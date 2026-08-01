-- packages/database/sql/006_business_events.sql
-- BusinessEvent (design §006, R4 insert-only PG persistence): the deterministic
-- append-only business-fact log table. Travels WITH PR2 (packages/database).
--   * business_event is INSERT-only at the adapter level: PgBusinessEventRepository
--     has NO update/delete — rows are immutable facts.
--   * uq_business_event_event_id (UNIQUE event_id) enforces single issuance
--     (R7): a duplicate append of the same eventId (evt:{attemptId}) is REJECTED
--     at the database level, no upsert — the original row is preserved.
--   * idx_business_event_company_id backs the tenant-scoped read
--     (listByCompany WHERE company_id = $1, ADR-0002); R8 forbids cross-tenant
--     reads because every row carries a non-empty company_id and every read is
--     scoped by it.
--   * idx_business_event_aggregate (aggregate_kind, aggregate_id) backs the
--     per-aggregate fact stream reads.
-- Every statement is idempotent (IF NOT EXISTS) like 001-005 — applied through
-- PgDbConnection.execute(), no migration runner. Target: PostgreSQL 18.4.

CREATE TABLE IF NOT EXISTS business_event (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  aggregate_kind TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  payload JSONB NOT NULL,
  source TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_event_event_id
  ON business_event (event_id);
CREATE INDEX IF NOT EXISTS idx_business_event_company_id
  ON business_event (company_id);
CREATE INDEX IF NOT EXISTS idx_business_event_aggregate
  ON business_event (aggregate_kind, aggregate_id);
