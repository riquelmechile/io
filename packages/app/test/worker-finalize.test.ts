import type { InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';

import type { CasResult, WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { Work } from '@io/business-domain/src/types.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';

import type { EffectRecord } from '../src/sandbox/sandbox-port.js';
import {
  type FinalizeDeps,
  type FinalizeInput,
  finalizeInFlightWorkAtomically,
  WORKER_ARTIFACT_HASH,
  WORKER_POLICY_HASH,
} from '../src/worker/finalize.js';
import { runWorker } from '../src/worker/worker.js';
import {
  cannedLlm,
  harness,
  principals,
  seed,
  type WorkerHarness,
  workerInput,
} from './worker-helpers.js';

/**
 * B7 — finalizeInFlightWorkAtomically twin (design "Finalize CAS-loss", WC-6
 * atomic-close + WC-7 journal-anchored reconciliation): T1 = CAS close in ONE
 * transaction (get → updateIfVersion(completed) → one receipt → journal.complete
 * → COMMIT); T1 CAS-loss STOPS BEFORE the receipt and ROLLS BACK (the
 * pre-committed in_flight row survives — it was committed before the effect in
 * a different tx); after the rollback, T2 reconciles honestly:
 *   (i) work still in_progress + effect applied → undo + markRetryable (OWN
 *       committed write, NEVER a failure-complete) → cas-lost-retryable;
 *   (ii) work already terminal + effect applied → NO undo, NO marker, only
 *       journal.complete(UNRESOLVED_REQUIRES_HUMAN) → UNRESOLVED_REQUIRES_HUMAN.
 * Replay (completed + same hash) and DENY (completed + diff hash) close the
 * WC-6 lookup table. The effect STAYS OUTSIDE T1 (§9.8) — re-confirmed by the
 * updated worker-effect test now that the terminal tx exists.
 */

const COMPANY = 'acme';
const KEY = 'close-2026-q3';
const HASH = 'hash-1';
const ATTEMPT = 'att:acme:close-2026-q3';
const WORK_ID = 'work-1';

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

/**
 * WorkRepository that simulates a concurrent writer winning BETWEEN the
 * finalize read (`get`) and its CAS (`updateIfVersion`): the FIRST read of an
 * `in_progress` work bumps the stored version (and applies the race's state)
 * while returning the STALE snapshot — so the finalize CAS loses exactly once.
 */
class RacingWorkRepository implements WorkRepository {
  private raced = false;
  constructor(
    private readonly inner: InMemoryWorkRepository,
    private readonly race: (work: Work) => Work,
  ) {}

  save(work: Work): Promise<Readonly<Work>> {
    return this.inner.save(work);
  }

  async get(companyId: string, workId: string): Promise<Work | undefined> {
    const stored = await this.inner.get(companyId, workId);
    if (stored !== undefined && stored.state === 'in_progress' && !this.raced) {
      this.raced = true;
      await this.inner.updateIfVersion(this.race(stored), stored.version);
    }
    return stored;
  }

  updateIfVersion(work: Work, expectedVersion: number): Promise<CasResult> {
    return this.inner.updateIfVersion(work, expectedVersion);
  }

  async listActionableByCompany(companyId: string): Promise<readonly Work[]> {
    return this.inner.listActionableByCompany(companyId);
  }

  async listRecoveryRequestedByCompany(companyId: string): Promise<readonly Work[]> {
    return this.inner.listRecoveryRequestedByCompany(companyId);
  }

  setRecoveryRequest(
    companyId: string,
    workId: string,
    expectedVersion: number,
    requested: boolean,
  ): Promise<CasResult> {
    return this.inner.setRecoveryRequest(companyId, workId, expectedVersion, requested);
  }
}

/** Claimed (in_progress) work + committed in_flight journal row + applied effect.
 * The claim mints the fencing token (0 → 1) exactly like the worker's claim. */
async function closeReady(h: WorkerHarness): Promise<{ effect: EffectRecord }> {
  await seed(h);
  const current = await h.work.get(COMPANY, WORK_ID);
  if (current === undefined) throw new Error('test setup: work not seeded');
  const claimed = await h.work.updateIfVersion({ ...current, state: 'in_progress' }, 1, {
    kind: 'claim',
  });
  if (!claimed.ok) throw new Error('test setup: claim failed');
  expect(claimed.ok && claimed.value.fencingToken).toBe(1);
  await h.journal.insertInFlight({
    companyId: COMPANY,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    // The journal row stores the MINTED claim token (1) — exactly what the
    // worker's pre-effect insertInFlight writes after the claim, so the T2(i)
    // markRetryable(attemptId, token) gate matches (fencing-tokens change).
    fencingToken: 1,
  });
  const effect = await h.sandbox.execute({
    type: 'create-document',
    relativePath: 'docs/quarterly-close.md',
    content: 'closed for Q3 2026',
  });
  return { effect };
}

function finalizeDeps(
  h: WorkerHarness,
  conn: DbConnection,
  overrides: Partial<FinalizeDeps> = {},
): FinalizeDeps {
  return {
    // The fakes ignore the connection: the same in-memory instances serve the
    // transaction-scoped (T1) and the pool (T2/WC-6 lookup) connections.
    repositories: () => ({
      work: h.work,
      receipts: h.receipts,
      journal: h.journal,
      events: h.events,
    }),
    sandbox: h.sandbox,
    connection: conn,
    executor: principals.executor,
    ...overrides,
  };
}

function finalizeInput(
  effect: EffectRecord,
  overrides: Partial<FinalizeInput> = {},
): FinalizeInput {
  return {
    companyId: COMPANY,
    workId: WORK_ID,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    // The claim minted token 1 (closeReady uses the claim directive); the
    // claim-owned terminal close must present the retained token.
    fencingToken: 1,
    effect,
    ...overrides,
  };
}

describe('finalizeInFlightWorkAtomically — T1 atomic close (WC atomic-close)', () => {
  it('T1 success: CAS → exactly one receipt (rcpt:<attemptId>, terminal_event_id=attemptId, evidenceId) → journal.complete → COMMIT', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn),
      finalizeInput(effect),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || 'replayed' in result) return;
    expect(result.work.state).toBe('completed');
    expect(result.work.version).toBe(3);
    // Exactly one receipt; the receipt references the STABLE evidence identity.
    expect(h.receipts.saves).toHaveLength(1);
    const receipt = h.receipts.saves[0];
    expect(receipt?.receiptId).toBe(`rcpt:${ATTEMPT}`);
    expect(receipt?.terminalEventId).toBe(ATTEMPT);
    expect(receipt?.terminalState).toBe('completed');
    expect(receipt?.workId).toBe(WORK_ID);
    expect(receipt?.delegationId).toBe('del-1');
    expect(receipt?.evidenceRefs).toContain('ev:acme:close-2026-q3');
    expect(receipt?.policyHash).toBe(WORKER_POLICY_HASH);
    expect(receipt?.artifactHash).toBe(WORKER_ARTIFACT_HASH);
    // Journal closed with the completed work as the stored result.
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toMatchObject({ state: 'completed' });
    // EXACTLY ONE `work.completed` event appended in the SAME transaction
    // (R5): evt:{attemptId}, built ONLY from terminal-close facts.
    expect(h.events.appends).toHaveLength(1);
    const event = h.events.appends[0];
    expect(event?.eventId).toBe(`evt:${ATTEMPT}`);
    expect(event?.companyId).toBe(COMPANY);
    expect(event?.aggregateKind).toBe('work');
    expect(event?.aggregateId).toBe(WORK_ID);
    expect(event?.eventType).toBe('work.completed');
    expect(event?.source).toBe('worker');
    expect(typeof event?.occurredAt).toBe('number');
    expect(event?.payload).toMatchObject({
      workId: WORK_ID,
      state: 'completed',
      receiptId: `rcpt:${ATTEMPT}`,
      terminalState: 'completed',
      evidenceId: 'ev:acme:close-2026-q3',
      attemptId: ATTEMPT,
      actor: principals.executor,
    });
    // T1 committed; nothing rolled back.
    expect(conn.commits).toBe(1);
    expect(conn.rollbacks).toBe(0);
  });

  it('R6: equal terminal-close facts + different LLM output → IDENTICAL events (model-independent payload)', async () => {
    // Two full cycles over the SAME work/key with a FIXED clock and DIFFERENT
    // LLM plans (different document content — different model output). The
    // event must be built ONLY from terminal facts — the model output MUST NOT
    // select, judge, or alter any event field (R6).
    const now = () => 1_234_567_890;
    const first = harness({ now });
    await seed(first);
    const second = harness({
      now,
      llm: cannedLlm(
        JSON.stringify({
          steps: [
            {
              action: 'create-document',
              args: {
                relativePath: 'docs/quarterly-close-draft.md',
                content: 'COMPLETELY DIFFERENT MODEL CONTENT',
              },
            },
          ],
          intent: 'a different plan for the same work',
        }),
      ),
    });
    await seed(second);

    const a = await runWorker(
      workerInput(),
      {
        ...first,
        connection: new TxTrackingConnection(new InMemoryDbConnection()),
      },
      'flash',
    );
    const b = await runWorker(
      workerInput(),
      {
        ...second,
        connection: new TxTrackingConnection(new InMemoryDbConnection()),
      },
      'flash',
    );

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || 'replayed' in a || !b.ok || 'replayed' in b) return;
    // Exactly one event per close, and the two are BYTE-IDENTICAL.
    expect(first.events.appends).toHaveLength(1);
    expect(second.events.appends).toHaveLength(1);
    expect(second.events.appends[0]).toEqual(first.events.appends[0]);
    // No LLM output leaked into the event payload (no content/path fields).
    expect(first.events.appends[0]?.payload).not.toHaveProperty('content');
    expect(first.events.appends[0]?.payload).not.toHaveProperty('relativePath');
  });
  it('T1 CAS-loss: stops BEFORE receipts.save → T1 ROLLS BACK; the pre-committed in_flight row survives; marker is NOT a failure-complete', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    // The concurrent writer wins with the work STILL in_progress → T2(i).
    const racing = new RacingWorkRepository(h.work, (work) => ({ ...work, state: 'in_progress' }));

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn, {
        repositories: () => ({
          work: racing,
          receipts: h.receipts,
          journal: h.journal,
          events: h.events,
        }),
      }),
      finalizeInput(effect),
    );

    // T2(i): controlled retry allowed — the key is marked retryable, never completed.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cas-lost-retryable');
    expect(result.current?.state).toBe('in_progress');
    // T1 stopped BEFORE the receipt: no receipt was ever saved.
    expect(h.receipts.saves).toHaveLength(0);
    // R5 orphan guard: the CAS loss aborted T1 BEFORE the append — ZERO events
    // from the losing attempt (the append is inside the transaction, so the
    // throw rolls it back).
    expect(h.events.appends).toHaveLength(0);
    // T1 rolled back (aborted), and the effect was reversed + marker set.
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(1);
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(true);
    expect(h.journal.log.some((logged) => logged.startsWith('complete:'))).toBe(false);
    // The pre-committed in_flight row SURVIVED the T1 rollback: markRetryable
    // (which rejects missing attempts) succeeded, so the row was never destroyed.
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.attemptId).toBe(ATTEMPT);
    // The marker is NOT a failure-complete: a same-key same-hash retry reopens
    // (a successful claim — typed {ok:true}, never a throw).
    await expect(
      h.journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 0,
      }),
    ).resolves.toEqual({ ok: true });
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
    // The failed CAS never overwrote the work; the effect was undone.
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
    expect(h.sandbox.undos).toHaveLength(1);
    expect(await h.sandbox.wasApplied(effect.undo.handleId)).toBe(false);
  });

  it('STALE-token close: a holder with the WRONG token cannot close — T1 rolls back Work+journal+receipt+event atomically, and the ZOMBIE cannot mark the row retryable (fencing "Stale-token close rolls back atomically" + "Stale token cannot mark retryable")', async () => {
    const h = harness();
    const { effect } = await closeReady(h); // claim minted token 1, work in_progress
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    // The holder presents token 0 — NOT the minted claim token 1. The T1 CAS
    // (token-checked terminal directive) must NOT land.
    const attempt = finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn),
      finalizeInput(effect, { fencingToken: 0 }),
    );

    // T1 aborted (fencing-conflict → FinalizeCasLostError → rollback). The T2
    // reconcile then hits the CLAIM-OWNERSHIP GATE: the effect is undone (the
    // zombie's own effect is reversed), but markRetryable(attemptId, 0) against
    // the stored claim token 1 is REJECTED — a stale holder must never mark a
    // row it does not own. The rejection FAILS LOUDLY (R4-001): the zombie
    // cannot close AND cannot mutate the row. The row stays in_flight under the
    // REAL claim (token 1); a later recovery pass sees in_flight + no applied
    // effect → clean replay (self-healing, never a fabricated resolution).
    await expect(attempt).rejects.toThrow(/fencing token mismatch/i);
    // Every terminal mutation rolled back atomically: no receipt, no event,
    // no journal.complete, no work terminal state.
    expect(h.receipts.saves).toHaveLength(0);
    expect(h.events.appends).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(1);
    expect(h.journal.log.some((logged) => logged.startsWith('complete:'))).toBe(false);
    const stored = await h.work.get(COMPANY, WORK_ID);
    expect(stored?.state).toBe('in_progress');
    expect(stored?.fencingToken).toBe(1);
    expect(stored?.version).toBe(2);
    // The zombie's effect was reversed (its own effect is undone), but the
    // journal row is UNTOUCHED by the zombie: still in_flight, still owned by
    // token 1 — the marker write was refused (never a failure-complete, never
    // a zombie-issued marker).
    expect(h.sandbox.undos).toHaveLength(1);
    expect(await h.sandbox.wasApplied(effect.undo.handleId)).toBe(false);
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('in_flight');
    expect(row?.fencingToken).toBe(1);
  });

  it('matching-token close succeeds: the claim owner presents the minted token 1 and the terminal CAS lands (fencing happy path)', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn),
      finalizeInput(effect, { fencingToken: 1 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || 'replayed' in result) return;
    expect(result.work.state).toBe('completed');
    expect(h.receipts.saves).toHaveLength(1);
    expect(conn.commits).toBe(1);
    expect(conn.rollbacks).toBe(0);
    const stored = await h.work.get(COMPANY, WORK_ID);
    expect(stored?.state).toBe('completed');
    // The terminal close retains the claim token (no re-mint).
    expect(stored?.fencingToken).toBe(1);
  });

  it('T2(ii): work already terminal + effect applied → NO undo, NO marker, journal.complete(UNRESOLVED) → UNRESOLVED_REQUIRES_HUMAN', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    // The concurrent writer already completed the work → T2(ii).
    const racing = new RacingWorkRepository(h.work, (work) => ({ ...work, state: 'completed' }));

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn, {
        repositories: () => ({
          work: racing,
          receipts: h.receipts,
          journal: h.journal,
          events: h.events,
        }),
      }),
      finalizeInput(effect),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNRESOLVED_REQUIRES_HUMAN');
    expect(result.current?.state).toBe('completed');
    // T1 rolled back before any receipt.
    expect(h.receipts.saves).toHaveLength(0);
    // R5 orphan guard: the terminal-work abort (T2(ii)) also never appends —
    // the state guard throws before the receipt AND the event.
    expect(h.events.appends).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(1);
    // NEVER fabricate a resolution: the journal row is closed with the typed
    // UNRESOLVED result, and the marker is NOT set (a marker would invite a
    // retry of a key whose work is already terminal).
    expect(h.journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(false);
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    // No undo: the concurrent terminal state is authoritative — reversing the
    // effect would fabricate an in_progress that no longer exists.
    expect(h.sandbox.undos).toHaveLength(0);
    expect(await h.sandbox.wasApplied(effect.undo.handleId)).toBe(true);
  });
});

