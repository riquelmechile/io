# Tasks: Wire Active Skills into Context Segment 7

Strict TDD: every task is RED (failing test) → GREEN (minimal code); tests ship with code.
Delivery: 2 stacked PRs to main (`auto-chain`). Baseline main@f9bd5d9, ~922 tests.
Runner: `PATH=/data/node24/bin:$PATH pnpm vitest run <path>` (the `--filter @io/<pkg> test` form is a silent no-op). PG tests: add `--no-file-parallelism`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~230–280 authored total (PR1 ~150–180, PR2 ~80–100); +1 generated golden excluded from authored count |
| 400-line budget risk | Low (each PR well under 400) |
| Chained PRs recommended | Yes (design: 2 stacked PRs for review focus + clean rollback) |
| Suggested split | PR1 (@io/context) → PR2 (@io/app + skill R7) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----------------------|-----------------|-------------------|
| 1 | `@io/context` seg-7 render + v2 + golden + boundary + cohort/inverse/compiler tests | PR1 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/context/test/` | N/A — pure I/O-free compiler; byte-stability proven by golden pin + inverse-poison tests (no runtime boundary by design) | Revert PR1 ⇒ `CONTEXT_SCHEMA_VERSION=1`, ABSENT seg-7, `prefix.v1.golden.txt` bytes; touches `packages/context/src/{segments,index}.ts` + fixtures only |
| 2 | `@io/app` worker seam + harness/tests + `skill.test.ts` R7 rewrite | PR2 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/worker-intent.test.ts packages/app/test/composition/worker-deps.test.ts packages/business-domain/test/skill.test.ts` | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/worker-e2e.integration.test.ts` (live PG cycle; empty tenant ⇒ seg-7 ABSENT) | Revert PR2 removes `WorkerDeps.skills` + fetch + R7 rewrite; PR1 render stays (harmless without seam) |

## Phase 1 — PR1: `@io/context` render + schema bump

- [x] 1.1 **Schema bump + relocate const** (R6 S1) — files: `src/segments.ts`, `src/index.ts`, `test/cohort.test.ts`. RED: `cohort.test.ts:41-42` expect `CONTEXT_SCHEMA_VERSION===2` and `io:acme:planning:v2` (also flip `:v1` literals at :26/:38). GREEN: define `CONTEXT_SCHEMA_VERSION=2` in `segments.ts`, re-export from `index.ts` (drop local const :19) — avoids segments↔index cycle. Verify: `pnpm vitest run packages/context/test/cohort.test.ts`.
- [x] 1.2 **Seg-7 render + `skills?` input** (R1 S1/S2/S3, skill R7 S1) — files: `src/segments.ts`, `test/context-compiler.test.ts`. RED: new cases — matching skills render fixed fields `{skillId,name,version,body}` skillId ASC; insertion-order ⇒ byte-identical; empty ⇒ ABSENT. GREEN: add `skills?: readonly Skill[]` to `CompileContextInput`; value-import `activeSkillsFor` + type `Skill`; `renderActiveSkills` passes ONLY `{companyId,process,schemaVersion:CONTEXT_SCHEMA_VERSION}`; wire seg-7 (`segments.ts:189`). Verify: `pnpm vitest run packages/context/test/context-compiler.test.ts`.
- [x] 1.3 **Boundary relaxation (BD-only)** (skill R7 S1 deps) — files: `test/boundary.test.ts`. RED: type-only assertion (:134 `^import\s+type\s`) fails on the new `activeSkillsFor` value import. GREEN: drop that assertion; keep `^@io/business-domain/` match (:128) + forbidden specifiers (:18-40); comment BD = single allowed RUNTIME dep. Verify: `pnpm vitest run packages/context/test/boundary.test.ts`.
- [x] 1.4 **Golden regeneration (ISOLATED, deterministic)** (R6 S2/S3) — files: `test/prefix-stability.test.ts`, `test/fixtures/prefix.v2.golden.txt` (create). RED: golden pin (:52) reads `prefix.v2.golden.txt` ⇒ ENOENT. GREEN: skills-bearing seed (one active skill `{companyId:'acme',process:'planning',scope.schemaVersion:2}`); one-shot write `buildStablePrefix(seed)` → `prefix.v2.golden.txt` — NEVER hand-edit; keep `prefix.v1.golden.txt` historical. Verify: `pnpm vitest run packages/context/test/prefix-stability.test.ts`.
- [x] 1.5 **Inverse cache-poisoning proof (ISOLATED)** (R2 S1/S2/S3, skill R7 S2) — files: `test/prefix-stability.test.ts`. RED: add cases — same cohort+store, vary work/delegation/dynamic-tail/insertion-order/non-matching entries (other company/process/schemaVersion/draft/retired/older) + double compile ⇒ byte-identical prefix incl. seg-7. GREEN: pure render from 1.2 ⇒ identical bytes. Then full PR1 gate. Verify: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/context/test/`.

