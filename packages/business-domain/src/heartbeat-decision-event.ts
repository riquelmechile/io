import { createHash } from 'node:crypto';

import type { HeartbeatCursor, HeartbeatDecision } from './heartbeat.js';
import type { BusinessEvent } from './types.js';

/** ∅ sentinel for an absent cursor in the identity preimage (real eventIds are non-empty). */
const EMPTY_CURSOR = '';

/**
 * Deterministic supervisor decision event (business-event delta: Model-
 * Independent Event Facts, Idempotent Single Emission). Builds ONE
 * `heartbeat.decision` BusinessEvent per gate evaluation — the persisted proof
 * the tick ran and what it decided. The eventId is a PURE digest of ONLY the
 * identity inputs:
 *
 *   `evt:hb:{sha256(companyId \0 (cursor ?? '') \0 decision.kind).hex.slice(0,16)}`
 *
 * so a retry with the same unadvanced cursor and decision rebuilds the SAME id
 * and `appendIfAbsent` no-ops — exactly one decision event remains. `occurredAt`
 * is the ONLY clock-derived field (injectable `now`); time never enters
 * identity; no LLM output, randomness, or generated identifier alters any
 * field. Prefix `evt:hb:` stays disjoint from the worker's `evt:{attemptId}`.
 * Pure function, `node:crypto` builtin only — zero `@io/*` imports.
 */
export function buildHeartbeatDecisionEvent(
  companyId: string,
  decision: HeartbeatDecision,
  cursor?: HeartbeatCursor,
  now?: () => number,
): BusinessEvent {
  const cursorKey = cursor?.lastEventId ?? EMPTY_CURSOR;
  const digest = createHash('sha256')
    .update(`${companyId}\0${cursorKey}\0${decision.kind}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return {
    eventId: `evt:hb:${digest}`,
    companyId,
    aggregateKind: 'heartbeat',
    aggregateId: companyId,
    eventType: 'heartbeat.decision',
    occurredAt: now?.() ?? Date.now(),
    payload: {
      decision: decision.kind,
      ...(decision.kind === 'activate' ? { model: 'flash' as const } : {}),
      cursor: cursor?.lastEventId ?? null,
    },
    source: 'supervisor',
  };
}
