# Apply Progress: Work Dispatch — PR 1 (tasks 1.1–1.6)

**Change**: work-dispatch · **Batch**: PR 1 of 2 (stacked-to-main) · **Mode**: STRICT TDD
**Artifact store**: HYBRID (openspec file + engram `sdd/work-dispatch/apply-progress`)
**Date**: 2026-08-02 · **Candidate**: UNCOMMITTED working tree (orchestrator commits with review receipt)

## Status

**success** — all 6 PR1 tasks complete, full gate GREEN, live-PG sequential GREEN, candidate normalized (biome format applied), nothing committed.

## Per-Task Status

| Task | Status | RED (written first) | GREEN (executed) | Evidence |
|------|--------|---------------------|------------------|----------|
| 1.1 | ✅ done | `transitions.test.ts` +3 tests (imports missing `ACTIONABLE_WORK_STATES`) | constant + re-export; 53/53 pass | 3 new tests |
| 1.2 | ✅ done | `fakes.test.ts` +3 tests (method missing) | port method + InMemory map-filter; 61/61 pass | 3 new tests |
| 1.3 | ✅ done | `sql-migrations.test.ts` 009 block (file missing) | `009_work_company_state_index.sql`; 24/24 pass | 3 new tests |
| 1.4 | ✅ done | `business-adapters.test.ts` +3 tests (method missing) + connection-fake `ANY($N)` support | `PgWorkRepository.listActionableByCompany`; 38/38 pass | 3 new tests |
| 1.5 | ✅ done | integration + parity tests written pre-GREEN (live PG, failed at RED) | adapter method satisfied them; 40/40 sequential live-PG | 4 new tests |
| 1.6 | ✅ done | gate GREEN | `pnpm check` all stages pass; business-domain boundary test (zero `@io/*`) passes | 1042 tests |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `business-domain/test/transitions.test.ts` | Unit | ✅ 50/50 | ✅ Written | ✅ Passed (53/53) | ✅ 3 cases | ➖ None needed |
| 1.2 | `business-domain/test/fakes.test.ts` | Unit | ✅ 58/58 | ✅ Written | ✅ Passed (61/61) | ✅ 3 cases | ✅ Clean |
| 1.3 | `database/test/sql-migrations.test.ts` | Unit | ✅ 21/21 | ✅ Written | ✅ Passed (24/24) | ➖ Single stmt + idempotency | ➖ None needed |
| 1.4 | `database/test/business-adapters.test.ts` | Unit | ✅ 35/35 | ✅ Written | ✅ Passed (38/38) | ✅ 4 cases | ✅ Clean |
| 1.5 | `database/test/business-pg-roundtrip.integration.test.ts` | Integration (live PG) | ✅ 36/36 | ✅ Written | ✅ Passed (40/40 seq) | ✅ 4 cases (incl. parity) | ✅ Clean |
| 1.6 | gate `pnpm check` + boundary tests | Suite | N/A | N/A | ✅ Passed | N/A | N/A |

Safety-net baseline: 163/163 passing across the 4 unit files BEFORE edits; RED confirmed 12 new tests failing (164 pre-existing still passing); all GREEN afterwards.

## Files Changed (uncommitted candidate)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/transitions.ts` | Modified | `ACTIONABLE_WORK_STATES: readonly ['accepted']` (mirrors `MATERIAL_EVENT_TYPES`) |
| `packages/business-domain/src/index.ts` | Modified | Re-export `ACTIONABLE_WORK_STATES` |
| `packages/business-domain/src/ports/repositories.ts` | Modified | `WorkRepository.listActionableByCompany(companyId)` port method |
| `packages/business-domain/src/ports/fakes.ts` | Modified | `InMemoryWorkRepository.listActionableByCompany` — guard-first, Map-iteration insertion order, company-scoped |
| `packages/business-domain/test/transitions.test.ts` | Modified | 1.1 RED tests (value, readonly-tuple type, membership) |
| `packages/business-domain/test/fakes.test.ts` | Modified | 1.2 RED tests (oldest-first mixed state/tenant; empty; empty-companyId zero reads via instrumented Map) |
| `packages/database/sql/009_work_company_state_index.sql` | Created | `CREATE INDEX IF NOT EXISTS idx_work_company_state ON work (company_id, state)` |
| `packages/database/test/sql-migrations.test.ts` | Modified | 1.3 RED 009 block (ships, index SQL, IF NOT EXISTS idempotency) |
| `packages/database/src/work-adapter.ts` | Modified | `PgWorkRepository.listActionableByCompany` — `WHERE company_id=$1 AND state=ANY($2) ORDER BY id ASC` + `parseWorkRow` guard (D7) |
| `packages/database/test/business-adapters.test.ts` | Modified | 1.4 RED unit tests (SQL shape, order, tenant scope, empty guard pre-SQL) |
| `packages/database/test/connection-fake.ts` | Modified | Test harness: `parseSelect` supports `col = ANY($N)` (additive, backward-compatible) |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modified | 1.5 RED live-PG tests (insertion order, tenant scope, guard parity, InMemory↔PG parity) + applies SCHEMA_009 |
| `packages/app/test/worker-finalize.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` (delegates to inner) |
| `packages/app/test/worker-reconcile.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` |
| `packages/app/test/parity.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` |

