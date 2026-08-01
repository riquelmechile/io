import type { CasResult, WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { JournalEntry } from '@io/business-domain/src/ports/idempotency.js';
import {
  InMemoryIdempotencyJournalRepository,
  type InMemoryWorkRepository,
} from '@io/business-domain/src/ports/fakes.js';
import type { Work } from '@io/business-domain/src/types.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';

import { decidePreEffect, reconcilePreEffect } from '../src/worker/reconcile.js';
import { runWorker } from '../src/worker/worker.js';
import { harness, seed, workerInput } from './worker-helpers.js';

/**
 * B6 — Pre-effect journal lookup reconciliation (WC reconciliation pre-effect +
 * IJ retryable/completed lookup parity): the decision table MUST match the
 * design table — completed+same → REPLAY stop; completed+diff → DENY;
 * aborted_retryable+same → reopen → execute; aborted_retryable+diff → DENY;
 * in_flight → recovery (no re-insert); none → insertInFlight → execute.
 */

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    companyId: 'acme',
    idempotencyKey: 'close-2026-q3',
    requestHash: 'hash-1',
    attemptId: 'att:acme:close-2026-q3',
    status: 'completed',
    resultJson: { ok: true, note: 'done' },
    ...overrides,
  };
}

const ATTEMPT = 'att:acme:close-2026-q3';

describe('decidePreEffect — decision table (matches design)', () => {
  it('completed + same hash → REPLAY with the recorded result (no effect)', () => {
    expect(decidePreEffect(entry(), 'hash-1')).toEqual({
      kind: 'replay',
      resultJson: { ok: true, note: 'done' },
    });
  });

  it('completed + different hash → DENY idempotency-conflict', () => {
    expect(decidePreEffect(entry(), 'hash-2')).toEqual({
      kind: 'deny',
      reason: 'idempotency-conflict',
    });
  });

  it('aborted_retryable + same hash → proceed (reopen via insertInFlight)', () => {
    expect(
      decidePreEffect(entry({ status: 'aborted_retryable', resultJson: undefined }), 'hash-1'),
    ).toEqual({
      kind: 'proceed',
    });
  });

  it('aborted_retryable + different hash → DENY', () => {
    expect(
      decidePreEffect(entry({ status: 'aborted_retryable', resultJson: undefined }), 'hash-2'),
    ).toEqual({
      kind: 'deny',
      reason: 'idempotency-conflict',
    });
  });

  it('in_flight + same hash → recovery (never replays a partial result)', () => {
    expect(
      decidePreEffect(entry({ status: 'in_flight', resultJson: undefined }), 'hash-1'),
    ).toEqual({
      kind: 'recovery',
    });
  });

  it('in_flight + different hash → DENY (conservative: a conflicting concurrent attempt)', () => {
    expect(
      decidePreEffect(entry({ status: 'in_flight', resultJson: undefined }), 'hash-2'),
    ).toEqual({
      kind: 'deny',
      reason: 'idempotency-conflict',
    });
  });

  it('no entry → proceed (insertInFlight)', () => {
    expect(decidePreEffect(undefined, 'hash-1')).toEqual({ kind: 'proceed' });
  });
});

describe('reconcilePreEffect — journal-anchored driver', () => {
  it('none → proceed and insertInFlight creates the in_flight row', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();

    const decision = await reconcilePreEffect(journal, 'acme', 'close-2026-q3', 'hash-1', ATTEMPT);

    expect(decision).toEqual({ kind: 'proceed' });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('aborted_retryable + same hash → proceed and REOPEN: in_flight, ORIGINAL attemptId kept', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });
    await journal.markRetryable(ATTEMPT);

    const decision = await reconcilePreEffect(journal, 'acme', 'close-2026-q3', 'hash-1', ATTEMPT);

    expect(decision).toEqual({ kind: 'proceed' });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('completed + same hash → REPLAY and the row is NOT mutated', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });
    await journal.complete(ATTEMPT, { ok: true, note: 'done' });

    const decision = await reconcilePreEffect(journal, 'acme', 'close-2026-q3', 'hash-1', ATTEMPT);

    expect(decision).toEqual({ kind: 'replay', resultJson: { ok: true, note: 'done' } });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('completed');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('in_flight → recovery with NO re-insert (row untouched)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });

    const decision = await reconcilePreEffect(journal, 'acme', 'close-2026-q3', 'hash-1', ATTEMPT);

    expect(decision).toEqual({ kind: 'recovery' });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('a different hash under any existing status → DENY without mutating', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });

    const decision = await reconcilePreEffect(journal, 'acme', 'close-2026-q3', 'hash-2', ATTEMPT);

    expect(decision).toEqual({ kind: 'deny', reason: 'idempotency-conflict' });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
  });
});

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
 * `in_progress` work bumps the stored version (keeping the work in_progress)
 * while returning the STALE snapshot — so the finalize T1 CAS loses exactly
 * once. The `in_progress` guard means the initial claim read (accepted) never
 * races: the claim always wins, the race fires only at the finalize close.
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
}

