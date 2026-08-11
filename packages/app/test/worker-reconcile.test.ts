import {
  InMemoryIdempotencyJournalRepository,
  type InMemoryWorkRepository,
} from '@io/business-domain/src/ports/fakes.js';
import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
} from '@io/business-domain/src/ports/idempotency.js';
import type { CasResult, WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { Work } from '@io/business-domain/src/types.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';

import { decidePreEffect, reconcilePreEffect } from '../src/worker/reconcile.js';
import { reconcilePostEffectFailure } from '../src/worker/finalize.js';
import type { EffectRecord, SandboxAction } from '../src/sandbox/sandbox-port.js';
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
    fencingToken: 0,
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

    const decision = await reconcilePreEffect(
      journal,
      'acme',
      'close-2026-q3',
      'hash-1',
      ATTEMPT,
      0,
    );

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
      fencingToken: 0,
    });
    await journal.markRetryable(ATTEMPT, 0);

    const decision = await reconcilePreEffect(
      journal,
      'acme',
      'close-2026-q3',
      'hash-1',
      ATTEMPT,
      0,
    );

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
      fencingToken: 0,
    });
    await journal.complete(ATTEMPT, { ok: true, note: 'done' });

    const decision = await reconcilePreEffect(
      journal,
      'acme',
      'close-2026-q3',
      'hash-1',
      ATTEMPT,
      0,
    );

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
      fencingToken: 0,
    });

    const decision = await reconcilePreEffect(
      journal,
      'acme',
      'close-2026-q3',
      'hash-1',
      ATTEMPT,
      0,
    );

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
      fencingToken: 0,
    });

    const decision = await reconcilePreEffect(
      journal,
      'acme',
      'close-2026-q3',
      'hash-2',
      ATTEMPT,
      0,
    );

    expect(decision).toEqual({ kind: 'deny', reason: 'idempotency-conflict' });
    const row = await journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
  });

  it('a LOST CLAIM re-decides on the fresh row — NEVER proceeds to a second effect (race safety)', async () => {
    const decision = await reconcilePreEffect(
      new LostClaimThenWinnerJournal(),
      'acme',
      'close-2026-q3',
      'hash-1',
      'att:acme:loser',
      0,
    );
    // The claim was lost; the re-decide sees the winner's in_flight row → recovery
    // (NOT proceed) — exactly one effect is preserved on the worker path too.
    expect(decision).toEqual({ kind: 'recovery' });
  });

  it('F2: a LOST CLAIM whose fresh re-decide WOULD be proceed (aborted_retryable + same hash) is mapped to recovery — NEVER proceed without a secured claim', async () => {
    const decision = await reconcilePreEffect(
      new LostClaimThenRetryableJournal(),
      'acme',
      'close-2026-q3',
      'hash-1',
      'att:acme:loser',
      0,
    );
    // The re-decide on the fresh aborted_retryable + same-hash row WOULD be
    // `proceed` (reopen) — but NO claim was secured, so it MUST be recovery
    // (exactly-one-effect safety, made structural — not a comment).
    expect(decision).toEqual({ kind: 'recovery' });
    expect(decision.kind).not.toBe('proceed');
  });

  it('F2: a LOST CLAIM whose fresh re-decide WOULD be proceed (row vanished → undefined) is mapped to recovery — NEVER proceed without a secured claim', async () => {
    const decision = await reconcilePreEffect(
      new LostClaimThenVanishedJournal(),
      'acme',
      'close-2026-q3',
      'hash-1',
      'att:acme:loser',
      0,
    );
    expect(decision).toEqual({ kind: 'recovery' });
    expect(decision.kind).not.toBe('proceed');
  });

  it('F3: a LOST CLAIM whose fresh re-decide is REPLAY (winner completed, same hash) routes to replay — never a second effect', async () => {
    const decision = await reconcilePreEffect(
      new LostClaimThenCompletedJournal('hash-1', { ok: true, note: 'winner-done' }),
      'acme',
      'close-2026-q3',
      'hash-1',
      'att:acme:loser',
      0,
    );
    expect(decision).toEqual({ kind: 'replay', resultJson: { ok: true, note: 'winner-done' } });
  });

  it('F3: a LOST CLAIM whose fresh re-decide is DENY (winner completed, different hash) routes to deny — never a second effect', async () => {
    const decision = await reconcilePreEffect(
      new LostClaimThenCompletedJournal('hash-WINNER', { ok: true }),
      'acme',
      'close-2026-q3',
      'hash-1',
      'att:acme:loser',
      0,
    );
    expect(decision).toEqual({ kind: 'deny', reason: 'idempotency-conflict' });
  });
});

