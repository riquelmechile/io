-- packages/database/sql/008_heartbeat_cursor.sql
-- HeartbeatCursor (supervisor-timer, design migration 008): the supervisor's
-- durable per-company checkpoint — "seen through event X" so a heartbeat
-- activation fires exactly once per novel event, and a later append renews
-- novelty.
--   * heartbeat_cursor is written ONLY through the atomic upsert path:
--     PgHeartbeatCursorRepository has NO standalone update/delete — a row is
--     created-or-replaced by `INSERT ... ON CONFLICT (company_id) DO UPDATE`.
--   * company_id PRIMARY KEY enforces ONE checkpoint per company (tenant
--     scoping, ADR-0002): an upsert for company A can never touch company B's
--     row.
--   * last_event_id is the tail event id in INSERTION order; updated_at is the
--     write timestamp (BIGINT epoch millis).
-- Only the supervisor writes cursors; the heartbeat gate/evaluator stay
-- read-only and unchanged. Every statement is idempotent (IF NOT EXISTS) like
-- 001-007 — applied through PgDbConnection.execute(), no migration runner.
-- Target: PostgreSQL 18.4.

CREATE TABLE IF NOT EXISTS heartbeat_cursor (
  company_id TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
