# Tasks: first-skill — Versioned Skill + Cohort-Safe Activation

Path shorthand: `bd/` = `packages/business-domain`, `db/` = `packages/database`. Strict TDD: every task is RED (failing test) → GREEN (minimal code); tests ship with code. Runner `PATH=/data/node24/bin:$PATH pnpm vitest run <path>` (the `pnpm --filter @io/<pkg> test` form is a silent no-op here); gate `PATH=/data/node24/bin:$PATH pnpm check`. PG tests run sequentially (`--no-file-parallelism`). Baseline main@de154e5, ~868 tests.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~580–740 total (PR1 ~280–360, PR2 ~300–380) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 (stacked to main) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

Each PR slice is budgeted ≤400 lines; the combined change exceeds 400, so it ships as two stacked PRs (auto-chain proceeds with PR1 first, no pre-apply decision needed).

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----------------------|-----------------|-------------------|
| 1 | Skill type/port/fake/activation + unit tests | PR1 | `pnpm vitest run bd/test/skill.test.ts` | N/A — pure domain + in-memory fake; no I/O/process boundary (segment-7 consumer deferred) | Revert PR1: removes Skill types, `skill-activation.ts`, port/fake, exports, `skill.test.ts`; nothing outside `bd` depends on it |
| 2 | 007 DDL + INSERT-only adapter + guard + PG tests | PR2 | `pnpm vitest run --no-file-parallelism db/test/skill-roundtrip.integration.test.ts` | Live PG `postgresql://io:io_dev@localhost:5432/io_dev` (sequential; skips if unreachable) | Revert PR2: drops `007_skills.sql`, `skill-adapter.ts`, `parseSkillRow`, exports, test edits; skill table is additive, PR1 stays intact |

## PR1 — business-domain (pure Skill + versioned port/fake + activation)

- [x] 1.1 **Skill type + SkillScope** (R1) — `bd/src/types.ts`, `bd/test/skill.test.ts` (new). RED: Skill has exactly the 9 design fields; two Skills from identical values are equal; differ when values differ. GREEN: add `SkillState`, `SkillScope`, `Skill` (plain literals; no clocks/ids). Verify: `pnpm vitest run bd/test/skill.test.ts`.
- [x] 1.2 **isSkillState lifecycle guard** (R4) — `bd/src/skill-activation.ts` (new), `bd/test/skill.test.ts`. RED: accepts `draft|active|retired`, rejects every other string. GREEN: add `isSkillState`. Verify: same.
- [x] 1.3 **SkillRepository versioned port** (R2) — `bd/src/ports/repositories.ts`, `bd/test/skill.test.ts`. RED: type-level surface is EXACTLY `save|get|listByCompany` (no update/delete); a conforming impl works. GREEN: add `SkillRepository` (append save, latest get, tenant `listByCompany`). Verify: same.
- [x] 1.4 **InMemorySkillRepository fake** (R3, R2, R7) — `bd/src/ports/fakes.ts`, `bd/test/skill.test.ts`. RED: v1+v2 → get=v2 and both listed; dup `(companyId,skillId,version)` rejected, original kept; interleaved A/B isolated; empty companyId rejected. GREEN: ordered-array fake, `requireCompanyId`, dup-triple reject, tenant get/list. Verify: same.
- [x] 1.5 **activeSkillsFor — pure cohort-safe activation** (R5, R4) — `bd/src/skill-activation.ts`, `bd/test/skill.test.ts`. RED: same cohort ⇒ identical identities+versions on repeat; identical skills+cohort under differing work/dynamic-tail ⇒ identical selection; only `active` selected; scope (process+schemaVersion) match; max version per skillId; skillId ASC. GREEN: filter active+company+scope, collapse max(version)/skillId, sort skillId ASC — signature `(cohort, skills)` admits nothing else. Verify: same.
- [x] 1.6 **Exports + isolation** (R1, R8) — `bd/src/index.ts`, `bd/test/skill.test.ts`. RED: index exports Skill/port/fake/`isSkillState`/`activeSkillsFor` (functional via index); src has ZERO `@io/*` imports; package.json zero runtime/dev deps; `packages/context` untouched ⇒ `compileContext` bytes and segment-7 ABSENT unchanged. GREEN: add the exports. Verify: `pnpm vitest run bd/test/skill.test.ts`, then gate `pnpm check`.

## PR2 — database (INSERT-only PG persistence)

- [ ] 2.1 **007_skills.sql DDL** (R6) — `db/sql/007_skills.sql` (new), `db/test/sql-migrations.test.ts`. RED: 007 ships; `skill` columns all NOT NULL (id SERIAL PK; skill_id/company_id/name/body/state TEXT; version INTEGER; scope JSONB; created_at/updated_at BIGINT); `uq_skill_company_skill_version UNIQUE(company_id, skill_id, version)`; `idx_skill_company_id ON (company_id)`; IF NOT EXISTS on every statement. GREEN: write 007. Verify: `pnpm vitest run db/test/sql-migrations.test.ts`.
- [ ] 2.2 **parseSkillRow guard** (R6) — `db/src/row-guards.ts`, `db/test/row-guards.test.ts`. RED: a valid row (9 fields; scope `{process, schemaVersion≥1}`) ⇒ ok; reject empty ids/name/body, version<1, non-number timestamps, state∉set, bad scope ⇒ `{ok:false,reason}`. GREEN: add `parseSkillRow` (reuse `isNonEmptyString`/`isPositiveInteger`/`isPlainObject`). Verify: `pnpm vitest run db/test/row-guards.test.ts`.
- [ ] 2.3 **PgSkillRepository INSERT-only adapter + exports** (R6, R2, R7) — `db/src/skill-adapter.ts` (new), `db/src/index.ts`, `db/test/boundary.test.ts`. RED: skill-adapter ships; SQL has `INSERT INTO skill` (9 cols); NO UPDATE/DELETE; class surface EXACTLY `save|get|listByCompany`; index exports `PgSkillRepository`+`parseSkillRow`. GREEN: `constructor(conn: DbConnection)`; save INSERT 9 cols (`JSON.stringify(scope)`), empty companyId pre-SQL reject; get `ORDER BY version DESC LIMIT 1`; list `ORDER BY skill_id, version`; map `parseSkillRow`; export. Verify: `pnpm vitest run db/test/boundary.test.ts`.
- [ ] 2.4 **Live-PG sequential round-trip** (R6, R2, R7) — `db/test/skill-roundtrip.integration.test.ts` (new). RED/GREEN: apply 007; save v1+v2 → get=v2 and both round-trip byte-identical via `parseSkillRow`; list `ORDER BY skill_id, version`; cross-tenant A≠B; empty companyId reject; dup triple rejected by UNIQUE, original kept; `describe.skipIf(!reachable)`; TRUNCATE beforeEach. Verify (sequential): `pnpm vitest run --no-file-parallelism db/test/skill-roundtrip.integration.test.ts`, then gate `pnpm check`.

### Requirement → task map
R1→1.1,1.6 · R2→1.3,1.4,2.3,2.4 · R3→1.4 · R4→1.2,1.5 · R5→1.5 · R6→2.1,2.2,2.3,2.4 · R7→1.4,2.3,2.4 · R8→1.6. All 10 scenarios covered: S1.1→1.1/1.6; S2.1→1.4/2.4; S3.1→1.4; S4.1→1.2/1.5; S5.1,S5.2→1.5; S6.1→2.4; S6.2→2.2/2.3; S7.1→1.4/2.4; S8.1→1.6.