/** Models a same-key race loser on the worker pre-effect path: the first lookup
 * sees nothing (decision = proceed), the claim is LOST (typed result), and the
 * re-decide lookup then sees the winner's committed in_flight row. */
class LostClaimThenWinnerJournal implements IdempotencyJournalPort {
  private winnerCommitted = false;

  async lookup(): Promise<JournalEntry | undefined> {
    if (!this.winnerCommitted) return undefined;
    return {
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: 'att:acme:winner',
      status: 'in_flight',
      fencingToken: 0,
    };
  }

  async insertInFlight(): Promise<JournalClaimResult> {
    this.winnerCommitted = true; // the winner committed during our insert
    return { ok: false, reason: 'attempt-in-flight' };
  }

  async complete(): Promise<void> {}
  async markRetryable(_attemptId: string, _fencingToken: number): Promise<void> {}
}

/** Models a same-key race loser whose fresh re-decide WOULD be `proceed` (F2):
 * the first lookup sees nothing (proceed), the claim is LOST, and the re-decide
 * lookup then sees the winner's aborted_retryable row under the SAME hash — a
 * reopen decision. With NO claim secured, proceeding would run the effect
 * unclaimed; the structural guard must map this to recovery. */
class LostClaimThenRetryableJournal implements IdempotencyJournalPort {
  private winnerMarked = false;

  async lookup(): Promise<JournalEntry | undefined> {
    if (!this.winnerMarked) return undefined;
    return {
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: 'att:acme:winner',
      status: 'aborted_retryable',
      fencingToken: 0,
    };
  }

  async insertInFlight(): Promise<JournalClaimResult> {
    this.winnerMarked = true; // the winner committed + marked during our insert
    return { ok: false, reason: 'attempt-in-flight' };
  }

  async complete(): Promise<void> {}
  async markRetryable(_attemptId: string, _fencingToken: number): Promise<void> {}
}

/** Models a same-key race loser whose fresh re-decide WOULD be `proceed` because
 * the row vanished (undefined → proceed). No claim secured ⇒ must be recovery. */
class LostClaimThenVanishedJournal implements IdempotencyJournalPort {
  async lookup(): Promise<JournalEntry | undefined> {
    return undefined;
  }

  async insertInFlight(): Promise<JournalClaimResult> {
    return { ok: false, reason: 'attempt-in-flight' };
  }

  async complete(): Promise<void> {}
  async markRetryable(_attemptId: string, _fencingToken: number): Promise<void> {}
}

/** Models a same-key race loser whose fresh re-decide sees the winner's
 * COMPLETED row (F3): same hash → REPLAY the winner's recorded result; a
 * different hash → DENY. Either way the loser never reaches a second effect. */
class LostClaimThenCompletedJournal implements IdempotencyJournalPort {
  private winnerCommitted = false;

  constructor(
    private readonly winnerHash: string,
    private readonly winnerResult: unknown,
  ) {}

  async lookup(): Promise<JournalEntry | undefined> {
    if (!this.winnerCommitted) return undefined;
    return {
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: this.winnerHash,
      attemptId: 'att:acme:winner',
      status: 'completed',
      fencingToken: 0,
      resultJson: this.winnerResult,
    };
  }

