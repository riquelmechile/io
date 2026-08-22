import {
  promotionScopeFor,
  type AuthorityTransitionProof,
  type DelegationRepository,
  type LearningSubject,
  type PolicyRef,
  type PromotionAuthorityRepository,
  type Work,
  type WorkRepository,
} from '@io/business-domain/src/index.js';
import { checkSod } from '@io/trust-kernel/src/index.js';
import type { SodAssignment } from '@io/trust-kernel/src/index.js';
import type { DbConnection } from '@io/database/src/connection.js';

import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';
import type { WorkerPrincipals } from './types.js';

/**
 * The verify step (design "Verify"; WC reconciliation post-effect + SP
 * no-leak failed-verification): a DISTINCT verifier principal confirms the
 * effect outcome BEFORE the terminal close. Two checks:
 *
 *   1. SoD — via the EXPORTED `checkSod` (ABSOLUTE_PAIRS is module-private):
 *      the verifier MUST differ from the executor at EVERY tier, including low
 *      risk. A collapsed pair is a verification failure.
 *   2. Outcome — the sandbox undo log is the source of truth for whether the
 *      effect ran (§9.8): an effect whose record says it never ran cannot be
 *      verified, and an effect the undo log does NOT confirm is a verification
 *      failure (no silent pass).
 *
 * A failed verification is a POST-EFFECT failure: the cycle reconciles it
 * exactly like the finalize CAS-loss path via the shared
 * `reconcilePostEffectFailure` (design "Other post-effect failures … same as
 * CAS-loss (i)") — in_progress+applied → undo + markRetryable;
 * in_progress+no effect → clean replay (no undo); already terminal → typed
 * UNRESOLVED_REQUIRES_HUMAN. This module NEVER throws for control flow.
 */

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'verification-failed'; detail: string };

export interface VerifyDeps {
  readonly sandbox: SandboxPort;
  readonly principals: WorkerPrincipals;
}

export interface VerifyContext {
  /** The effect the cycle just executed (its undo handle names the log entry). */
  readonly effect: EffectRecord;
}

export async function verifyEffect(deps: VerifyDeps, ctx: VerifyContext): Promise<VerifyResult> {
  // SoD at the verify step (ABSOLUTE_PAIRS via the EXPORTED checkSod): the
  // verifier MUST be a distinct principal from the executor at every tier.
  const assignments: readonly SodAssignment[] = [
    { role: 'proposer', principalId: deps.principals.proposer },
    { role: 'approver', principalId: deps.principals.approver },
    { role: 'executor', principalId: deps.principals.executor },
    { role: 'verifier', principalId: deps.principals.verifier },
  ];
  const sod = checkSod({ risk: 'low', assignments });
  if (sod.decision === 'DENY') {
    return {
      ok: false,
      reason: 'verification-failed',
      detail: `sod-denied: ${sod.reason}`,
    };
  }

  // Outcome: an effect that never ran cannot be verified…
  if (!ctx.effect.applied) {
    return { ok: false, reason: 'verification-failed', detail: 'effect was not applied' };
  }
  // …and the undo log (SoT, §9.8) must confirm the effect is applied.
  if (!(await deps.sandbox.wasApplied(ctx.effect.undo.handleId))) {
    return {
      ok: false,
      reason: 'verification-failed',
      detail: 'undo log does not confirm the effect',
    };
  }
  return { ok: true };
}

/**
 * Learning promotion verify hook (task 2.6): ONE transaction owns BOTH writes —
 * the `completed → verified` CAS win AND the append-only verification proof
 * (DISTINCT verifier — enforced against the work proposer, fresh active
 * Delegation, policy reference). Failures abort + roll BOTH back and return
 * as typed VALUES (finalize twin pattern).
 */
export type VerifyWorkFailureReason =
  | 'work-not-found'
  | 'invalid-work-state'
  | 'verifier-not-distinct'
  | 'version-conflict'
  | 'delegation-unavailable'
  | 'proof-conflict';

export interface VerifyWorkRepositories {
  readonly work: WorkRepository;
  readonly delegation: DelegationRepository;
  readonly authority: PromotionAuthorityRepository;
}

export interface VerifyWorkDeps {
  /** Binds the repositories to the GIVEN connection (finalize precedent). */
  readonly repositories: (conn: DbConnection) => VerifyWorkRepositories;
  readonly connection: DbConnection;
  /** The verifier principal (trusted authenticated context). */
  readonly verifier: string;
  readonly now?: () => number;
}

export interface VerifyWorkInput {
  readonly companyId: string;
  readonly workId: string;
  readonly subject: LearningSubject;
  readonly policyRef: PolicyRef;
}

export type VerifyWorkResult =
  | { readonly ok: true; readonly work: Work; readonly proof: AuthorityTransitionProof }
  | { readonly ok: false; readonly reason: VerifyWorkFailureReason; readonly current?: Work };

class VerifyWorkAbortError extends Error {
  constructor(
    readonly reason: VerifyWorkFailureReason,
    readonly current?: Work,
  ) {
    super(`verify work abort: ${reason}`);
    this.name = 'VerifyWorkAbortError';
  }
}

export async function verifyWorkWithProofAtomically(
  deps: VerifyWorkDeps,
  input: VerifyWorkInput,
): Promise<VerifyWorkResult> {
  try {
    return await deps.connection.transaction(async (tx) => {
      const { work, delegation, authority } = deps.repositories(tx);
      const current = await work.get(input.companyId, input.workId);
      if (current === undefined) throw new VerifyWorkAbortError('work-not-found');
      if (current.state !== 'completed')
        throw new VerifyWorkAbortError('invalid-work-state', current);
      if (deps.verifier === current.proposer)
        throw new VerifyWorkAbortError('verifier-not-distinct', current);
      const freshDelegation = await delegation.get(input.companyId, current.delegationId);
      if (freshDelegation === undefined) throw new VerifyWorkAbortError('delegation-unavailable');
      if (freshDelegation.state !== 'active')
        throw new VerifyWorkAbortError('delegation-unavailable');
      const now = deps.now?.() ?? Date.now();
      if (freshDelegation.validFrom > now || freshDelegation.validUntil <= now)
        throw new VerifyWorkAbortError('delegation-unavailable');
      const cas = await work.updateIfVersion({ ...current, state: 'verified' }, current.version);
      if (!cas.ok) throw new VerifyWorkAbortError('version-conflict', cas.current);
      const proof: Omit<AuthorityTransitionProof, 'current'> = {
        proofId: `proof:${input.workId}`,
        proofRevision: 1,
        transitionId: input.workId,
        transitionRevision: 1,
        kind: 'verification',
        companyId: input.companyId,
        subject: input.subject,
        actorId: deps.verifier,
        principalId: freshDelegation.delegate,
        delegationId: freshDelegation.delegationId,
        grantId: freshDelegation.delegationId,
        command: 'learning.promote',
        capability: 'learning.promote',
        scope: promotionScopeFor(input.companyId, input.subject),
        policyRef: input.policyRef,
        issuedAt: now,
        effectiveFrom: freshDelegation.validFrom,
        expiry: freshDelegation.validUntil,
        revoked: false,
        revocationVersion: 0,
      };
      const appended = await authority.appendProof(proof);
      if (appended === 'conflict') throw new VerifyWorkAbortError('proof-conflict');
      return { ok: true as const, work: cas.value, proof: { ...proof, current: true as const } };
    });
  } catch (error) {
    if (error instanceof VerifyWorkAbortError) {
      return error.current === undefined
        ? { ok: false, reason: error.reason }
        : { ok: false, reason: error.reason, current: error.current };
    }
    throw error;
  }
}
