import { isWindowActive, validateBoundedWindow } from './model.js';
import type {
  Authority,
  CommandId,
  Decision,
  KernelAction,
  PrincipalId,
  Scope,
  ValidationOutcome,
} from './model.js';

/**
 * An explicit, bounded, command-bound authority grant (Req 4). Holding any
 * role grants NO ambient authority; every action is DENIED unless a current,
 * valid, command-matching bounded grant exists. Grants are re-evaluated per
 * input — no grant is "remembered" as authority across actions.
 */
export interface Grant {
  readonly grantId: string;
  readonly principalId: PrincipalId;
  readonly command: CommandId;
  readonly authority: Authority;
  readonly scope: Scope;
  readonly start: number;
  readonly expiry: number;
  readonly revoked?: boolean;
}

/** Outcome of structurally validating a grant. */
export type GrantValidation = ValidationOutcome;

/** Outcome of an authority check. A DENY yields no authority. */
export interface GrantDecision {
  readonly decision: Decision;
  readonly authority: Authority | null;
  readonly reason: string;
}

/** Validate a grant is well-formed: id, command, authority, and a bounded
 * window (scope/start/expiry-after-start). Unbounded grants are INVALID and
 * grant no authority; revoked grants may still be valid. Window checks are
 * shared via {@link validateBoundedWindow}. [ADR-0001] */
export function validateGrant(grant: Grant): GrantValidation {
  if (!grant.grantId) return { valid: false, reason: 'grant must declare a grant id' };
  if (!grant.command) return { valid: false, reason: 'grant must declare a command' };
  if (!grant.authority) return { valid: false, reason: 'grant must declare an authority' };
  const window = validateBoundedWindow(grant);
  return window.valid ? { valid: true, reason: 'ok' } : window;
}

/** Deny-by-default authority check: ALLOW only when a valid, non-revoked,
 * command-matching bounded grant for `principalId` is active at `now`. Returns
 * the matched grant's authority; everything else DENIES with no authority.
 * Re-evaluated per input from the supplied grants list. */
export function checkGrant(
  action: KernelAction,
  principalId: PrincipalId,
  grants: readonly Grant[],
  now: number,
): GrantDecision {
  for (const grant of grants) {
    if (
      isGrantActive(grant, now) &&
      grant.principalId === principalId &&
      grant.command === action.command
    ) {
      return { decision: 'ALLOW', authority: grant.authority, reason: 'explicit grant matched' };
    }
  }
  return { decision: 'DENY', authority: null, reason: 'no current bounded command grant' };
}

/** A grant is active when structurally valid, not revoked, and within its window. */
function isGrantActive(grant: Grant, now: number): boolean {
  return (
    validateGrant(grant).valid &&
    grant.revoked !== true &&
    isWindowActive(grant.start, now, grant.expiry)
  );
}
