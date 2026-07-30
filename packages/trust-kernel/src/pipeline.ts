import { NON_PERSISTENT_DISCLOSURE, captureEvidence, type EvidenceInput } from './evidence.js';
import { validateBoundedWindow } from './model.js';
import type {
  AuditEntry,
  Decision,
  Evidence,
  KernelAction,
  PersistentRecord,
  RiskClass,
} from './model.js';
import type { Grant } from './grant.js';
import { classify } from './risk.js';
import type { RiskThresholds } from './risk.js';
import type { PrincipalIdentity } from './identity.js';
import { issueReceipt, type UnsignedInMemoryReceipt } from './receipt.js';
import { checkSod } from './sod.js';
import type { SodAssignment, SodPolicy } from './sod.js';
import type {
  AuditRepository,
  EvidenceRepository,
  PersistenceOutcome,
} from './ports/repositories.js';
import { PERSISTENT_PORT_DISCLOSURE } from './ports/repositories.js';

/**
 * Scoped in-memory evaluation pipeline (Req 5). Composes the persistence-free
 * subset of the canonical fixed 16-step authority pipeline: ten enforced gates
 * and six documented no-op pass-through steps deferred to downstream hardening.
 * Classify (step 1) runs BEFORE authority (step 3). Any failed enforced step is
 * a terminal DENY. One evidence record + one disclosed audit entry are captured
 * for every evaluation (ALLOW and DENY); an unsigned non-persistent receipt is
 * issued only on ALLOW. Pure: no state survives the returned values.
 */

/** The six deferred steps, documented as "harden downstream" no-op pass-throughs. */
export type DeferredStep =
  | 'delegation'
  | 'policy-version'
  | 'budget'
  | 'approvals'
  | 'exceptions'
  | 'records';

/** Deferred step names in canonical pipeline order (Req 5, io-ports). */
export const DEFERRED_STEPS: readonly DeferredStep[] = [
  'delegation',
  'policy-version',
  'budget',
  'approvals',
  'exceptions',
  'records',
];

/** One recorded pipeline step (enforced gate or deferred pass-through). */
export interface StepResult {
  readonly id: number;
  readonly name: string;
  readonly deferred: boolean;
  readonly passThrough?: boolean;
  readonly decision: Decision;
  readonly reason: string;
}

/** Input to an evaluation. Pure data; no ambient authority survives the call. */
export interface EvaluationInput {
  readonly principal: PrincipalIdentity;
  readonly action: KernelAction;
  readonly grants: readonly Grant[];
  readonly sodAssignments: readonly SodAssignment[];
  readonly thresholds: RiskThresholds;
  readonly now: number;
  readonly priorAuditLog?: readonly AuditEntry[];
  readonly policy?: SodPolicy;
  readonly receiptId?: string;
  /**
   * OPTIONAL evidence repository port (Req 5, D1). When absent the evaluation is
   * byte-identical to the persistence-free kernel. When present, `finalize()`
   * routes a durable-capable record through the port (D5).
   */
  readonly evidenceRepository?: EvidenceRepository;
  /**
   * OPTIONAL audit repository port (Req 5, D1). When absent the evaluation is
   * byte-identical to the persistence-free kernel. When present, `finalize()`
   * routes a durable-capable entry through the port (D5).
   */
  readonly auditRepository?: AuditRepository;
}

/** Outcome of an evaluation: decision, risk, evidence, audit log, receipt, steps. */
export interface EvaluationResult {
  readonly decision: Decision;
  readonly reason: string;
  readonly risk: RiskClass;
  readonly evidence: Evidence;
  readonly auditLog: readonly AuditEntry[];
  readonly receipt?: UnsignedInMemoryReceipt;
  readonly steps: readonly StepResult[];
  /**
   * OPTIONAL durable-capable view of the routed records (Req 5, D5). Absent when
   * no repository is injected (byte-identical default path). When present, the
   * captured in-memory `evidence`/`auditLog` are KEPT (persistent:false) and
   * `persistence` carries the routed {@link PersistentRecord}s (persistent:true).
   */
  readonly persistence?: PersistenceOutcome;
}

