import { InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';
import type { Work } from '@io/business-domain/src/types.js';
import { describe, expect, it } from 'vitest';

import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../src/dispatch/keys.js';
import { attemptIdFor } from '../src/worker/intent.js';
import { recoverDesignatedWork } from '../src/worker/recover.js';
import { acceptedWork, RecordingJournal, RecordingSandbox } from './worker-helpers.js';

/**
 * Supervisor recovery matrix (worker-cycle "Journal-Anchored Reconciliation" +
 * io-persistence-recovery-contract "Recovery Matrix"): the supervisor entry
 * point `recoverDesignatedWork` dispatches per crash WINDOW. The supervisor
 * holds ONLY the orphaned `in_progress` Work row; the journal identity is
 * derived deterministically (`wk:` key + SHA-256 hash + `att:` attemptId), and
 * every reconcile write presents the RETAINED token read fresh from the Work
 * row (design D6 — never re-minted).
 *
 *   W1 (no journal row, no effect)     → resume (insert fresh, never fabricate)
 *   W2 (in_flight, no applied effect)  → markRetryable WITHOUT undo → cas-lost-retryable
 *   W3 (in_flight, applied effect)     → undo FIRST → markRetryable → cas-lost-retryable
 *   missing evidence / undo failure    → UNRESOLVED_REQUIRES_HUMAN (never re-run)
 *   idempotent re-tick                 → no second undo/effect/terminal mutation
 *   stale token                        → rejected (fail loud), row unchanged
 *   terminal Work                      → UNRESOLVED_REQUIRES_HUMAN (never fabricate)
 *   already aborted_retryable          → recovery-required (no-op)
 *   already completed                  → replay the recorded result
 */

const COMPANY = 'acme';
const WORK_ID = 'work-1';
const KEY = dispatchIdempotencyKeyFor(COMPANY, WORK_ID);
const ATTEMPT = attemptIdFor(COMPANY, KEY);

const docAction = {
  type: 'create-document' as const,
  relativePath: 'docs/quarterly-close.md',
  content: 'closed for Q3 2026',
};

/** A claimed (in_progress) orphan: claim mints token 0 → 1. */
async function claimedWork(
  overrides: Partial<Work> = {},
): Promise<{ work: InMemoryWorkRepository; current: Work }> {
  const work = new InMemoryWorkRepository();
  await work.save(acceptedWork(overrides));
  const current = await work.get(COMPANY, WORK_ID);
  if (current === undefined) throw new Error('test setup: work not seeded');
  const claimed = await work.updateIfVersion(
    { ...current, state: 'in_progress' },
    current.version,
    { kind: 'claim' },
  );
  if (!claimed.ok) throw new Error('test setup: claim failed');
  return { work, current: claimed.value };
}

/** The journal identity for the matrix's Work row (identical in both worlds:
 * the supervisor entry and the test seed MUST derive the same key/hash). */
function identityFor(work: Work): { requestHash: string; fencingToken: number } {
  return { requestHash: dispatchRequestHashFor(work), fencingToken: work.fencingToken };
}

describe('supervisor recovery matrix — recoverDesignatedWork dispatches per window', () => {
  it('W1: no journal row + no effect → resume (NOT UNRESOLVED) — no journal write, token retained (spec "W1 resumes with no journal row")', async () => {
    const { work, current } = await claimedWork();
    const journal = new RecordingJournal();
    const sandbox = new RecordingSandbox();

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toEqual({ ok: false, reason: 'resume' });
    // NO journal write: nothing was fabricated (no insert/complete/mark).
    expect(
      journal.log.some(
        (logged) =>
          logged.startsWith('insertInFlight:') ||
          logged.startsWith('complete:') ||
          logged.startsWith('markRetryable:'),
      ),
    ).toBe(false);
    expect(await journal.lookup(COMPANY, KEY)).toBeUndefined();
    // Token retained: the minted claim token (1) was never re-minted.
    expect((await work.get(COMPANY, WORK_ID))?.fencingToken).toBe(1);
    expect((await work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });

  it('W2: in_flight + no applied effect → markRetryable WITHOUT undo → cas-lost-retryable (spec "W2 becomes retryable without undo")', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    const sandbox = new RecordingSandbox(); // empty undo log — no effect ran

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.fencingToken).toBe(current.fencingToken); // retained token N
    expect(sandbox.undos).toHaveLength(0); // W2 abort requires NO preceding undo
  });

  it('W3: in_flight + applied effect → undo FIRST → markRetryable → cas-lost-retryable (spec "W3 undoes before retry")', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    const sandbox = new RecordingSandbox();
    const effect = await sandbox.execute(docAction);
    expect(await sandbox.wasApplied(effect.undo.handleId)).toBe(true);

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
    // The applied effect was reversed BEFORE the marker (W3 ordering).
    expect(sandbox.undos).toHaveLength(1);
    expect(await sandbox.wasApplied(effect.undo.handleId)).toBe(false);
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.fencingToken).toBe(current.fencingToken);
  });

  it('missing evidence: required undo FAILS → UNRESOLVED_REQUIRES_HUMAN, never re-executes (spec "Missing evidence or undo failure escalates")', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    const sandbox = new FailingUndoSandbox();
    await sandbox.execute(docAction); // undo log proves the effect applied

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toMatchObject({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    // The failed undo never re-ran the effect, and the marker was NOT set —
    // the attempt is closed honestly with the typed UNRESOLVED result.
    expect(sandbox.undoAttempts).toHaveLength(1);
    expect(sandbox.executes).toHaveLength(1); // exactly the setup execution
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
  });

  it('idempotent re-tick: a second recovery over the already-recovered (aborted_retryable) row no-ops — no second undo, no mutation (spec "Recovery is idempotent on re-tick")', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    const sandbox = new RecordingSandbox();
    // Apply the effect so the durable undo log holds an applied entry (W3).
    await sandbox.execute(docAction);

    const first = await recoverDesignatedWork({ work, journal, sandbox }, current);
    expect(first).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
    expect(sandbox.undos).toHaveLength(1);

    // Re-tick: the marker row short-circuits — no second undo/effect/mutation.
    const second = await recoverDesignatedWork({ work, journal, sandbox }, current);
    expect(second).toMatchObject({ ok: false, reason: 'recovery-required' });
    expect(sandbox.undos).toHaveLength(1); // NO second undo
    expect(sandbox.executes).toHaveLength(1); // NO re-executed effect
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable'); // NO terminal mutation
    expect(row?.fencingToken).toBe(current.fencingToken);
  });

  it('stale token: journal ownership advanced past the retained token → REJECTED, row unchanged (spec "Stale reconciliation token is rejected")', async () => {
    // The Work row carries token 3 (the recovery presents it fresh); the
    // journal row is owned by token 5 — ownership advanced. The claim-gated
    // marker write MUST refuse the stale holder (fail loud, R4-001 — the same
    // typed rejection the pinned finalize stale-holder contract uses) and
    // leave the row unchanged.
    const { work, current } = await claimedWork({ version: 2, fencingToken: 3 });
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash: identityFor(current).requestHash,
      attemptId: ATTEMPT,
      fencingToken: 5, // ownership advanced to N + 1
    });
    const sandbox = new RecordingSandbox();

    const reconcile = recoverDesignatedWork({ work, journal, sandbox }, current);

    await expect(reconcile).rejects.toThrow(/fencing token mismatch/i);
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('in_flight');
    expect(row?.fencingToken).toBe(5);
    expect(sandbox.undos).toHaveLength(0);
  });

  it('terminal Work + in_flight row → UNRESOLVED_REQUIRES_HUMAN, no undo, no marker (spec "Unresolvable terminal state is reported honestly")', async () => {
    const { work, current } = await claimedWork();
    const completed = await work.updateIfVersion(
      { ...current, state: 'completed' },
      current.version,
    );
    if (!completed.ok) throw new Error('test setup: out-of-band completion failed');
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash: identityFor(current).requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    const sandbox = new RecordingSandbox();

    const result = await recoverDesignatedWork({ work, journal, sandbox }, completed.value);

    expect(result).toMatchObject({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    expect(sandbox.undos).toHaveLength(0);
    expect(journal.log.some((logged) => logged.startsWith('markRetryable:'))).toBe(false);
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('completed');
    expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    expect((await work.get(COMPANY, WORK_ID))?.state).toBe('completed');
  });

  it('already aborted_retryable → recovery-required (no-op): no mutation, no undo', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    await journal.markRetryable(ATTEMPT, current.fencingToken);
    const sandbox = new RecordingSandbox();

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toMatchObject({ ok: false, reason: 'recovery-required' });
    const row = await journal.lookup(COMPANY, KEY);
    expect(row?.status).toBe('aborted_retryable');
    expect(row?.fencingToken).toBe(current.fencingToken);
    expect(sandbox.undos).toHaveLength(0);
    expect((await work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
  });

  it('already completed → replay the recorded result (no effect re-run)', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    await journal.complete(ATTEMPT, { ok: true, state: 'completed' });
    const sandbox = new RecordingSandbox();

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    expect(result).toEqual({
      ok: true,
      replayed: true,
      resultJson: { ok: true, state: 'completed' },
    });
    expect(sandbox.undos).toHaveLength(0);
    expect(sandbox.executes).toHaveLength(0);
  });

  it('re-tick after an escalation replays the recorded UNRESOLVED close — idempotent, no second escalation write', async () => {
    const { work, current } = await claimedWork();
    const { requestHash } = identityFor(current);
    const journal = new RecordingJournal();
    await journal.insertInFlight({
      companyId: COMPANY,
      idempotencyKey: KEY,
      requestHash,
      attemptId: ATTEMPT,
      fencingToken: current.fencingToken,
    });
    await journal.complete(ATTEMPT, { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    const sandbox = new RecordingSandbox();

    const result = await recoverDesignatedWork({ work, journal, sandbox }, current);

    // The completed row replays the recorded sentinel — the key is sealed and
    // the recovery never re-mutates (spec "Recovery is idempotent on re-tick").
    expect(result).toEqual({
      ok: true,
      replayed: true,
      resultJson: { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' },
    });
    expect(sandbox.undos).toHaveLength(0);
    expect(sandbox.executes).toHaveLength(0);
  });
});

/** Sandbox whose `undo` ALWAYS fails: the effect evidence cannot be reversed
 * (missing/contradictory evidence — the durable undo log cannot be trusted). */
class FailingUndoSandbox extends RecordingSandbox {
  readonly undoAttempts: number[] = [];
  override async undo(_handle: { handleId: string }): Promise<void> {
    this.undoAttempts.push(1);
    throw new Error('undo failed: effect evidence unavailable');
  }
}
