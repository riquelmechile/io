# Apply Progress: first-skill — PR1 + PR2 (ALL 10 tasks)

- Status: **PR1 + PR2 DONE (tasks 1.1–2.4)**, changes uncommitted in working tree (review-gated commit deferred to orchestrator).
- Mode: **Strict TDD** (RED → GREEN → TRIANGULATE → REFACTOR per task).
- Batch: TWO apply batches — batch 1 (PR1, business-domain) + batch 2 (PR2, database). This file MERGES both into the cumulative state.
- Scope: PR1 `packages/business-domain`; PR2 `packages/database`. `packages/app`, `packages/context` untouched.
- Chain: auto-chain / stacked-to-main; PR1 and PR2 each ≤400 lines.

## Completed Tasks

- [x] 1.1 Skill type + SkillScope (R1) — `types.ts`
- [x] 1.2 isSkillState lifecycle guard (R4) — `skill-activation.ts` (new)
- [x] 1.3 SkillRepository versioned port (R2) — `ports/repositories.ts`
- [x] 1.4 InMemorySkillRepository fake (R3, R2, R7) — `ports/fakes.ts`
- [x] 1.5 activeSkillsFor pure cohort-safe activation (R5, R4) — `skill-activation.ts`
- [x] 1.6 Exports + isolation (R1, R8) — `index.ts`
- [x] 2.1 007_skills.sql DDL (R6) — `db/sql/007_skills.sql` (new)
- [x] 2.2 parseSkillRow guard (R6) — `db/src/row-guards.ts`
- [x] 2.3 PgSkillRepository INSERT-only adapter + exports (R6, R2, R7) — `db/src/skill-adapter.ts` (new), `db/src/index.ts`
- [x] 2.4 Live-PG sequential round-trip (R6, R2, R7) — `db/test/skill-roundtrip.integration.test.ts` (new)

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `bd/test/skill.test.ts` | Unit | ✅ 174/174 (package) | ✅ tsc RED (missing Skill types) | ✅ 4 tests | ✅ 3 cases (equal/differ/SkillState union) | ✅ Clean |
| 1.2 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (module missing) | ✅ 3 tests | ✅ 7 invalid strings + narrowing | ✅ Clean |
| 1.3 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (SkillRepository missing) | ✅ 2 tests | ✅ 2 cases (exact surface + conforming impl) | ✅ Clean |
| 1.4 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (fake missing, 9 failing) | ✅ 9 tests | ✅ v1+v2/dup/tenant/empty-companyId | ✅ Clean |
| 1.5 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (activeSkillsFor missing, 9 failing) | ✅ 9 tests | ✅ repeat/purity/state/scope/company/max-version/ASC/empty | ✅ Clean |
| 1.6 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (index exports missing) | ✅ 4 tests | ✅ functional-via-index + 3 isolation checks | ✅ Clean (biome import-order) |
| 2.1 | `db/test/sql-migrations.test.ts` | Unit | ✅ 14/14 (file) | ✅ RED (007 absent, 4 failing) | ✅ 4 tests | ✅ 3 DDL shapes + IF NOT EXISTS scan | ✅ Clean (mirrors 006 block) |
| 2.2 | `db/test/row-guards.test.ts` | Unit | ✅ 8/8 (file) | ✅ RED (parseSkillRow missing, 4 failing) | ✅ 4 tests | ✅ boundary schemaVersion=1 + 3 states + 28 corrupt rows | ✅ Clean (mirrors event guard) |
| 2.3 | `db/test/boundary.test.ts` | Unit | ✅ 52/52 (file) | ✅ RED (adapter+exports missing, 4 failing) | ✅ 4 tests | ✅ INSERT 9 cols / NO UPDATE-DELETE / exact surface / exports | ✅ Clean (biome import-order) |
| 2.4 | `db/test/skill-roundtrip.integration.test.ts` | Integration | N/A (new) | ✅ Written (live PG; adapter bugs would fail) | ✅ 9 tests, 1st run | ✅ v1+v2/order/cross-tenant/empty/dup-triple + raw-guard | ✅ Clean (biome import-order) |

### Test Summary

