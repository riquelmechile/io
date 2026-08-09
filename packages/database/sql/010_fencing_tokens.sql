-- 010_fencing_tokens.sql (zombie-writer protection — fencing tokens)
--
-- Mint a monotonic fencing token at the Work claim CAS (work.fencing_token,
-- design "Claim mint mechanics") and store the claim-owned token on the
-- idempotency journal row (idempotency_journal.fencing_token, design
-- "Journal token store"). Both columns are ADDITIVE and idempotent (IF NOT
-- EXISTS), defaulting to 0 — the valid pre-fencing epoch — so existing rows
-- (and the whole Slice-1 rollback boundary) are INERT at DEFAULT 0 until a
-- fresh claim increments the work-side counter.
--
-- Applied through PgDbConnection.execute() with no migration runner, matching
-- 001–009: every statement uses IF NOT EXISTS so re-apply is safe.

ALTER TABLE work ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0;
ALTER TABLE idempotency_journal ADD COLUMN IF NOT EXISTS fencing_token BIGINT NOT NULL DEFAULT 0;
