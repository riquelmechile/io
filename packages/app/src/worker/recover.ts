import type { IdempotencyJournalPort } from '@io/business-domain/src/ports/idempotency.js';
import type { WorkRepository } from '@io/business-domain/src/ports/repositories.js';
import type { Work } from '@io/business-domain/src/types.js';

import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';
import { reconcilePostEffectFailure } from './finalize.js';

/**
 * Durable restart recovery (WC durable-restart; design "Post-effect / restart"
 * table): a worker that died mid-cycle recovers from the DURABLE
 * (PostgreSQL-backed) journal in-flight row — the recovery anchor that MUST
 * survive process death. A fresh worker over the same durable journal + durable
 * undo log consults BOTH (journal = attempt SoT, undo log = effect SoT, §9.8):
 *
 *   - no in-flight row            → nothing durable to recover — never fabricate
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
 *     `cas-lost-retryable`; no applied entry → clean replay (no undo, no
 *     marker) → `recovery-required`.
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
  | { ok: false; reason: 'UNRESOLVED_REQUIRES_HUMAN'; current?: Work };

/** The synthetic "no effect" record for the clean-replay branch: the recovery
 * reconstructs the effect state from the durable undo log, and an empty log
 * means the crashed worker's effect never ran. The record's `applied: false`
 * is what the shared reconcile reads; the undo handle is synthetic and NEVER
 * dereferenced on the clean-replay branch (which never undoes), so it stays
 * inert under the port's handle shape. */
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
    // The crash left no durable in-flight row — nothing to recover; never
    // fabricate an in_progress state or an undo.
    return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' };
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

  return reconcilePostEffectFailure(
    { work: deps.work, journal: deps.journal, sandbox: deps.sandbox },
    {
      companyId: input.companyId,
      workId: input.workId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      attemptId: input.attemptId,
      effect,
    },
  );
}
