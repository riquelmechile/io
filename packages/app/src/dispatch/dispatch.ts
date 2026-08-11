import { runClaimedWork, runWorker } from '../worker/worker.js';
import type { ModelTier } from '@io/business-domain/src/index.js';
import type { Work } from '@io/business-domain/src/types.js';
import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from './keys.js';
import type { DispatchDeps, DispatchResult } from './types.js';

/**
 * One company activation (work-dispatch R2; design "Data Flow"): pick the
 * FIRST (oldest accepted) actionable Work for the company and run EXACTLY ONE
 * unchanged `runWorker` cycle for it. The dispatch identity is derived from
 * the Work's stable identity fields — `wk:${companyId}:${workId}` key + SHA-256
 * request hash (R1) — so a re-activation of the same Work under the same
 * key+hash journal-REPLAYS instead of re-running the effect or issuing a
 * second receipt (R4, `UNIQUE(work_id, terminal_event_id)`).
 *
 * Settlement policy (R5): the worker cycle returns TYPED results for every
 * business outcome, so a typed `{ok:false}` (invalid-plan, denied,
 * recovery-required, invalid-transition, idempotency-conflict, …) SETTLES as a
 * `dispatched: true` DispatchResult — the supervisor cursor advances and there
 * is no hot LLM retry loop. Only a THROWN error (LlmError, DB/network) — which
 * never comes from a typed result — PROPAGATES, leaving the cursor un-advanced
 * for the next activation (at-least-once, R4-001). The empty queue settles
 * `{ok:true, dispatched:false}` with zero worker/LLM invocation; an empty
 * `companyId` rejects BEFORE any store read (ADR-0002).
 */
export async function dispatchCompanyActivation(
  companyId: string,
  deps: DispatchDeps,
  model: ModelTier,
): Promise<DispatchResult> {
  if (!companyId) {
    throw new Error('a non-empty companyId is required');
  }
  const actionable = await deps.work.listActionableByCompany(companyId);
  const first = actionable[0];
  if (first === undefined) {
    return { ok: true, dispatched: false };
  }
  const worker = await runWorker(
    {
      companyId,
      actor: deps.actor,
      workId: first.workId,
      expectedVersion: first.version,
      idempotencyKey: dispatchIdempotencyKeyFor(companyId, first.workId),
      requestHash: dispatchRequestHashFor(first),
    },
    deps.worker,
    model,
  );
  // Settle: the typed worker result (ok or not) advances the cursor. A thrown
  // error propagates — never caught here (design R5).
  return { ok: true, dispatched: true, workId: first.workId, worker };
}

/**
 * Designated recovery dispatch (work-dispatch "Designated Recovery Dispatch",
 * design D5/D6/D7): resumes a supervisor-designated `in_progress` orphan
 * through the claimed-work cycle WITHOUT re-claiming. Normal dispatch picks
 * OLDEST ACCEPTED Work (`ACTIONABLE_WORK_STATES = ['accepted']`) — an
 * `in_progress` Work is invisible to it by construction, and re-claiming one
 * would `invalid-transition` (W1) or re-mint a fencing token (drift). Recovery
 * therefore enters DIRECTLY at the claim-gate-free {@link runClaimedWork} seam
 * (the same post-claim body normal dispatch runs), presenting the RETAINED
 * token from the Work row (never re-minted, D6) and the DETERMINISTIC dispatch
 * identity (`dispatchIdempotencyKeyFor` / `dispatchRequestHashFor` — the same
 * `wk:` key + SHA-256 hash a normal activation derives, so the journal attempt
 * reconciles to the original dispatch). The supervisor reconciles the attempt
 * to the `aborted_retryable` retry boundary FIRST (recoverDesignatedWork); the
 * pre-effect reconcile then reopens the key. Expected recovery failures are
 * TYPED (the worker result settles — no thrown control flow).
 */
export async function dispatchRecovery(
  companyId: string,
  work: Work,
  deps: DispatchDeps,
  model: ModelTier,
): Promise<DispatchResult> {
  if (!companyId) {
    throw new Error('a non-empty companyId is required');
  }
  const worker = await runClaimedWork(work, deps.worker, model, {
    companyId,
    workId: work.workId,
    idempotencyKey: dispatchIdempotencyKeyFor(companyId, work.workId),
    requestHash: dispatchRequestHashFor(work),
  });
  return { ok: true, dispatched: true, workId: work.workId, worker };
}
