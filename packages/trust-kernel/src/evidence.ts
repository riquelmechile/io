import type { AuditEntry, Decision, Evidence, PrincipalId, RiskClass } from './model.js';

/**
 * Disclosure shared by every in-memory kernel record: it is NOT persisted and
 * does NOT satisfy persistent R1–R17 obligations (Req 7, Req 8). Shared with
 * the receipt module so non-persistence is declared consistently.
 */
export const NON_PERSISTENT_DISCLOSURE =
  'in-memory only; not persisted; does not satisfy R1-R17 persistent-record obligations';

/** Input to evidence capture. */
export interface EvidenceInput {
  readonly actionId: string;
  readonly principalId: PrincipalId;
  readonly riskClass: RiskClass;
  readonly decision: Decision;
  readonly reason: string;
  readonly now: number;
}

/** Outcome of evidence capture: the evidence record and the new audit log. */
export interface EvidenceResult {
  readonly evidence: Evidence;
  readonly auditLog: readonly AuditEntry[];
}

/**
 * Capture an in-memory evidence record and append ONE disclosed audit entry for
 * the evaluation, returning a NEW immutable audit list (Req 7). Works for both
 * ALLOW and DENY — every evaluation appends exactly one entry that records
 * principal, action, risk class, decision, and reason, and declares it is
 * non-persistent. Pure: the prior audit log is never mutated and no state
 * survives the returned values.
 */
export function captureEvidence(
  input: EvidenceInput,
  priorAuditLog: readonly AuditEntry[],
): EvidenceResult {
  const record = buildDisclosedRecord(input);
  return { evidence: record, auditLog: appendImmutable(priorAuditLog, record) };
}

/**
 * Build the disclosed in-memory record from the input. Shared source of truth
 * for the persistent:false literal and the non-persistent disclosure so the
 * honesty contract is set in one place (Req 7).
 */
function buildDisclosedRecord(input: EvidenceInput): Evidence {
  return {
    actionId: input.actionId,
    principalId: input.principalId,
    riskClass: input.riskClass,
    decision: input.decision,
    reason: input.reason,
    timestamp: input.now,
    persistent: false,
    disclosure: NON_PERSISTENT_DISCLOSURE,
  };
}

/**
 * Return a NEW list with `entry` appended; never mutates `list` (Req 7). The
 * single immutable-append path so no caller can mutate the prior audit log.
 */
function appendImmutable<T>(list: readonly T[], entry: T): readonly T[] {
  return [...list, entry];
}
