# Apply Progress: skill-segment7 — Batch 1 (PR1 `@io/context`)

- Change: `skill-segment7` · Project: io · Batch: 1/2 (PR1) · Status: PR1 tasks 1.1–1.5 COMPLETE
- Mode: Strict TDD (RED → GREEN per task, demonstrated on the real runner)
- Delivery: `auto-chain` / `stacked-to-main` — PR1 (`@io/context`) implemented; PR2 (`@io/app` + skill R7) REMAINS
- Runner: `PATH=/data/node24/bin:$PATH pnpm vitest run <path>` (the `--filter @io/<pkg> test` form is a silent no-op — verified)
- Baseline: main@f9bd5d9, clean tree, ~922 tests passing sequentially

## Completed Tasks (PR1)

- [x] 1.1 Schema bump + relocate const (R6 S1) — `CONTEXT_SCHEMA_VERSION` 1→2 defined in `segments.ts`, re-exported from `index.ts` (local const at index.ts:19 dropped — avoids segments↔index cycle). `cohort.test.ts` updated: `=== 2`, `io:acme:planning:v2`, `:v1` literals at :26/:38 flipped to v2.
- [x] 1.2 Seg-7 render + `skills?` input (R1 S1/S2/S3, skill R7 S1) — `skills?: readonly Skill[]` on `CompileContextInput`; value-import `activeSkillsFor` + type `Skill` from `@io/business-domain/src/index.js`; `renderActiveSkills` passes ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}` into `activeSkillsFor`; fixed multi-line template `Active skills:\n- id=<skillId> name=<name> v=<version>\n<body>` joined with `\n`; empty ⇒ ABSENT (zero bytes); seg 7 wired (`render: renderActiveSkills`). Tests: skillId ASC, fixed-fields-only (metadata never leaks), insertion-order byte-identical, empty/undefined ABSENT.
- [x] 1.3 Boundary relaxation (BD-only) (skill R7 S1 deps) — dropped the `^import\s+type\s` assertion at boundary.test.ts:134; kept the `^@io/business-domain/` match + forbidden specifiers (:18-40); comments updated: BD = single allowed RUNTIME dep (matches manifest).
- [x] 1.4 Golden regeneration (ISOLATED, deterministic) (R6 S2/S3) — `test/fixtures/prefix.v2.golden.txt` (538 bytes) generated via a ONE-SHOT write of the real `buildStablePrefix(seed)` (temporary vitest file, deleted after one run — NEVER hand-edited). Seed = one active skill `{companyId:'acme', process:'planning', scope:{process:'planning', schemaVersion:2}}`. `prefix.v1.golden.txt` kept historical. Pin test reads `prefix.v{CONTEXT_SCHEMA_VERSION}.golden.txt` → auto-picks v2.
- [x] 1.5 Inverse cache-poisoning proof (ISOLATED) (R2 S1/S2/S3, skill R7 S2) — same cohort+store; varied work / delegation / dynamic-tail / shuffled insertion order / non-matching entries (other company, other process, other schemaVersion, draft, retired, older version) + double compile ⇒ byte-identical prefix INCLUDING seg 7. Pre-existing `noDelegation` variant in the R2-inverse test updated to keep the tenant store (`{ ...seed, delegation: undefined }`) so seg 7 stays PRESENT on both sides.

## TDD Cycle Evidence (Strict TDD)

| Task | RED (test first, watched fail) | GREEN (minimal code) | REFACTOR |
|------|-------------------------------|----------------------|----------|
| 1.1 | `cohort.test.ts` — 1 failed: `expected 1 to be 2` (const still 1) | const relocated+bumped to 2 in `segments.ts`, re-exported; cohort.test.ts green (8 passed) | None — minimal |
| 1.2 | `context-compiler.test.ts` — 2 failed: seg-7 render returned ABSENT (`present:false`, undefined text) | `skills?` input + value-import + `renderActiveSkills` + seg-7 wiring; context-compiler green (17 passed) | None |
| 1.3 | `boundary.test.ts` — 1 failed: `src/segments.ts: expected 'import { activeSkillsFor } …' to match /^import\s+type\s/` | Dropped type-only assertion, kept BD match + forbidden specifiers; boundary green (9 passed) | None |
| 1.4 | Golden pin: `ENOENT …/prefix.v2.golden.txt` (demonstrated pre-regen; full gate 3 failed incl. ENOENT) | One-shot generator wrote `prefix.v2.golden.txt` from real `buildStablePrefix(seed)`, deleted generator; pin green (prefix-stability 10 passed) | `noDelegation` variant now spreads seed to keep tenant store |
| 1.5 | 2 failed pre-GREEN: `expected '…Business process…' to contain 'Active skills:'` (seg 7 ABSENT in baseline) | Pure cohort render from 1.2 ⇒ identical bytes; 2 inverse tests green (10 passed file total) | None |

## Work Unit Evidence (all modes)

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/context/test/` → **5 files passed, 49 tests passed** (PR1 AUTHORITATIVE gate — GREEN) |
| Runtime harness command/scenario and exact result | N/A — pure I/O-free compiler; byte stability proven by the v2 golden pin + inverse-poison tests (no runtime boundary by design) |
| Rollback boundary | Revert PR1 ⇒ `CONTEXT_SCHEMA_VERSION=1`, seg-7 ABSENT, `prefix.v1.golden.txt` bytes; touches only `packages/context/src/{segments,index}.ts` + test files + fixture |