- **Total tests written**: PR1 31 + PR2 21 = **52** (all passing); +2 auto-generated boundary-loop tests for the new `src/skill-adapter.ts` file (per-file forbidden-import + kernel type-only checks) → **23 net-new** on the gate.
- **Total tests passing**: 52/52 authored (PR2 21/21)
- **Layers used**: Unit (31 + 16), Integration/live-PG (9)
- **Approval tests** (refactoring): None — no refactoring tasks (existing files only extended)
- **Pure functions created**: `parseSkillRow` (row guard); `isSkillState` reused from business-domain (design "PG reuses")

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result (PR1) | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain` → Test Files 9 passed (9), Tests **205 passed (205)** (174 baseline + 31 new) |
| Focused test command and exact result (PR2) | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/database` → Test Files **14 passed \| 1 skipped (15)**, Tests **256 passed \| 1 skipped (257)** (pre-existing pg-required CI-only skip) |
| Runtime harness command/scenario and exact result (PR2) | Live PG `postgresql://io:io_dev@localhost:5432/io_dev` (PostgreSQL 18.4, docker `io_pg`) — 9 integration tests ran against REAL PG: 007 applied, INSERT/UNIQUE/ORDER BY/TRUNCATE exercised; `describe.skipIf(!reachable)` verified reachable |
| Rollback boundary | Revert PR2: drop `sql/007_skills.sql`, `src/skill-adapter.ts`, `parseSkillRow` + exports, `test/skill-roundtrip.integration.test.ts`, and the 007/guard/adapter additions in `sql-migrations.test.ts`/`row-guards.test.ts`/`boundary.test.ts`; `skill` table is additive, PR1 stays intact |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/types.ts` | Modified | `SkillState`, `SkillScope`, `Skill` (9 design fields, plain caller-supplied literals) |
| `packages/business-domain/src/skill-activation.ts` | Created | `isSkillState` guard + `SkillCohort` + pure `activeSkillsFor(cohort, skills)` |
| `packages/business-domain/src/ports/repositories.ts` | Modified | `SkillRepository` versioned append-only port (`save\|get\|listByCompany`) |
| `packages/business-domain/src/ports/fakes.ts` | Modified | `InMemorySkillRepository` — ordered-array versioned storage, dup-triple reject, tenant get/list, `requireCompanyId` |
| `packages/business-domain/src/index.ts` | Modified | Exports Skill/port/fake/`isSkillState`/`activeSkillsFor`/`SkillCohort` |
| `packages/business-domain/test/skill.test.ts` | Created | 31 unit tests (1.1–1.6) incl. cache-poisoning inverse, tenant isolation, zero `@io/*` imports, zero deps, segment-7 ABSENT |
| `packages/database/sql/007_skills.sql` | Created | `skill` table: 10 NOT NULL columns, `uq_skill_company_skill_version UNIQUE(company_id, skill_id, version)`, `idx_skill_company_id`, all IF NOT EXISTS |
| `packages/database/src/skill-adapter.ts` | Created | `PgSkillRepository` — `constructor(conn: DbConnection)`; INSERT-only `save` (9 cols, `JSON.stringify(scope)`, empty-companyId pre-SQL reject); `get` `ORDER BY version DESC LIMIT 1`; `listByCompany` `ORDER BY skill_id, version`; both map `parseSkillRow` |
| `packages/database/src/row-guards.ts` | Modified | `parseSkillRow` guard — non-empty ids/name/body, version≥1, numeric timestamps, state via `isSkillState`, scope `{process, schemaVersion≥1}` |
| `packages/database/src/index.ts` | Modified | Exports `PgSkillRepository` + `parseSkillRow` |
| `packages/database/test/skill-roundtrip.integration.test.ts` | Created | 9 live-PG tests (2.4): v1+v2 get=v2 + raw-guard round-trip, ORDER BY skill_id/version, cross-tenant, empty companyId, dup-triple UNIQUE, TRUNCATE beforeEach, `describe.skipIf(!reachable)` |
| `packages/database/test/sql-migrations.test.ts` | Modified | 007 DDL block (4 tests) |
| `packages/database/test/row-guards.test.ts` | Modified | `parseSkillRow` block (4 tests) |
| `packages/database/test/boundary.test.ts` | Modified | skill-adapter INSERT-only + exact-surface + exports assertions (4 tests); public-surface namespace now includes `PgSkillRepository` + `parseSkillRow` |

## Gate Result

- PR2 focused (sequential): **15 files, 256 passed | 1 skipped** (`pnpm vitest run --no-file-parallelism packages/database`). The 1 skipped is the pre-existing CI-only `pg-required.integration.test.ts` — NOT caused by PR2.
- Full gate `PATH=/data/node24/bin:$PATH pnpm check`: **GREEN** — Test Files **71 passed | 3 skipped (74)**, Tests **922 passed | 6 skipped (928)** (PR1 baseline 899 passed | 6 skipped + 23 net-new).
- `biome check --write` applied to the 7 PR2 files only (import-order in `skill-roundtrip.integration.test.ts` + `row-guards.ts`); no untouched files reformatted.
- `pnpm typecheck` (tsc) + `pnpm build`: clean, zero errors.

## Pre-existing Flaky Test (not caused by PR1/PR2)

`packages/database/test/business-pg-roundtrip.integration.test.ts` — "two concurrent terminal closes on the same key issue EXACTLY ONE receipt and bump the version once (no throw)" (line 748) is a live-PG race test that intermittently throws `duplicate key value violates unique constraint "idempotency_journal_attempt_id_key"` on the concurrent loser's INSERT. Proven pre-existing on clean main (PR1 stashed). PR2 does not touch the journal/use-case path. The `pnpm check` parallel run landed GREEN this batch (the flake did not trip); the sequential run remains the sanctioned proof. Recommend flagging the race for a later fix (outside PR1/PR2 scope).

## Deviations from Design

- None — implementation matches `design.md`. `parseSkillRow` reuses the domain `isSkillState` guard exactly as the design's "State guard — PG reuses" decision prescribes (database src already imports business-domain values in `idempotency-adapter.ts`/`complete-work-flow.ts`, so this is consistent with the package's coupling rules).

## Status

**10/10 tasks complete (PR1 6/6 + PR2 4/4).** Ready for review-gated commit of PR1 and PR2, then `sdd-verify`.
