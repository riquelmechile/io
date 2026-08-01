import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';

import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import type {
  EffectRecord,
  SandboxAction,
  SandboxPort,
  UndoHandle,
} from '../src/sandbox/sandbox-port.js';
import { type FinalizeInput, reconcilePostEffectFailure } from '../src/worker/finalize.js';
import type { WorkerPrincipals } from '../src/worker/types.js';
import { verifyEffect } from '../src/worker/verify.js';
import { runWorker } from '../src/worker/worker.js';
import { harness, principals, seed, type WorkerHarness, workerInput } from './worker-helpers.js';

/**
 * B8 — Verify step + post-effect/verify-fail reconciliation (WC
 * reconciliation applied-reversed / no-effect-replay + SP no-leak
 * failed-verification): a DISTINCT verifier principal confirms the effect
 * outcome BEFORE the terminal close. `verifyEffect` enforces SoD
 * (verifier≠executor at every tier) and consults the sandbox undo log (SoT,
 * §9.8) — an effect that never ran, or whose undo log does not confirm it,
 * FAILS verification. A failed verification is a post-effect failure: the
 * worker reconciles EXACTLY like the finalize CAS-loss path (design "Other
 * post-effect failures … same as CAS-loss (i)") via the SHARED
 * `reconcilePostEffectFailure`:
 *   - in_progress + applied  → undo + markRetryable → `cas-lost-retryable`
 *   - in_progress + NO effect → clean replay: NO undo, NO marker → `recovery-required`
 *   - already terminal       → typed `UNRESOLVED_REQUIRES_HUMAN` (never fabricate)
 * The verify step runs BETWEEN the effect and the finalize twin.
 */

const COMPANY = 'acme';
const KEY = 'close-2026-q3';
const HASH = 'hash-1';
const ATTEMPT = 'att:acme:close-2026-q3';
const WORK_ID = 'work-1';

const docAction: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/quarterly-close.md',
  content: 'closed for Q3 2026',
};

/** DbConnection double that counts committed vs rolled-back transactions. */
class TxTrackingConnection implements DbConnection {
  commits = 0;
  rollbacks = 0;
  constructor(private readonly inner: DbConnection) {}

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    return this.inner.execute(sql, params);
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    return this.inner.query<T>(sql, params);
  }

  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    try {
      const result = await this.inner.transaction(fn);
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

/** Sandbox double that traces every port call into the shared phase trace. */
class TraceSandbox implements SandboxPort {
  readonly undos: UndoHandle[] = [];
  protected readonly inner = new InMemorySandbox();
  constructor(protected readonly trace?: string[]) {}

  async execute(action: SandboxAction): Promise<EffectRecord> {
    this.trace?.push(`sandbox:execute:${action.relativePath}`);
    return this.inner.execute(action);
  }

  async undo(handle: UndoHandle): Promise<void> {
    this.undos.push(handle);
    return this.inner.undo(handle);
  }

  async wasApplied(handleId: string): Promise<boolean> {
    this.trace?.push('sandbox:verify:wasApplied');
    return this.inner.wasApplied(handleId);
  }
}

/** Verify-failure simulation: the verifier finds the document missing — the
 * undo log (SoT) does NOT confirm the effect, though the record claims it. */
class MissingDocumentSandbox extends TraceSandbox {
  override async wasApplied(_handleId: string): Promise<boolean> {
    this.trace?.push('sandbox:verify:wasApplied');
    return false;
  }
}

/** Verify-failure simulation: the effect never ran (record says not applied). */
class NotAppliedSandbox extends TraceSandbox {
  override async execute(action: SandboxAction): Promise<EffectRecord> {
    const record = await super.execute(action);
    return { ...record, applied: false };
  }
}

/** Claimed (in_progress) work + committed in_flight journal row + applied effect. */
async function closeReady(h: WorkerHarness): Promise<EffectRecord> {
  await seed(h);
  const current = await h.work.get(COMPANY, WORK_ID);
  if (current === undefined) throw new Error('test setup: work not seeded');
  const claimed = await h.work.updateIfVersion(
    { ...current, state: 'in_progress' },
    current.version,
  );
  if (!claimed.ok) throw new Error('test setup: claim failed');
  await h.journal.insertInFlight({
    companyId: COMPANY,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
  });
  return h.sandbox.execute(docAction);
}

function reconcileInput(
  effect: EffectRecord,
  overrides: Partial<FinalizeInput> = {},
): FinalizeInput {
  return {
    companyId: COMPANY,
    workId: WORK_ID,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    effect,
    ...overrides,
  };
}

describe('verifyEffect — distinct verifier step (WC reconciliation + SP no-leak)', () => {
  it('distinct principals + applied effect + undo log confirms → verification passes', async () => {
    const h = harness();
    const effect = await h.sandbox.execute(docAction);

    const result = await verifyEffect({ sandbox: h.sandbox, principals }, { effect });

    expect(result).toEqual({ ok: true });
  });

  it('verifier === executor → verification FAILS (SoD ABSOLUTE_PAIRS at every tier)', async () => {
    const h = harness();
    const effect = await h.sandbox.execute(docAction);
    const collapsed: WorkerPrincipals = { ...principals, verifier: principals.executor };

    const result = await verifyEffect({ sandbox: h.sandbox, principals: collapsed }, { effect });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('verification-failed');
    expect(result.detail).toMatch(/verifier|sod/i);
  });

  it('an effect that never ran (record applied:false) cannot be verified → verification FAILS', async () => {
    const h = harness();
    const effect = await h.sandbox.execute(docAction);

    const result = await verifyEffect(
      { sandbox: h.sandbox, principals },
      { effect: { ...effect, applied: false } },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('verification-failed');
  });

  it('the undo log (SoT) does NOT confirm the effect → verification FAILS (no silent pass)', async () => {
    const sandbox = new MissingDocumentSandbox();
    const effect = await sandbox.execute(docAction); // record claims applied:true

    const result = await verifyEffect({ sandbox, principals }, { effect });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('verification-failed');
  });
});

describe('reconcilePostEffectFailure — post-effect/verify-fail reconciliation (same path as CAS-loss)', () => {
  it('in_progress + applied → undo FIRST, then markRetryable (own commit) → cas-lost-retryable; attempt closed with the marker', async () => {
    const h = harness();
    const effect = await closeReady(h);

    const result = await reconcilePostEffectFailure(
      { work: h.work, journal: h.journal, sandbox: h.sandbox },
      reconcileInput(effect),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'cas-lost-retryable',
      current: expect.objectContaining({ state: 'in_progress' }),
    });
    // The applied effect was reversed, then the attempt was closed.
    expect(h.sandbox.undos).toHaveLength(1);
    expect(await h.sandbox.wasApplied(effect.undo.handleId)).toBe(false);
    // Closed via the retryable marker — NEVER a failure-complete.
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(true);
    expect(h.journal.log.some((logged) => logged.startsWith('complete:'))).toBe(false);
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable');
    // The work is untouched by the reconcile.
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });

  it('in_progress + NO effect applied → clean replay: NO undo, NO marker → recovery-required', async () => {
    const h = harness();
    await closeReady(h);
    const notApplied: EffectRecord = {
      effectId: 'effect-none',
      action: docAction,
      absolutePath: '/io/mem/docs/quarterly-close.md',
      applied: false,
      // Synthetic handle: never dereferenced on the clean-replay branch (no undo).
      undo: { handleId: 'undo-none', action: docAction, applied: true },
    };

    const result = await reconcilePostEffectFailure(
      { work: h.work, journal: h.journal, sandbox: h.sandbox },
      reconcileInput(notApplied),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'recovery-required',
      current: expect.objectContaining({ state: 'in_progress' }),
    });
    // Nothing to reverse; nothing to mark — the attempt retries via the replay path.
    expect(h.sandbox.undos).toHaveLength(0);
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(false);
    expect(h.journal.log.some((logged) => logged.startsWith('complete:'))).toBe(false);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
  });

  it('work already terminal + applied → typed UNRESOLVED_REQUIRES_HUMAN: no undo, no marker (never fabricate)', async () => {
    const h = harness();
    const effect = await closeReady(h);
    const current = await h.work.get(COMPANY, WORK_ID);
    if (current === undefined) throw new Error('test setup');
    const completed = await h.work.updateIfVersion(
      { ...current, state: 'completed' },
      current.version,
    );
    if (!completed.ok) throw new Error('test setup: complete');

    const result = await reconcilePostEffectFailure(
      { work: h.work, journal: h.journal, sandbox: h.sandbox },
      reconcileInput(effect),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'UNRESOLVED_REQUIRES_HUMAN',
      current: expect.objectContaining({ state: 'completed' }),
    });
    expect(h.sandbox.undos).toHaveLength(0);
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(false);
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
  });
});

