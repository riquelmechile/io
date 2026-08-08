import type { BusinessEvent } from './types.js';

/**
 * Deterministic heartbeat decision for the worker cycle (heartbeat spec R1):
 * either activate a model tier or decline with `no-llm-heartbeat`. The branch
 * and tier are a pure, constant value derived only from the event stream and
 * the cursor — never from clocks, LLMs, randomness, or generated identifiers.
 */
export type ModelTier = 'flash' | 'pro';

export type HeartbeatDecision =
  | { readonly kind: 'activate'; readonly model: ModelTier }
  | { readonly kind: 'no-llm-heartbeat' };

/**
 * Cursor marking the last event the heartbeat has already seen (design). The
 * `lastEventId` is resolved against the supplied stream by INSERTION INDEX,
 * never by string comparison.
 */
export type HeartbeatCursor = { readonly lastEventId: string };

/**
 * Extensible set of event types that count as "material" for the heartbeat
 * (R2): an event is material iff its `eventType` is declared here. Declared as
 * a constant so the set stays extensible without touching the filter.
 */
export const MATERIAL_EVENT_TYPES: readonly ['work.completed'] = ['work.completed'];

/** Materiality (R2): an event is material iff its `eventType` is declared. */
export function isMaterialEvent(event: BusinessEvent): boolean {
  return (MATERIAL_EVENT_TYPES as readonly string[]).includes(event.eventType);
}

/**
 * Resolved cursor index (design): absent cursor → `-1` (precedes every event);
 * `lastEventId` at `i` → `i`; `lastEventId` missing → `events.length` (ahead of
 * the stream). Shared by `hasMaterialNovelty` and `escalationModelFor` so both
 * judge novelty by the same insertion-index rule. An event at index `j`
 * follows the cursor iff `j > cursorIndex`.
 */
function resolveCursorIndex(events: readonly BusinessEvent[], cursor?: HeartbeatCursor): number {
  if (cursor === undefined) return -1;
  const found = events.findIndex((event) => event.eventId === cursor.lastEventId);
  return found === -1 ? events.length : found;
}

/**
 * Cursor-defined novelty (R4): true iff a material event FOLLOWS the cursor in
 * the supplied stream. The cursor is resolved by INSERTION INDEX, mirroring
 * the repository's `ORDER BY id ASC` read order — never by string comparison
 * (event ids are not lexicographically ordered). Novelty is never clock-
 * defined: `occurredAt` and ambient time play no role.
 */
export function hasMaterialNovelty(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): boolean {
  const cursorIndex = resolveCursorIndex(events, cursor);
  return events.some((event, index) => isMaterialEvent(event) && index > cursorIndex);
}

/**
 * Declared escalation threshold (HB Escalation): the activation tier is `pro`
 * iff at least one novel material event carries a `payload.riskClass` whose
 * rank is at or above this constant ('high' or 'critical').
 */
export const PRO_ESCALATION_THRESHOLD = 'high' as const;

/**
 * Declared, ordered risk vocabulary (HB Escalation): the only values that can
 * escalate. Absent or invalid values default to `flash` (cost-safe).
 */
export const VALID_RISK_CLASSES = ['low', 'medium', 'high', 'critical'] as const;

type RiskClassFact = (typeof VALID_RISK_CLASSES)[number];

/** Rank of each declared risk class — escalation compares ranks, not labels. */
const RISK_RANK: Record<RiskClassFact, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Rank of the declared threshold — a compile-time constant (never undefined). */
const THRESHOLD_RANK: number = RISK_RANK[PRO_ESCALATION_THRESHOLD];

/**
 * Pure model-tier selection (HB Escalation): `pro` iff ≥1 novel MATERIAL event
 * has `typeof payload.riskClass === 'string'` AND the value is a declared risk
 * class AND its rank is ≥ the threshold's rank; otherwise `flash`. Absent,
 * invalid, non-material, or at-or-before-cursor risk stays `flash` (default-
 * flash — cost-safe until a risk-signal producer exists). Never consults
 * `occurredAt`, clocks, LLMs, or randomness: the same `(events, cursor)` ALWAYS
 * yield the same tier (inverse-poison guarantee).
 */
export function escalationModelFor(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): ModelTier {
  const cursorIndex = resolveCursorIndex(events, cursor);
  const escalated = events.some((event, index) => {
    if (!isMaterialEvent(event) || index <= cursorIndex) return false;
    const riskClass = event.payload.riskClass;
    if (typeof riskClass !== 'string') return false;
    const rank = RISK_RANK[riskClass as RiskClassFact];
    return rank !== undefined && rank >= THRESHOLD_RANK;
  });
  return escalated ? 'pro' : 'flash';
}

/**
 * Pure heartbeat decision (R1, R3, HB Escalation): a deterministic function of
 * ONLY `(events, cursor)`. No clock, LLM, randomness, or generated identifier
 * can enter — the same inputs ALWAYS yield the same decision, no matter what
 * surrounds the call (inverse-poison guarantee). Material novelty gates
 * activation; the activation tier is the pure escalation result.
 */
export function evaluateHeartbeat(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): HeartbeatDecision {
  return hasMaterialNovelty(events, cursor)
    ? { kind: 'activate', model: escalationModelFor(events, cursor) }
    : { kind: 'no-llm-heartbeat' };
}

/**
 * Tail of the event stream in INSERTION (stream) order (supervisor-timer):
 * the `lastEventId` of the final event, or `undefined` for an empty stream.
 * Never lexicographic — the LAST-APPENDED event is the tail, mirroring the
 * repository's `ORDER BY id ASC` read order. Pure: the supervisor's durable
 * cursor is derived ONLY from the stream, never from clocks, LLMs, randomness,
 * or generated identifiers.
 */
export function tailCursor(events: readonly BusinessEvent[]): HeartbeatCursor | undefined {
  const tail = events.at(-1);
  if (tail === undefined) return undefined;
  return { lastEventId: tail.eventId };
}
