import {
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '@io/business-domain/src/ports/fakes.js';
import type { CasResult, WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { JournalEntry } from '@io/business-domain/src/ports/idempotency.js';
import type { Work } from '@io/business-domain/src/types.js';
import type { CompleteWorkCommand } from '@io/business-domain/src/use-cases/index.js';
import { completeWork, IdempotentFlowAbortError } from '@io/business-domain/src/use-cases/index.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { describe, expect, it } from 'vitest';

import { decidePreEffect } from '../src/worker/reconcile.js';
import { runWorker } from '../src/worker/worker.js';
import { harness, principals, seed, workerInput } from './worker-helpers.js';

/**
 * B11 — Parity tests pinning the FORCED app re-implementation against drift
 * (design "Testing" parity rows):
 *
 *   1. The app's PRE-EFFECT replay/DENY decisions are EQUIVALENT to the
 *      foundation's `completeWork` idempotent lookup: the SAME journal inputs
 *      yield the SAME replay/DENY outcome — completed+same hash → replay,
 *      completed+diff hash → DENY, in_flight → NO replay of a partial result.
 *      (The aborted_retryable reopen row is an APP EXTENSION — the design adds
 *      it beyond completeWork's pre-marker surface, which predates the marker
 *      status and would replay an empty result — so it sits OUTSIDE the parity
 *      domain and is documented, not asserted equivalent.)
 *
 *   2. CAS-loss → markRetryable → retry-wins is EQUIVALENT to the foundation
 *      rollback-then-retry (complete-work.ts:103-108): after a CAS loss with an
 *      applied effect and in_progress work, a FRESH same-key attempt can still
 *      SUCCEED — the app's durable aborted_retryable marker and the
 *      foundation's transaction rollback both prevent a bricked key.
 */

const COMPANY = 'acme';
const KEY = 'close-2026-q3';
const HASH = 'hash-1';
const ATTEMPT = 'att:acme:close-2026-q3';
const WORK_ID = 'work-1';

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    companyId: COMPANY,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    status: 'completed',
    resultJson: { ok: true, note: 'done' },
    ...overrides,
  };
}

function completeCmd(requestHash: string = HASH): CompleteWorkCommand {
  return {
    companyId: COMPANY,
    actor: principals.executor,
    workId: WORK_ID,
    // No expectedVersion early-out: the idempotent terminal close CASes on the
    // FRESH version read inside the flow (the parity pins the CAS-loss path).
    idempotencyKey: KEY,
    requestHash,
    policyHash: 'policy:test',
    artifactHash: 'artifact:test',
  };
}

/** Run BOTH decision makers over the SAME journal row and hash. */
async function runBoth(entryOverrides: Partial<JournalEntry>, requestHash: string) {
  const row = entry(entryOverrides);
  const journal = new InMemoryIdempotencyJournalRepository();
  await journal.insertInFlight({
    companyId: row.companyId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    attemptId: row.attemptId,
  });
  if (row.status === 'completed') await journal.complete(row.attemptId, row.resultJson);
  if (row.status === 'aborted_retryable') await journal.markRetryable(row.attemptId);
  const work = new InMemoryWorkRepository();
  await work.save(acceptedWork());
  const app = decidePreEffect(await journal.lookup(row.companyId, row.idempotencyKey), requestHash);
  const foundation = await completeWork(completeCmd(requestHash), {
    work,
    receipts: new InMemoryBusinessReceiptRepository(),
    journal,
  });
  return { app, foundation };
}

