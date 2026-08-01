# Apply Progress: first-skill — PR1 (packages/business-domain)

- Status: PR1 DONE (tasks 1.1–1.6), changes uncommitted in working tree (review-gated commit deferred to orchestrator).
- Mode: **Strict TDD** (RED → GREEN → TRIANGULATE → REFACTOR per task).
- Batch: FIRST apply batch — no prior apply-progress to merge.
- Scope: PR1 only (`packages/business-domain`). PR2 (`packages/database`) NOT implemented.
- Chain: auto-chain / stacked-to-main; this batch is PR1, budget ≤400 lines.

## Completed Tasks

- [x] 1.1 Skill type + SkillScope (R1) — `types.ts`
- [x] 1.2 isSkillState lifecycle guard (R4) — `skill-activation.ts` (new)
- [x] 1.3 SkillRepository versioned port (R2) — `ports/repositories.ts`
- [x] 1.4 InMemorySkillRepository fake (R3, R2, R7) — `ports/fakes.ts`
- [x] 1.5 activeSkillsFor pure cohort-safe activation (R5, R4) — `skill-activation.ts`
- [x] 1.6 Exports + isolation (R1, R8) — `index.ts`

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `bd/test/skill.test.ts` | Unit | ✅ 174/174 (package) | ✅ tsc RED (missing Skill types) | ✅ 4 tests | ✅ 3 cases (equal/differ/SkillState union) | ✅ Clean |
| 1.2 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (module missing) | ✅ 3 tests | ✅ 7 invalid strings + narrowing | ✅ Clean |
| 1.3 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (SkillRepository missing) | ✅ 2 tests | ✅ 2 cases (exact surface + conforming impl) | ✅ Clean |
| 1.4 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (fake missing, 9 failing) | ✅ 9 tests | ✅ v1+v2/dup/tenant/empty-companyId | ✅ Clean |
| 1.5 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (activeSkillsFor missing, 9 failing) | ✅ 9 tests | ✅ repeat/purity/state/scope/company/max-version/ASC/empty | ✅ Clean |
| 1.6 | `bd/test/skill.test.ts` | Unit | ✅ above | ✅ RED (index exports missing) | ✅ 4 tests | ✅ functional-via-index + 3 isolation checks | ✅ Clean (biome import-order) |

### Test Summary

- **Total tests written**: 31 (all in `bd/test/skill.test.ts`)
- **Total tests passing**: 31/31
- **Layers used**: Unit (31)
- **Approval tests** (refactoring): None — no refactoring tasks (existing files only extended)
- **Pure functions created**: 3 (`isSkillState`, `activeSkillsFor`; `requireCompanyId` reused)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain` → Test Files 9 passed (9), Tests **205 passed (205)** (174 baseline + 31 new) |
| Runtime harness command/scenario and exact result | N/A — pure domain types + in-memory fake; no I/O/process boundary (segment-7 consumer deferred to a later slice) |
| Rollback boundary | Revert PR1: remove `skill-activation.ts`, `test/skill.test.ts`, the Skill additions in `types.ts`/`ports/repositories.ts`/`ports/fakes.ts`/`index.ts`; nothing outside `bd` depends on it |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/types.ts` | Modified | `SkillState`, `SkillScope`, `Skill` (9 design fields, plain caller-supplied literals) |
| `packages/business-domain/src/skill-activation.ts` | Created | `isSkillState` guard + `SkillCohort` + pure `activeSkillsFor(cohort, skills)` |
| `packages/business-domain/src/ports/repositories.ts` | Modified | `SkillRepository` versioned append-only port (`save\|get\|listByCompany`) |
| `packages/business-domain/src/ports/fakes.ts` | Modified | `InMemorySkillRepository` — ordered-array versioned storage, dup-triple reject, tenant get/list, `requireCompanyId` |
| `packages/business-domain/src/index.ts` | Modified | Exports Skill/port/fake/`isSkillState`/`activeSkillsFor`/`SkillCohort` |
| `packages/business-domain/test/skill.test.ts` | Created | 31 unit tests (1.1–1.6) incl. cache-poisoning inverse, tenant isolation, zero `@io/*` imports, zero deps, segment-7 ABSENT |

## Gate Result

- PR1 focused: **9 files / 205 tests PASS** (`pnpm vitest run packages/business-domain`)
- Full gate `PATH=/data/node24/bin:$PATH pnpm check`: **GREEN** — Test Files 70 passed | 3 skipped (73); Tests **899 passed | 6 skipped (905)** (baseline ~868 + 31 new).
- `biome check --write` applied to the 6 PR1 files only (import-order in `index.ts`); no untouched files reformatted.
- `pnpm typecheck` (tsc): clean, zero errors.

## Pre-existing Flaky Test (not caused by PR1)

`packages/database/test/business-pg-roundtrip.integration.test.ts` — "two concurrent terminal closes on the same key issue EXACTLY ONE receipt and bump the version once (no throw)" (line 748) is a live-PG race test that intermittently throws `duplicate key value violates unique constraint "idempotency_journal_attempt_id_key"` on the concurrent loser's INSERT. Proven pre-existing: on CLEAN main (PR1 changes stashed) it failed 2/3 isolated runs; with PR1 present it passed 2/3. PR1 only adds additive `business-domain` exports and does not touch the journal/use-case path. The gate ultimately landed GREEN on re-run. Recommend flagging the race for a later fix (outside PR1/PR2 scope).

## Deviations from Design

- None — implementation matches `design.md`. `SkillCohort` is exported as a named interface for the activation signature (design shows the shape inline; behavior identical, and the signature still admits ONLY `(cohort, skills)`).

## Remaining (PR2 — next batch)

- [ ] 2.1 `db/sql/007_skills.sql` DDL (R6)
- [ ] 2.2 `parseSkillRow` guard (R6)
- [ ] 2.3 `PgSkillRepository` INSERT-only adapter + exports (R6, R2, R7)
- [ ] 2.4 Live-PG sequential round-trip (R6, R2, R7)

## Status

6/6 PR1 tasks complete. Ready for review-gated commit of PR1, then `sdd-apply` batch 2 (PR2) or `sdd-verify` after PR2.