describe('finalizeInFlightWorkAtomically — replay / DENY (WC atomic-close lookup)', () => {
  it('completed + same hash → REPLAY the recorded result: no new receipt, no effect, no transaction', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    await h.journal.complete(ATTEMPT, { ok: true, note: 'done' });
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn),
      finalizeInput(effect),
    );

    expect(result).toEqual({ ok: true, replayed: true, resultJson: { ok: true, note: 'done' } });
    expect(h.receipts.saves).toHaveLength(0);
    // R7: the replay early-returns BEFORE T1 — no second event append (the
    // recorded result is replayed, the close never re-runs).
    expect(h.events.appends).toHaveLength(0);
    expect(h.sandbox.undos).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(0);
    // The work is untouched: replay never re-runs the CAS transition.
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });

  it('completed + different hash → DENY idempotency-conflict: no receipt, no effect, no transaction', async () => {
    const h = harness();
    const { effect } = await closeReady(h);
    await h.journal.complete(ATTEMPT, { ok: true });
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await finalizeInFlightWorkAtomically(
      finalizeDeps(h, conn),
      finalizeInput(effect, { requestHash: 'hash-2' }),
    );

    expect(result).toEqual({ ok: false, reason: 'idempotency-conflict' });
    expect(h.receipts.saves).toHaveLength(0);
    expect(h.sandbox.undos).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(0);
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });
});

