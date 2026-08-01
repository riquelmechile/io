import { checkGrant } from '@io/trust-kernel/src/index.js';
import type { Grant } from '@io/trust-kernel/src/index.js';
import { checkSod } from '@io/trust-kernel/src/index.js';
import { isWindowActive } from '@io/trust-kernel/src/index.js';
import type { KernelAction } from '@io/trust-kernel/src/index.js';
import type { SodAssignment } from '@io/trust-kernel/src/index.js';
import type { DelegationRepository } from '@io/business-domain/src/ports/repositories.js';
import type { Delegation } from '@io/business-domain/src/types.js';

import type { WorkerPrincipals } from './types.js';

/**
 * Authority at action time (WC authority; ADR-0002 "deny-at-action"): before
 * ANY effect the worker re-verifies the delegation — it exists (tenant-scoped),
 * its window is active (`isWindowActive`), it is NOT revoked, the executor
 * holds an active command-bound grant (`checkGrant`, deny-by-default), and the
 * SoD ABSOLUTE_PAIRS hold via the EXPORTED `checkSod` (verifier≠executor AND
 * proposer≠approver at every tier, including low risk). A revoked, expired, or
 * out-of-window grant DENIES at action time and no effect runs. `ABSOLUTE_PAIRS`
 * is module-private in trust-kernel — NEVER referenced directly here.
 */

/** The command a worker cycle executes (the grant is bound to it). */
export const WORK_EXECUTE_COMMAND = 'work.execute';

export type AuthorityDecision =
  | { ok: true; delegation: Delegation }
  | { ok: false; reason: string };

export interface AuthorityContext {
  readonly companyId: string;
  readonly delegationId: string;
  readonly principals: WorkerPrincipals;
  /** The action-time clock (injected for deterministic tests). */
  readonly now: number;
}

export async function checkAuthority(
  ctx: AuthorityContext,
  deps: { delegation: DelegationRepository },
): Promise<AuthorityDecision> {
  const delegation = await deps.delegation.get(ctx.companyId, ctx.delegationId);
  if (delegation === undefined) {
    return { ok: false, reason: 'delegation-not-found' };
  }
  if (delegation.state === 'revoked') {
    return { ok: false, reason: 'revoked' };
  }
  if (!isWindowActive(delegation.validFrom, ctx.now, delegation.validUntil)) {
    return { ok: false, reason: 'delegation-window-inactive' };
  }

  // Grant check (deny-by-default): the delegation is the executor's authority
  // grant — active, unrevoked, window-active, bound to the work.execute command.
  const action: KernelAction = {
    actionId: `execute:${ctx.delegationId}`,
    command: WORK_EXECUTE_COMMAND,
  };
  const grant: Grant = {
    grantId: delegation.delegationId,
    principalId: delegation.delegate,
    command: WORK_EXECUTE_COMMAND,
    authority: delegation.authorityScope.scope,
    scope: delegation.authorityScope.scope,
    start: delegation.validFrom,
    expiry: delegation.validUntil,
    // The early revocation check above already returned for a revoked
    // delegation, so the grant reaching checkGrant is never revoked.
    revoked: false,
  };
  const grantDecision = checkGrant(action, ctx.principals.executor, [grant], ctx.now);
  if (grantDecision.decision === 'DENY') {
    return { ok: false, reason: `grant-denied: ${grantDecision.reason}` };
  }

  // SoD via the EXPORTED checkSod: verifier≠executor, proposer≠approver.
  const assignments: readonly SodAssignment[] = [
    { role: 'proposer', principalId: ctx.principals.proposer },
    { role: 'approver', principalId: ctx.principals.approver },
    { role: 'executor', principalId: ctx.principals.executor },
    { role: 'verifier', principalId: ctx.principals.verifier },
  ];
  const sod = checkSod({ risk: 'low', assignments });
  if (sod.decision === 'DENY') {
    return { ok: false, reason: `sod-denied: ${sod.reason}` };
  }

  // D5 additive success: surface the delegation this cycle ALREADY fetched so
  // prepareIntent reuses it for context compilation — no second repository read.
  return { ok: true, delegation };
}
