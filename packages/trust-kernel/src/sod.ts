import type { Decision, PrincipalId, RiskClass } from './model.js';

/** SOD roles. Medium requires the four core roles distinct; high/critical add a
 * distinct authorizer (five-way). [ADR-0003] */
export type SodRole = 'proposer' | 'approver' | 'executor' | 'verifier' | 'authorizer';

/** A principal assigned to a SOD role for one action. */
export interface SodAssignment {
  readonly role: SodRole;
  readonly principalId: PrincipalId;
}

/** Low-risk role combination is the only policy-controlled relaxation. */
export interface SodPolicy {
  readonly allowsLowCombination?: boolean;
}

/** Input to a separation-of-duties check. */
export interface SodInput {
  readonly risk: RiskClass;
  readonly assignments: readonly SodAssignment[];
  readonly policy?: SodPolicy;
}

/** Outcome of a separation-of-duties check. */
export interface SodDecision {
  readonly decision: Decision;
  readonly reason: string;
}

// Tier role-count rules — single source of truth (Req 6).
const CORE_ROLES: readonly SodRole[] = ['proposer', 'approver', 'executor', 'verifier'];
const CRITICAL_ROLES: readonly SodRole[] = [...CORE_ROLES, 'authorizer'];
// Absolute independence at EVERY tier: no self-approval, no self-verification.
const ABSOLUTE_PAIRS: ReadonlyArray<readonly [SodRole, SodRole]> = [
  ['approver', 'executor'],
  ['verifier', 'executor'],
];

/** Roles that MUST be mutually distinct for the tier, or null when the tier
 * permits combination (low + policy). */
function requiredDistinctRoles(
  risk: RiskClass,
  policy: SodPolicy | undefined,
): readonly SodRole[] | null {
  switch (risk) {
    case 'high':
    case 'critical':
      return CRITICAL_ROLES;
    case 'medium':
      return CORE_ROLES;
    case 'low':
      return policy?.allowsLowCombination === true ? null : CORE_ROLES;
    default:
      return CORE_ROLES;
  }
}

/**
 * Enforce separation of duties per risk tier (Req 6). The absolute
 * no-self-approval/no-self-verification pairs are checked first at every tier;
 * tier distinctness (medium four-way, high/critical five-way, low four-way
 * unless policy permits combination) is then enforced. Any prohibited overlap
 * or missing required role produces a terminal DENY.
 */
export function checkSod(input: SodInput): SodDecision {
  const byRole = new Map<SodRole, Set<PrincipalId>>();
  for (const { role, principalId } of input.assignments) {
    const set = byRole.get(role) ?? new Set<PrincipalId>();
    set.add(principalId);
    byRole.set(role, set);
  }
  const share = (a: SodRole, b: SodRole): boolean => {
    const pa = byRole.get(a);
    const pb = byRole.get(b);
    return pa !== undefined && pb !== undefined && [...pa].some((id) => pb.has(id));
  };

  for (const [a, b] of ABSOLUTE_PAIRS) {
    if (share(a, b)) {
      return {
        decision: 'DENY',
        reason: `separation of duties violated: ${a}/${b} share a principal (no self-approval/self-verification)`,
      };
    }
  }

  const required = requiredDistinctRoles(input.risk, input.policy);
  if (required !== null) {
    for (const role of required) {
      if ((byRole.get(role)?.size ?? 0) === 0) {
        return {
          decision: 'DENY',
          reason: `separation of duties violated: missing required role ${role} for ${input.risk} risk`,
        };
      }
    }
    for (let i = 0; i < required.length; i += 1) {
      const a = required[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < required.length; j += 1) {
        const b = required[j];
        if (b !== undefined && share(a, b)) {
          return {
            decision: 'DENY',
            reason: `separation of duties violated: ${required.length}-way distinctness failed for ${input.risk} risk`,
          };
        }
      }
    }
  }

  return { decision: 'ALLOW', reason: 'separation of duties satisfied' };
}
