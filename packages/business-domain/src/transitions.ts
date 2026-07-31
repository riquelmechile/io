import type { DelegationState, WorkState } from './types.js';

/**
 * Transition tables + pure guard functions for Delegation and Work state
 * machines (ADR-0002). Each table maps a state to the set of states it may
 * transition to; `canTransition*` returns `true` only when the target is in
 * that set. Terminal states (empty arrays) reject all transitions. Pure
 * functions, zero deps — matches the kernel's `validateBoundedWindow` pattern.
 */

// Delegation: draft → active → revoked | expired
const DELEGATION_TRANSITIONS: Readonly<Record<DelegationState, readonly DelegationState[]>> = {
  draft: ['active'],
  active: ['revoked', 'expired'],
  revoked: [],
  expired: [],
};

// Work: proposed → accepted → in_progress → completed → verified | rejected
const WORK_TRANSITIONS: Readonly<Record<WorkState, readonly WorkState[]>> = {
  proposed: ['accepted', 'rejected'],
  accepted: ['in_progress'],
  in_progress: ['completed'],
  completed: ['verified', 'rejected'],
  verified: [],
  rejected: [],
};

export function canTransitionDelegation(from: DelegationState, to: DelegationState): boolean {
  return DELEGATION_TRANSITIONS[from].includes(to);
}

export function canTransitionWork(from: WorkState, to: WorkState): boolean {
  return WORK_TRANSITIONS[from].includes(to);
}
