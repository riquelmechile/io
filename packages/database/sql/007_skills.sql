-- packages/database/sql/007_skills.sql
-- Skill (design §007, R6 insert-only PG persistence): the deterministic
-- versioned skill registry. Travels WITH PR2 (packages/database).
--   * skill is INSERT-only at the adapter level: PgSkillRepository has NO
--     update/delete — a new version is a NEW row (append-only, §9.2
--     no-overwrite). Rows are immutable facts.
--   * uq_skill_company_skill_version (UNIQUE(company_id, skill_id, version))
--     enforces the no-overwrite contract (R2): a duplicate version identity is
--     REJECTED at the database level, no upsert — the original row is
--     preserved.
--   * idx_skill_company_id backs the tenant-scoped read (listByCompany
--     WHERE company_id = $1, ADR-0002); R7 forbids cross-tenant reads because
--     every row carries a non-empty company_id and every read is scoped by it.
-- Every statement is idempotent (IF NOT EXISTS) like 001-006 — applied through
-- PgDbConnection.execute(), no migration runner. Target: PostgreSQL 18.4.

CREATE TABLE IF NOT EXISTS skill (
  id SERIAL PRIMARY KEY,
  skill_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  scope JSONB NOT NULL,
  state TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_company_skill_version
  ON skill (company_id, skill_id, version);
CREATE INDEX IF NOT EXISTS idx_skill_company_id
  ON skill (company_id);
