import type { Authority, PrincipalId, Role, TemporaryAssignment } from './model.js';
import { isWindowActive, validateBoundedWindow } from './model.js';

/** Outcome of structurally validating a temporary assignment. */
export interface AssignmentValidation {
  readonly valid: boolean;
  readonly reason: string;
}

/** A principal's identity: exactly one primary role plus zero or more temp roles. */
export interface PrincipalIdentity {
  readonly principalId: PrincipalId;
  readonly primaryRole: Role;
  readonly temporaryAssignments: readonly TemporaryAssignment[];
}

/**
 * The currently-effective identity after expiry/revocation. The primary role is
 * unchanged. `authority` is ALWAYS empty here: holding any role grants NO
 * ambient authority (Req 2); explicit command-bound grants are evaluated later.
 */
export interface ActiveIdentity {
  readonly principalId: PrincipalId;
  readonly primaryRole: Role;
  readonly activeRoles: readonly Role[];
  readonly activeAssignments: readonly TemporaryAssignment[];
  readonly authority: readonly Authority[];
}

/**
 * Validate a temporary assignment is well-formed: it MUST declare an assignment
 * ID plus a bounded window (scope, start, non-indefinite expiry after start).
 * Indefinite expiry is INVALID and grants no authority. Revoked assignments may
 * still be structurally valid — revocation strips authority, not validity. The
 * window checks are shared via {@link validateBoundedWindow}. [ADR-0001]
 */
export function validateTemporaryAssignment(assignment: TemporaryAssignment): AssignmentValidation {
  if (!assignment.assignmentId) {
    return { valid: false, reason: 'temporary assignment must declare an assignment id' };
  }
  const window = validateBoundedWindow(assignment);
  return window.valid ? { valid: true, reason: 'ok' } : window;
}

/**
 * Resolve the currently-effective identity at `now`: keep the unchanged primary
 * role and only the temp assignments that are valid, not revoked, and not
 * expired. Expired/revoked/invalid assignments add no authority. Validation is
 * shared via {@link validateTemporaryAssignment} (single path).
 */
export function resolveActiveIdentity(identity: PrincipalIdentity, now: number): ActiveIdentity {
  const activeAssignments = identity.temporaryAssignments.filter((assignment) => {
    if (!validateTemporaryAssignment(assignment).valid) return false;
    if (assignment.revoked === true) return false;
    // Valid assignments always declare start and expiry (validateBoundedWindow);
    // the window gate makes a future start confer no authority (ADR-0001).
    if (assignment.start === undefined || assignment.expiry === undefined) return false;
    return isWindowActive(assignment.start, now, assignment.expiry);
  });

  return {
    principalId: identity.principalId,
    primaryRole: identity.primaryRole,
    activeRoles: [identity.primaryRole, ...activeAssignments.map((assignment) => assignment.role)],
    activeAssignments,
    authority: [],
  };
}