interface PipelineContext {
  risk: RiskClass;
  grant: Grant | null;
}

type GateResult = { readonly decision: Decision; readonly reason: string };

/**
 * Evaluate an action through the fixed 16-step pipeline. Enforced gates run in
 * canonical order and DENY terminally on the first failure; deferred steps
 * pass through as documented no-ops. Returns the terminal decision with one
 * captured evidence record, one appended disclosed audit entry, the recorded
 * steps, and (on ALLOW only) an unsigned non-persistent receipt.
 */
export function evaluate(input: EvaluationInput): EvaluationResult {
  const steps: StepResult[] = [];
  const ctx: PipelineContext = { risk: 'low', grant: null };

  // Step 1 — classify risk BEFORE authority (Req 3).
  const classification = classifyGate(input, ctx);
  if (!gate(steps, 1, 'classification', classification)) {
    return finalize(input, steps, ctx, 'DENY', classification.reason);
  }
  // Step 2 — delegation (deferred).
  passThrough(steps, 2, 'delegation');
  // Step 3 — explicit grant existence (Req 4).
  const authority = authorityGate(input, ctx);
  if (!gate(steps, 3, 'authority', authority)) {
    return finalize(input, steps, ctx, 'DENY', authority.reason);
  }
  // Step 4 — policy-version (deferred).
  passThrough(steps, 4, 'policy-version');
  // Step 5 — principal identity.
  const identity = identityGate(input);
  if (!gate(steps, 5, 'identity', identity)) {
    return finalize(input, steps, ctx, 'DENY', identity.reason);
  }
  // Step 6 — well-formed grant assignment.
  const assignment = assignmentGate(ctx);
  if (!gate(steps, 6, 'assignment', assignment)) {
    return finalize(input, steps, ctx, 'DENY', assignment.reason);
  }
  // Step 7 — bounded scope (Req 2, Req 4).
  const boundedScope = boundedScopeGate(ctx);
  if (!gate(steps, 7, 'bounded-scope', boundedScope)) {
    return finalize(input, steps, ctx, 'DENY', boundedScope.reason);
  }
  // Step 8 — budget (deferred).
  passThrough(steps, 8, 'budget');
  // Step 9 — evidence collection (always proceeds; captured at finalize).
  gate(steps, 9, 'evidence', { decision: 'ALLOW', reason: 'evidence collection ready' });
  // Step 10 — separation of duties (Req 6).
  const sod = sodGate(input, ctx);
  if (!gate(steps, 10, 'sod', sod)) {
    return finalize(input, steps, ctx, 'DENY', sod.reason);
  }
  // Step 11 — approvals (deferred).
  passThrough(steps, 11, 'approvals');
  // Step 12 — expiry/revocation.
  const expiry = expiryGate(input, ctx);
  if (!gate(steps, 12, 'expiry', expiry)) {
    return finalize(input, steps, ctx, 'DENY', expiry.reason);
  }
  // Step 13 — exceptions (deferred).
  passThrough(steps, 13, 'exceptions');
  // Step 14 — action scope (command binding).
  const actionScope = actionScopeGate(input, ctx);
  if (!gate(steps, 14, 'action-scope', actionScope)) {
    return finalize(input, steps, ctx, 'DENY', actionScope.reason);
  }
  // Step 15 — records (deferred).
  passThrough(steps, 15, 'records');
  // Step 16 — final: every enforced gate passed.
  record(steps, 16, 'final', false, 'ALLOW', 'evaluation allowed');

  return finalize(input, steps, ctx, 'ALLOW', 'all enforced gates passed');
}