  async insertInFlight(): Promise<JournalClaimResult> {
    this.winnerCommitted = true; // the winner completed during our insert
    return { ok: false, reason: 'attempt-in-flight' };
  }

  async complete(): Promise<void> {}
  async markRetryable(_attemptId: string, _fencingToken: number): Promise<void> {}
}

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

  updateIfVersion(
    work: Work,
    expectedVersion: number,
    fencing?: import('@io/business-domain/src/ports/repositories.js').FencingDirective,
  ): Promise<CasResult> {
    // Forward the directive (fencing-tokens): the racing double must mint on a
    // `claim` and check on a `terminal` exactly like the inner repository —
    // dropping it would make the claim never mint (token stuck at 0).
    return this.inner.updateIfVersion(work, expectedVersion, fencing);
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

describe('cycle reconciliation (WC reconciliation pre-effect)', () => {
  it('none → insertInFlight → effect runs (fresh attempt)', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h, 'flash');

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
      fencingToken: 0,
    });
    await h.journal.complete(ATTEMPT, { ok: true, note: 'done' });

    const result = await runWorker(workerInput(), h, 'flash');

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
      fencingToken: 0,
    });
    await h.journal.complete(ATTEMPT, { ok: true });

    const result = await runWorker(workerInput({ requestHash: 'hash-1' }), h, 'flash');

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
      fencingToken: 0,
    });
    await h.journal.markRetryable(ATTEMPT, 0);

    const result = await runWorker(workerInput(), h, 'flash');

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
      fencingToken: 0,
    });
    await h.journal.markRetryable(ATTEMPT, 0);

    const result = await runWorker(workerInput({ requestHash: 'hash-1' }), h, 'flash');

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
      fencingToken: 0,
    });

    const result = await runWorker(workerInput(), h, 'flash');

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

    const lost = await runWorker(
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
    const retry = await runWorker(workerInput(), { ...h, connection: conn }, 'flash');

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
      fencingToken: 0,
    });
    await h.journal.complete(key2Attempt, { ok: true, state: 'completed' });

    // Key1's own attempt sits aborted_retryable (prior CAS loss); the work is
    // now terminal. Same-key retry of key1 must NOT reopen/re-apply/finalize.
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
      fencingToken: 0,
    });
    await h.journal.markRetryable(ATTEMPT, 0);

    const result = await runWorker(workerInput(), { ...h, connection: conn }, 'flash');

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
    // The attempt is closed honestly: the key returns the typed UNRESOLVED
    // result on EVERY retry (the terminal branch short-circuits before any
    // effect/receipt), so the marker row is NEVER regressed to a completion —
    // the complete status guard (fencing-tokens spec) forbids completing a
    // non-in_flight row. A marker on a terminal-work key never reopens (the
    // terminal branch precedes the reopen), so it invites no retry loop.
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.resultJson).toBeUndefined();
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
      fencingToken: 0,
    });

    const result = await runWorker(workerInput(), h, 'flash');

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

