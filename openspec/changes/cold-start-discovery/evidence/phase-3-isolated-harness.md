# Phase 3 Isolated PostgreSQL Harness Evidence — cold-start-discovery (final evidence correction, 2026-08-13)

- **Purpose**: independently inspectable identity of the EXCLUSIVE dedicated PostgreSQL harness used for all Phase 3 runtime evidence. Supersedes all prior shared-DB Phase 3 evidence (contaminated, #6474). Work unit `phase-3-raw-schema-readback-correction` (token `sha256:33cc6c50…1fc3f`, budget 520 per Engram #6526); final evidence correction `phase-3-raw-gate-lineage-correction` (2026-08-13).
- **Shared-DB truth (corrected)**: prior "shared io_pg/io_dev were never connected" is FALSE. Allowed truth only: the RED run's pre-existing conn-string isolation test made ONE accidental read/connection attempt to shared `localhost:5432` pre-fix, which failed (`database io_dev_iso does not exist`); no write conclusion is claimed because none is proven. Current recovery operations (this correction) targeted the isolated container by identity only.

## Harness Identity (preserved)

| Property | Value |
|----------|-------|
| Container | `io-phase3-iso-pg-ca93986d` (prefix `1eff346e8a1f`, postgres:18.4, `PostgreSQL 18.4`) |
| Volume | `io-phase3-iso-pg-vol-ca93986d` (preserved, never deleted) |
| Host port | `127.0.0.1:5433` (loopback only; 5432 is the shared server) |
| Role/db | non-sensitive `io_iso`; credentials env-injected, never printed |

## Raw Proofs (in-repo, self-contained)

- `phase-3-scratch-lineage.log` — fresh scratch DB `io_scratch_lin_20260813a`: verbatim pre-absence, CREATE, `current_database()` identity, baseline-0, migration manifest 001–011 (OK + sha256), final readback (10 tables, 9 design indexes, `total_public_indexes=31`, CHECK, 010/011 columns, absence 0), DROP, post-absence. Supersedes the prior `phase-3-schema-readback.log`.
- `phase-3-check-gate.log` — full `pnpm check`, run exactly once against the isolated harness; exit 0; `99 passed | 3 skipped (102); 1378 passed | 6 skipped (1384)`; all 9 lint warnings present raw.
- `phase-3-focused-live-pg.log` — focused suite run exactly once against the isolated harness; `60 passed (60); exit 0`.

## Isolation Proof

- All live-PG suites ran with injected `DATABASE_URL` → `127.0.0.1:5433` (env-first `pgConnectionString()`; repo defaults and `.env` untouched). During the gate, the conn-string test creates+drops scratch DB `io_dev_iso` on the SAME isolated server (fixed to derive from `pgConnectionString()`). Residual rows after run: the final test's committed writes (`work-acc-001` accepted@v2 + its event; `main-only` evidence row — `evidence` not in this suite's TRUNCATE list, pre-existing design).
- Container stopped after the evidence runs (preserved, NOT deleted); volume preserved.

## Defect Found (Strict TDD RED) + Fix

- **RED** (isolated, pre-fix): `1 failed | 59 passed (60)` — the PRE-EXISTING conn-string isolation test hardcoded the shared-server URL `postgresql://<dev-user>:<dev-pass>@localhost:5432/io_dev_iso`, dialing the shared server regardless of `DATABASE_URL` (exact coupling class of #6474). The 59 passing included all 7 new atomic-acceptance cases, so production code was sound.
- **GREEN** (minimal, test-only fix): derive the scratch URL from `pgConnectionString()` (pathname rewrite to `io_dev_iso`) + `.toString()`. Focused rerun: `60 passed (60); exit 0` (raw in `phase-3-focused-live-pg.log`). No production/spec/design change; rollback = revert the single conn-string block.
