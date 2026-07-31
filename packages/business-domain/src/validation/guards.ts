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

export function assertValidDelegationRow(row: unknown): Delegation {
  if (row === null || typeof row !== 'object') {
    throw new ValidationError('delegation row must be an object');
  }
  const r = row as Record<string, unknown>;
  assertNonEmptyString(r.delegationId, 'delegationId');
  assertNonEmptyString(r.companyId, 'companyId');
  assertNonEmptyString(r.delegator, 'delegator');
  assertNonEmptyString(r.delegate, 'delegate');
  return row as Delegation;
}

export function assertValidReceiptRow(row: unknown): BusinessReceipt {
  if (row === null || typeof row !== 'object') {
    throw new ValidationError('receipt row must be an object');
  }
  const r = row as Record<string, unknown>;
  assertNonEmptyString(r.receiptId, 'receiptId');
  assertNonEmptyString(r.companyId, 'companyId');
  assertNonEmptyString(r.terminalEventId, 'terminalEventId');
  assertNonEmptyString(r.policyHash, 'policyHash');
  assertNonEmptyString(r.artifactHash, 'artifactHash');
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