describe('journal fencing token threading through the worker cycle (task 2.4)', () => {
  it('the worker threads the MINTED claim token into the pre-effect insert: the in_flight row carries token 1 after a fresh runWorker claim', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h, 'flash');

    expect(result.ok).toBe(true);
    // The claim minted token 1 (accepted token 0 → in_progress token 1); the
    // pre-effect insertInFlight (reconcilePreEffect) stored THAT token.
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight');
    expect(row?.fencingToken).toBe(1);
  });

  it('a REAL finalize CAS-loss persists the retryable marker WITH the claim token N: markRetryable(attemptId, N) lands (spec "Marker set on CAS loss with applied effect and in-progress work")', async () => {
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    const racing = new RacingWorkRepository(h.work, (work) => ({ ...work, state: 'in_progress' }));

    const lost = await runWorker(
      workerInput(),
      {
        ...h,
        work: racing,
        connection: conn,
        repositories: () => ({
          work: racing,
          receipts: h.receipts,
          journal: h.journal,
          events: h.events,
        }),
      },
      'flash',
    );

    expect(lost.ok).toBe(false);
    if (lost.ok) return;
    expect(lost.reason).toBe('cas-lost-retryable');
    // The marker is CLAIM-GATED: the row is owned by the claim token 1 (the
    // pre-effect insert stored it) and the worker presented the retained token
    // 1 — the marker write matched and persisted WITH token 1.
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.fencingToken).toBe(1);
    // A controlled retry reopens and RETAINS that same token N (no re-claim,
    // no increment) — spec "Controlled retry retains its token".
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
      fencingToken: 99, // a fresh claim WOULD mint higher — the retry must NOT adopt it
    });
    const reopened = await h.journal.lookup('acme', 'close-2026-q3');
    expect(reopened?.status).toBe('in_flight');
    expect(reopened?.fencingToken).toBe(1);
  });

  it('a STALE token at the worker reconcile boundary cannot mark retryable: the marker write is refused (fail loud), the row stays in_flight under the REAL claim', async () => {
    const h = harness();
    await seed(h);
    const current = await h.work.get('acme', 'work-1');
    if (current === undefined) throw new Error('test setup: work not seeded');
    // Claim → token 1; the journal row is owned by token 1 (pre-effect store).
    const claimed = await h.work.updateIfVersion(
      { ...current, state: 'in_progress' },
      current.version,
      { kind: 'claim' },
    );
    if (!claimed.ok) throw new Error('test setup: claim failed');
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
      fencingToken: 1,
    });
    const effect = await h.sandbox.execute({
      type: 'create-document',
      relativePath: 'docs/stale.md',
      content: 'stale-holder effect',
    });

    // A ZOMBIE holder (token 0) reconciles a post-effect failure: the effect is
    // undone (the zombie's own effect), then the claim-gated marker write is
    // REFUSED — fail loud (R4-001), never a zombie-issued marker.
    await expect(
      reconcilePostEffectFailure(
        { work: h.work, journal: h.journal, sandbox: h.sandbox },
        {
          companyId: 'acme',
          workId: 'work-1',
          idempotencyKey: 'close-2026-q3',
          requestHash: 'hash-1',
          attemptId: ATTEMPT,
          fencingToken: 0, // STALE — not the claim owner
          effect,
        },
      ),
    ).rejects.toThrow(/fencing token mismatch/i);

    expect(h.sandbox.undos).toHaveLength(1);
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('in_flight'); // untouched by the zombie
    expect(row?.fencingToken).toBe(1);
    expect((await h.work.get('acme', 'work-1'))?.state).toBe('in_progress');
  });

  it('a MATCHING token at the worker reconcile boundary marks retryable: the claim owner undoes + persists the marker WITH token N (spec marker-set scenario)', async () => {
    const h = harness();
    await seed(h);
    const current = await h.work.get('acme', 'work-1');
    if (current === undefined) throw new Error('test setup: work not seeded');
    const claimed = await h.work.updateIfVersion(
      { ...current, state: 'in_progress' },
      current.version,
      { kind: 'claim' },
    );
    if (!claimed.ok) throw new Error('test setup: claim failed');
    await h.journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'close-2026-q3',
      requestHash: 'hash-1',
      attemptId: ATTEMPT,
      fencingToken: 1,
    });
    const effect = await h.sandbox.execute({
      type: 'create-document',
      relativePath: 'docs/owner.md',
      content: 'claim-owner effect',
    });

    const result = await reconcilePostEffectFailure(
      { work: h.work, journal: h.journal, sandbox: h.sandbox },
      {
        companyId: 'acme',
        workId: 'work-1',
        idempotencyKey: 'close-2026-q3',
        requestHash: 'hash-1',
        attemptId: ATTEMPT,
        fencingToken: 1, // the claim owner
        effect,
      },
    );

    expect(result).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
    expect(h.sandbox.undos).toHaveLength(1);
    const row = await h.journal.lookup('acme', 'close-2026-q3');
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.fencingToken).toBe(1);
    expect(row?.resultJson).toBeUndefined();
  });
});
