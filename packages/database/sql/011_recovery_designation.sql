-- 011_recovery_designation.sql (operator recovery designation — supervisor recovery)
--
-- Boolean marker `work.recovery_requested` (operator designation of orphaned
-- in_progress Work) + a partial index covering the discovery predicate.
-- Designation is OPERATIONAL METADATA, not a lifecycle transition:
-- `WORK_TRANSITIONS` keeps `in_progress -> ['completed']` and the domain Work
-- type stays pure (the marker lives only in this row + the repository port
-- methods). A designation CAS bumps `version` — fencing a stale-version
-- zombie's terminal close — while leaving `state` and `fencing_token`
-- UNCHANGED (no new token is minted).
--
-- Additive + inert (DEFAULT false), matching the fencing-token precedent
-- (010_fencing_tokens.sql): existing rows and the Slice-2 rollback boundary
-- are unaffected until an operator designates a work. Applied through
-- PgDbConnection.execute() with no migration runner, matching 001-010: every
-- statement uses IF NOT EXISTS so re-apply is safe.

ALTER TABLE work ADD COLUMN IF NOT EXISTS recovery_requested BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_work_recovery_requested
  ON work (company_id)
  WHERE recovery_requested AND state = 'in_progress';