/** Record an enforced gate. Returns true when it passed (ALLOW), false on DENY. */
function gate(steps: StepResult[], id: number, name: string, result: GateResult): boolean {
  record(steps, id, name, false, result.decision, result.reason);
  return result.decision === 'ALLOW';
}

/** Push a documented no-op pass-through deferred step (never gates). */
function passThrough(steps: StepResult[], id: number, name: DeferredStep): void {
  steps.push({
    id,
    name,
    deferred: true,
    passThrough: true,
    decision: 'ALLOW',
    reason: `${name} deferred: harden downstream; no-op pass-through`,
  });
}

function record(
  steps: StepResult[],
  id: number,
  name: string,
  deferred: boolean,
  decision: Decision,
  reason: string,
): void {
  steps.push({ id, name, deferred, decision, reason });
}

/** Step 1 — classify the risk BEFORE authority (Req 3). The action must be
 * identifiable; the produced risk class drives downstream SOD. */
function classifyGate(input: EvaluationInput, ctx: PipelineContext): GateResult {
  if (!input.action.actionId) {
    return { decision: 'DENY', reason: 'classification requires an identifiable action' };
  }
  ctx.risk = classify(input.action, input.thresholds);
  return { decision: 'ALLOW', reason: `classified as ${ctx.risk}` };
}

/** Step 3 — an explicit grant for the principal must exist (Req 4). */
function authorityGate(input: EvaluationInput, ctx: PipelineContext): GateResult {
  const grant =
    input.grants.find(
      (entry) =>
        entry.principalId === input.principal.principalId && entry.command === input.action.command,
    ) ?? input.grants.find((entry) => entry.principalId === input.principal.principalId);
  if (grant === undefined) {
    return { decision: 'DENY', reason: 'no explicit grant exists for the principal' };
  }
  ctx.grant = grant;
  return { decision: 'ALLOW', reason: 'explicit grant exists for the principal' };
}

/** Step 5 — the principal must declare a principal id and primary role. */
function identityGate(input: EvaluationInput): GateResult {
  if (!input.principal.principalId || !input.principal.primaryRole) {
    return { decision: 'DENY', reason: 'identity must declare a principal and primary role' };
  }
  return { decision: 'ALLOW', reason: 'principal identity resolved' };
}

/** Step 6 — the matched grant must be a well-formed assignment record. */
function assignmentGate(ctx: PipelineContext): GateResult {
  const grant = ctx.grant;
  if (grant === null || !grant.grantId || !grant.command || !grant.authority) {
    return { decision: 'DENY', reason: 'grant is not a well-formed assignment' };
  }
  return { decision: 'ALLOW', reason: 'grant assignment well-formed' };
}

/** Step 7 — the matched grant must carry a bounded window (Req 2, Req 4). */
function boundedScopeGate(ctx: PipelineContext): GateResult {
  if (ctx.grant === null) {
    return { decision: 'DENY', reason: 'no grant matched to bound' };
  }
  const window = validateBoundedWindow(ctx.grant);
  return window.valid
    ? { decision: 'ALLOW', reason: 'bounded scope valid' }
    : { decision: 'DENY', reason: window.reason };
}

/** Step 10 — separation of duties enforced per risk tier (Req 6). */
function sodGate(input: EvaluationInput, ctx: PipelineContext): GateResult {
  return checkSod({ risk: ctx.risk, assignments: input.sodAssignments, policy: input.policy });
}

/** Step 12 — the matched grant must be active (not expired or revoked). */
function expiryGate(input: EvaluationInput, ctx: PipelineContext): GateResult {
  const grant = ctx.grant;
  if (grant === null || grant.revoked === true || grant.expiry <= input.now) {
    return { decision: 'DENY', reason: 'grant expired or revoked' };
  }
  return { decision: 'ALLOW', reason: 'grant active' };
}

