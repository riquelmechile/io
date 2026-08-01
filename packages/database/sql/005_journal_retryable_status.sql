-- packages/database/sql/005_journal_retryable_status.sql
-- The retryable-marker migration (first-enterprise-vertical, Slice A): extends
-- the idempotency_journal status domain from two values to THREE
-- ('in_flight','completed','aborted_retryable') so finalize CAS-loss marks an
-- attempt retryable instead of sealing the key with a failure (IJ marker-durable;
-- foundation parity with the complete-work rollback-then-retry path).
--
-- 004 created `status TEXT NOT NULL` with NO CHECK. 005 idempotently DROPs any
-- existing status CHECK (IF EXISTS — e.g. a two-value CHECK from an earlier
-- hand-rolled constraint) and re-ADDs the three-value CHECK. PostgreSQL has no
-- `ADD CONSTRAINT IF NOT EXISTS`, so the DROP-then-ADD pair is what makes the
-- migration idempotent and re-apply safe (applied through
-- PgDbConnection.execute(), no migration runner).
--
-- ROLLBACK: drop the CHECK — existing completed/in_flight rows remain valid:
--   ALTER TABLE idempotency_journal DROP CONSTRAINT IF EXISTS idempotency_journal_status_check;
-- We deliberately do NOT restore a two-value CHECK (acceptance note 2): an
-- aborted_retryable marker row would violate it and brick the retry.
ALTER TABLE idempotency_journal DROP CONSTRAINT IF EXISTS idempotency_journal_status_check;
ALTER TABLE idempotency_journal ADD CONSTRAINT idempotency_journal_status_check
  CHECK (status IN ('in_flight', 'completed', 'aborted_retryable'));
