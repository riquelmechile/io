import { buildHeartbeatDecisionEvent, tailCursor } from '@io/business-domain/src/index.js';

import { evaluateHeartbeatGate } from '../heartbeat/cycle.js';
import type { SupervisorDeps, TickCompany } from './types.js';

/**
 * One sequential, checkpointed company tick (design "Tick order" — R4-001
 * crash-safety order):
 *
 * 1. require a non-empty `companyId` (ADR-0002) BEFORE any store read;
 * 2. read the stored cursor (or `undefined` on first contact);
 * 3. evaluate the companyId-only `evaluateHeartbeatGate` (read-only, the
 *    UNCHANGED worker-boundary gate — a new caller, never mutated);
 * 4. read the stream tail (the supervisor's own read — two reads per tick);
 * 5. append ONE `heartbeat.decision` via `appendIfAbsent` (at-most-once: a
 *    retry with the same unadvanced cursor rebuilds the same eventId and
 *    no-ops; an append failure propagates — the tick fails uncheckpointed);
 * 6. `activate` → `await onActivate?.(companyId)` — SIDE EFFECT FIRST;
 * 7. `await onRecovery?.(companyId)` — the recovery pass (supervisor-timer
 *    delta, design D4): runs on BOTH decision branches, exactly once per
 *    company per tick, AFTER activation and BEFORE the checkpoint;
 * 8. persist the checkpoint LAST — never before the callbacks return.
 *
 * At-least-once delivery (spec "Callback failure leaves the activation
 * retryable" + "Recovery failure leaves cursor unadvanced"): a crash or throw
 * inside `onActivate` OR `onRecovery` propagates with the cursor UN-advanced
 * (the schedule logs/swallows it), so the next tick re-evaluates the same
 * stream tail and re-invokes the callback(s). On `no-llm-heartbeat` (no
 * activation side effect) recovery still runs, then the checkpoint is upserted
 * directly. `tailCursor([]) === undefined` → no checkpoint row (defensive;
 * discovered companies have ≥1 event). Decision-event appends, cursor writes,
 * and the recovery writes (marker/journal/undo/resume — a NEW class
 * legitimated by the supervisor-timer delta) belong ONLY to the supervisor
 * within this tick boundary.
 */
export const tickCompany: TickCompany = async (
  deps: SupervisorDeps,
  companyId,
  onActivate,
  onRecovery,
) => {
  if (!companyId) {
    throw new Error('a non-empty companyId is required');
  }
  const cursor = await deps.cursors.get(companyId);
  const decision = await evaluateHeartbeatGate({ events: deps.events }, companyId, cursor);
  const stream = await deps.events.listByCompany(companyId);
  const tail = tailCursor(stream);
  await deps.events.appendIfAbsent(buildHeartbeatDecisionEvent(companyId, decision, cursor));
  if (decision.kind === 'activate') {
    await onActivate?.(companyId, decision.model);
  }
  await onRecovery?.(companyId);
  if (tail !== undefined) {
    await deps.cursors.upsert(companyId, tail);
  }
};