describe('cycle wiring (B7) — finalize runs after the effect, INSIDE the terminal tx', () => {
  it('full cycle with a connection: claim → intent → effect → finalize → work completed + exactly one receipt + journal completed', async () => {
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await runWorker(workerInput(), { ...h, connection: conn }, 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok || 'replayed' in result) return;
    expect(result.work.state).toBe('completed');
    expect(result.work.version).toBe(3);
    expect(result.receipt?.receiptId).toBe(`rcpt:${ATTEMPT}`);
    expect(result.receipt?.terminalEventId).toBe(ATTEMPT);
    expect(result.receipt?.evidenceRefs).toContain('ev:acme:close-2026-q3');
    // Exactly one receipt per (work_id, terminal_event_id).
    expect(h.receipts.saves).toHaveLength(1);
    const row = await h.journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    // §9.8: the effect ran OUTSIDE T1 — intent commit, then the effect, then the
    // SINGLE terminal transaction (T1).
    const insertIdx = h.trace.findIndex((entry) => entry.startsWith('journal:insertInFlight'));
    const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(executeIdx).toBeGreaterThan(insertIdx);
    expect(conn.commits).toBe(1);
    expect(conn.rollbacks).toBe(0);
    expect(await h.sandbox.wasApplied(result.effect.undo.handleId)).toBe(true);
  });

  it('cycle CAS-loss: finalize returns cas-lost-retryable → no receipt, effect undone, retryable marker set', async () => {
    const h = harness();
    await seed(h);
    const racing = new RacingWorkRepository(h.work, (work) => ({ ...work, state: 'in_progress' }));
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const result = await runWorker(
      workerInput(),
      {
        ...h,
        work: racing,
        connection: conn,
        // The racing double must reach the finalize twin's T1 too.
        repositories: () => ({
          work: racing,
          receipts: h.receipts,
          journal: h.journal,
          events: h.events,
        }),
      },
      'flash',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('cas-lost-retryable');
    expect(h.receipts.saves).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(1);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    // The applied effect was reversed during reconciliation.
    expect(h.sandbox.undos).toHaveLength(1);
    expect(await h.sandbox.wasApplied(h.sandbox.undos[0]?.handleId ?? '')).toBe(false);
    // The failed finalize never moved the work.
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });
});