describe('cycle wiring (B8) — verify runs BETWEEN the effect and the finalize twin', () => {
  it('happy: verification passes and the full claim→…→effect→verify→finalize cycle completes with one receipt', async () => {
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    const sandbox = new TraceSandbox(h.trace);

    const result = await runWorker(workerInput(), { ...h, sandbox, connection: conn });

    expect(result.ok).toBe(true);
    if (!result.ok || 'replayed' in result) return;
    expect(result.work.state).toBe('completed');
    expect(result.receipt?.receiptId).toBe(`rcpt:${ATTEMPT}`);
    expect(h.receipts.saves).toHaveLength(1);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('completed');
    // Verify ran AFTER the effect and BEFORE the terminal close.
    const insertIdx = h.trace.findIndex((entry) => entry.startsWith('journal:insertInFlight'));
    const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
    const verifyIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:verify:wasApplied'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(executeIdx).toBeGreaterThan(insertIdx);
    expect(verifyIdx).toBeGreaterThan(executeIdx);
    expect(conn.commits).toBe(1);
    expect(conn.rollbacks).toBe(0);
  });

  it('verify fail with in_progress + applied → cas-lost-retryable: effect undone + marker set, finalize NEVER runs', async () => {
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    const sandbox = new MissingDocumentSandbox(h.trace);

    const result = await runWorker(workerInput(), { ...h, sandbox, connection: conn });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cas-lost-retryable');
    expect(result.current?.state).toBe('in_progress');
    // The applied effect was reversed during reconciliation.
    expect(sandbox.undos).toHaveLength(1);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    // Verify blocked the terminal close: no receipt, no T1 transaction.
    expect(h.receipts.saves).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(0);
    // The verify step ran after the effect, before any finalize.
    const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
    const verifyIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:verify:wasApplied'));
    expect(verifyIdx).toBeGreaterThan(executeIdx);
    expect(h.journal.log.some((logged) => logged.startsWith('complete:'))).toBe(false);
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });

  it('verify fail with NO effect applied → clean replay: recovery-required, NO undo, NO marker, no finalize', async () => {
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    const sandbox = new NotAppliedSandbox(h.trace);

    const result = await runWorker(workerInput(), { ...h, sandbox, connection: conn });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('recovery-required');
    expect(sandbox.undos).toHaveLength(0);
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(false);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
    expect(h.receipts.saves).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });
});