## Files Created / Modified

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/context/src/segments.ts` | Modified | `CONTEXT_SCHEMA_VERSION=2` defined here; `skills?: readonly Skill[]` on input; value-import `activeSkillsFor` + type `Skill`; `renderActiveSkills` (cohort-pure, fixed template); seg 7 wired |
| `packages/context/src/index.ts` | Modified | Local const dropped; `CONTEXT_SCHEMA_VERSION` re-exported from `segments.js` (no segments↔index cycle) |
| `packages/context/test/cohort.test.ts` | Modified | `=== 2`, `io:acme:planning:v2`, `:v1` literals flipped |
| `packages/context/test/context-compiler.test.ts` | Modified | Seg-7 present/order/fixed-fields/insertion-order/empty-ABSENT cases (+`SegmentRender` type import) |
| `packages/context/test/boundary.test.ts` | Modified | BD value imports allowed (runtime dep); all other bans intact |
| `packages/context/test/prefix-stability.test.ts` | Modified | Skills-bearing seed; inverse-poison proof block; golden seed; `noDelegation` keeps tenant store |
| `packages/context/test/fixtures/prefix.v2.golden.txt` | Created | 538-byte deterministic regen (never hand-edited); `prefix.v1.golden.txt` kept historical |
| `openspec/changes/skill-segment7/apply-progress.md` | Created | This artifact |
| `openspec/changes/skill-segment7/tasks.md` | Modified | 1.1–1.5 marked `[x]` |

## Verification (run + report)

- **PR1 AUTHORITATIVE focused gate**: `pnpm vitest run packages/context/test/` → **GREEN — 5 files / 49 tests passed**.
- **Static gates**: `pnpm run typecheck` ✅ · `pnpm run build` ✅ · `pnpm run lint` ✅ · `pnpm run format-check` ✅ (biome formatting fixed on the 2 files I touched: `segments.ts`, `prefix-stability.test.ts`).
- **Full `pnpm check`**: 74 files — 70 passed | 1 failed; tests — **927 passed | 2 failed | 6 skipped**. The 2 failures are EXACTLY the accepted red-window: `packages/app/test/worker-intent.test.ts:69` (`expected 'io:acme:low-risk-documents:v2' to be '…:v1'`) and `:90` (`'io:acme:onboarding:v2'` vs `:v1`). These are the hard-coded `:v1` cohort asserts that **PR2 fixes** (tasks 2.1–2.5). Do NOT alarm — expected until PR2 lands. No type/build/lint errors (the app issue is a test-assertion failure only).

## Accepted Red-Window (record for PR2)

- `worker-intent.test.ts:69` and `:90` hard-code `io:acme:low-risk-documents:v1` / `io:acme:onboarding:v1`; PR1 correctly re-derives cohorts to `:v2`. PR2 task 2.2 flips these asserts and adds the skills pass-through.
- No other hard-coded `:v1` cohort asserts or `schemaVersion: 1` PRESENT-skill fixtures remain in `@io/context` (churn sweep for PR2 will confirm across `@io/app`).

## Deviations from Design

None — implementation matches design.md (Option B: pure compiler render, cohort rule, serialize template, golden regen procedure, boundary relaxation exact).

## Issues Found

1. `tsc` caught `SegmentRender` missing from the test type import in `context-compiler.test.ts` — fixed (added to import).
2. Pre-existing R2-inverse `noDelegation` variant dropped `skills` after the seed became skills-bearing — updated to `{ ...seed, delegation: undefined }` so both sides render seg 7 PRESENT (required for the same-cohort+store invariant).
3. Biome format wanted `renderActiveSkills` params on one line and the delegation spread expanded — auto-fixed with `biome format --write` on my changed files only.

## Remaining (PR2 — NOT in this batch)

- [ ] 2.1 `WorkerDeps.skills` port + wiring (PgSkillRepository / harness InMemorySkillRepository)
- [ ] 2.2 Intent pass-through + `:v1`→`:v2` churn (`worker-intent.test.ts:69/:90`) + skills pass-through assert
- [ ] 2.3 Worker fetch-once after authority (`listByCompany` → `prepareIntent`)
- [ ] 2.4 `skill.test.ts` R7 rewrite (seg-7 render contract; deps BD-only)
- [ ] 2.5 Churn sweep + full sequential gate (`pnpm check` green ~929+)

## Invariants Honored

- Cohort rule: seg-7 passes ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}` — inverse-poison tests prove dynamic input cannot change prefix bytes.
- `CONTEXT_SCHEMA_VERSION` = 2; golden REGENERATED deterministically (never hand-edited); silent-prefix-change pin preserved (`prefix.v2.golden.txt`).
- `packages/context` deps unchanged (`@io/business-domain` only — value import now used, no NEW deps).
- Empty selection ⇒ ABSENT (zero bytes, backward compatible).
- PR1 did NOT touch `packages/business-domain` source, `packages/app`, or `packages/database`; app tests untouched (PR2's job).
- NOT committed / NOT pushed — changes left uncommitted in the working tree for the review-gated commit.
