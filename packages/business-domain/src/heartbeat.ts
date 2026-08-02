import type { BusinessEvent } from './types.js';

/**
 * Deterministic heartbeat decision for the worker cycle (heartbeat spec R1):
 * either activate the Flash model or decline with `no-llm-heartbeat`. The
 * branch is a pure, constant value derived only from the event stream and the
 * cursor — never from clocks, LLMs, randomness, or generated identifiers.
 */
export type HeartbeatDecision =
  | { readonly kind: 'activate'; readonly model: 'flash' }
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
 * Cursor-defined novelty (R4): true iff a material event FOLLOWS the cursor in
 * the supplied stream. The cursor is resolved by INSERTION INDEX, mirroring
 * the repository's `ORDER BY id ASC` read order — never by string comparison
 * (event ids are not lexicographically ordered).
 *
 * Resolved cursor index (design):
 * - absent cursor      → `-1` (precedes every event);
 * - `lastEventId` at `i` → `i`;
 * - `lastEventId` missing → `events.length` (ahead of the stream).
 * An event at index `j` follows the cursor iff `j > cursorIndex`. Novelty is
 * never clock-defined: `occurredAt` and ambient time play no role.
 */
export function hasMaterialNovelty(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): boolean {
  let cursorIndex = -1;
  if (cursor !== undefined) {
    const found = events.findIndex((event) => event.eventId === cursor.lastEventId);
    cursorIndex = found === -1 ? events.length : found;
  }
  return events.some((event, index) => isMaterialEvent(event) && index > cursorIndex);
}

/**
 * Pure heartbeat decision (R1, R3): a deterministic function of ONLY
 * `(events, cursor)`. No clock, LLM, randomness, or generated identifier can
 * enter — the same inputs ALWAYS yield the same decision, no matter what
 * surrounds the call (inverse-poison guarantee).
 */
export function evaluateHeartbeat(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): HeartbeatDecision {
  return hasMaterialNovelty(events, cursor)
    ? { kind: 'activate', model: 'flash' }
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