> NOTE on app test doubles: adding `listActionableByCompany` to the `WorkRepository` port interface (design A1) requires every explicit implementer to declare it. The three `RacingWorkRepository` doubles under `packages/app/test/` got 4-line additive delegation stubs — same convention as supervisor-timer PR1 (`da494ae` added a `listCompanyIds` stub to `app/test/worker-helpers.ts`). No `app/src` file was touched; all byte-identical files verified unchanged.

## Test Evidence

- **RED confirmation**: `pnpm vitest run` on the 4 unit files — 12 failed / 176 total (all new tests), 164 pre-existing still passing.
- **Unit GREEN**: 176/176 (transitions 53, fakes 61, sql-migrations 24, business-adapters 38).
- **Full gate** (`PATH=/data/node24/bin:$PATH pnpm check`): format-check ✅ · typecheck (tsc strict, noEmit) ✅ · build (tsc build) ✅ · lint (biome) ✅ · test ✅ — **Test Files 78 passed | 3 skipped (81) · Tests 1042 passed | 6 skipped (1048)**.
- **Live-PG sequential** (`pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts`): **40/40 passed** (includes 4 new work-dispatch tests; migration 009 applied in beforeAll).
- **Boundary**: business-domain zero `@io/*` import tests pass (heartbeat.test.ts, skill.test.ts scan all `src/**` recursively); business-domain package.json still declares zero deps.

## Work Unit Evidence (PR 1 — Actionable port + adapter + 009)

| Evidence | Value |
|---|---|
| Focused test command and result | `pnpm vitest run <4 unit files>` → 176/176; per-task counts above |
| Runtime harness command/scenario and result | live-PG sequential roundtrip → 40/40 (insertion order, tenant scope, guard parity, InMemory↔PG parity on real PG 18.4) |
| Rollback boundary | revert PR 1 commits only — `listActionableByCompany` has zero callers until PR 2; `ACTIONABLE_WORK_STATES` unused by callers; 009 is a pure additive index (IF NOT EXISTS). No PR 2 code exists yet |

## Candidate State (UNCOMMITTED)

`git status --short`:
```
 M packages/app/test/parity.test.ts
 M packages/app/test/worker-finalize.test.ts
 M packages/app/test/worker-reconcile.test.ts
 M packages/business-domain/src/index.ts
 M packages/business-domain/src/ports/fakes.ts
 M packages/business-domain/src/ports/repositories.ts
 M packages/business-domain/src/transitions.ts
 M packages/business-domain/test/fakes.test.ts
 M packages/business-domain/test/transitions.test.ts
 M packages/database/src/work-adapter.ts
 M packages/database/test/business-adapters.test.ts
 M packages/database/test/business-pg-roundtrip.integration.test.ts
 M packages/database/test/connection-fake.ts
 M packages/database/test/sql-migrations.test.ts
?? openspec/changes/work-dispatch/
?? packages/database/sql/009_work_company_state_index.sql
```

`git diff --stat` (tracked): **14 files changed, 342 insertions(+), 14 deletions(-)** — within the 400-line PR1 budget.

**Byte-identical files — verified UNCHANGED** (git diff vs HEAD is empty): `supervisor.ts`, `supervisor/tick.ts`, `supervisor/types.ts`, `worker.ts`, `heartbeat/cycle.ts`, `heartbeat/evaluate.ts`, `composition/supervisor-deps.ts`, `composition/worker-deps.ts`. (`worker/cycle.ts` does not exist — absent, as documented.)

## Deviations from Design

None — implementation matches design.md (A1 additive port, `state = ANY($2)` binding the declarative set, insertion order via `ORDER BY id ASC` / Map iteration, guard-before-read parity, 009 `(company_id, state)` index).

## Issues Found

1. Pre-existing flake, NOT caused by this batch: `business-pg-roundtrip.integration.test.ts` — "two concurrent terminal closes on the same key issue EXACTLY ONE receipt" intermittently fails with `duplicate key value violates unique constraint "idempotency_journal_attempt_id_key"` (known ON CONFLICT vs secondary UNIQUE(attempt_id) race). Passes in isolation and on full sequential rerun (40/40). Untouched by this PR.
2. Interface cascade (documented above): port extension requires app test-double stubs. Required by design A1; precedent `da494ae`.

## Next Recommended

`sdd-apply` PR 2 batch (tasks 2.1–2.7) after this PR1 candidate is reviewed/merged — or `sdd-verify` on the full change once PR2 lands. PR 2 adds `app/src/dispatch/*` + `composition/supervisor-dispatch.ts` and re-checks the same byte-identity list.
