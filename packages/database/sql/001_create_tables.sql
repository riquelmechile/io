-- packages/database/sql/001_create_tables.sql
-- Schema for the evidence & audit PersistentRecord column set (Req: Database
-- Schema for Evidence and Audit; D7). Snake_case columns map to camelCase
-- PersistentRecord fields via AS aliases in the adapters (sql.ts). The `id`
-- SERIAL PRIMARY KEY backs the audit ORDER BY id ASC ordering. Applied through
-- PgDbConnection.execute() (CREATE TABLE IF NOT EXISTS = idempotent) — no
-- migration runner this slice (D3). Target: PostgreSQL 18.4.

CREATE TABLE IF NOT EXISTS evidence (
  id           SERIAL PRIMARY KEY,
  action_id    TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  timestamp    BIGINT NOT NULL,
  persistent   BOOLEAN NOT NULL,
  disclosure   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_action_id ON evidence (action_id);

CREATE TABLE IF NOT EXISTS audit (
  id           SERIAL PRIMARY KEY,
  action_id    TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class   TEXT NOT NULL,
  decision     TEXT NOT NULL,
  reason       TEXT NOT NULL,
  timestamp    BIGINT NOT NULL,
  persistent   BOOLEAN NOT NULL,
  disclosure   TEXT NOT NULL
);
