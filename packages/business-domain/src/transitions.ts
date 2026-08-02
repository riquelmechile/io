import type { Delegation, DelegationState, WorkState } from './types.js';

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

/**
 * Extensible set of Work states that count as "actionable" for dispatch
 * (work-lifecycle delta): a Work is actionable iff its `state` is declared
 * here. Declared as a constant so the set stays extensible without touching
 * the filter — mirrors the `MATERIAL_EVENT_TYPES`/`isMaterialEvent` precedent
 * in heartbeat.ts.
 */
export const ACTIONABLE_WORK_STATES: readonly ['accepted'] = ['accepted'];

export function canTransitionDelegation(from: DelegationState, to: DelegationState): boolean {
  return DELEGATION_TRANSITIONS[from].includes(to);
}

/**
 * Temporal activity of a delegation (ADR-0002): active ONLY inside its window
 * `validFrom <= now < validUntil`. A future `validFrom` (validFrom > now) is NOT
 * active and confers no authority; a delegation past `validUntil` (now >=
 * validUntil) is NOT active. This is the SAME window rule the trust kernel
 * applies (`isWindowActive(start, now, expiry)`); business-domain implements it
 * locally because the package stays `@io/*`-free (no cross-aggregate import).
 */
export function isDelegationActive(delegation: Delegation, now: number): boolean {
  return delegation.validFrom <= now && now < delegation.validUntil;
}

export function canTransitionWork(from: WorkState, to: WorkState): boolean {
  return WORK_TRANSITIONS[from].includes(to);
}
