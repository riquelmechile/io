import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import type { UseCaseResult, WorkCommandBase } from './result.js';

/**
 * requestRecovery (supervisor-recovery design D2, work-lifecycle "Operator
 * Recovery Designation"): the OPERATOR's designation entry point. Designation
 * is operational repository metadata — a plain expected-version CAS that bumps
 * `version` while leaving `state` and `fencing_token` UNCHANGED (no
 * FencingDirective, no new token mint). It is NOT a lifecycle transition:
 * `WORK_TRANSITIONS` keeps `in_progress -> ['completed']` as the only outgoing
 * edge, and the domain `Work` type stays pure (no `recoveryRequested` field —
 * the marker lives only in the repository row + port methods).
 *
 * The version bump is the fencing mechanism: a zombie worker holding the stale
 * version N fails its terminal CAS (claim, terminal, and plain CAS all check
 * version) once the stored version advances to N + 1, while the retained claim
 * token stays valid for the legitimate holder. `requested` supports both
 * designation (`true`) and clearing (`false` — recovery completed or an
 * `UNRESOLVED_REQUIRES_HUMAN` escalation recorded), so a later explicit
 * re-designation is a fresh operator action. Failures are VALUES, never
 * thrown exceptions for control flow.
 */
export interface RequestRecoveryCommand extends WorkCommandBase {
  readonly workId: string;
  /** Designation = true; clear = false (recovery done / escalation recorded). */
  readonly requested: boolean;
}

export type RequestRecoveryResult = UseCaseResult<Work>;

export async function requestRecovery(
  cmd: RequestRecoveryCommand,
  deps: { work: WorkRepository },
): Promise<RequestRecoveryResult> {
  if (!cmd.workId) return { ok: false, reason: 'invalid-command' };
  const current = await deps.work.get(cmd.companyId, cmd.workId);
  if (current === undefined) return { ok: false, reason: 'not-found' };
  // Designation targets ORPHANED in_progress Work only (the discovery query
  // filters `state = 'in_progress'`); a terminal Work has nothing to recover.
  if (current.state !== 'in_progress') {
    return { ok: false, reason: 'invalid-transition', current };
  }
  if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== current.version) {
    // The caller is provably stale; short-circuit before a doomed write.
    return { ok: false, reason: 'version-conflict', current };
  }
  const cas = await deps.work.setRecoveryRequest(
    cmd.companyId,
    cmd.workId,
    current.version,
    cmd.requested,
  );
  if (!cas.ok) {
    // The atomic CAS is authoritative: a concurrent writer won. A plain CAS
    // never returns fencing-conflict (no directive is supplied) — but the
    // reason passes through typed, never re-mapped.
    return { ok: false, reason: cas.reason, current: cas.current };
  }
  return { ok: true, value: cas.value };
}
