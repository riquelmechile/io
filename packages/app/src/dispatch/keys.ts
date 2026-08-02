import { createHash } from 'node:crypto';

import type { Work } from '@io/business-domain/src/types.js';

/**
 * Deterministic dispatch identity (work-dispatch R1, design B1): the worker
 * cycle is re-activated by its idempotency key + request hash, so both MUST be
 * stable functions of the SAME Work. The key is the collision-free
 * `wk:${companyId}:${workId}` anchor (company-scoped, restart-stable); the hash
 * is SHA-256 over the canonical `{ companyId, workId, delegationId,
 * description }` — the identity fields that NEVER change across the lifecycle.
 * The stateful Work fields (state/version/outcome/deliverable/evidenceRefs)
 * are EXCLUDED so the hash is identical across
 * `accepted → in_progress → completed`: a re-activation of the same Work
 * derives the SAME key + hash and journal-replays instead of re-running the
 * effect or issuing a second receipt (`UNIQUE(work_id, terminal_event_id)`).
 */
export function dispatchIdempotencyKeyFor(companyId: string, workId: string): string {
  return `wk:${companyId}:${workId}`;
}

export function dispatchRequestHashFor(work: Work): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        companyId: work.companyId,
        workId: work.workId,
        delegationId: work.delegationId,
        description: work.description,
      }),
    )
    .digest('hex');
}
