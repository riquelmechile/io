import type { IdempotencyJournalPort } from '@io/business-domain/src/ports/idempotency.js';
import type { WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { Work } from '@io/business-domain/src/types.js';

import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../dispatch/keys.js';
import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';
import { reconcilePostEffectFailure } from './finalize.js';
import { attemptIdFor } from './intent.js';

/**
 * Durable restart recovery (WC durable-restart; design "Post-effect / restart"
 * table): a worker that died mid-cycle recovers from the DURABLE
 * (PostgreSQL-backed) journal in-flight row — the recovery anchor that MUST
 * survive process death. A fresh worker over the same durable journal + durable
 * undo log consults BOTH (journal = attempt SoT, undo log = effect SoT, §9.8):
 *
 *   - no in-flight row (W1)       → resumable disposition: the supervisor
 *                                   inserts fresh (never fabricate a row/effect)
 *   - completed row               → the recorded result replays (no effect re-run)
 *   - aborted_retryable row       → a prior recovery already reconciled the
 *                                   attempt; a controlled retry reopens the key
 *                                   via the PRE-effect path — recovery-required
 *   - in-flight + work gone       → typed UNRESOLVED close (never fabricate an
 *                                   in_progress or an undo)
 *   - in-flight + work terminal   → typed UNRESOLVED close (T2(ii) rule)
 *   - in-flight + work in_progress → reconstruct the effect state from the
 *     DURABLE undo log (applied entries): applied → the SHARED post-effect
 *     reconcile undoes the effect + marks the attempt retryable (a terminal,
 *     durable marker — own committed write, never a failure-complete) →
 *     `cas-lost-retryable`; no applied entry (W2) → markRetryable WITHOUT undo
 *     (durable proof of no effect) → `cas-lost-retryable`; a failed undo →
 *     typed `UNRESOLVED_REQUIRES_HUMAN` (never re-execute).
 *
 * The recovery reuses `reconcilePostEffectFailure` — the SAME honest close the
 * finalize CAS-loss T2 and the verify-fail path use — so restart, CAS-loss and
 * verify-fail cannot drift apart.
 */

export interface RecoverDeps {
  work: WorkRepository;
  journal: IdempotencyJournalPort;
  /** The durable sandbox whose undo log survived the restart (SoT, §9.8):
   * `snapshotUndoLog` enumerates the persisted applied effects. */
  sandbox: SandboxPort & { snapshotUndoLog(): readonly EffectRecord[] };
}

export interface RecoverInput {
  readonly companyId: string;
  readonly workId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
}

export type RecoveryResult =
  | { ok: true; replayed: true; resultJson: unknown }
  | { ok: false; reason: 'cas-lost-retryable'; current: Work }
  | { ok: false; reason: 'recovery-required'; current?: Work }
  /** W1 (design D7): no journal row and no effect evidence — a RESUMABLE
   * disposition. The supervisor inserts a fresh attempt at the pre-effect
   * reconcile; recovery never fabricates a journal row or an effect. */
  | { ok: false; reason: 'resume'; current?: Work }
  | { ok: false; reason: 'UNRESOLVED_REQUIRES_HUMAN'; current?: Work };

/** The synthetic "no effect" record for the W2 branch: the recovery
 * reconstructs the effect state from the durable undo log, and an empty log
 * means the crashed worker's effect never ran. The record's `applied: false`
 * is what the shared reconcile reads; the undo handle is synthetic and NEVER
 * dereferenced on the W2 branch (which never undoes), so it stays inert under
 * the port's handle shape. */
function noAppliedEffect(): EffectRecord {
  const action = { type: 'create-document' as const, relativePath: '', content: '' };
  return {
    effectId: 'recovered-none',
    action,
    absolutePath: '',
    applied: false,
    undo: { handleId: '', action, applied: true },
  };
}

export async function recoverInFlightWork(
  deps: RecoverDeps,
  input: RecoverInput,
): Promise<RecoveryResult> {
  const entry = await deps.journal.lookup(input.companyId, input.idempotencyKey);
  if (entry === undefined) {
    // W1 (design D7): the crash left NO durable in-flight row AND no effect
    // evidence — the effect provably never ran. Return the RESUMABLE
    // disposition (never fabricate an in_progress state, a journal row, or an
    // undo): the supervisor inserts a fresh attempt at the pre-effect
    // reconcile with the retained token.
    return { ok: false, reason: 'resume' };
  }
  if (entry.status === 'completed') {
    // The attempt already reached a terminal close — replay the recorded result.
    return { ok: true, replayed: true, resultJson: entry.resultJson };
  }
  if (entry.status === 'aborted_retryable') {
    // A prior recovery already reconciled this attempt to its retryable marker.
    // A controlled retry reopens the key via the PRE-effect path; the recovery
    // itself never retries and never fabricates.
    return { ok: false, reason: 'recovery-required' };
  }

  // in_flight — the recovery anchor. Reconstruct the effect state from the
  // DURABLE undo log: an applied entry survived the crash, or the effect never
  // ran. The shared post-effect reconcile closes the attempt honestly.
  const appliedEntries = deps.sandbox.snapshotUndoLog().filter((record) => record.applied);
  const lastApplied = appliedEntries[appliedEntries.length - 1];
  const effect: EffectRecord = lastApplied !== undefined ? lastApplied : noAppliedEffect();

  // The claim-scoped fencing token (fencing-tokens change): retained on the
  // Work row — recovery resumes WITHOUT a fresh claim, so it presents the
  // stored token (never re-mints). Read here so the shared reconcile's
  // FinalizeInput contract is satisfied with the honest retained token.
  const retained = await deps.work.get(input.companyId, input.workId);
  const fencingToken = retained?.fencingToken ?? 0;

  return reconcilePostEffectFailure(
    { work: deps.work, journal: deps.journal, sandbox: deps.sandbox },
    {
      companyId: input.companyId,
      workId: input.workId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      attemptId: input.attemptId,
      fencingToken,
      effect,
    },
  );
}

/**
 * Supervisor recovery entry point (design D5/D7 data flow): dispatches the
 * orphaned `in_progress` Work per crash WINDOW. The supervisor holds ONLY the
 * Work row — the journal identity is a stable function of it
 * (`dispatchIdempotencyKeyFor` / `dispatchRequestHashFor`, keys.ts), so the
 * attempt is reconstructed with zero worker memory. The retained fencing token
 * is read FRESH from the Work row inside `recoverInFlightWork` (never
 * re-minted, D6). Per-window disposition:
 *
 *   - W1 (no journal row)      → `resume` — the caller inserts fresh pre-effect
 *   - W2 (in_flight, no fx)    → markRetryable WITHOUT undo → `cas-lost-retryable`
 *   - W3 (in_flight, fx)       → undo FIRST → markRetryable → `cas-lost-retryable`
 *   - missing evidence / undo failure → `UNRESOLVED_REQUIRES_HUMAN`
 *   - terminal Work            → `UNRESOLVED_REQUIRES_HUMAN` (never fabricate)
 *   - already retryable/completed → no-op (`recovery-required` / replay)
 */
export async function recoverDesignatedWork(
  deps: RecoverDeps,
  work: Work,
): Promise<RecoveryResult> {
  const idempotencyKey = dispatchIdempotencyKeyFor(work.companyId, work.workId);
  const requestHash = dispatchRequestHashFor(work);
  const attemptId = attemptIdFor(work.companyId, idempotencyKey);
  return recoverInFlightWork(deps, {
    companyId: work.companyId,
    workId: work.workId,
    idempotencyKey,
    requestHash,
    attemptId,
  });
}