/** A claimable Work: `accepted` at version 1 (startWork: accepted → in_progress). */
function acceptedWork(): Work {
  return {
    workId: WORK_ID,
    companyId: COMPANY,
    delegationId: 'del-1',
    proposer: principals.proposer,
    description: 'execute the quarterly close',
    state: 'accepted',
    version: 1,
    evidenceRefs: [],
  };
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

/** WorkRepository that races on the FIRST read of an `in_progress` work: a
 * concurrent writer wins BETWEEN the reader's `get` and its `updateIfVersion` —
 * the reader's CAS loses exactly once (used for completeWork's rollback path
 * AND the app cycle's finalize T1). The `in_progress` guard keeps the app
 * cycle's initial claim read (accepted) from racing — the claim always wins and
 * the race fires only at the finalize close. */
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

describe('B11 parity 1 — app pre-effect replay/DENY ≡ completeWork lookup', () => {
  it('completed + same hash: BOTH replay the recorded result (no effect re-run)', async () => {
    const { app, foundation } = await runBoth({ status: 'completed' }, HASH);

    expect(app).toEqual({ kind: 'replay', resultJson: { ok: true, note: 'done' } });
    expect(foundation.ok).toBe(true);
    if (foundation.ok) expect(foundation.value).toEqual({ ok: true, note: 'done' });
  });

  it('completed + different hash: BOTH DENY idempotency-conflict', async () => {
    const { app, foundation } = await runBoth({ status: 'completed' }, 'hash-2');

    expect(app).toEqual({ kind: 'deny', reason: 'idempotency-conflict' });
    expect(foundation).toEqual({ ok: false, reason: 'idempotency-conflict' });
  });

  it('in_flight + same hash: BOTH refuse to replay a partial result (app recovery ≡ foundation attempt-in-flight)', async () => {
    const { app, foundation } = await runBoth({ status: 'in_flight', resultJson: undefined }, HASH);

    expect(app).toEqual({ kind: 'recovery' });
    expect(foundation).toEqual({ ok: false, reason: 'attempt-in-flight' });
  });

  it('in_flight + different hash: BOTH DENY idempotency-conflict', async () => {
    const { app, foundation } = await runBoth(
      { status: 'in_flight', resultJson: undefined },
      'hash-2',
    );

    expect(app).toEqual({ kind: 'deny', reason: 'idempotency-conflict' });
    expect(foundation).toEqual({ ok: false, reason: 'idempotency-conflict' });
  });
});

describe('B11 parity 2 — CAS-loss → markRetryable → retry-wins ≡ foundation rollback-then-retry (complete-work.ts:103-108)', () => {
  it('after a CAS loss with an applied effect + in_progress work, a fresh same-key attempt still succeeds — the app marker and the foundation rollback both prevent a brick', async () => {
    // ---- FOUNDATION WORLD: completeWork's CAS loss THROWS
    // IdempotentFlowAbortError (complete-work.ts:103-108) so the enclosing
    // transaction ROLLS BACK the in_flight insert (no zombie row), and a FRESH
    // same-key attempt SUCCEEDS.
    const fWork = new InMemoryWorkRepository();
    await fWork.save(acceptedWork());
    // The work is claimed (in_progress) before the completion race — the
    // stale snapshot completeWork reads stays transition-valid.
    const seeded = await fWork.get(COMPANY, WORK_ID);
    if (seeded === undefined) throw new Error('test setup: work not seeded');
    const claimed = await fWork.updateIfVersion(
      { ...seeded, state: 'in_progress' },
      seeded.version,
    );
    if (!claimed.ok) throw new Error('test setup: claim failed');
    const fReceipts = new InMemoryBusinessReceiptRepository();
    const fJournal = new InMemoryIdempotencyJournalRepository();
    // The concurrent writer wins BETWEEN completeWork's get and its CAS, bumping
    // the version while the work stays in_progress (a competing completion that
    // also aborted) — so the CAS loses but the work remains completable.
    const racing = new RacingWorkRepository(fWork, (work) => ({ ...work, state: 'in_progress' }));

    await expect(
      completeWork(completeCmd(), { work: racing, receipts: fReceipts, journal: fJournal }),
    ).rejects.toBeInstanceOf(IdempotentFlowAbortError);
    // Simulate the REAL transaction rollback: the in_flight insert is undone
    // (the in-memory fake is not transactional — restore the pre-insert state).
    fJournal.restoreSnapshot([]);
    expect(await fJournal.lookup(COMPANY, KEY)).toBeUndefined();

    const foundationRetry = await completeWork(completeCmd(), {
      work: fWork,
      receipts: fReceipts,
      journal: fJournal,
    });
    expect(foundationRetry.ok).toBe(true);
    if (foundationRetry.ok) expect(foundationRetry.value.state).toBe('completed');

    // ---- APP WORLD: the PUBLIC cycle (runWorker) loses the finalize T1 CAS
    // race → T2(i): undo + durable aborted_retryable marker (own committed
    // write) → a SECOND runWorker with the SAME key RESUMES the cycle through
    // the resume-aware claim (the work is still in_progress — the marker is NOT
    // a brick) and the retry WINS (work completed, exactly one receipt).
    const h = harness();
    await seed(h);
    const conn = new TxTrackingConnection(new InMemoryDbConnection());
    const appRacing = new RacingWorkRepository(h.work, (work) => ({
      ...work,
      state: 'in_progress',
    }));

    const lost = await runWorker(workerInput(), {
      ...h,
      work: appRacing,
      connection: conn,
      // The racing double must reach the finalize twin's T1 too.
      repositories: () => ({ work: appRacing, receipts: h.receipts, journal: h.journal }),
    });
    expect(lost.ok).toBe(false);
    if (lost.ok) return;
    expect(lost.reason).toBe('cas-lost-retryable');
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    expect(h.receipts.saves).toHaveLength(0);
    // The applied effect was reversed; the work stays in_progress (not bricked).
    expect(h.sandbox.undos).toHaveLength(1);
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');

    // Controlled retry through the PUBLIC cycle: same key + same hash reopens,
    // the effect is re-applied, and the finalize closes with a single receipt.
    const retry = await runWorker(workerInput(), { ...h, connection: conn });
    expect(retry.ok).toBe(true);
    if (!retry.ok || 'replayed' in retry) return;
    expect(retry.work.state).toBe('completed');
    expect(h.receipts.saves).toHaveLength(1);
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('completed');

    // ---- EQUIVALENCE: both worlds end with a SUCCESSFUL same-key retry.
    expect(foundationRetry.ok).toBe(true);
    expect(retry.ok).toBe(true);
  });
});
