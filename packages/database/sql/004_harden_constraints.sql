-- packages/database/sql/004_harden_constraints.sql
-- Slice B (persistence + concurrency): the constraints migration. Travels WITH
-- Slice B per the design's 003+004 split — 003 (Slice A) already added the
-- columns the adapters read/write (company_id x3, work.version); 004 adds the
-- constraints:
--   * business_receipt.terminal_event_id (D5 — the terminal event / attempt id
--     that closed the work; written by the business-receipt adapter).
--   * One UNIQUE index per aggregate id (company.company_id, delegation.
--     delegation_id, work.work_id, business_receipt.receipt_id) so a second
--     save of the same id is rejected at the database level (single-issuance).
--   * uq_receipt_work_terminal: UNIQUE (work_id, terminal_event_id) — a single
--     terminal close per work (D5): a second receipt for the same work +
--     terminal event is rejected even with a different receipt_id.
--   * idempotency_journal (D6): the journal TABLE is created here; the
--     idempotency LOGIC/adapter is Slice C. Columns match the design sketch;
--     UNIQUE (company_id, idempotency_key) and UNIQUE (attempt_id) back the
--     replay/DENY contract.
-- Every statement is idempotent (IF NOT EXISTS) like 001-003 — applied through
-- PgDbConnection.execute(), no migration runner. Target: PostgreSQL 18.4.

-- GREENFIELD: this migration assumes an empty (or already dedup'd)
-- business_receipt table. The column lands NOT NULL DEFAULT '' and is covered
-- by uq_receipt_work_terminal (work_id, terminal_event_id) below; backfilling
-- every existing row to '' would create duplicate (work_id, '') keys, and
-- CREATE UNIQUE INDEX IF NOT EXISTS does NOT skip on a data violation — it
-- fails. If rows already exist, backfill terminal_event_id = receipt_id (a
-- per-row unique value) BEFORE creating uq_receipt_work_terminal.
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS terminal_event_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_company_id ON company (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delegation_delegation_id ON delegation (delegation_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_work_id ON work (work_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_receipt_id ON business_receipt (receipt_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_work_terminal ON business_receipt (work_id, terminal_event_id);

CREATE TABLE IF NOT EXISTS idempotency_journal (
  id SERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json JSONB,
  created_at BIGINT NOT NULL,
  UNIQUE (company_id, idempotency_key),
  UNIQUE (attempt_id)
);
