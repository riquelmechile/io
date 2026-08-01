-- packages/database/sql/003_harden_columns.sql
-- Slice A (authority+scope): additive columns the business adapters read/write.
-- The Slice A adapters (delegation, work, business_receipt) INSERT/SELECT
-- company_id (tenant scope, ADR-0002) and work.version (optimistic-concurrency
-- counter), so those columns must exist wherever 002's tables live. Additive and
-- idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-apply. Constraints
-- (terminal_event_id, UNIQUE indexes, idempotency_journal) stay in Slice B's
-- 004_harden_constraints.sql. Applied through PgDbConnection.execute() — no
-- migration runner. Target: PostgreSQL 18.4.

ALTER TABLE delegation ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