/** Step 14 — the action command must be within the granted command scope. */
function actionScopeGate(input: EvaluationInput, ctx: PipelineContext): GateResult {
  const grant = ctx.grant;
  if (grant === null || grant.command !== input.action.command) {
    return { decision: 'DENY', reason: 'action command out of granted scope' };
  }
  return { decision: 'ALLOW', reason: 'action command within granted scope' };
}

/**
 * Capture one evidence record + one disclosed audit entry for the terminal
 * decision and issue a receipt only on ALLOW (Req 7, Req 8). Pure: returns a
 * new immutable audit list; the prior log is never mutated. When OPTIONAL
 * repository ports are injected, routes a durable-capable record through them
 * (Req 5, D1/D5); the no-repo path is byte-identical to the persistence-free
 * kernel.
 */
function finalize(
  input: EvaluationInput,
  steps: StepResult[],
  ctx: PipelineContext,
  decision: Decision,
  reason: string,
): EvaluationResult {
  const evidenceInput: EvidenceInput = {
    actionId: input.action.actionId,
    principalId: input.principal.principalId,
    riskClass: ctx.risk,
    decision,
    reason,
    now: input.now,
  };
  const { evidence, auditLog } = captureEvidence(evidenceInput, input.priorAuditLog ?? []);
  const receipt = issueReceipt({
    actionId: input.action.actionId,
    authority: ctx.grant?.authority ?? null,
    riskClass: ctx.risk,
    terminalState: decision,
    evidence,
    receiptId: input.receiptId,
    now: input.now,
  });

  const base: EvaluationResult = {
    decision,
    reason,
    risk: ctx.risk,
    evidence,
    auditLog,
    receipt: receipt ?? undefined,
    steps,
  };

  // OPTIONAL repository routing (Req 5, D1/D5). When no repo is injected the
  // result carries NO persistence field (byte-identical default path). When a
  // repo IS present, the captured in-memory records stay and a durable-capable
  // PersistentRecord is routed through the port(s).
  const persistence = routeThroughPorts(input, evidenceInput);
  return persistence === undefined ? base : { ...base, persistence };
}

/**
 * Build a durable-capable {@link PersistentRecord} mirroring the captured
 * in-memory evidence (D8 field order), diverging ONLY on the `persistent: true`
 * literal and the port-contract disclosure (D6 path marker). Pure.
 */
function buildPersistentRecord(input: EvidenceInput): PersistentRecord {
  return {
    actionId: input.actionId,
    principalId: input.principalId,
    riskClass: input.riskClass,
    decision: input.decision,
    reason: input.reason,
    timestamp: input.now,
    persistent: true,
    disclosure: PERSISTENT_PORT_DISCLOSURE,
  };
}

/**
 * Route the evaluation's records through the OPTIONAL repository ports (Req 5,
 * D1/D5). Returns `undefined` when no repository is injected so the default path
 * is byte-identical. When a repository IS present, builds one durable-capable
 * record and saves it via the evidence port and/or appends it via the audit
 * port. The captured in-memory records in `evidence`/`auditLog` are NEVER
 * replaced; `persistence` carries the routed durable view (D5). Routing never
 * touches the caller's prior audit log.
 */
function routeThroughPorts(
  input: EvaluationInput,
  evidenceInput: EvidenceInput,
): PersistenceOutcome | undefined {
  const { evidenceRepository, auditRepository } = input;
  if (evidenceRepository === undefined && auditRepository === undefined) {
    return undefined;
  }
  const record = buildPersistentRecord(evidenceInput);
  if (evidenceRepository !== undefined) {
    evidenceRepository.save(record);
  }
  if (auditRepository !== undefined) {
    auditRepository.append(record);
  }
  return {
    evidenceRecord: evidenceRepository !== undefined ? record : undefined,
    auditRecord: auditRepository !== undefined ? record : undefined,
  };
}

// Re-export the shared disclosure so consumers read the honesty contract from
// the public pipeline surface alongside evidence/receipt.
export { NON_PERSISTENT_DISCLOSURE };