describe('cycle reconciliation (WC reconciliation pre-effect)', () => {
  it('none → insertInFlight → effect runs (fresh attempt)', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    expect(h.sandbox.executes).toHaveLength(1);
    expect(h.journal.snapshot()).toHaveLength(1);
  });

  it('completed + same hash → REPLAY stop: recorded result returned, NO new effect, NO receipt', async () => {
    const h = harness();
    await seed(h);
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });
    await h.journal.complete(ATTEMPT, { ok: true, note: 'done' });

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    if (result.ok && 'replayed' in result) {
      expect(result.replayed).toBe(true);
      expect(result.resultJson).toEqual({ ok: true, note: 'done' });
    }
    expect(h.sandbox.executes).toHaveLength(0);
    expect(h.receipts.saves).toHaveLength(0);
  });

  it('completed + different hash → DENY idempotency-conflict, no effect', async () => {
    const h = harness();
    await seed(h);
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-0',
      attemptId: ATTEMPT,
    });
    await h.journal.complete(ATTEMPT, { ok: true });

    const result = await runWorker(workerInput({ requestHash: 'hash-1' }), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('idempotency-conflict');
    expect(h.sandbox.executes).toHaveLength(0);
  });

  it('aborted_retryable + same hash → REOPEN → effect runs again (controlled retry resume: work already in_progress)', async () => {
    const h = harness();
    // Realistic post-CAS-loss state: the work is STILL in_progress (T2(i) never
    // mutates it) and the journal holds the aborted_retryable marker. The
    // resume-aware claim must NOT re-claim — it resumes and the pre-effect
    // reopen drives the fresh effect.
    await seed(h, { state: 'in_progress', version: 2 });
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });
    await h.journal.markRetryable(ATTEMPT);

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
    expect(h.sandbox.executes).toHaveLength(1);
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('aborted_retryable + different hash → DENY, no effect (resume of an already-claimed work)', async () => {
    const h = harness();
    await seed(h, { state: 'in_progress', version: 2 });
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-0',
      attemptId: ATTEMPT,
    });
    await h.journal.markRetryable(ATTEMPT);

    const result = await runWorker(workerInput({ requestHash: 'hash-1' }), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('idempotency-conflict');
    expect(h.sandbox.executes).toHaveLength(0);
  });

  it('in_flight → recovery-required: stops with NO re-insert and NO effect (crash-before-effect resume)', async () => {
    const h = harness();
    // Realistic crash-before-effect state: the claim ran (work in_progress)
    // and the in-flight row was committed, then the worker died. The resume
    // must pass the claim and reach the honest in_flight recovery result.
    await seed(h, { state: 'in_progress', version: 2 });
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('recovery-required');
    expect(h.sandbox.executes).toHaveLength(0);
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
  });

  it('BLOCKER: a same-key retry via runWorker after a REAL finalize CAS-loss resumes the cycle and completes — the key is never bricked', async () => {
    // First runWorker: the finalize T1 CAS loses a race with a concurrent
    // writer (work stays in_progress) → T2(i) undoes the effect + sets the
    // durable aborted_retryable marker. The Work is LEFT in_progress.
    const h = harness();
    await seed(h);
    const racing = new RacingWorkRepository(h.work, (work) => ({ ...work, state: 'in_progress' }));
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    const lost = await runWorker(workerInput(), { ...h, work: racing, connection: conn });

    expect(lost.ok).toBe(false);
    if (lost.ok) return;
    expect(lost.reason).toBe('cas-lost-retryable');
    expect((await h.work.get('acme', 'work-1'))?.state).toBe('in_progress');
    expect((await h.journal.lookup('acme', 'close-2026-q3'))?.status).toBe('aborted_retryable');
    expect(h.sandbox.undos).toHaveLength(1);
    expect(h.receipts.saves).toHaveLength(0);

    // Second runWorker with the SAME key + hash: the resume-aware claim must
    // NOT re-claim (startWork rejects in_progress → in_progress with
    // invalid-transition). It resumes the cycle's OWN work: reopen → effect →
    // verify → finalize → completed, exactly one receipt.
    const retry = await runWorker(workerInput(), { ...h, connection: conn });

    expect(retry.ok).toBe(true);
    if (!retry.ok || 'replayed' in retry) return;
    expect(retry.work.state).toBe('completed');
    expect(retry.receipt?.receiptId).toBe(`rcpt:${ATTEMPT}`);
    // Exactly ONE receipt across both runs (the lost run never issued one).
    expect(h.receipts.saves).toHaveLength(1);
    expect((await h.journal.lookup('acme', 'close-2026-q3'))?.status).toBe('completed');
    expect(conn.commits).toBe(1);
  });

  it('WARNING: a TERMINAL work (completed out-of-band under a SECOND key) must NOT resume into effect→verify→finalize on a same-key retry — no second receipt, no duplicate effect, honest UNRESOLVED close', async () => {
    // Narrow double-receipt scenario: key1 holds the cycle's OWN attempt (the
    // aborted_retryable marker from a prior CAS loss) while the WORK was
    // completed OUT-OF-BAND under a SECOND idempotency key (key2) — terminal
    // work, exactly ONE receipt. A same-key retry of key1 must NOT resume the
    // effect pipeline: resuming would reopen key1, re-apply the effect (a
    // duplicate document), and CAS completed → completed in T1, issuing a
    // SECOND receipt with a DIFFERENT terminal_event_id (key1's attemptId) —
    // which UNIQUE(work_id, terminal_event_id) does NOT catch. The honest
    // terminal handling must close the unresolvable attempt instead.
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());

    // Key2 completes the work OUT-OF-BAND: terminal completed + ONE receipt.
    const current = await h.work.get('acme', 'work-1');
    if (current === undefined) throw new Error('test setup: work not seeded');
    const completed = await h.work.updateIfVersion(
      { ...current, state: 'completed' },
      current.version,
    );
    if (!completed.ok) throw new Error('test setup: out-of-band completion failed');
    const key2Attempt = 'att:acme:close-2026-q3-key2';
    await h.receipts.save({
      receiptId: `rcpt:${key2Attempt}`,
      companyId: 'acme',
      workId: 'work-1',
      delegationId: 'del-1',
      actor: 'principal-executor',
      policyHash: 'worker:low-risk-documents',
      evidenceRefs: ['ev:acme:close-2026-q3-key2'],
      terminalState: 'completed',
      terminalEventId: key2Attempt,
      artifactHash: 'worker:create-document',
      issuedAt: 1,
    });
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3-key2',
      requestHash: 'hash-2',
      attemptId: key2Attempt,
    });
    await h.journal.complete(key2Attempt, { ok: true, state: 'completed' });

    // Key1's own attempt sits aborted_retryable (prior CAS loss); the work is
    // now terminal. Same-key retry of key1 must NOT reopen/re-apply/finalize.
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });
    await h.journal.markRetryable(ATTEMPT);

    const result = await runWorker(workerInput(), { ...h, connection: conn });

    // The honest terminal result: the attempt is unresolvable, never re-run.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('UNRESOLVED_REQUIRES_HUMAN');
    expect(result.current?.state).toBe('completed');
    // Exactly ONE receipt total (key2's) — the retry issued NO second receipt.
    expect(h.receipts.saves).toHaveLength(1);
    // The effect was NOT re-applied: no duplicate document was created.
    expect(h.sandbox.executes).toHaveLength(0);
    expect(conn.commits).toBe(0);
    expect(conn.rollbacks).toBe(0);
    // The attempt was closed honestly: NO retryable marker left on a terminal
    // key (a marker would invite an endless retry of a key whose work is done).
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    // The terminal work was NOT mutated by the retry.
    expect((await h.work.get('acme', 'work-1'))?.state).toBe('completed');
  });

  it('crash before the effect (in_flight + in_progress): runWorker resumes past the claim to the typed reconciliation result — never invalid-transition', async () => {
    // Realistic crash site: the claim ran (work in_progress) and the in-flight
    // journal row was committed, but the worker died BEFORE the effect. A
    // same-key resume must NOT die at the claim (startWork rejects
    // in_progress → in_progress with invalid-transition); it proceeds and the
    // pre-effect reconcile closes the still-in_flight attempt honestly
    // (design pre-effect "recovery path (no re-insert)") → recovery-required.
    const h = harness();
    await seed(h);
    const current = await h.work.get('acme', 'work-1');
    if (current === undefined) throw new Error('test setup: work not seeded');
    const claimed = await h.work.updateIfVersion(
      { ...current, state: 'in_progress' },
      current.version,
    );
    if (!claimed.ok) throw new Error('test setup: claim failed');
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
    });

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('recovery-required');
    }
    expect(h.sandbox.executes).toHaveLength(0);
    expect(h.receipts.saves).toHaveLength(0);
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.attemptId).toBe(ATTEMPT);
    expect((await h.work.get('acme', 'work-1'))?.state).toBe('in_progress');
  });
});
