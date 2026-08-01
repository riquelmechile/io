import { checkSod } from '@io/trust-kernel/src/index.js';
import type { SodAssignment } from '@io/trust-kernel/src/index.js';

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
