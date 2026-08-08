import { runWorker } from '../worker/worker.js';
import type { ModelTier } from '@io/business-domain/src/index.js';
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
