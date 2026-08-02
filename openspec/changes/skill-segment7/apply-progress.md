# Apply Progress: skill-segment7 — MERGED PR1 + PR2 (ALL 10 TASKS COMPLETE)

- Change: `skill-segment7` · Project: io · Batch: 1/2 (PR1) + 2/2 (PR2) — ALL TASKS DONE · Status: 1.1–1.5 + 2.1–2.5 COMPLETE
- Mode: Strict TDD (RED → GREEN per task, demonstrated on the real runner)
- Delivery: `auto-chain` / `stacked-to-main` — PR1 (`@io/context`) implemented (committed locally, NOT pushed); PR2 (`@io/app` worker seam + skill R7 rewrite) implemented (uncommitted, review-gated commit by orchestrator)
- Runner: `PATH=/data/node24/bin:$PATH pnpm vitest run <path>` (the `--filter @io/<pkg> test` form is a silent no-op — verified)
- Baseline: main@f9bd5d9, clean tree, ~922 tests passing sequentially; PR1 commit `64ff904` (local)
- Final gate: **`pnpm check` GREEN — 936 passed | 6 skipped** (red-window CLOSED)

## Completed Tasks (ALL)

### PR1 (Batch 1 — `@io/context`)

- [x] 1.1 Schema bump + relocate const (R6 S1) — `CONTEXT_SCHEMA_VERSION` 1→2 defined in `segments.ts`, re-exported from `index.ts` (local const at index.ts:19 dropped — avoids segments↔index cycle). `cohort.test.ts` updated: `=== 2`, `io:acme:planning:v2`, `:v1` literals at :26/:38 flipped to v2.
- [x] 1.2 Seg-7 render + `skills?` input (R1 S1/S2/S3, skill R7 S1) — `skills?: readonly Skill[]` on `CompileContextInput`; value-import `activeSkillsFor` + type `Skill` from `@io/business-domain/src/index.js`; `renderActiveSkills` passes ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}` into `activeSkillsFor`; fixed multi-line template `Active skills:\n- id=<skillId> name=<name> v=<version>\n<body>` joined with `\n`; empty ⇒ ABSENT (zero bytes); seg 7 wired (`render: renderActiveSkills`). Tests: skillId ASC, fixed-fields-only (metadata never leaks), insertion-order byte-identical, empty/undefined ABSENT.
- [x] 1.3 Boundary relaxation (BD-only) (skill R7 S1 deps) — dropped the `^import\s+type\s` assertion at boundary.test.ts:134; kept the `^@io/business-domain/` match + forbidden specifiers (:18-40); comments updated: BD = single allowed RUNTIME dep (matches manifest).
- [x] 1.4 Golden regeneration (ISOLATED, deterministic) (R6 S2/S3) — `test/fixtures/prefix.v2.golden.txt` (538 bytes) generated via a ONE-SHOT write of the real `buildStablePrefix(seed)` (temporary vitest file, deleted after one run — NEVER hand-edited). Seed = one active skill `{companyId:'acme', process:'planning', scope:{process:'planning', schemaVersion:2}}`. `prefix.v1.golden.txt` kept historical. Pin test reads `prefix.v{CONTEXT_SCHEMA_VERSION}.golden.txt` → auto-picks v2.
- [x] 1.5 Inverse cache-poisoning proof (ISOLATED) (R2 S1/S2/S3, skill R7 S2) — same cohort+store; varied work / delegation / dynamic-tail / shuffled insertion order / non-matching entries (other company, other process, other schemaVersion, draft, retired, older version) + double compile ⇒ byte-identical prefix INCLUDING seg 7. Pre-existing `noDelegation` variant in the R2-inverse test updated to keep the tenant store (`{ ...seed, delegation: undefined }`) so seg 7 stays PRESENT on both sides.

### PR2 (Batch 2 — `@io/app` worker seam + skill R7)

- [x] 2.1 `WorkerDeps.skills` port + wiring (skill R7 S1) — required `skills: SkillRepository` on `WorkerDeps` (type-only import BD `ports/repositories.js`); composition root wires `skills: new PgSkillRepository(connection)`; harness `skills: new RecordingSkills()` (records `listByCompany` calls, delegates to `InMemorySkillRepository` — same store semantics as the plain fake, enables the fetch-once assert in 2.3); `worker-deps.test.ts` asserts `deps.skills instanceof PgSkillRepository`. Verify: worker-deps.test.ts **7 passed**.
- [x] 2.2 Intent pass-through + `:v1`→`:v2` churn (skill R7 S1, R6 S1) — flipped `worker-intent.test.ts:69` (`io:acme:low-risk-documents:v1→v2`) and `:90` (`io:acme:onboarding:v1→v2`) — CLOSES the accepted red-window; added skills pass-through assert (matching skill ⇒ `Active skills:` block in the system prefix). GREEN: `IntentInput.skills?: readonly Skill[]`; `compileContext` receives `skills: input.skills` (intent.ts:53). Verify: worker-intent.test.ts **10 passed** (incl. the 2 formerly-red asserts).
- [x] 2.3 Worker fetch-once after authority (skill R7 S1 read-only) — `runWorker` fetches `const skills = await deps.skills.listByCompany(cmd.companyId)` after authority OK, before `prepareIntent`, and passes it in. Tests: harness-seeded matching skill ⇒ recorded LLM request system msg contains the seg-7 block AND `listCalls === ['acme']` (called exactly once); revoked delegation ⇒ `denied` and `listCalls === []` (placement proof: fetch happens AFTER authority); raw-store pass-through (non-matching skill fetched once but filtered by the compiler ⇒ seg-7 ABSENT). Verify: worker-intent.test.ts **13 passed**.
- [x] 2.4 `skill.test.ts` R7 rewrite (skill R7 S1/S2/S3) — deleted the superseded R8 "segment 7 stays ABSENT" contract test (:407-433); added 4 new contract tests: matching active skills render exact bytes into the prefix (skillId ASC, fixed fields); non-matching/inactive filtered (draft/retired/other-company/wrong-process/wrong-schemaVersion); empty/`undefined` ⇒ seg-7 ABSENT (zero bytes, `[] ≡ undefined`); byte-identical for same cohort+store. Deps BD-only still enforced by the existing zero-`@io/*`-src and zero-deps tests in the same file. PRESENT fixtures scope `schemaVersion: 2` (churn rule). Verify: skill.test.ts **34 passed** (31 − 1 superseded + 4 new).
- [x] 2.5 Churn sweep + full sequential gate (all reqs) — sweep: zero hard-coded `:v1` cohort asserts remain in `packages/`; no `schemaVersion:1` PRESENT-skill fixture (remaining `schemaVersion: 1` uses are pure-function `activeSkillsFor`/`deriveCohort` cohorts, the non-render `sampleSkill` default, and the deliberate `wrong-schema` NEGATIVE fixture). `worker-e2e.integration.test.ts:145` passes UNCHANGED (no skills ⇒ seg-7 ABSENT ⇒ v1 golden bytes). E2E harness MIGRATIONS extended with `007_skills.sql` (the seam's live-PG read needs the `skill` table — test-support only, database source untouched). Verify: full sequential `pnpm vitest run --no-file-parallelism` → **936 passed | 6 skipped**; `pnpm check` → **GREEN** (format ✅ typecheck ✅ build ✅ lint ✅ 936 passed | 6 skipped).

## TDD Cycle Evidence (Strict TDD)

| Task | RED (test first, watched fail) | GREEN (minimal code) | REFACTOR |
|------|-------------------------------|----------------------|----------|
| 1.1 | `cohort.test.ts` — 1 failed: `expected 1 to be 2` (const still 1) | const relocated+bumped to 2 in `segments.ts`, re-exported; cohort.test.ts green (8 passed) | None — minimal |
| 1.2 | `context-compiler.test.ts` — 2 failed: seg-7 render returned ABSENT (`present:false`, undefined text) | `skills?` input + value-import + `renderActiveSkills` + seg-7 wiring; context-compiler green (17 passed) | None |
| 1.3 | `boundary.test.ts` — 1 failed: `src/segments.ts: expected 'import { activeSkillsFor } …' to match /^import\s+type\s/` | Dropped type-only assertion, kept BD match + forbidden specifiers; boundary green (9 passed) | None |
| 1.4 | Golden pin: `ENOENT …/prefix.v2.golden.txt` (demonstrated pre-regen; full gate 3 failed incl. ENOENT) | One-shot generator wrote `prefix.v2.golden.txt` from real `buildStablePrefix(seed)`, deleted generator; pin green (prefix-stability 10 passed) | `noDelegation` variant now spreads seed to keep tenant store |
| 1.5 | 2 failed pre-GREEN: `expected '…Business process…' to contain 'Active skills:'` (seg 7 ABSENT in baseline) | Pure cohort render from 1.2 ⇒ identical bytes; 2 inverse tests green (10 passed file total) | None |
| 2.1 | `worker-deps.test.ts` — 1 failed: `expect(undefined).toBeInstanceOf(PgSkillRepository)` (deps.skills missing) | `WorkerDeps.skills` type port + `new PgSkillRepository(connection)` in composition root + harness `RecordingSkills`; worker-deps green (7 passed) | None — minimal |
| 2.2 | `worker-intent.test.ts` — red-window `:v1` asserts flipped to `:v2` (now green — compiler already derives v2); NEW skills pass-through assert FAILED: system msg lacked `Active skills:` (skills never reached compileContext) | `IntentInput.skills?` + pass `skills` into `compileContext`; worker-intent green (10 passed) | None |
| 2.3 | `worker-intent.test.ts` — 1 failed: `expect(listCalls).toEqual(['acme'])` got `[]` (worker never fetched) | `const skills = await deps.skills.listByCompany(cmd.companyId)` after authority OK, passed to `prepareIntent`; green (13 passed). TRIANGULATE: denied ⇒ `listCalls=[]` (placement); raw-store pass-through (non-matching ⇒ fetched once, compiler filters, seg-7 ABSENT) | None |
| 2.4 | Superseded R8 "seg-7 ABSENT" contract test deleted (its contract is now WRONG per the new spec); new-contract tests exercise PR1's shipped render — genuine RED proven in PR1 1.2 RED | New R7 tests (matching renders exact bytes / non-matching filtered / empty+undefined ABSENT / deterministic) green — production render already in `segments.ts` (PR1) | None — import cleanup (`CompileContextInput`, `SEGMENTS`, `SegmentId` dropped as unused) |
| 2.5 | Sweep: `rg "io:acme:.*:v1"` → 0 matches; `schemaVersion:1` only in pure-function/negative fixtures | E2E harness MIGRATIONS + `007_skills.sql` (live-PG seam read); full sequential gate GREEN | None |

## Work Unit Evidence (all modes)

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result (PR2 AUTHORITATIVE) | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/worker-intent.test.ts packages/app/test/composition/worker-deps.test.ts packages/business-domain/test/skill.test.ts` → **3 files passed, 54 tests passed** (GREEN) |
| Runtime harness command/scenario and exact result (PR2) | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/worker-e2e.integration.test.ts` → **1 passed** (live PG, `io_pg`; empty tenant ⇒ seg-7 ABSENT ⇒ v1 golden bytes — :145 unchanged). Full sequential `pnpm vitest run --no-file-parallelism` → **936 passed | 6 skipped** |
| Rollback boundary (PR2) | Revert PR2 ⇒ `WorkerDeps.skills` + fetch + R7 rewrite removed; PR1 render stays (harmless without the seam — `prepareIntent`/`compileContext` tolerate absent skills ⇒ seg-7 ABSENT). Touches `packages/app/src/worker/{types,intent,worker}.ts`, `packages/app/src/composition/worker-deps.ts`, 5 app/bd test files + `tasks.md`/apply-progress only |

## Files Created / Modified

### PR1 (Batch 1)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/context/src/segments.ts` | Modified | `CONTEXT_SCHEMA_VERSION=2` defined here; `skills?: readonly Skill[]` on input; value-import `activeSkillsFor` + type `Skill`; `renderActiveSkills` (cohort-pure, fixed template); seg 7 wired |
| `packages/context/src/index.ts` | Modified | Local const dropped; `CONTEXT_SCHEMA_VERSION` re-exported from `segments.js` (no segments↔index cycle) |
| `packages/context/test/cohort.test.ts` | Modified | `=== 2`, `io:acme:planning:v2`, `:v1` literals flipped |
| `packages/context/test/context-compiler.test.ts` | Modified | Seg-7 present/order/fixed-fields/insertion-order/empty-ABSENT cases (+`SegmentRender` type import) |
| `packages/context/test/boundary.test.ts` | Modified | BD value imports allowed (runtime dep); all other bans intact |
| `packages/context/test/prefix-stability.test.ts` | Modified | Skills-bearing seed; inverse-poison proof block; golden seed; `noDelegation` keeps tenant store |
| `packages/context/test/fixtures/prefix.v2.golden.txt` | Created | 538-byte deterministic regen (never hand-edited); `prefix.v1.golden.txt` kept historical |

### PR2 (Batch 2)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/app/src/worker/types.ts` | Modified | Required `skills: SkillRepository` on `WorkerDeps` (type-only import BD `ports/repositories.js`) |
| `packages/app/src/composition/worker-deps.ts` | Modified | `skills: new PgSkillRepository(connection)` (import added) |
| `packages/app/src/worker/intent.ts` | Modified | `IntentInput.skills?: readonly Skill[]`; `skills` passed into `compileContext` |
| `packages/app/src/worker/worker.ts` | Modified | Fetch-once `deps.skills.listByCompany(cmd.companyId)` after authority OK, before `prepareIntent`; skills passed in |
| `packages/app/test/worker-helpers.ts` | Modified | `RecordingSkills` double (wraps `InMemorySkillRepository`, records `listByCompany` calls); wired into `WorkerHarness`/`harness()` |
| `packages/app/test/composition/worker-deps.test.ts` | Modified | Asserts `deps.skills instanceof PgSkillRepository` |
| `packages/app/test/worker-intent.test.ts` | Modified | `:v1`→`:v2` flips (:69/:90); skills pass-through; fetch-once + seg-7 render; denied ⇒ no-fetch; raw-store pass-through (13 tests) |
| `packages/app/test/e2e/harness.ts` | Modified | MIGRATIONS + `007_skills.sql` (live-PG seam read — test-support only) |
| `packages/business-domain/test/skill.test.ts` | Modified | R8 ABSENT test deleted; 4 new R7 contract tests (exact bytes / filtered / ABSENT / deterministic); imports cleaned |
| `openspec/changes/skill-segment7/tasks.md` | Modified | 2.1–2.5 marked `[x]` (all 10 tasks now `[x]`) |
| `openspec/changes/skill-segment7/apply-progress.md` | Modified | This MERGED artifact (PR1+PR2) |

## Verification (run + report)

- **PR1 AUTHORITATIVE focused gate**: `pnpm vitest run packages/context/test/` → **GREEN — 5 files / 49 tests passed**.
- **PR2 AUTHORITATIVE focused gate**: `worker-intent.test.ts` + `worker-deps.test.ts` + `skill.test.ts` → **GREEN — 3 files / 54 tests passed**.
- **E2E (sequential, live PG)**: `pnpm vitest run --no-file-parallelism packages/app/test/e2e/worker-e2e.integration.test.ts` → **1 passed** (unchanged; :145 v1-golden-bytes proof holds with the seam wired).
- **Full sequential suite**: `pnpm vitest run --no-file-parallelism` → **936 passed | 6 skipped** (red-window CLOSED: was 927 passed | 2 failed | 6 skipped after PR1).
- **FULL gate**: `pnpm check` → **GREEN** — format-check ✅ typecheck ✅ build ✅ lint ✅ tests **936 passed | 6 skipped** (74 files: 71 passed | 3 skipped). Biome format fixed on 1 changed file (`skill.test.ts`) with `biome format --write` (changed files only).

## Accepted Red-Window — CLOSED (PR2)

- `worker-intest.test.ts:69`/`:90` hard-coded `:v1` asserts flipped to `:v2` (task 2.2) — cohorts now re-derive at `CONTEXT_SCHEMA_VERSION=2` end-to-end. Full gate green.

## Deviations from Design

- None functional. Implementation matches design.md (D5 worker seam: top-level `WorkerDeps.skills`, fetch-once after authority, raw store pass-through — compiler filters). One test-support addition beyond the design's file table: `packages/app/test/e2e/harness.ts` MIGRATIONS list gained `007_skills.sql` so live-PG cycles (now calling `listByCompany`) find the `skill` table. The design's file table listed `packages/app/test/worker-helpers.ts` with `InMemorySkillRepository`; implemented as `RecordingSkills` wrapping `InMemorySkillRepository` (same store, adds the call-recording the fetch-once assert needs — consistent with the existing `RecordingJournal`/`RecordingReceipts` pattern).

## Issues Found

1. PR1 (batch 1): `tsc` caught `SegmentRender` missing from the test type import in `context-compiler.test.ts` — fixed.
2. PR1 (batch 1): Pre-existing R2-inverse `noDelegation` variant dropped `skills` after the seed became skills-bearing — updated to `{ ...seed, delegation: undefined }`.
3. PR1 (batch 1): Biome format wanted `renderActiveSkills` params on one line and the delegation spread expanded — auto-fixed.
4. PR2 (batch 2): Live-PG `worker-deps.test.ts` cycle failed `relation "skill" does not exist` — the e2e harness migration list stopped at 006; added `007_skills.sql` (test-support fix; database source untouched).
5. PR2 (batch 2): One transient `business-pg-roundtrip.integration.test.ts` failure during a `pnpm check` run (leftover scratch DB from the pre-migration e2e failure colliding under parallel mode) — NOT reproducible: isolated run 36/36, parallel `vitest run` 936/936, and the final `pnpm check` is green.
6. PR2 (batch 2): My first R7-rewrite edit accidentally retained the superseded old test (causing a transient `SEGMENTS is not defined` + one syntax break from a dropped `});`) — caught by the test runner, corrected, final file 34 tests green with imports cleaned.
7. PR2 (batch 2): Biome format wanted the multi-line `sampleSkill(...)` calls expanded in `skill.test.ts` — auto-fixed with `biome format --write` on changed files only.

## Invariants Honored

- Worker stays PG-agnostic (adapters at the composition root; fetch via the `SkillRepository` port).
- `packages/context` deps exactly `@io/business-domain`; `business-domain` zero `@io/*`; `openai` confined to `llm-client`; no new runtime deps.
- The worker seam does NOT change the cohort rule: segment 7 stays a pure function of the cohort — the worker supplies the raw tenant skill store; the compiler filters (proven by the raw-store pass-through test: non-matching fetched once but never rendered).
- `packages/context` source untouched in PR2; `packages/database` source untouched (only the app TEST harness migration list extended).
- Cohort rule: seg-7 renders with ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}`; empty ⇒ ABSENT (zero bytes, backward compatible — proven by the unchanged v1-golden E2E proof).
- OUT of scope (not implemented): heartbeats, worker EXECUTION of skills, skill outcome BusinessEvents, learning/promotion, Memory OS.
- PR2 changes NOT committed / NOT pushed — left uncommitted in the working tree for the orchestrator's review-gated commit.
