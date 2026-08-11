import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Work } from '@io/business-domain/src/types.js';
import {
  PgDelegationRepository,
  PgIdempotencyJournalRepository,
  PgWorkRepository,
} from '@io/database/src/index.js';
import { InMemoryDbConnection } from '@io/database/test/connection-fake.js';
import { describe, expect, it } from 'vitest';

import { buildSupervisorDispatch } from '../../src/composition/supervisor-dispatch.js';
import { buildWorkerDeps } from '../../src/composition/worker-deps.js';
import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../../src/dispatch/keys.js';
import { attemptIdFor } from '../../src/worker/intent.js';
import { E2E_PRINCIPALS } from '../e2e/harness.js';
import { acceptedWork, activeDelegation, cannedLlm } from '../worker-helpers.js';

/**
 * Supervisor recovery wiring (supervisor-timer "Sequential Checkpointed Tick"
 * delta + design D4/D5/D7): the COMPOSITION ROOT builds the `onRecovery`
 * closure over work/journal/sandbox (the same shape `onActivate` closes over
 * dispatch deps) and wires `requestRecovery` as the admin designation entry.
 * The closure per company: `listRecoveryRequestedByCompany` → for each: fresh
 * `work.get` → if NOT `in_progress`, clear the stale marker (done/gone) →
 * else `recoverDesignatedWork` (the W1/W2/W3 matrix) → on a RESUMABLE
 * disposition (`resume` | `cas-lost-retryable` | `recovery-required`) →
 * `dispatchRecovery` (the claim-gate-free resume, retained token, deterministic
 * `wk:` identity) → clear the marker LAST with a FRESH version read. A
 * completed-attempt replay, an UNRESOLVED escalation, and a fail-loud
 * stale-token reconcile all SETTLE (marker cleared — re-designation is a fresh
 * operator action; no hot retry). The full cycle runs against the in-memory
 * DB connection fake + the REAL FileDocumentSandbox over a tmp root, so the
 * recovered Work COMPLETES end-to-end (one receipt, journal completed) with
 * zero PostgreSQL.
 */

const COMPANY = 'acme';
const WORK_ID = 'work-1';

function makeComposed() {
  const connection = new InMemoryDbConnection();
  const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-recovery-'));
  const composed = buildSupervisorDispatch({
    connection,
    llm: cannedLlm(),
    sandboxRoot,
    principals: E2E_PRINCIPALS,
  });
  return { connection, sandboxRoot, composed };
}

/** A designated in_progress orphan (claim minted token 0 → 1) with its active
 * delegation — exactly what the operator designation flow produces. */
async function designateOrphan(
  connection: InMemoryDbConnection,
  version = 2,
  fencingToken = 1,
): Promise<Work> {
  const work = new PgWorkRepository(connection);
  await work.save(acceptedWork({ state: 'in_progress', version, fencingToken }));
  await new PgDelegationRepository(connection).save(activeDelegation());
  await work.setRecoveryRequest(COMPANY, WORK_ID, version, true);
  const stored = await work.get(COMPANY, WORK_ID);
  if (stored === undefined) throw new Error('test setup: designated orphan missing');
  return stored;
}

/** The dispatch identity for the matrix's Work row (identical in both worlds:
 * the recovery closure and the test seed MUST derive the same key/hash). */
function identityFor(work: Work): { key: string; hash: string; attemptId: string } {
  const key = dispatchIdempotencyKeyFor(work.companyId, work.workId);
  return { key, hash: dispatchRequestHashFor(work), attemptId: attemptIdFor(work.companyId, key) };
}

