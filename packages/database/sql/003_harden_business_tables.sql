-- packages/database/sql/003_harden_business_tables.sql
-- Harden business tables: company scope, version CAS, terminal_event_id,
-- UNIQUE constraints, and idempotency_journal. Idempotent (IF NOT EXISTS).
-- Target: PostgreSQL 18.4.

-- Company uniqueness
ALTER TABLE company ADD COLUMN IF NOT EXISTS company_id TEXT;
DO $$ BEGIN
  ALTER TABLE company ADD CONSTRAINT uq_company_company_id UNIQUE (company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Delegation: company_id + unique
ALTER TABLE delegation ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE delegation ADD CONSTRAINT uq_delegation_delegation_id UNIQUE (delegation_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_delegation_company_id ON delegation (company_id);

-- Work: company_id + version + unique
ALTER TABLE work ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE work ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE work ADD CONSTRAINT uq_work_work_id UNIQUE (work_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_work_company_id ON work (company_id);

-- Business receipt: company_id + terminal_event_id + uniques
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
ALTER TABLE business_receipt ADD COLUMN IF NOT EXISTS terminal_event_id TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  ALTER TABLE business_receipt ADD CONSTRAINT uq_business_receipt_receipt_id UNIQUE (receipt_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE business_receipt ADD CONSTRAINT uq_business_receipt_work_terminal
    UNIQUE (work_id, terminal_event_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_business_receipt_company_id ON business_receipt (company_id);

-- Idempotency journal (company-scoped attempt store)
CREATE TABLE IF NOT EXISTS idempotency_journal (
  id           SERIAL PRIMARY KEY,
  company_id   TEXT NOT NULL,
  operation    TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status       TEXT NOT NULL,
  result       JSONB,
  created_at   BIGINT NOT NULL,
  completed_at BIGINT
);
DO $$ BEGIN
  ALTER TABLE idempotency_journal ADD CONSTRAINT uq_idempotency_journal_scope
    UNIQUE (company_id, operation, key);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
