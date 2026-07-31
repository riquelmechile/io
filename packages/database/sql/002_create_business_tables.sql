-- packages/database/sql/002_create_business_tables.sql
-- Schema for the four business-domain aggregates (Company, Delegation, Work,
-- BusinessReceipt). Snake_case columns map to camelCase domain fields via AS
-- aliases in the adapters. Nested value objects use JSONB (D6: read-at-once
-- value objects, no join patterns). SERIAL PK backs physical row identity.
-- Applied through PgDbConnection.execute() (CREATE TABLE IF NOT EXISTS =
-- idempotent) — no migration runner. Target: PostgreSQL 18.4.
-- Hardened: company_id scope, work.version, receipt.terminal_event_id, UNIQUEs.

CREATE TABLE IF NOT EXISTS company (
  id          SERIAL PRIMARY KEY,
  company_id  TEXT NOT NULL UNIQUE,
  purpose     TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_company_company_id ON company (company_id);

CREATE TABLE IF NOT EXISTS delegation (
  id               SERIAL PRIMARY KEY,
  delegation_id    TEXT NOT NULL UNIQUE,
  company_id       TEXT NOT NULL,
  delegator        TEXT NOT NULL,
  delegate         TEXT NOT NULL,
  authority_scope  JSONB NOT NULL,
  budget           JSONB NOT NULL,
  valid_from       BIGINT NOT NULL,
  valid_until      BIGINT NOT NULL,
  expected_outcome TEXT NOT NULL,
  state            TEXT NOT NULL,
  created_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegation_delegation_id ON delegation (delegation_id);
CREATE INDEX IF NOT EXISTS idx_delegation_company_id ON delegation (company_id);

CREATE TABLE IF NOT EXISTS work (
  id            SERIAL PRIMARY KEY,
  work_id       TEXT NOT NULL UNIQUE,
  company_id    TEXT NOT NULL,
  delegation_id TEXT NOT NULL,
  proposer      TEXT NOT NULL,
  description   TEXT NOT NULL,
  state         TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,
  deliverable   JSONB,
  evidence_refs JSONB NOT NULL,
  outcome       JSONB,
  created_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_work_id ON work (work_id);
CREATE INDEX IF NOT EXISTS idx_work_delegation_id ON work (delegation_id);
CREATE INDEX IF NOT EXISTS idx_work_company_id ON work (company_id);

CREATE TABLE IF NOT EXISTS business_receipt (
  id                SERIAL PRIMARY KEY,
  receipt_id        TEXT NOT NULL UNIQUE,
  work_id           TEXT NOT NULL,
  delegation_id     TEXT NOT NULL,
  company_id        TEXT NOT NULL,
  actor             TEXT NOT NULL,
  policy_hash       TEXT NOT NULL,
  evidence_refs     JSONB NOT NULL,
  terminal_event_id TEXT NOT NULL,
  terminal_state    TEXT NOT NULL,
  artifact_hash     TEXT NOT NULL,
  issued_at         BIGINT NOT NULL,
  created_at        BIGINT NOT NULL,
  UNIQUE (work_id, terminal_event_id)
);
CREATE INDEX IF NOT EXISTS idx_business_receipt_receipt_id ON business_receipt (receipt_id);
CREATE INDEX IF NOT EXISTS idx_business_receipt_work_id ON business_receipt (work_id);
CREATE INDEX IF NOT EXISTS idx_business_receipt_company_id ON business_receipt (company_id);

CREATE TABLE IF NOT EXISTS idempotency_journal (
  id           SERIAL PRIMARY KEY,
  company_id   TEXT NOT NULL,
  operation    TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status       TEXT NOT NULL,
  result       JSONB,
  created_at   BIGINT NOT NULL,
  completed_at BIGINT,
  UNIQUE (company_id, operation, key)
);