## Phase 2 — PR2: `@io/app` worker seam + skill R7

- [x] 2.1 **`WorkerDeps.skills` port + wiring** (skill R7 S1) — files: `src/worker/types.ts`, `src/composition/worker-deps.ts`, `test/worker-helpers.ts`, `test/composition/worker-deps.test.ts`. RED: `worker-deps.test.ts` asserts `deps.skills instanceof PgSkillRepository`. GREEN: add required `skills: SkillRepository` (type-only import BD `ports/repositories.js`); wire `new PgSkillRepository(connection)`; harness adds `new InMemorySkillRepository()` (both pre-exist). Verify: `pnpm vitest run packages/app/test/composition/worker-deps.test.ts`.
- [x] 2.2 **Intent pass-through + `:v1`→`:v2` churn** (skill R7 S1, R6 S1) — files: `src/worker/intent.ts`, `test/worker-intent.test.ts`. RED: flip `:v1`→`:v2` at `worker-intent.test.ts:69` (`io:acme:low-risk-documents`) and `:90` (`io:acme:onboarding`); add skills pass-through assert. GREEN: `IntentInput.skills?: readonly Skill[]`; pass `skills` into `compileContext` (`intent.ts:53`). Verify: `pnpm vitest run packages/app/test/worker-intent.test.ts`.
- [x] 2.3 **Worker fetch-once after authority** (skill R7 S1 read-only) — files: `src/worker/worker.ts`, `test/worker-intent.test.ts`. RED: harness-seeded matching skill ⇒ recorded LLM request system msg contains seg-7 block; `listByCompany(companyId)` called once. GREEN: in `runWorker`, after authority OK (`worker.ts:136`) before `prepareIntent` (:140): `const skills = await deps.skills.listByCompany(cmd.companyId)`; pass into `prepareIntent`. Verify: `pnpm vitest run packages/app/test/worker-intent.test.ts`.
- [x] 2.4 **`skill.test.ts` R7 rewrite** (skill R7 S1/S2/S3) — files: `packages/business-domain/test/skill.test.ts`. RED: rewrite the R8 "seg-7 ABSENT" test (:407-433) to new contract — matching skills render into prefix; non-matching filtered; empty/`undefined` ⇒ seg-7 ABSENT; deps BD-only. GREEN: aligns to PR1 render (production code already in `segments.ts`). Verify: `pnpm vitest run packages/business-domain/test/skill.test.ts`.
- [x] 2.5 **Churn sweep + full sequential gate** (all reqs) — files: none new (sweep). Verify no remaining hard-coded `:v1` cohort asserts / `schemaVersion:1` PRESENT-skill fixtures; confirm `worker-e2e.integration.test.ts:145` passes unchanged (no skills ⇒ seg-7 ABSENT ⇒ v1 golden bytes). Run `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism` then `PATH=/data/node24/bin:$PATH pnpm check` (green ~922+). Spec deltas archive with the change (already authored).

## Scenario → Task Map

- context-compiler R1 (S1 order / S2 deterministic / S3 empty ABSENT): 1.2
- context-compiler R2 (S1 work / S2 leak / S3 inverse poison seg-7): 1.5
- context-compiler R6 (S1 bump / S2 silent-change ban / S3 v2 golden): 1.1 / 1.4 / 1.4
- skill R7 (S1 render+deps / S2 inverse / S3 absence): 1.2+1.3+2.1–2.4 / 1.5+2.4 / 1.2+2.4

## Invariants honored

Cohort rule: seg-7 passes ONLY `{companyId,process,schemaVersion}`. `CONTEXT_SCHEMA_VERSION=2`; golden regenerated, never hand-edited; silent-change pin preserved. `@io/context` deps stay exactly `@io/business-domain`; BD zero `@io/*`; `openai` confined to `llm-client`; no new runtime deps. Empty ⇒ ABSENT; append-only read-only. Out of scope: heartbeats, skill execution, BusinessEvents, learning/promotion, Memory OS.
