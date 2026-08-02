import type {
  BusinessEventRepository,
  HeartbeatCursor,
  HeartbeatDecision,
} from '@io/business-domain/src/index.js';

import { evaluateHeartbeatForCompany } from './evaluate.js';

/**
 * Worker-boundary heartbeat gate (Approach 1, heartbeat-activation). Future
 * supervisor entry: `activate` → pick Work → `runWorker` (unchanged).
 *
 * Deadlock prevention (S1.1): the gate accepts ONLY `{ events }`, a non-empty
 * `companyId`, and an optional cursor — it NEVER accepts a `workId`, so the
 * empty-stream first-Work deadlock is structurally impossible.
 *
 * Read-only (R2): a THIN delegate over the read-only evaluator seam — no
 * duplicated list/filter logic, and no claims, journals, receipts, event
 * appends, or LLM calls on either decision path.
 */
export async function evaluateHeartbeatGate(
  deps: { readonly events: BusinessEventRepository },
  companyId: string,
  cursor?: HeartbeatCursor,
): Promise<HeartbeatDecision> {
  return evaluateHeartbeatForCompany(deps, companyId, cursor);
}
