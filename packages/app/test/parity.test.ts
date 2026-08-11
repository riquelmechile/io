import {
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '@io/business-domain/src/ports/fakes.js';
import type { JournalEntry } from '@io/business-domain/src/ports/idempotency.js';
import type {
  CasResult,
  FencingDirective,
  WorkRepository,
} from '@io/business-domain/src/ports/repositories.js';
import type { Work } from '@io/business-domain/src/types.js';
import type { CompleteWorkCommand } from '@io/business-domain/src/use-cases/index.js';
import { completeWork, IdempotentFlowAbortError } from '@io/business-domain/src/use-cases/index.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { PgWorkRepository } from '@io/database/src/work-adapter.js';
import { PgIdempotencyJournalRepository } from '@io/database/src/idempotency-adapter.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DurableSandboxFake } from '../src/sandbox/durable-sandbox-fake.js';
import { FileDocumentSandbox } from '../src/sandbox/file-document-sandbox.js';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import type { EffectRecord, SandboxAction, SandboxPort } from '../src/sandbox/sandbox-port.js';
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
    fencingToken: 0,
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
    fencingToken: 0,
  });
  if (row.status === 'completed') await journal.complete(row.attemptId, row.resultJson);
  if (row.status === 'aborted_retryable') await journal.markRetryable(row.attemptId, 0);
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
    fencingToken: 0,
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

  updateIfVersion(
    work: Work,
    expectedVersion: number,
    fencing?: FencingDirective,
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

    const lost = await runWorker(
      workerInput(),
      {
        ...h,
        work: appRacing,
        connection: conn,
        // The racing double must reach the finalize twin's T1 too.
        repositories: () => ({
          work: appRacing,
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
    expect((await h.journal.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    expect(h.receipts.saves).toHaveLength(0);
    // The applied effect was reversed; the work stays in_progress (not bricked).
    expect(h.sandbox.undos).toHaveLength(1);
    expect((await h.work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');

    // Controlled retry through the PUBLIC cycle: same key + same hash reopens,
    // the effect is re-applied, and the finalize closes with a single receipt.
    const retry = await runWorker(workerInput(), { ...h, connection: conn }, 'flash');
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

describe('B11 parity 3 — fencing CAS: InMemory fake ≡ PgWorkRepository (claim mint / stale-close / matching-close)', () => {
  /** The claimable accepted Work at version 1, token 0 — identical in both worlds. */
  async function seedBoth(): Promise<{ fake: InMemoryWorkRepository; pg: PgWorkRepository }> {
    const fake = new InMemoryWorkRepository();
    const pg = new PgWorkRepository(new InMemoryDbConnection());
    for (const repo of [fake, pg]) {
      await repo.save(acceptedWork());
    }
    return { fake, pg };
  }

  it('claim: BOTH mint the NEXT token 0 → 1, bump version 1 → 2, store the same state', async () => {
    const { fake, pg } = await seedBoth();

    const fakeClaim = (await fake.updateIfVersion(
      { ...(await fake.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    )) as Extract<CasResult, { ok: true }>;
    const pgClaim = (await pg.updateIfVersion(
      { ...(await pg.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    )) as Extract<CasResult, { ok: true }>;

    // OUTCOMES match: both ok, same minted token, same version bump.
    expect(fakeClaim.ok).toBe(true);
    expect(pgClaim.ok).toBe(true);
    expect(pgClaim.value.fencingToken).toBe(fakeClaim.value.fencingToken);
    expect(pgClaim.value.version).toBe(fakeClaim.value.version);
    expect(pgClaim.value.state).toBe(fakeClaim.value.state);

    // STORED STATES match (token + version + state).
    const fakeStored = await fake.get(COMPANY, WORK_ID);
    const pgStored = await pg.get(COMPANY, WORK_ID);
    expect(pgStored?.fencingToken).toBe(fakeStored?.fencingToken);
    expect(pgStored?.version).toBe(fakeStored?.version);
    expect(pgStored?.state).toBe(fakeStored?.state);
    expect(fakeStored?.fencingToken).toBe(1);
    expect(fakeStored?.version).toBe(2);
  });

  it('stale-token terminal close: BOTH return fencing-conflict and leave the stored work unchanged (same token/version/state)', async () => {
    const { fake, pg } = await seedBoth();
    // Claim in both worlds: token 1, version 2, in_progress.
    const fakeClaim = await fake.updateIfVersion(
      { ...(await fake.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    );
    const pgClaim = await pg.updateIfVersion(
      { ...(await pg.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    );
    if (!fakeClaim.ok || !pgClaim.ok) throw new Error('test setup: claim failed');

    // A stale holder (token 0) tries the terminal close in BOTH worlds.
    const fakeTerminal = (await fake.updateIfVersion(
      { ...fakeClaim.value, state: 'completed' },
      fakeClaim.value.version,
      { kind: 'terminal', expectedFencingToken: 0 },
    )) as Extract<CasResult, { ok: false }>;
    const pgTerminal = (await pg.updateIfVersion(
      { ...pgClaim.value, state: 'completed' },
      pgClaim.value.version,
      { kind: 'terminal', expectedFencingToken: 0 },
    )) as Extract<CasResult, { ok: false }>;

    // OUTCOMES match: typed fencing-conflict with the same current token.
    expect(fakeTerminal.ok).toBe(false);
    expect(pgTerminal.ok).toBe(false);
    expect(pgTerminal.reason).toBe(fakeTerminal.reason);
    expect(fakeTerminal.reason).toBe('fencing-conflict');
    expect(pgTerminal.current?.fencingToken).toBe(fakeTerminal.current?.fencingToken);

    // STORED STATES match and are UNCHANGED (token 1, version 2, in_progress).
    const fakeStored = await fake.get(COMPANY, WORK_ID);
    const pgStored = await pg.get(COMPANY, WORK_ID);
    expect(pgStored?.fencingToken).toBe(fakeStored?.fencingToken);
    expect(pgStored?.version).toBe(fakeStored?.version);
    expect(pgStored?.state).toBe(fakeStored?.state);
    expect(fakeStored?.state).toBe('in_progress');
    expect(fakeStored?.fencingToken).toBe(1);
    expect(fakeStored?.version).toBe(2);
  });

  it('matching-token terminal close: BOTH complete the work, retain the claim token, bump version once', async () => {
    const { fake, pg } = await seedBoth();
    const fakeClaim = await fake.updateIfVersion(
      { ...(await fake.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    );
    const pgClaim = await pg.updateIfVersion(
      { ...(await pg.get(COMPANY, WORK_ID))!, state: 'in_progress' },
      1,
      { kind: 'claim' },
    );
    if (!fakeClaim.ok || !pgClaim.ok) throw new Error('test setup: claim failed');

    const fakeTerminal = await fake.updateIfVersion(
      { ...fakeClaim.value, state: 'completed' },
      fakeClaim.value.version,
      { kind: 'terminal', expectedFencingToken: fakeClaim.value.fencingToken },
    );
    const pgTerminal = await pg.updateIfVersion(
      { ...pgClaim.value, state: 'completed' },
      pgClaim.value.version,
      { kind: 'terminal', expectedFencingToken: pgClaim.value.fencingToken },
    );

    expect(fakeTerminal.ok).toBe(true);
    expect(pgTerminal.ok).toBe(true);
    if (fakeTerminal.ok && pgTerminal.ok) {
      // Same outcome: completed, retained token, version N+1.
      expect(pgTerminal.value.state).toBe(fakeTerminal.value.state);
      expect(pgTerminal.value.fencingToken).toBe(fakeTerminal.value.fencingToken);
      expect(pgTerminal.value.version).toBe(fakeTerminal.value.version);
      expect(fakeTerminal.value.state).toBe('completed');
      expect(fakeTerminal.value.fencingToken).toBe(1);
    }
  });
});

describe('B11 parity 4 — journal fencing: InMemory fake ≡ Pg adapter (store / matching / stale / token-0)', () => {
  /** The SAME journal state seeded into the fake and the PG adapter (over the
   * in-memory connection): one in_flight row owned by `token`. */
  async function seedBoth(token: number): Promise<{
    fake: InMemoryIdempotencyJournalRepository;
    pg: PgIdempotencyJournalRepository;
  }> {
    const fake = new InMemoryIdempotencyJournalRepository();
    const pg = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
    for (const repo of [fake, pg]) {
      await repo.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: token,
      });
    }
    return { fake, pg };
  }

  it('insertInFlight stores the claim token in BOTH: the in_flight row carries the token', async () => {
    const { fake, pg } = await seedBoth(5);

    expect((await fake.lookup(COMPANY, KEY))?.status).toBe('in_flight');
    expect((await fake.lookup(COMPANY, KEY))?.fencingToken).toBe(5);
    expect((await pg.lookup(COMPANY, KEY))?.status).toBe('in_flight');
    expect((await pg.lookup(COMPANY, KEY))?.fencingToken).toBe(5);
  });

  it('matching-token markRetryable: BOTH mark aborted_retryable and RETAIN token N (no increment)', async () => {
    const { fake, pg } = await seedBoth(5);

    await fake.markRetryable(ATTEMPT, 5);
    await pg.markRetryable(ATTEMPT, 5);

    const f = await fake.lookup(COMPANY, KEY);
    const p = await pg.lookup(COMPANY, KEY);
    expect(f?.status).toBe('aborted_retryable');
    expect(p?.status).toBe('aborted_retryable');
    expect(f?.fencingToken).toBe(5);
    expect(p?.fencingToken).toBe(5);
  });

  it('stale-token markRetryable: BOTH reject WITHOUT mutation — status and token unchanged', async () => {
    const { fake, pg } = await seedBoth(5);

    const fErr = await fake
      .markRetryable(ATTEMPT, 3)
      .then(() => undefined)
      .catch((error: Error) => error);
    const pErr = await pg
      .markRetryable(ATTEMPT, 3)
      .then(() => undefined)
      .catch((error: Error) => error);

    expect(fErr).toBeInstanceOf(Error);
    expect(pErr).toBeInstanceOf(Error);
    const f = await fake.lookup(COMPANY, KEY);
    const p = await pg.lookup(COMPANY, KEY);
    expect(f?.status).toBe('in_flight');
    expect(p?.status).toBe('in_flight');
    expect(f?.fencingToken).toBe(5);
    expect(p?.fencingToken).toBe(5);
  });

  it('token-0 (epoch) is valid in BOTH: an unclaimed / legacy close stores and marks at 0', async () => {
    const { fake, pg } = await seedBoth(0);

    expect((await fake.lookup(COMPANY, KEY))?.fencingToken).toBe(0);
    expect((await pg.lookup(COMPANY, KEY))?.fencingToken).toBe(0);

    await fake.markRetryable(ATTEMPT, 0);
    await pg.markRetryable(ATTEMPT, 0);
    expect((await fake.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    expect((await pg.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
    expect((await fake.lookup(COMPANY, KEY))?.fencingToken).toBe(0);
    expect((await pg.lookup(COMPANY, KEY))?.fencingToken).toBe(0);
  });

  it('the controlled-retry reopen RETAINS token N in BOTH: the original attemptId and token survive (no re-claim, no increment)', async () => {
    const { fake, pg } = await seedBoth(5);
    await fake.markRetryable(ATTEMPT, 5);
    await pg.markRetryable(ATTEMPT, 5);

    // Same-key same-hash retry: reopen keeps the ORIGINAL attemptId + token N.
    const retryEntry = {
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash: HASH,
      attemptId: 'att:acme:close-2026-q3-retry',
      fencingToken: 99,
    };
    expect(await fake.insertInFlight(retryEntry)).toEqual({ ok: true });
    expect(await pg.insertInFlight(retryEntry)).toEqual({ ok: true });

    const f = await fake.lookup(COMPANY, KEY);
    const p = await pg.lookup(COMPANY, KEY);
    expect(f?.status).toBe('in_flight');
    expect(p?.status).toBe('in_flight');
    expect(f?.attemptId).toBe(ATTEMPT); // original kept
    expect(p?.attemptId).toBe(ATTEMPT);
    expect(f?.fencingToken).toBe(5); // N retained — never incremented
    expect(p?.fencingToken).toBe(5);
  });
});

describe('B11 parity 5 — sandbox undo-log snapshot: FileDocumentSandbox ≡ DurableSandboxFake ≡ InMemorySandbox (applied/undone/no-effect)', () => {
  const docA: SandboxAction = {
    type: 'create-document',
    relativePath: 'docs/a.md',
    content: 'alpha',
  };
  const docB: SandboxAction = {
    type: 'create-document',
    relativePath: 'docs/b.md',
    content: 'beta',
  };

  /** The undo-log SNAPSHOT shape — identical across the three implementations.
   * `absolutePath` is intentionally excluded: FileDocumentSandbox resolves real
   * tmp paths while the fakes use a virtual FS — the parity is on undo-log
   * SNAPSHOT behavior, not the storage medium. */
  function snapshotShape(records: readonly EffectRecord[]) {
    return records.map((record) => ({
      effectId: record.effectId,
      action: record.action,
      applied: record.applied,
      undo: {
        handleId: record.undo.handleId,
        action: record.undo.action,
        applied: record.undo.applied,
      },
    }));
  }

  /** Build the three subjects: the shipped adapter over a real tmp root, the
   * JSON-durable fake, and the in-memory fake. Returns them with a cleanup. */
  function newSubjects(): {
    subjects: Array<{ name: string; sandbox: SandboxPort }>;
    cleanup: () => void;
  } {
    const dirs: string[] = [];
    const tmp = (prefix: string): string => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    };
    const subjects = [
      {
        name: 'FileDocumentSandbox (real fs + JSON undo log)',
        sandbox: new FileDocumentSandbox(join(tmp('io-parity-sandbox-fs-'), 'root')),
      },
      {
        name: 'DurableSandboxFake (virtual fs + JSON undo log)',
        sandbox: new DurableSandboxFake(join(tmp('io-parity-sandbox-durable-'), 'state.json')),
      },
      { name: 'InMemorySandbox (virtual fs + in-memory undo log)', sandbox: new InMemorySandbox() },
    ];
    return {
      subjects,
      cleanup: () => {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it('no-effect: ALL THREE snapshot an empty undo log', async () => {
    const { subjects, cleanup } = newSubjects();
    try {
      for (const { name, sandbox } of subjects) {
        expect(sandbox.snapshotUndoLog(), `${name} — fresh sandbox`).toEqual([]);
      }
    } finally {
      cleanup();
    }
  });

  it('applied: ALL THREE record one entry per executed effect with IDENTICAL snapshot shapes', async () => {
    const { subjects, cleanup } = newSubjects();
    try {
      for (const { sandbox } of subjects) {
        await sandbox.execute(docA);
        await sandbox.execute(docB);
      }
      const shapes = subjects.map(({ name, sandbox }) => ({
        name,
        snapshot: snapshotShape(sandbox.snapshotUndoLog()),
      }));
      // Non-trivial: exactly two applied entries in every implementation.
      for (const { name, snapshot } of shapes) {
        expect(snapshot, `${name} — two applied entries`).toHaveLength(2);
      }
      const [fs, durable, inMem] = shapes;
      expect(durable?.snapshot).toEqual(fs?.snapshot);
      expect(inMem?.snapshot).toEqual(fs?.snapshot);
    } finally {
      cleanup();
    }
  });

  it('undone: ALL THREE EXCLUDE the undone entry from the snapshot (applied-only)', async () => {
    const { subjects, cleanup } = newSubjects();
    try {
      for (const { sandbox } of subjects) {
        const a = await sandbox.execute(docA);
        await sandbox.execute(docB);
        await sandbox.undo(a.undo);
      }
      const shapes = subjects.map(({ name, sandbox }) => ({
        name,
        snapshot: snapshotShape(sandbox.snapshotUndoLog()),
      }));
      for (const { name, snapshot } of shapes) {
        expect(snapshot, `${name} — only the applied entry remains`).toHaveLength(1);
        expect(snapshot[0]?.action.relativePath, `${name} — the B entry`).toBe('docs/b.md');
        expect(snapshot[0]?.undo.handleId, `${name} — handle id 2`).toBe('undo-2');
      }
      const [fs, durable, inMem] = shapes;
      expect(durable?.snapshot).toEqual(fs?.snapshot);
      expect(inMem?.snapshot).toEqual(fs?.snapshot);
    } finally {
      cleanup();
    }
  });
});

describe('B11 parity 6 — recovery designation: InMemoryWorkRepository ≡ PgWorkRepository (listRecoveryRequestedByCompany + setRecoveryRequest CAS)', () => {
  const DESIGNATED_ID = 'work-design';

  /** A claimed (in_progress) orphan at version 2, token 5 — identical in both
   * worlds. The marker CAS must bump version while preserving state+token. */
  function inProgress(id: string, companyId: string = COMPANY): Work {
    return {
      workId: id,
      companyId,
      delegationId: 'del-1',
      proposer: principals.proposer,
      description: 'execute the quarterly close',
      state: 'in_progress',
      version: 2,
      fencingToken: 5,
      evidenceRefs: [],
    };
  }

  /** Seed the SAME in_progress orphan into the fake and the PG adapter. */
  async function seedBoth(): Promise<{ fake: InMemoryWorkRepository; pg: PgWorkRepository }> {
    const fake = new InMemoryWorkRepository();
    const pg = new PgWorkRepository(new InMemoryDbConnection());
    for (const repo of [fake, pg]) {
      await repo.save(inProgress(DESIGNATED_ID));
    }
    return { fake, pg };
  }

  it('matching-version designation: BOTH ok — version N → N + 1, state/token unchanged, marker discovered', async () => {
    const { fake, pg } = await seedBoth();

    const fakeResult = (await fake.setRecoveryRequest(COMPANY, DESIGNATED_ID, 2, true)) as Extract<
      CasResult,
      { ok: true }
    >;
    const pgResult = (await pg.setRecoveryRequest(COMPANY, DESIGNATED_ID, 2, true)) as Extract<
      CasResult,
      { ok: true }
    >;

    // OUTCOMES match: both ok, same version bump, same preserved state+token.
    expect(fakeResult.ok).toBe(true);
    expect(pgResult.ok).toBe(true);
    expect(pgResult.value.version).toBe(fakeResult.value.version);
    expect(pgResult.value.state).toBe(fakeResult.value.state);
    expect(pgResult.value.fencingToken).toBe(fakeResult.value.fencingToken);
    expect(fakeResult.value.version).toBe(3);
    expect(fakeResult.value.state).toBe('in_progress');
    expect(fakeResult.value.fencingToken).toBe(5);

    // DISCOVERY matches: the designated orphan is listed in BOTH.
    const fakeList = await fake.listRecoveryRequestedByCompany(COMPANY);
    const pgList = await pg.listRecoveryRequestedByCompany(COMPANY);
    expect(pgList.map((w) => w.workId)).toEqual(fakeList.map((w) => w.workId));
    expect(fakeList.map((w) => w.workId)).toEqual([DESIGNATED_ID]);
  });

  it('stale-version designation: BOTH typed version-conflict, marker NOT set, stored version unchanged', async () => {
    const { fake, pg } = await seedBoth();

    const fakeResult = (await fake.setRecoveryRequest(COMPANY, DESIGNATED_ID, 1, true)) as Extract<
      CasResult,
      { ok: false }
    >;
    const pgResult = (await pg.setRecoveryRequest(COMPANY, DESIGNATED_ID, 1, true)) as Extract<
      CasResult,
      { ok: false }
    >;

    expect(fakeResult.ok).toBe(false);
    expect(pgResult.ok).toBe(false);
    expect(pgResult.reason).toBe(fakeResult.reason);
    expect(fakeResult.reason).toBe('version-conflict');
    expect(pgResult.current?.version).toBe(fakeResult.current?.version);
    expect(fakeResult.current?.version).toBe(2);

    // No marker landed in BOTH: discovery stays empty.
    expect(await fake.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
    expect(await pg.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
    expect((await fake.get(COMPANY, DESIGNATED_ID))?.version).toBe(2);
    expect((await pg.get(COMPANY, DESIGNATED_ID))?.version).toBe(2);
  });

  it('absent work: BOTH typed version-conflict (never fabricate)', async () => {
    const { fake, pg } = await seedBoth();

    expect((await fake.setRecoveryRequest(COMPANY, 'ghost', 2, true)).ok).toBe(false);
    expect((await pg.setRecoveryRequest(COMPANY, 'ghost', 2, true)).ok).toBe(false);
  });

  it('cross-tenant designation: BOTH version-conflict with NO current; discovery empty under the wrong tenant', async () => {
    const { fake, pg } = await seedBoth();

    const fakeResult = (await fake.setRecoveryRequest('other', DESIGNATED_ID, 2, true)) as Extract<
      CasResult,
      { ok: false }
    >;
    const pgResult = (await pg.setRecoveryRequest('other', DESIGNATED_ID, 2, true)) as Extract<
      CasResult,
      { ok: false }
    >;

    expect(fakeResult.ok).toBe(false);
    expect(pgResult.ok).toBe(false);
    expect(pgResult.reason).toBe(fakeResult.reason);
    expect(fakeResult.current).toBeUndefined();
    expect(pgResult.current).toBeUndefined();

    expect(await fake.listRecoveryRequestedByCompany('other')).toEqual([]);
    expect(await pg.listRecoveryRequestedByCompany('other')).toEqual([]);
  });

  it('designated NON-in_progress Work is never discovered in BOTH (partial-index predicate); version bump matches', async () => {
    const fake = new InMemoryWorkRepository();
    const pg = new PgWorkRepository(new InMemoryDbConnection());
    const accepted: Work = { ...inProgress(DESIGNATED_ID), state: 'accepted' };
    for (const repo of [fake, pg]) {
      await repo.save(accepted);
      const cas = await repo.setRecoveryRequest(COMPANY, DESIGNATED_ID, 2, true);
      expect(cas.ok).toBe(true);
      if (cas.ok) expect(cas.value.version).toBe(3);
    }

    // The marker CAS landed (version bumped) but the partial-index predicate
    // excludes non-in_progress rows in BOTH worlds.
    expect(await fake.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
    expect(await pg.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
  });

  it('clear + explicit re-designation: BOTH remove the marker (list empty), version bumps each time (S4)', async () => {
    const { fake, pg } = await seedBoth();
    await fake.setRecoveryRequest(COMPANY, DESIGNATED_ID, 2, true);
    await pg.setRecoveryRequest(COMPANY, DESIGNATED_ID, 2, true);

    // Clear (recovery completed / UNRESOLVED escalation recorded).
    const fakeClear = (await fake.setRecoveryRequest(COMPANY, DESIGNATED_ID, 3, false)) as Extract<
      CasResult,
      { ok: true }
    >;
    const pgClear = (await pg.setRecoveryRequest(COMPANY, DESIGNATED_ID, 3, false)) as Extract<
      CasResult,
      { ok: true }
    >;
    expect(fakeClear.ok).toBe(true);
    expect(pgClear.ok).toBe(true);
    expect(pgClear.value.version).toBe(fakeClear.value.version);
    expect(await fake.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
    expect(await pg.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);

    // Explicit re-designation is a fresh operator action in BOTH.
    const fakeRe = (await fake.setRecoveryRequest(COMPANY, DESIGNATED_ID, 4, true)) as Extract<
      CasResult,
      { ok: true }
    >;
    const pgRe = (await pg.setRecoveryRequest(COMPANY, DESIGNATED_ID, 4, true)) as Extract<
      CasResult,
      { ok: true }
    >;
    expect(fakeRe.ok).toBe(true);
    expect(pgRe.ok).toBe(true);
    expect(pgRe.value.version).toBe(fakeRe.value.version);
    expect(fakeRe.value.version).toBe(5);
    expect((await fake.listRecoveryRequestedByCompany(COMPANY)).map((w) => w.workId)).toEqual([
      DESIGNATED_ID,
    ]);
    expect((await pg.listRecoveryRequestedByCompany(COMPANY)).map((w) => w.workId)).toEqual([
      DESIGNATED_ID,
    ]);
  });
});
