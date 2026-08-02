import {
  evaluateHeartbeat,
  type BusinessEventRepository,
  type HeartbeatCursor,
  type HeartbeatDecision,
} from '@io/business-domain/src/index.js';

/**
 * Read-only app evaluator seam (heartbeat R6, design "Data Flow"): returns the
 * PURE domain decision for a tenant by reading its business-event stream and
 * delegating to `evaluateHeartbeat`. The seam is STRICTLY read-only — exactly
 * one tenant-scoped `listByCompany`, zero writes/mutations — and carries NO
 * LLM, clock, or cursor persistence: the decision is the pure filter's output.
 *
 * Tenant scoping (R7): a non-empty `companyId` is REQUIRED and enforced BEFORE
 * any repository read, so an empty tenant scope never touches the store.
 *
 * The worker cycle / `runWorker` / `compileContext` are NOT on this path.
 */
export async function evaluateHeartbeatForCompany(
  deps: { readonly events: BusinessEventRepository },
  companyId: string,
  cursor?: HeartbeatCursor,
): Promise<HeartbeatDecision> {
  if (!companyId) {
    throw new Error('a non-empty companyId is required');
  }
  const events = await deps.events.listByCompany(companyId);
  return evaluateHeartbeat(events, cursor);
}