describe('buildSupervisorDispatch — onRecovery closure over work/journal/sandbox (design D4/D5)', () => {
  it('exposes the onRecovery seam as a callable sibling of onActivate, plus the requestRecovery admin entry', () => {
    const { composed, sandboxRoot } = makeComposed();
    try {
      expect(typeof composed.onRecovery).toBe('function');
      expect(typeof composed.requestRecovery).toBe('function');
      expect(typeof composed.onActivate).toBe('function');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('resumes a designated W1 orphan end-to-end — recoverDesignatedWork → resume → dispatchRecovery → COMPLETED, marker cleared', async () => {
    const { connection, sandboxRoot, composed } = makeComposed();
    try {
      const orphan = await designateOrphan(connection);
      // W1: NO journal row exists for the derived key — the safest window
      // (the effect provably never ran).

      await composed.onRecovery(COMPANY);

      // The claim-gate-free resume ran the FULL post-claim body: LLM intent +
      // real sandbox effect + atomic finalize → the orphan COMPLETES with
      // exactly one receipt and a completed journal attempt.
      const workRepo = new PgWorkRepository(connection);
      const after = await workRepo.get(COMPANY, WORK_ID);
      expect(after?.state).toBe('completed');
      // seed 2 → designation bump 3 → finalize terminal CAS 4 → marker-clear 5
      expect(after?.version).toBe(5);
      const entry = await new PgIdempotencyJournalRepository(connection).lookup(
        COMPANY,
        identityFor(orphan).key,
      );
      expect(entry?.status).toBe('completed');
      // Marker cleared LAST — the next tick will NOT re-recover the completed Work.
      expect(await workRepo.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
      // The durable undo-log evidence was written under the sandbox root.
      expect(existsSync(join(sandboxRoot, '.io', 'undo-log.json'))).toBe(true);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('reconciles a designated W2 orphan (in_flight, no effect) → markRetryable → dispatchRecovery reopens → COMPLETED, marker cleared', async () => {
    const { connection, sandboxRoot, composed } = makeComposed();
    try {
      const orphan = await designateOrphan(connection);
      const { key, hash, attemptId } = identityFor(orphan);
      const journal = new PgIdempotencyJournalRepository(connection);
      await journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: key,
        requestHash: hash,
        attemptId,
        fencingToken: orphan.fencingToken,
      });
      // W2: in_flight row + EMPTY durable undo log (the fresh sandbox) — the
      // no-effect window. The composition must mark it retryable (no undo)
      // and then resume it.

      await composed.onRecovery(COMPANY);

      const workRepo = new PgWorkRepository(connection);
      const after = await workRepo.get(COMPANY, WORK_ID);
      expect(after?.state).toBe('completed');
      const entry = await journal.lookup(COMPANY, key);
      expect(entry?.status).toBe('completed');
      expect(await workRepo.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('does NOT resume a designated Work whose attempt ALREADY completed — replay settles, marker cleared, ZERO LLM (completed → no-op)', async () => {
    const { connection, sandboxRoot, composed } = makeComposed();
    try {
      const orphan = await designateOrphan(connection);
      const { key, hash, attemptId } = identityFor(orphan);
      const journal = new PgIdempotencyJournalRepository(connection);
      await journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: key,
        requestHash: hash,
        attemptId,
        fencingToken: orphan.fencingToken,
      });
      await journal.complete(attemptId, { ok: true, state: 'completed' });

      await composed.onRecovery(COMPANY);

      // The completed row replays (no effect re-run, no LLM) and the marker
      // clears — recovery is idempotent on re-tick.
      const workRepo = new PgWorkRepository(connection);
      expect(await workRepo.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
      expect((await workRepo.get(COMPANY, WORK_ID))?.state).toBe('in_progress'); // untouched
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('settles a stale-token reconcile (typed escalation): marker cleared, NO dispatch, NO throw, NO hot retry (escalation)', async () => {
    const connection = new InMemoryDbConnection();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-recovery-'));
    try {
      const orphan = await designateOrphan(connection);
      const { key, hash, attemptId } = identityFor(orphan);
      const journal = new PgIdempotencyJournalRepository(connection);
      await journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: key,
        requestHash: hash,
        attemptId,
        fencingToken: 5, // journal ownership advanced past the retained token 1
      });
      const llm = cannedLlm();
      const composed = buildSupervisorDispatch({
        connection,
        llm,
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // The reconcile returns the TYPED UNRESOLVED escalation (spec "Stale
      // reconciliation token is rejected" — never a thrown rejection) — the
      // composition settles it: the marker clears and the tick never hot-retries.
      await expect(composed.onRecovery(COMPANY)).resolves.toBeUndefined();
      expect(llm.requests).toHaveLength(0); // no resume was attempted
      const workRepo = new PgWorkRepository(connection);
      expect(await workRepo.listRecoveryRequestedByCompany(COMPANY)).toEqual([]);
      // The journal row is unchanged (still in_flight, token 5).
      const entry = await journal.lookup(COMPANY, key);
      expect(entry?.status).toBe('in_flight');
      expect(entry?.fencingToken).toBe(5);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('wires requestRecovery as the admin designation entry — designating makes the orphan discoverable by the recovery closure', async () => {
    const connection = new InMemoryDbConnection();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-recovery-'));
    try {
      const work = new PgWorkRepository(connection);
      await work.save(acceptedWork({ state: 'in_progress', version: 2, fencingToken: 1 }));
      const composed = buildSupervisorDispatch({
        connection,
        llm: cannedLlm(),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      const result = await composed.requestRecovery({
        companyId: COMPANY,
        actor: E2E_PRINCIPALS.proposer,
        workId: WORK_ID,
        expectedVersion: 2,
        requested: true,
      });

      expect(result.ok).toBe(true);
      // The designation bumps version (2 → 3) and the discovery query finds it.
      expect(await work.listRecoveryRequestedByCompany(COMPANY)).toHaveLength(1);
      const stored = await work.get(COMPANY, WORK_ID);
      expect(stored?.version).toBe(3);
      expect(stored?.state).toBe('in_progress'); // NOT a lifecycle transition
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('a terminal designated Work is invisible to the partial-index discovery — zero LLM, marker stays inert (no sweep)', async () => {
    const connection = new InMemoryDbConnection();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-recovery-'));
    try {
      const work = new PgWorkRepository(connection);
      await work.save(acceptedWork({ state: 'completed', version: 3, fencingToken: 1 }));
      // An out-of-band completion left a stale designation marker.
      await work.setRecoveryRequest(COMPANY, WORK_ID, 3, true);
      const llm = cannedLlm();
      const composed = buildSupervisorDispatch({
        connection,
        llm,
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      await composed.onRecovery(COMPANY);

      // The completed Work is invisible to `listRecoveryRequestedByCompany`
      // (partial-index predicate `state='in_progress'`) — the tick does
      // nothing (zero LLM) and the stale marker stays inert, hidden by the
      // index (slice-2 inert-stale-marker semantics). No resume, no mutation.
      expect(llm.requests).toHaveLength(0);
      const stored = await work.get(COMPANY, WORK_ID);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(4); // seed 3 → designation bump 4; untouched by the tick
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});

describe('buildWorkerDeps — FileDocumentSandbox with the explicit durability path (design File Changes)', () => {
  it('constructs the sandbox with an explicit durability path — the undo log lands there, not the default', async () => {
    const connection = new InMemoryDbConnection();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-durable-'));
    const durabilityPath = join(sandboxRoot, 'custom', 'undo-log.json');
    try {
      const deps = buildWorkerDeps({
        connection,
        llm: cannedLlm(),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
        durabilityPath,
      });

      await deps.sandbox.execute({
        type: 'create-document',
        relativePath: 'docs/durable.md',
        content: 'durable evidence',
      });

      // The durability contract: the undo-log JSON (counter + applied entry)
      // is persisted at the EXPLICIT path after the effect.
      expect(existsSync(durabilityPath)).toBe(true);
      const state = JSON.parse(readFileSync(durabilityPath, 'utf8')) as {
        counter: number;
        undoLog: readonly { applied: boolean }[];
      };
      expect(state.counter).toBe(1);
      expect(state.undoLog).toHaveLength(1);
      expect(state.undoLog[0]?.applied).toBe(true);
      expect(existsSync(join(sandboxRoot, '.io', 'undo-log.json'))).toBe(false);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});
