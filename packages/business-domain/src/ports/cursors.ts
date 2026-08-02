import type { HeartbeatCursor } from '../heartbeat.js';

/**
 * Per-company heartbeat cursor store (supervisor-timer, design: ports/cursors.ts
 * mirrors ports/idempotency.ts — a non-aggregate checkpoint port). The
 * supervisor persists "seen through event X" per company so a heartbeat
 * activation fires exactly once per novel event, and a later append renews
 * novelty.
 *
 * Tenant scoping (ADR-0002): every operation carries a mandatory, non-empty
 * `companyId`; a scoped `get` returns ONLY that company's checkpoint. `upsert`
 * is ATOMIC — it creates or replaces exactly ONE checkpoint for that company
 * and never touches another company's checkpoint. Only the supervisor writes
 * cursors; the heartbeat gate/evaluator remain read-only and unchanged.
 * Methods return a `Promise` — a real adapter is I/O-bound. The port carries
 * ZERO persistence knowledge; a downstream adapter (PG, file, etc.) supplies
 * the implementation. Pure interface — zero `@io/*` imports.
 */
export interface HeartbeatCursorStore {
  /** The company's checkpoint, or `undefined` when none has been recorded. */
  get(companyId: string): Promise<HeartbeatCursor | undefined>;
  /** Atomically create or replace the company's single checkpoint. */
  upsert(companyId: string, cursor: HeartbeatCursor): Promise<void>;
}
