import type { BusinessEvent, Work } from './types.js';

/**
 * Deterministic acceptance event (business-event delta: Atomic Acceptance
 * Event Emission, Idempotent Single Emission). Builds ONE `work.accepted`
 * BusinessEvent per successful `proposed → accepted` transition — the typed
 * fact that makes a zero-history company discoverable. The eventId is
 * determined SOLELY by `workId`:
 *
 *   `evt:acc:{workId}`
 *
 * so a retry with the same workId rebuilds the SAME id and a duplicate append
 * is rejected by `uq_business_event_event_id` — exactly one acceptance event
 * remains. `occurredAt` is the ONLY clock-derived field (injectable `now`);
 * time never enters identity. The remaining routing/typing/payload fields
 * (`companyId`, `aggregateKind`, `aggregateId`, `eventType`, `source`,
 * `payload`) derive deterministically from the accepted Work facts — no LLM
 * output, randomness, or generated identifier alters any field. Prefix
 * `evt:acc:` stays disjoint from the supervisor's `evt:hb:` and the worker's
 * `evt:att:{companyId}:{idempotencyKey}` namespaces, and `source:'acceptor'`
 * marks exclusive ownership. Pure function — zero `@io/*` imports.
 */
export function buildWorkAcceptedEvent(work: Work, now?: () => number): BusinessEvent {
  return {
    eventId: `evt:acc:${work.workId}`, // SOLELY workId
    companyId: work.companyId,
    aggregateKind: 'work',
    aggregateId: work.workId,
    eventType: 'work.accepted',
    occurredAt: now?.() ?? Date.now(), // injected now; EXCLUDED from identity
    payload: { workId: work.workId, state: work.state, actor: work.proposer },
    source: 'acceptor',
  };
}
