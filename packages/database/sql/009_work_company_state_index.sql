-- packages/database/sql/009_work_company_state_index.sql
-- Company-scoped actionable read (work-dispatch, design migration 009): the
-- index backing `listActionableByCompany` — `WHERE company_id = $1 AND
-- state = ANY($2) ORDER BY id ASC`. The (company_id, state) composite index
-- serves the tenant-scoped actionable lookup without a full scan: the leading
-- company_id column enforces ADR-0002 tenant scoping and state narrows to the
-- actionable states, while ORDER BY id ASC follows the table's clustered
-- insertion order (the dispatch "oldest first" queue).
-- Purely additive (a query planner aid): no schema change, no flag. Built
-- CONCURRENTLY so the build does NOT hold the SHARE lock an ordinary
-- CREATE INDEX takes against INSERT/UPDATE/DELETE — work creation and lifecycle
-- transitions stay writable for the whole index build during deployment
-- (R4-001). CONCURRENTLY cannot run inside a transaction block; the
-- no-migration-runner pattern applies this through PgDbConnection.execute() in
-- autocommit, exactly the transaction-free context CONCURRENTLY requires.
-- Still idempotent (IF NOT EXISTS) like 001-008. Target: PostgreSQL 18.4.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_company_state
  ON work (company_id, state);
