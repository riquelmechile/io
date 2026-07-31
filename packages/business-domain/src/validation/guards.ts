import { canTransitionDelegation, canTransitionWork } from '../transitions.js';
import type { BusinessReceipt, Delegation, DelegationState, Work, WorkState } from '../types.js';
import { ValidationError } from './errors.js';

export interface TransitionCommand {
  readonly companyId: string;
  readonly workId: string;
  readonly delegationId: string;
  readonly principalId: string;
  readonly action: string;
}

export interface LlmPlan {
  readonly description: string;
  readonly actions: readonly string[];
  readonly deliverable?: string;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`invalid or missing field: ${field}`);
  }
}

export function assertValidCommand(command: unknown): asserts command is TransitionCommand {
  if (command === null || typeof command !== 'object') {
    throw new ValidationError('command must be an object');
  }
  const c = command as Record<string, unknown>;
  assertNonEmptyString(c.companyId, 'companyId');
  assertNonEmptyString(c.workId, 'workId');
  assertNonEmptyString(c.delegationId, 'delegationId');
  assertNonEmptyString(c.principalId, 'principalId');
  assertNonEmptyString(c.action, 'action');
}

const WORK_STATES: readonly WorkState[] = [
  'proposed',
  'accepted',
  'in_progress',
  'completed',
  'verified',
  'rejected',
];

export function assertValidWorkRow(row: unknown): Work {
  if (row === null || typeof row !== 'object') {
    throw new ValidationError('work row must be an object');
  }
  const r = row as Record<string, unknown>;
  assertNonEmptyString(r.workId, 'workId');
  assertNonEmptyString(r.companyId, 'companyId');
  assertNonEmptyString(r.delegationId, 'delegationId');
  assertNonEmptyString(r.proposer, 'proposer');
  assertNonEmptyString(r.description, 'description');
  if (typeof r.state !== 'string' || !WORK_STATES.includes(r.state as WorkState)) {
    throw new ValidationError('invalid or missing field: state');
  }
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 0) {
    throw new ValidationError('invalid or missing field: version');
  }
  if (!Array.isArray(r.evidenceRefs)) {
    throw new ValidationError('invalid or missing field: evidenceRefs');
  }
  return row as Work;
}

const DELEGATION_STATES: readonly DelegationState[] = ['draft', 'active', 'revoked', 'expired'];

/**
 * Single source of truth for delegation window semantics — mirrors trust-kernel
 * `isWindowActive(start, now, expiry)`: active iff start <= now AND expiry > now.
 */
export function isDelegationWindowActive(
  validFrom: number,
  now: number,
  validUntil: number,
): boolean {
  return validFrom <= now && validUntil > now;
}

/** A Delegation is active only when state is `active` AND within [validFrom, validUntil). */
export function isDelegationActive(delegation: Delegation, now: number): boolean {
  return (
    delegation.state === 'active' &&
    isDelegationWindowActive(delegation.validFrom, now, delegation.validUntil)
  );
}

export function assertValidDelegationRow(row: unknown): Delegation {
  if (row === null || typeof row !== 'object') {
    throw new ValidationError('delegation row must be an object');
  }
  const r = row as Record<string, unknown>;
  assertNonEmptyString(r.delegationId, 'delegationId');
  assertNonEmptyString(r.companyId, 'companyId');
  assertNonEmptyString(r.delegator, 'delegator');
  assertNonEmptyString(r.delegate, 'delegate');
  assertNonEmptyString(r.expectedOutcome, 'expectedOutcome');
  if (typeof r.state !== 'string' || !DELEGATION_STATES.includes(r.state as DelegationState)) {
    throw new ValidationError('invalid or missing field: state');
  }
  if (typeof r.validFrom !== 'number' || !Number.isFinite(r.validFrom)) {
    throw new ValidationError('invalid or missing field: validFrom');
  }
  if (typeof r.validUntil !== 'number' || !Number.isFinite(r.validUntil)) {
    throw new ValidationError('invalid or missing field: validUntil');
  }
  if (r.validUntil <= r.validFrom) {
    throw new ValidationError('invalid window: validUntil must be after validFrom');
  }
  const scope = r.authorityScope;
  if (scope === null || typeof scope !== 'object') {
    throw new ValidationError('invalid or missing field: authorityScope');
  }
  const s = scope as Record<string, unknown>;
  assertNonEmptyString(s.scope, 'authorityScope.scope');
  if (!Array.isArray(s.actions) || s.actions.length === 0) {
    throw new ValidationError('invalid or missing field: authorityScope.actions');
  }
  const budget = r.budget;
  if (budget === null || typeof budget !== 'object') {
    throw new ValidationError('invalid or missing field: budget');
  }
  const b = budget as Record<string, unknown>;
  assertNonEmptyString(b.currency, 'budget.currency');
  if (typeof b.limit !== 'number' || !Number.isFinite(b.limit)) {
    throw new ValidationError('invalid or missing field: budget.limit');
  }
  return row as Delegation;
}

export function assertValidReceiptRow(row: unknown): BusinessReceipt {
  if (row === null || typeof row !== 'object') {
    throw new ValidationError('receipt row must be an object');
  }
  const r = row as Record<string, unknown>;
  assertNonEmptyString(r.receiptId, 'receiptId');
  assertNonEmptyString(r.workId, 'workId');
  assertNonEmptyString(r.delegationId, 'delegationId');
  assertNonEmptyString(r.companyId, 'companyId');
  assertNonEmptyString(r.actor, 'actor');
  assertNonEmptyString(r.terminalEventId, 'terminalEventId');
  assertNonEmptyString(r.terminalState, 'terminalState');
  assertNonEmptyString(r.policyHash, 'policyHash');
  assertNonEmptyString(r.artifactHash, 'artifactHash');
  if (typeof r.issuedAt !== 'number' || !Number.isFinite(r.issuedAt)) {
    throw new ValidationError('invalid or missing field: issuedAt');
  }
  if (!Array.isArray(r.evidenceRefs)) {
    throw new ValidationError('invalid or missing field: evidenceRefs');
  }
  return row as BusinessReceipt;
}

export function assertValidWorkTransition(from: WorkState, to: WorkState): void {
  if (!canTransitionWork(from, to)) {
    throw new ValidationError(`illegal work transition: ${from} -> ${to}`);
  }
}

export function assertValidDelegationTransition(from: DelegationState, to: DelegationState): void {
  if (!canTransitionDelegation(from, to)) {
    throw new ValidationError(`illegal delegation transition: ${from} -> ${to}`);
  }
}

export function assertValidLlmPlan(plan: unknown): asserts plan is LlmPlan {
  if (plan === null || typeof plan !== 'object') {
    throw new ValidationError('llm plan must be an object');
  }
  const p = plan as Record<string, unknown>;
  assertNonEmptyString(p.description, 'description');
  if (!Array.isArray(p.actions) || p.actions.length === 0) {
    throw new ValidationError('invalid or missing field: actions');
  }
  for (const action of p.actions) {
    if (typeof action !== 'string' || action.length === 0) {
      throw new ValidationError('invalid or missing field: actions');
    }
  }
}
