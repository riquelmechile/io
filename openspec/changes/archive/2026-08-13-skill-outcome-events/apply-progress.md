# Apply Progress: skill-outcome-events — Units 1–4 (domain-foundation + compiler single-pass + intent→worker→finalize threading + atomic live-PG proof, boundaries & spec gates)

Change: `skill-outcome-events` · Batches: Unit 1 (tasks 1.1–1.4) + Unit 2 (tasks 2.1–2.5) + Unit 3 (tasks 3.1–3.6) + Unit 4 (tasks 4.1–4.4) · Mode: **Strict TDD** · Store: hybrid (OpenSpec + Engram) · Delivery: auto-chain, stacked-to-main · Attempt tokens: Unit 1 `sha256:e6621ab1de89ddc8db7fc907707daa19ae77bc5132b064fd70ec8ef17f3fc5f0`; Unit 2 `sha256:e3409ea7d60655a6178696f3a70cd1d705c5c9bae3257ae2b6979842030b448e`; Unit 3 `sha256:be3b95eaafff12fb2f10c4d98892671d59d1eea1b06fdd1432f749c6e4f69796`; Unit 4 `sha256:6ffa0a5f507697259115c5a8c9bc578f33429fbf626a12c130bf2e7f2e22760b` (native attempt `skill-outcome-events-unit4-20260813-a1` acquired by orchestrator — no acquire/settle performed by apply)

## Scope & PR Boundary

- PR boundary (Unit 1): **Domain Foundation only** — no compiler, no worker, no finalize, no live-PG.
- PR boundary (Unit 2): **Compiler Single-Pass Selection only** — no worker/finalize/live-PG (Units 3–4 are later slices). `compileContext` returns `{ messages, user, activatedSkills }`, selects the segment-7 cohort ONCE, and never accepts/invokes a client.
- PR boundary (Unit 3): **Intent → Worker → Finalize Threading only** — `prepareIntent` returns the intent-time selection, `runClaimedWork` threads it into `FinalizeInput`, and T1 appends the composite `work.skill-outcome` after `work.completed`, before `journal.complete`. NO Unit-4 live-PG/boundary/final gates (4.1–4.4 pending).
- PR boundary (Unit 4): **Atomic live-PG proof, boundaries & spec gates only** — test/proof slice: live-PG stale-token rollback, v1 payload round-trip + duplicate `evt:sk:` rejection + no-backfill, package/runtime boundaries + `openai` confinement + non-materiality/heartbeat-unchanged, and the `pnpm check` GATE. ZERO new functional production changes — the single RED (missing `E2E_REQUEST_HASH` import) was a test-authoring repair, not a production correction.
- Unit 1 slice changed lines: **217** (66 + 145 + 6). Unit 2 slice changed lines: **201** (43 + 41 + 70 + 47). Unit 3 slice changed lines: **339** (307 insertions + 34 deletions) ≤ 340 slice cap. Unit 4 slice changed lines: **284** (281 insertions + 3 deletions) ≤ 360 slice cap — all test-only across 3 files. Cumulative implementation 1041 changed lines across Units 1–4; session review budget 800 applies per autonomous slice/PR, not to the stacked whole (stacked-to-main authorized).
- Rollback: see Work Unit Evidence (per unit).

## Completed Tasks (marked [x] in tasks.md)

### Unit 1 — Phase 1: Domain Foundation

- [x] 1.1 RED — test file `packages/business-domain/test/skill-outcome-event.test.ts`
- [x] 1.2 GREEN — builder `packages/business-domain/src/skill-outcome-event.ts`
- [x] 1.3 Export `ActivatedSkillRef` + `SkillOutcomeEventInput`/`SkillOutcomePayload` from `src/index.ts`
- [x] 1.4 REFACTOR — zero `@io/*` assertion + `pnpm typecheck`

### Unit 2 — Phase 2: Compiler Single-Pass Selection

- [x] 2.1 RED — `packages/context/test/context-compiler.test.ts`: `activatedSkills` equals segment-7 cohort in order; empty list when none; `LlmClient` spy proves `compileContext` makes zero client calls
- [x] 2.2 RED — `packages/context/test/prefix-stability.test.ts`: `messages`/`user` byte-identical pre/post extension; golden unchanged
- [x] 2.3 GREEN — `packages/context/src/index.ts`: `CompiledContext.activatedSkills` added; selection computed ONCE; no client accepted/called
- [x] 2.4 GREEN — `packages/context/src/segments.ts`: map already-selected segment-7 `Skill[]` to ordered refs (same array, no re-select); absent zero-byte preserved
- [x] 2.5 REFACTOR — `pnpm vitest run packages/context` (55/55) + golden diff empty

### Unit 3 — Phase 3: Intent → Worker → Finalize Threading

- [x] 3.1 RED — `packages/app/test/worker-intent.test.ts`: `prepareIntent` returns the exact intent-time selection (ordered segment-7 refs; `[]` when none); version drift after intent leaves the captured snapshot frozen at v1
- [x] 3.2 RED — `packages/app/test/worker-finalize.test.ts`: verified close appends `work.completed` → exactly one `work.skill-outcome` → `journal.complete` (trace-order proven); CAS loss/replay/DENY/T2(ii) leave neither event; invalid-plan/denied/recovery-required emit no skill-outcome; full-cycle threading proves fetch-once + v1 attribution
- [x] 3.3 GREEN — `packages/app/src/worker/intent.ts`: `IntentResult` ok variant gains `activatedSkills: readonly ActivatedSkillRef[]`; returns `compiled.activatedSkills`; `LlmRequest` still projects only `{messages,user}`
- [x] 3.4 GREEN — `packages/app/src/worker/worker.ts`: `runClaimedWork` threads `activatedSkills: intent.activatedSkills` into the T1 `FinalizeInput` and the verify-fail reconcile call
- [x] 3.5 GREEN — `packages/app/src/worker/finalize.ts`: `FinalizeInput.activatedSkills` (required); T1 appends `buildSkillOutcomeEvent(...)` after `work.completed`, before `journal.complete`; failure paths never reach the append
- [x] 3.6 REFACTOR — worker suite 119/119; byte-identity pins re-pinned (`worker/worker.ts`) + normalization proofs extended (PR1/SLICE3 baselines intact); stale one-event live-PG assertions updated to the two-event contract; full `pnpm test` 1402 passed | 6 skipped; typecheck/format/build clean

### Unit 4 — Phase 4: Atomic Proof, Boundaries & Spec Gates

- [x] 4.1 RED/GREEN — `packages/app/test/e2e/worker-e2e.integration.test.ts`: live-PG stale-token close rolls back Work/journal/receipt/BOTH events atomically (holder presents token 0 against minted claim token 1; T1 CAS loses via fencing → rollback → claim-ownership gate refuses the zombie marker → typed UNRESOLVED; effect undone). Full-cycle two-event persistence already asserted in the Unit-3 happy-path `it` in the same file.
- [x] 4.2 RED/GREEN — `packages/database/test/business-event-roundtrip.integration.test.ts`: v1 `work.skill-outcome` payload round-trip byte-identical through the row guard; duplicate `evt:sk:` rejected by `uq_business_event_event_id` (original preserved); historical pre-change `work.completed` row untouched — replay does not append, no skill-outcome synthesized (no backfill).
- [x] 4.3 RED/GREEN — `packages/app/test/app-boundary.test.ts`: `business-domain` zero runtime deps (no `dependencies` manifest key) + zero `@io/*` package-wide; builder's only import is `./types.js`; `openai` confined to `llm-client/src/deepseek-client.ts`; `work.skill-outcome` NOT in `MATERIAL_EVENT_TYPES` (declared set unchanged); heartbeat.ts sha256-pinned byte-identical.
- [x] 4.4 GATE — `pnpm check` exit 0 (GATE A — historical isolated-PG run with `IO_REQUIRE_PG=1`: format-check 213 files / typecheck / build / lint 9 pre-existing warnings / test 102 files `1411 passed | 5 skipped`; GATE B — fresh non-PG validation `1410 passed | 6 skipped`, exit 0, ordinary suite only); spec-alignment sweep complete (all 24 delta scenarios → passing tests, incl. namespace disjointness `sk:`/`att:`/`hb:`/`acc:`); no migration/backfill (git status clean over `packages/database/sql`).

## TDD Cycle Evidence (Strict TDD)

### Unit 1 (domain-foundation)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/business-domain/test/skill-outcome-event.test.ts` | Unit | N/A (new file) | ✅ Written — run: `1 failed (1)`, `11 failed (11)` (module `skill-outcome-event.ts` not found) | N/A (RED step) | N/A (RED step) | N/A (RED step) |
| 1.2 | same file | Unit | N/A (new) | ✅ (from 1.1) | ✅ Passed — `1 passed (1)`, `11 passed (11)` | ✅ 11 cases: shape contract; multi-clock identity (occurredAt excluded); retry rebuild equality; different attemptId → different id; occurredAt-only variance; `aggregateId = workId`; payload order/values; **empty selection**; `sk:` disjoint from `att:`/`hb:`/`acc:`; `source:'worker'` ownership; purity | ✅ Pure single-return builder mirroring `buildWorkAcceptedEvent`; none needed beyond style |
| 1.3 | same (imports via `../src/index.js`) | Unit | ✅ `work-accepted-event.test.ts` 11/11 before AND after `index.ts` edit | ✅ (via 1.1) | ✅ Passed — `11 passed (11)` after export | ➖ Structural type exports; triangulated by all 11 tests importing through the index | ✅ Exports placed in biome-preferred sorted position |
| 1.4 | same (purity assertion) | Unit | ✅ `work-accepted-event.test.ts` 11/11 re-run green | ✅ zero-`@io/*` assertion written in 1.1 | ✅ Passed — `11 passed (11)` | ➖ Single (zero-import surface, one possible output) | ✅ `pnpm typecheck` clean; `pnpm format-check` 213 files clean; `biome check`/`biome lint` clean on new files |

### Unit 2 (compiler single-pass selection)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/context/test/context-compiler.test.ts` | Unit | ✅ `packages/context` 49/49 pre-edit | ✅ Written first — run: `4 failed | 17 passed (21)` (asserts `compiled.activatedSkills` undefined — field absent) | ✅ Passed — `2 files, 33 passed (33)` after 2.3+2.4 | ✅ 4 cases: cohort order (ASC from reversed input); refs match seg-7 render order/bytes (same selection); explicit empty list when `skills: []` or absent; `LlmClient` spy zero calls + LlmClient-compatible shape | ✅ Extracted `renderSeg7` helper locally; `selectActiveSkills`/`renderSelectedSkills`/`toActivatedSkillRefs` naming aligned to design; biome format + lint clean |
| 2.2 | `packages/context/test/prefix-stability.test.ts` | Unit | ✅ same 49/49 baseline | ✅ Written first — run: `1 failed | 11 passed (12)` (only `activatedSkills` assertion failed — golden/bytes green already) | ✅ Passed — `33 passed (33)` combined run | ✅ 2 cases: golden pin + dynamic suffix + cohort bytes identical through full `compileContext` path; `activatedSkills` matches seg-7 rendered identity (skill-planning-v2 v=1) | ✅ Imports re-sorted per biome; `deriveCohort` used instead of hard-coded string |
| 2.3 | `packages/context/src/index.ts` | Unit | ✅ `packages/context` 49/49 + `skill.test.ts`/`worker-intent.test.ts` 105/105 consumers | ✅ (2.1/2.2 tests reference new field) | ✅ Passed — `55 passed (55)` packages/context | ✅ Covered by 2.1/2.2 triangulation (order, empty, bytes, spy) | ✅ Closure-over-selection render keeps `SEGMENTS` frozen; additive field breaks zero consumers (structural read of messages/user only) |
| 2.4 | `packages/context/src/segments.ts` | Unit | ✅ same 49/49 baseline | ✅ (via 2.1/2.2) | ✅ Passed — `55 passed (55)` | ✅ `toActivatedSkillRefs` maps the SAME selected array (no re-select); empty → zero bytes preserved | ✅ `renderActiveSkills` re-expressed as `renderSelectedSkills(selectActiveSkills(input))` — single selection point, zero duplication |
| 2.5 | full `packages/context` | Unit | ✅ `packages/context` 49/49 pre-change | N/A (REFACTOR gate) | ✅ `pnpm exec vitest run packages/context` → `5 passed (5)`, `55 passed (55)` | N/A | ✅ `git diff packages/context/test/fixtures` → **empty** (golden unchanged); `pnpm typecheck` clean; biome format + lint clean on all 4 changed files; full `pnpm test` → `1398 passed | 6 skipped` (live-PG only), zero regressions |

### Unit 3 (intent→worker→finalize threading)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `packages/app/test/worker-intent.test.ts` | Unit | ✅ `worker-` 11 files / 115/115 pre-edit | ✅ Written first — run: `3 failed | 16 passed (19)` (`intent.activatedSkills` undefined — field absent) | ✅ Passed — `19 passed (19)` after 3.3 | ✅ 3 cases: ordered refs + explicit `[]` when no skills; drift snapshot frozen at v1 after the store publishes v2 | ✅ Fixture extracted (`matchingSkill`); biome format/lint clean |
| 3.2 | `packages/app/test/worker-finalize.test.ts` + `worker-helpers.ts` (trace seam) | Unit | ✅ same 115/115 baseline | ✅ Written first — run: `5 failed | 12 passed (17)` (only `work.completed` appended; skill-outcome assertions red) | ✅ Passed — `32 passed (32)` focused (worker-intent + worker-finalize) after 3.4+3.5 | ✅ 6 cases: append order + shape; T1 placement (completed → skill-outcome → journal.complete via trace); CAS loss leaves neither; replay/DENY/T2(ii) zero appends; empty selection records one composite fact (R6 cycle-level); full-cycle v1 attribution + fetch-once | ✅ Trace ordering seam added to `RecordingEvents.append` + `RecordingJournal.complete`; helpers kept shared |
| 3.3 | `packages/app/src/worker/intent.ts` | Unit | ✅ 115/115 consumers pre-edit | ✅ (3.1 tests reference `IntentResult.activatedSkills`) | ✅ Passed — `19 passed (19)` | ✅ Covered by 3.1 triangulation (refs/empty/drift) | ✅ Field documented as immutable snapshot; projection of `{messages,user}` to `LlmRequest` untouched |
| 3.4 | `packages/app/src/worker/worker.ts` | Unit | ✅ same baseline | ✅ (via 3.2 full-cycle test) | ✅ Passed — `32 passed (32)` | ✅ Covered by 3.2 (fetch-once `listCalls=['acme']` + v1 payload = intent threading, no re-derivation) | ✅ Byte-identity pins re-pinned + `stripSkillOutcomeThreading` normalization; PR1/SLICE3 proofs still land (drift is ONLY the threading) |
| 3.5 | `packages/app/src/worker/finalize.ts` (+ ripple: `recover.ts`, `parity.test.ts`, `worker-verify.test.ts`, `worker-reconcile.test.ts`) | Unit | ✅ same baseline | ✅ (via 3.2 tests) | ✅ Passed — `32 passed (32)`; typecheck clean after required-field ripple | ✅ Covered by 3.2 (order, shape, empty, failure dispositions) | ✅ `FinalizeInput.activatedSkills` required (uniform contract); recovery carries `[]` (never emits outcomes); biome clean |
| 3.6 | full `packages/app/test/worker-` + full suite | Unit | ✅ worker- 115/115 pre-change | N/A (REFACTOR gate) | ✅ `pnpm exec vitest run packages/app/test/worker-` → `11 passed (11)`, `119 passed (119)`; full `pnpm test` → `1402 passed | 6 skipped (1408)` | N/A | ✅ byte-identity 11/11 (pins + normalization); 5 stale live-PG one-event assertions updated to the two-event contract; `pnpm typecheck` clean; `pnpm format-check` 213 files clean; `biome lint` clean on changed files (7 pre-existing warnings in parity/worker-reconcile, untouched); `pnpm build` clean |

### Unit 4 (atomic live-PG proof, boundaries & spec gates)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `packages/app/test/e2e/worker-e2e.integration.test.ts` | Integration (live PG) | ✅ baseline `3 files, 19 passed (19)` pre-edit (worker-e2e + roundtrip + app-boundary, isolated harness `io-unit4-iso-pg-9cad4d9e`) | ✅ Written first — run: `1 failed | 1 passed (2)` (`E2E_REQUEST_HASH` not imported — test-authoring gap, repaired) | ✅ Passed — `2 passed (2)` after import repair; final focused `27 passed (27)` | ✅ 2 cases: happy-path two-event persistence (Unit 3) + stale-token close (claim mints token 1 → holder presents 0 → fencing CAS loses → rollback; Work in_progress v2 token 1, journal in_flight token 1, 0 receipts, 0 events, effect undone) | ✅ Guards narrowed optional `WorkerDeps.connection`/`repositories` for the direct finalize call (typecheck-clean); biome format + lint clean |
| 4.2 | `packages/database/test/business-event-roundtrip.integration.test.ts` | Integration (live PG) | ✅ same 19/19 baseline | ✅ Written first — all 3 new tests red before production/assertion completion; ran against isolated harness | ✅ Passed — `17 passed (17)` focused file | ✅ 3 cases: v1 payload round-trip byte-identical (`evt:sk:att:acme:attempt-1`, ordered refs, source worker, occurredAt); duplicate `evt:sk:` → throws `/duplicate key|unique/i` + original preserved; historical `work.completed` replay via appendIfAbsent → one original row, no `work.skill-outcome` synthesized | ✅ Reused existing `sampleEvent`-style helpers + beforeEach TRUNCATE isolation; biome format clean |
| 4.3 | `packages/app/test/app-boundary.test.ts` | Unit (boundary) | ✅ same 19/19 baseline | ✅ Written first — 5 new boundary tests (zero-deps package-wide, builder zero-`@io/*`, MATERIAL_EVENT_TYPES non-materiality, heartbeat sha256 pin, openai confinement retained) | ✅ Passed — `8 passed (8)` focused file | ✅ 5 cases: manifest `dependencies` undefined + every business-domain import relative/`node:*`; builder imports exactly `['./types.js']`; `MATERIAL_EVENT_TYPES` exactly `['work.accepted','work.completed']` + NOT containing `work.skill-outcome`; heartbeat.ts hash pinned `04fbb0…a563d`; openai owner still `deepseek-client.ts` | ✅ `createHash` imported; biome format/lint clean |
| 4.4 | full `pnpm check` + spec sweep | GATE | ✅ focused 27/27 + worker 119/119 intact | N/A (GATE) | ✅ GATE A (historical, isolated-PG `IO_REQUIRE_PG=1`): `pnpm check` → exit 0 — format-check 213 files; typecheck clean; build clean; lint 9 warnings (pre-existing); test `102 files passed (102) | 2 skipped`, `1411 passed | 5 skipped`. GATE B (fresh, no `IO_REQUIRE_PG`): `pnpm check` → exit 0, `1410 passed | 6 skipped` — ordinary suite only, does not replace GATE A | N/A | ✅ Spec sweep documented (all 24 delta scenarios → passing tests; namespaces disjoint; zero migration — `git status --porcelain -- packages/database/sql` empty) |

### Test Summary (cumulative, Units 1–4)

- **Total tests written**: 27 (Units 1–3) + 9 (Unit 4: 1 stale-token E2E + 3 roundtrip + 4 boundary) + 1 existing E2E happy-path `it` re-purposed as 4.1's first case = **37** (36 authored + 1 live-PG suite count movement: `pg-required` now runs under `IO_REQUIRE_PG=1`)
- **Total tests passing**: 37/37. Full suite at the historical isolated-PG gate (**GATE A**): `1411 passed | 5 skipped` (was `1402 | 6` — +8 authored Unit-4 tests + `pg-required` reachability guard now executing; skipped = deepseek-live token-gated + offline-only suites)
- **GATE separation (non-conflated)**:
  - **GATE A — historical/native Unit 4, `IO_REQUIRE_PG=1`**: dedicated isolated PostgreSQL 18.4 harness `io-unit4-iso-pg-9cad4d9e` (127.0.0.1:55432). `pnpm check` → exit 0; full `pnpm test` **`1411 passed | 5 skipped`**; PG executed (`pg-required` ran, none skipped). Native receipt `024cc0eb…` process_evidence `focused-27-full-1411-pg-required-executed-check-exit-zero`.
  - **GATE B — fresh validation, no `IO_REQUIRE_PG`** (gatekeeper-observed 2026-08-13, memory #6589/#6590): `pnpm check` → exit 0; full `pnpm test` **`1410 passed | 6 skipped`** (`pg-required` skips when the dedicated harness env is absent → 1 fewer passed, 1 more skipped). **GATE B does NOT replace GATE A** — it only confirms the CURRENT ordinary (non-PG) suite is green; the required-PG proof remains GATE A.
- **Layers used**: Unit (32: 27 + 5 boundary) + Integration/live-PG (5: 1 stale-token E2E + 3 roundtrip + 1 pg-required)
- **Approval tests** (refactoring): 0 — no refactoring of pre-existing behavior; Unit-4 proofs are behavioral boundary/roundtrip tests, heartbeat pin is a committed-baseline byte pin
- **Pure functions created**: 4 total (Units 1–2); Unit 3 reused the builder; Unit 4 created zero production code (proof/test slice only)

## Work Unit Evidence

### Unit 1 (domain-foundation)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/skill-outcome-event` → `Test Files 1 passed (1)`, `Tests 11 passed (11)`, exit 0 |
| Runtime harness command/scenario and exact result | `PATH=/data/node24/bin:$PATH pnpm typecheck` → exit 0, no diagnostics; `pnpm format-check` → 213 files, no fixes; `biome check` + `biome lint` on the two new files → clean |
| Rollback boundary | Delete `packages/business-domain/src/skill-outcome-event.ts`, remove the 6 added export lines in `packages/business-domain/src/index.ts`, delete `packages/business-domain/test/skill-outcome-event.test.ts`. Inert: zero consumers exist (compiler/worker/finalize wiring is Unit 2–3). No migration, no schema, no persistence touched |

### Unit 2 (compiler single-pass selection)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/context/test/context-compiler packages/context/test/prefix-stability` → `Test Files 2 passed (2)`, `Tests 33 passed (33)`, exit 0 |
| Runtime harness command/scenario and exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/context` → `5 passed (5)`, `55 passed (55)`; `pnpm typecheck` → exit 0; `biome lint` + `biome format` on the 4 changed files → clean; full `pnpm test` → `1398 passed | 6 skipped (1404)` (skipped = live-PG integration), zero regressions across 101 test files |
| Rollback boundary | Revert the 4 `packages/context` files (index.ts, segments.ts, both test files) to HEAD → `CompiledContext.activatedSkills` gone, bytes unchanged. Inert: zero consumers read `activatedSkills` yet (worker/finalize wiring is Unit 3). No migration, no schema, no adapter, no heartbeat touched |

### Unit 3 (intent→worker→finalize threading)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/app/test/worker-intent packages/app/test/worker-finalize` → `Test Files 2 passed (2)`, `Tests 32 passed (32)`, exit 0 |
| Runtime harness command/scenario and exact result | `pnpm exec vitest run packages/app/test/worker-` → `11 passed (11)`, `119 passed (119)`; `pnpm exec vitest run packages/app/test/daemon/byte-identity` → `11 passed (11)` (pins re-pinned, PR1/SLICE3 normalization baselines intact); full `pnpm test` → `1402 passed | 6 skipped (1408)` (live-PG run — 5 stale one-event assertions updated to the two-event contract); `pnpm typecheck` → exit 0; `pnpm format-check` → 213 files clean; `biome lint` on the 15 changed files → clean (7 pre-existing warnings untouched); `pnpm build` → exit 0 |
| Rollback boundary | Revert the 4 worker src files (`intent.ts`, `worker.ts`, `finalize.ts`, `recover.ts`) to HEAD + revert the 11 test/helper files → the second T1 append, the threaded field, and `FinalizeInput.activatedSkills` disappear byte-for-byte; pre-existing behavior (single `work.completed` append) restored. The byte-identity pin for `worker/worker.ts` reverts with it. No migration, no schema, no adapter, no heartbeat touched |

### Unit 4 (atomic live-PG proof, boundaries & spec gates)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `DATABASE_URL=postgresql://io:io_dev@127.0.0.1:55432/io_dev IO_REQUIRE_PG=1 PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/app/test/e2e/worker-e2e.integration packages/database/test/business-event-roundtrip.integration packages/app/test/app-boundary` → `Test Files 3 passed (3)`, `Tests 27 passed (27)`, exit 0 |
| Runtime harness command/scenario and exact result | Isolated dedicated PostgreSQL 18.4 harness `io-unit4-iso-pg-9cad4d9e` (127.0.0.1:55432, user `io`, db `io_dev` — verified `SELECT version()` = PostgreSQL 18.4; NOT the shared `io_pg` on 5432). `DATABASE_URL` injected env-first via `pgConnectionString()`; credentials never printed. `IO_REQUIRE_PG=1` — PG tests REQUIRED, none skipped (`pg-required` reachability guard executed). Harness cleaned with evidence after the run (`docker rm -f`). Full GATE A (historical, isolated PG): `pnpm check` → exit 0 (format-check 213 files / typecheck / build / lint 9 pre-existing warnings / `vitest run` → `102 files passed | 2 skipped (104)`, `1411 passed | 5 skipped (1416)`). GATE B (fresh validation without `IO_REQUIRE_PG`, gatekeeper-observed 2026-08-13): `pnpm check` → exit 0, `1410 passed | 6 skipped` — confirms the ordinary suite only; does NOT replace GATE A |
| Rollback boundary | Revert the 3 test files (`worker-e2e.integration.test.ts` → 195-line Unit-3 state, `business-event-roundtrip.integration.test.ts` → HEAD, `app-boundary.test.ts` → HEAD) — all Unit-4 additions are test/proof lines in isolated scratch databases (`io_dev_e2e_worker_stale`) dropped on harness close; ZERO production/source/migration/schema changes to revert. Inert by construction |

## Files Changed (exact changed lines)

### Unit 1

| File | Action | Changed lines | What |
|------|--------|---------------|------|
| `packages/business-domain/src/skill-outcome-event.ts` | Created | 66 | `ActivatedSkillRef`, `SkillOutcomePayload` (v1), `SkillOutcomeEventInput`, pure `buildSkillOutcomeEvent` — `source:'worker'`, `aggregateKind:'work'`, `aggregateId=workId`, `eventType:'work.skill-outcome'`, `eventId=evt:sk:${attemptId}`, payload `{version:1, activatedSkills}`; only import `./types.js` (zero `@io/*`) |
| `packages/business-domain/src/index.ts` | Modified | +6 | Export `buildSkillOutcomeEvent` + types `ActivatedSkillRef`, `SkillOutcomeEventInput`, `SkillOutcomePayload` |
| `packages/business-domain/test/skill-outcome-event.test.ts` | Created | 145 | 11 unit tests: shape contract, identity determinism (occurredAt excluded), retry equality, aggregateId = closed workId, payload v1 order/values, empty selection, disjoint `sk:` namespace, `source:'worker'`, purity/zero-`@io/*` |

### Unit 2

| File | Action | Changed lines | What |
|------|--------|---------------|------|
| `packages/context/src/index.ts` | Modified | 43 (38+5) | `CompiledContext` gains `readonly activatedSkills: readonly ActivatedSkillRef[]`; `compileContext` computes selection ONCE via `selectActiveSkills`, overrides seg-7 render slot with a closure over the SAME selected array (`renderSelectedSkills`), maps it via `toActivatedSkillRefs`; accepts no `LlmClient`, returns data only; re-exports `ActivatedSkillRef` from business-domain |
| `packages/context/src/segments.ts` | Modified | 41 (38+3) | Extracted `selectActiveSkills` (single selection call site), `renderSelectedSkills(selected)` (caller-supplied array render; empty → ABSENT zero bytes), `toActivatedSkillRefs(selected)` (same array → ordered refs); `renderActiveSkills` re-expressed as `renderSelectedSkills(selectActiveSkills(input))` — canonical table unchanged |
| `packages/context/test/context-compiler.test.ts` | Modified | 70 (68+2) | New describe «compileContext — activatedSkills output contract»: cohort order (ASC from reversed input), refs match seg-7 render order, explicit empty list, `LlmClient` spy zero calls + compatible shape |
| `packages/context/test/prefix-stability.test.ts` | Modified | 47 (46+1) | New describe «compiled output extension — byte-stable pre/post»: golden pin + dynamic suffix + cohort byte-identical through full `compileContext` path; `activatedSkills` matches seg-7 rendered identity |

**Unit 2 slice: 201 changed lines** (190 insertions + 11 deletions) ≤ 260 slice cap. **Units 1–2 cumulative: 418 changed lines**; session review budget 800 untouched beyond that.

### Unit 3

| File | Action | Changed lines | What |
|------|--------|---------------|------|
| `packages/app/src/worker/intent.ts` | Modified | 16+2=18 | `IntentResult` ok variant gains `activatedSkills: readonly ActivatedSkillRef[]`; `prepareIntent` returns `compiled.activatedSkills` (the compiler's single-pass selection, verbatim); `LlmRequest` projection unchanged (`{messages,user}` only) |
| `packages/app/src/worker/worker.ts` | Modified | 7 | `runClaimedWork` threads `activatedSkills: intent.activatedSkills` into the T1 `FinalizeInput` AND the verify-fail `reconcilePostEffectFailure` call |
| `packages/app/src/worker/finalize.ts` | Modified | 20 | `FinalizeInput` gains required `readonly activatedSkills: readonly ActivatedSkillRef[]`; T1 appends `buildSkillOutcomeEvent({companyId, workId: completed.workId, attemptId, occurredAt, activatedSkills})` between `work.completed` and `journal.complete` (verified success only) |
| `packages/app/src/worker/recover.ts` | Modified | 4 | Recovery reconcile carries `activatedSkills: []` (no intent selection; recovery never emits outcomes) — required-field ripple |
| `packages/app/test/worker-intent.test.ts` | Modified | 73 | New describe «prepareIntent — activatedSkills capture (Unit 3)»: ordered refs + explicit `[]`; drift snapshot frozen at v1 after store publishes v2 |
| `packages/app/test/worker-finalize.test.ts` | Modified | 112+10=122 | T1-success updated to the two-event contract (order + skill-outcome shape + trace placement); R6 determinism extended (both events identical, empty selection recorded); new describe «skill-outcome emission»: full-cycle threading (v1 refs + fetch-once) + merged non-success dispositions (invalid-plan/denied/recovery-required → zero appends) |
| `packages/app/test/worker-helpers.ts` | Modified | 5+1=6 | Trace seam: `RecordingEvents.append` pushes `events:append:{eventType}`; `RecordingJournal.complete` pushes `journal:complete:{attemptId}`; harness wires the shared trace |
| `packages/app/test/daemon/byte-identity.test.ts` | Modified | 19+5=24 | `worker/worker.ts` pin re-pinned to the Unit-3 baseline; `stripSkillOutcomeThreading` normalization (regex) added to the PR2 + PR4 proofs — PR1/SLICE3 baselines still restored (drift is ONLY the threading) |
| `packages/app/test/parity.test.ts`, `worker-verify.test.ts`, `worker-reconcile.test.ts` | Modified | 3+3+6=12 | `reconcileInput` helpers carry `activatedSkills: []` (required-field ripple; reconcile never emits outcomes) |
| `packages/app/test/dispatch/dispatch.integration.test.ts`, `e2e/worker-e2e.integration.test.ts`, `e2e/cold-start-e2e.integration.test.ts`, `heartbeat/heartbeat.integration.test.ts` | Modified | 6+16+18+13=53 | Stale one-event live-PG assertions updated to the two-event contract (SQL counts 1→2, event-row arrays gain `worker:work.skill-outcome`); heartbeat gate decision unchanged (non-material proof) |

**Unit 3 slice: 339 changed lines** (307 insertions + 34 deletions) ≤ 340 slice cap. **Units 1–3 cumulative implementation: 757 changed lines**; session review budget 800 untouched beyond that.

### Unit 4

| File | Action | Changed lines | What |
|------|--------|---------------|------|
| `packages/app/test/e2e/worker-e2e.integration.test.ts` | Modified | 121 (118+3) | New describe «E2E (4.1): stale-token close vs live PostgreSQL» — claim CAS mints token 1, holder presents token 0, direct `finalizeInFlightWorkAtomically` over the production wiring: T1 fencing CAS loses → rollback → claim-ownership gate refuses the zombie marker → typed `UNRESOLVED_REQUIRES_HUMAN`; Work/journal/receipt/BOTH events unchanged (0 receipts, 0 events); effect undone. Happy-path two-event `it` (Unit 3) retained as 4.1's first case |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Modified | 106 | New describe «work.skill-outcome contract (Unit 4)» — v1 payload round-trip byte-identical through the row guard (`evt:sk:att:acme:attempt-1`, ordered refs, source worker); duplicate `evt:sk:` → `uq_business_event_event_id` throws + original preserved; historical pre-change `work.completed` replay → appendIfAbsent ON CONFLICT DO NOTHING, exactly one original row, zero `work.skill-outcome` synthesized (no backfill) |
| `packages/app/test/app-boundary.test.ts` | Modified | 57 | 5 new boundary proofs: `business-domain` manifest has no `dependencies` + package-wide import scan (relative/`node:` only, zero `@io/*`); builder imports exactly `./types.js`; `work.skill-outcome` NOT in `MATERIAL_EVENT_TYPES` (declared set unchanged); heartbeat.ts sha256 pinned `04fbb0003ab7d0820424bb0f46e7d93609d1cf6df436d143c8509c3af73a563d`; openai confinement scan retained |

**Unit 4 slice: 284 changed lines** (281 insertions + 3 deletions) ≤ 360 slice cap — 100% test/proof lines. **Units 1–4 cumulative implementation: 1041 changed lines**; per-slice accounting authorized (stacked-to-main: each autonomous PR carries its own slice budget; the 800 session review budget is per slice/PR, not the stacked whole).

## Work-Unit Budget & Full Snapshot (contractual accounting)

Unit implementation budgets are **authored implementation of the batch** — source/test slices only: Unit 1 = 217 ≤ 220 cap; Unit 2 = 201 ≤ 260 cap; Unit 3 = 339 ≤ 340 cap; Unit 4 = 284 ≤ 360 cap. Pre-existing SDD pipeline artifacts (proposal / exploration / design / tasks / specs) are planning scope of the whole change — authored by the propose/spec/design/tasks phases, not by any apply unit — and are NOT imputed to work-unit implementation budgets.

**Snapshots are CUMULATIVE**: each snapshot re-measures the whole change from disk and supersedes the prior one. The Unit 1 baseline snapshot of **771** (6 tracked + 765 untracked) was valid at that point; the Units 1–2 measurement of **1045** (207 tracked + 838 untracked) superseded it; the Units 1–3 measurement of **1446** (546 tracked + 900 untracked) superseded both; applying Unit 4 grew the change again, so the baseline below supersedes all three.

**Stale snapshot correction (gatekeeper, 2026-08-13)**: the previously published total **1730 (830 tracked + 900 untracked)** was stale and internally inconsistent — its own untracked rows summed to **925** (211 implementation + 452 planning + 259 apply + 3 other), which would total **1755**, not 1730. The untracked 900 assumed older line counts for `tasks.md` (59) and `apply-progress.md` (259); re-measuring those two from disk (tasks.md 61, apply-progress.md 285) reconciles exactly: 211 + 454 + 285 + 3 = **953**. The correct pre-edit measurement was therefore **1783 (830 tracked + 953 untracked)** — gatekeeper-observed (memory #6589). The table below is a fresh POST-EDIT measurement and is the count authority.

Full snapshot measured from disk (`git status --porcelain` + `wc -l`; tracked = work-tree diff lines per file [insertions + deletions], untracked = new-file line counts) **after** this correction edit:

### Tracked changed lines (per file, from disk)

| Unit | File | Ins + Del | Lines |
|---|---|---|---|
| 1 | `packages/business-domain/src/index.ts` | 6 + 0 | 6 |
| 2 | `packages/context/src/index.ts` | 38 + 5 | 43 |
| 2 | `packages/context/src/segments.ts` | 38 + 3 | 41 |
| 2 | `packages/context/test/context-compiler.test.ts` | 68 + 2 | 70 |
| 2 | `packages/context/test/prefix-stability.test.ts` | 46 + 1 | 47 |
| 3 | `packages/app/src/worker/intent.ts` | 16 + 2 | 18 |
| 3 | `packages/app/src/worker/worker.ts` | 7 + 0 | 7 |
| 3 | `packages/app/src/worker/finalize.ts` | 20 + 0 | 20 |
| 3 | `packages/app/src/worker/recover.ts` | 4 + 0 | 4 |
| 3 | `packages/app/test/worker-intent.test.ts` | 73 + 0 | 73 |
| 3 | `packages/app/test/worker-finalize.test.ts` | 112 + 10 | 122 |
| 3 | `packages/app/test/worker-helpers.ts` | 5 + 1 | 6 |
| 3 | `packages/app/test/parity.test.ts` | 3 + 0 | 3 |
| 3 | `packages/app/test/worker-verify.test.ts` | 3 + 0 | 3 |
| 3 | `packages/app/test/worker-reconcile.test.ts` | 6 + 0 | 6 |
| 3 | `packages/app/test/daemon/byte-identity.test.ts` | 19 + 5 | 24 |
| 3 | `packages/app/test/dispatch/dispatch.integration.test.ts` | 4 + 2 | 6 |
| 3 | `packages/app/test/e2e/worker-e2e.integration.test.ts` (Unit-3 portion) | 16 of cumulative 137 | 16 |
| 3 | `packages/app/test/e2e/cold-start-e2e.integration.test.ts` | 12 + 6 | 18 |
| 3 | `packages/app/test/heartbeat/heartbeat.integration.test.ts` | 8 + 5 | 13 |
| 4 | `packages/app/test/e2e/worker-e2e.integration.test.ts` (Unit-4 portion; cumulative file 134 + 3 = 137) | 118 + 3 | 121 |
| 4 | `packages/database/test/business-event-roundtrip.integration.test.ts` | 106 + 0 | 106 |
| 4 | `packages/app/test/app-boundary.test.ts` | 57 + 0 | 57 |
| **Tracked total** | 22 rows (21 tracked files; `worker-e2e` split across Units 3–4) | — | **830** |

Unit totals: Unit 1 = 6; Unit 2 = 201 (43+41+70+47); Unit 3 = 339 (18+7+20+4+73+122+6+3+3+6+24+6+16+18+13); Unit 4 = 284 (121+106+57). **Sum = 830**, matching `git diff --numstat` exactly.

### Untracked lines (per category, from disk)

| Category | Files (lines) | Lines |
|---|---|---|
| Implementation — Unit 1 | `packages/business-domain/src/skill-outcome-event.ts` (66), `packages/business-domain/test/skill-outcome-event.test.ts` (145) | 211 |
| Planning artifacts — pre-existing pipeline | `proposal.md` (70), `exploration.md` (80), `design.md` (67), `tasks.md` (61), `specs/business-event/spec.md` (73), `specs/context-compiler/spec.md` (30), `specs/worker-cycle/spec.md` (51), `specs/skill/spec.md` (22) | 454 |
| Apply artifacts — Units 1–4 | `apply-progress.md` (379 — final count after this correction), plus the `[x]` state inside `tasks.md` (counted in the planning row above) | 379 |
| Other untracked — agent runtime, not SDD | `.pi/gentle-ai/persona.json` (3) | 3 |
| **Untracked total** | — | **1047** (211 + 454 + 379 + 3) |
| **Snapshot total (cumulative, Units 1–4)** | tracked 830 + untracked 1047 | **1877** |

## Native Evidence Reconciliation

Native SDD runtime records (`sdd-runtime/v1/skill-outcome-events/records/`, immutable `gentle-ai.sdd-runtime-record/v1`) were NOT altered by this correction. Where a native measurement or label differs from the corrected evidence, the discrepancy is documented here; **corrected outputs/artifacts + the fresh GATE B validation are the count authority**, not any stale native label.

| Unit | Native record (sha256 prefix) | Native changed_lines | Native process_evidence | Corrected evidence | Reconciliation |
|---|---|---|---|---|---|
| 1 | `ab90217e…` (attempt/finish) | 6 | `focused-vitest-11-of-11-typecheck-format-lint-green` | 11/11 tests; Unit-1 slice 217 (66 + 145 + 6) | process_evidence consistent with corrected 11/11. **`changed_lines: 6` counted ONLY the tracked diff** (`business-domain/src/index.ts` +6) and **excluded the 211 untracked lines** (`skill-outcome-event.ts` 66 + `skill-outcome-event.test.ts` 145). Native measurement limitation documented; real Unit-1 slice = **217 by disk evidence**. No settle fabricated — both figures are recorded with their scopes (native 6 = tracked-only delta; contractual slice 217 = full disk evidence). |
| 2 | `e72ff0ed…` (attempt/finish) | 201 | `focused-33-of-33-context-55-of-55-full-1398-golden-empty` | 33 focused / 55 context / 1398 full | Consistent with corrected evidence. |
| 3 | `216b8fe1…` (attempt/finish) | 339 | `focused-36-worker-123-full-1402-typecheck-format-build-green` | 32 focused (worker-intent + worker-finalize) / 119 worker suite / 1402 full | `changed_lines: 339` and `full-1402` match corrected evidence. The **process-evidence label `focused-36-worker-123` is STALE** (the native in-process run reported 36 focused / 123 worker; the final persisted evidence is 32 focused / 119 worker). The receipt is immutable and was NOT altered; its label is **NOT used as count authority**. Corrected outputs/artifacts + GATE B fresh validation are the count authority. |
| 4 | `024cc0eb…` (attempt/finish) | 284 | `focused-27-full-1411-pg-required-executed-check-exit-zero` | 27 focused / GATE A 1411 passed \| 5 skipped with `IO_REQUIRE_PG=1` | Consistent with corrected evidence (isolated-PG gate; container + volume cleaned after the run). |

## Spec Alignment (delta scenarios covered)

All **24 delta scenarios** across the four delta specs (business-event 10, context-compiler 4, skill 3, worker-cycle 7) are traced below: 17 by authored Units 1–4 evidence and 7 INHERITED scenarios mapped to concrete pre-existing tests (HEAD/persisted code, green in the historical gates). No tests were executed during this documentary correction — every trace references already-persisted evidence, production code, or existing tests. The matrix below is the complete 24/24 map; the per-unit bullets after it preserve the authored evidence detail.

| # | Scenario | Delta spec | Evidence (concrete) | Coverage |
|---|---|---|---|---|
| 1 | Event construction is deterministic and isolated | business-event | `packages/business-domain/test/skill-outcome-event.test.ts` (11 tests: shape, determinism, equality, purity); Unit 4 `app-boundary.test.ts` zero-`@io/*` + zero runtime deps package-wide | Unit 1 + 4 |
| 2 | Composite empty selection is recorded | business-event | Unit 1 empty-selection payload test; Unit 3 R6 cycle-level composite fact `payload {version:1, activatedSkills: []}` | Unit 1 + 3 |
| 3 | Terminal close commits its events | business-event | Unit 3 T1 two-event contract (`work.completed` → one `work.skill-outcome` → `journal.complete`, trace-order proven); Unit 4 live-PG happy path (SQL counts + event rows) | Unit 3 + 4 |
| 4 | CAS loss leaves no orphan event | business-event | Unit 3 R5 CAS-loss zero-appends; Unit 4 stale-token E2E — 0 receipts, 0 events after rollback | Unit 3 + 4 |
| 5 | Completed replay does not append | business-event | Unit 4 `business-event-roundtrip.integration.test.ts` historical `work.completed` replay via `appendIfAbsent` → ON CONFLICT DO NOTHING, exactly one original row, no `work.skill-outcome` synthesized | Unit 4 |
| 6 | Duplicate throwing append is rejected | business-event | Unit 4 duplicate `evt:sk:att:acme:attempt-1` append throws `/duplicate key\|unique/i`; ORIGINAL v1 payload row preserved | Unit 4 |
| 7 | Decision identity is deterministic | business-event | **INHERITED** — `packages/business-domain/test/heartbeat-decision-event.test.ts`: `evt:hb:{sha256(companyId \0 (cursor ?? '') \0 kind).hex.slice(0,16)}`; both decision branches produce `evt:hb:{16-hex}` ids; clock excluded | Inherited (HEAD) |
| 8 | Acceptance identity is deterministic and namespaced | business-event | **INHERITED** — `packages/business-domain/test/work-accepted-event.test.ts` (11/11): `evt:acc:{workId}` depends solely on `workId` (different clocks/LLM outputs → same id), `source:'acceptor'`, disjoint from `hb:`/`att:`/`sk:` | Inherited (HEAD) |
| 9 | Retry conditionally appends once | business-event | **INHERITED** — `packages/app/test/supervisor/supervisor.test.ts:269` (`appendIfAbsent` no-ops — spec: "Retry does not duplicate the decision"); `packages/database/test/business-adapters.test.ts:982` (Pg `appendIfAbsent` at-most-once); live-PG `packages/database/test/business-event-roundtrip.integration.test.ts:178` (double `appendIfAbsent` → EXACTLY ONE ORIGINAL row) | Inherited (HEAD) |
| 10 | Skill-outcome identity is deterministic and non-material | business-event | Unit 1 `sk:` identity (occurredAt excluded, retry equality, disjoint namespace); Unit 4 roundtrip byte-identical + NOT in `MATERIAL_EVENT_TYPES` + heartbeat sha256 pin + no historical synthesis | Unit 1 + 4 |
| 11 | LlmClient-compatible result | context-compiler | Unit 2 `context-compiler.test.ts` `LlmClient` spy: zero client calls; `messages`/`user` asserted as consumable fields | Unit 2 |
| 12 | Exact selected identities are surfaced | context-compiler | Unit 2: `activatedSkills` equals segment-7 cohort in order (ASC from reversed input); refs match rendered seg-7 bytes order-for-order (same array) | Unit 2 |
| 13 | Output extension is byte-stable | context-compiler | Unit 2 `prefix-stability.test.ts`: golden pin + dynamic suffix + cohort bytes identical through full `compileContext`; fixture diff empty | Unit 2 |
| 14 | Empty selection is explicit without rendering change | context-compiler | Unit 2: `activatedSkills` is `[]` with `skills: []` AND with the key absent; segment 7 stays ABSENT (zero bytes) | Unit 2 |
| 15 | Captured version is attributed | skill | Unit 3 drift test (snapshot frozen at v1 after store publishes v2) + full-cycle v1 payload + fetch-once (`listCalls=['acme']`); Unit 1 refs carry `{skillId, version}` only | Unit 1 + 3 |
| 16 | Failure emits no usage outcome | skill | Unit 3 merged non-success dispositions (invalid-plan/denied/recovery-required → zero appends) + replay/DENY/T2(ii) zero appends | Unit 3 |
| 17 | Historical Work remains untouched | skill | Unit 4 historical `work.completed` replay → one original row, reading never synthesizes; cold-start no-backfill E2E retained as app-level proof | Unit 4 |
| 18 | In-flight record precedes the effect | worker-cycle | **INHERITED** — `packages/app/test/worker-intent.test.ts` `it('insertInFlight is committed BEFORE sandbox.execute', ...)` (HEAD:245; current:318): trace-order proof the durable in-flight row commits before the first external effect | Inherited (HEAD) |
| 19 | Version drift does not alter the outcome | worker-cycle | Unit 3 drift test + full-cycle v1 attribution end-to-end through `runWorker` → T1 | Unit 3 |
| 20 | Replay returns the recorded result | worker-cycle | **INHERITED** — `packages/app/test/worker-finalize.test.ts:505–527` «replay / DENY (WC atomic-close lookup)»: `{ ok: true, replayed: true, resultJson }`, R7 early-return BEFORE T1 — 0 receipts, 0 appends, 0 commits, Work untouched; `parity.test.ts:207` (B11 both replay); `worker-recovery-matrix.test.ts:415`; live-PG `e2e/replay-deny.integration.test.ts` | Inherited (HEAD) |
| 21 | Hash mismatch under the same key is denied | worker-cycle | **INHERITED** — `packages/app/test/worker-finalize.test.ts:529` (`completed + different hash → DENY idempotency-conflict: no receipt, no effect, no transaction`); `parity.test.ts:215` (B11 both DENY); live-PG `e2e/replay-deny.integration.test.ts:135` | Inherited (HEAD) |
| 22 | One receipt per terminal event | worker-cycle | **INHERITED** — `packages/app/test/e2e/single-receipt.integration.test.ts` (live-PG: `UNIQUE(work_id, terminal_event_id)` rejects a duplicate close, no second receipt); Unit-4 happy-path `it` asserts exactly one receipt | Inherited (HEAD) + Unit 4 |
| 23 | End-to-end happy path against live PostgreSQL | worker-cycle | Unit 4 full-cycle `it`: Work completed v3 + exactly one receipt + `work.completed` + one skill-outcome in the same close (live SQL counts + event-row contract) | Unit 4 |
| 24 | Stale-token close rolls back atomically | worker-cycle | Unit 4 live-PG E2E: holder presents token 0 against minted claim token 1 → fencing CAS loses → rollback → claim-ownership gate → typed `UNRESOLVED_REQUIRES_HUMAN`; Work/journal/receipt/both event stores unchanged; effect undone | Unit 4 |

**24/24 delta scenarios mapped** (17 authored + 7 inherited). The 7 inherited traces in detail:

1. **In-flight record precedes the effect** (worker-cycle) → `packages/app/test/worker-intent.test.ts` — `it('insertInFlight is committed BEFORE sandbox.execute', ...)` (HEAD:245; current:318): the trace index proves the durable in-flight row is committed before the first external `SandboxPort.execute` call (D6 pre-effect pattern). Pre-existing; unchanged by this change.
2. **Replay returns the recorded result** (worker-cycle) → `packages/app/test/worker-finalize.test.ts:505–527` «finalizeInFlightWorkAtomically — replay / DENY (WC atomic-close lookup)»: replay returns `{ ok: true, replayed: true, resultJson }` and early-returns BEFORE T1 — 0 receipts, 0 event appends, 0 commits, Work state untouched (`in_progress`). Cross-confirmed by `parity.test.ts:207` (B11: both app and foundation replay the recorded result), `worker-recovery-matrix.test.ts:415`, and live-PG `e2e/replay-deny.integration.test.ts`.
3. **Hash mismatch under the same key is denied** (worker-cycle) → `packages/app/test/worker-finalize.test.ts:529` (`completed + different hash → DENY idempotency-conflict: no receipt, no effect, no transaction`); `parity.test.ts:215` (B11: completed + different hash → BOTH DENY); live-PG `e2e/replay-deny.integration.test.ts:135`.
4. **One receipt per terminal event** (worker-cycle) → `packages/app/test/e2e/single-receipt.integration.test.ts` (live-PG: `UNIQUE(work_id, terminal_event_id)` rejects a duplicate close for the same terminal event — no second receipt, even with a different receipt_id); the Unit-4 happy-path `it` additionally asserts exactly one receipt in the two-event close.
5. **Decision identity is deterministic** (business-event) → `packages/business-domain/test/heartbeat-decision-event.test.ts`: decision IDs are `evt:hb:{sha256(companyId \0 (cursor ?? '') \0 kind).hex.slice(0,16)}`; both decision branches produce `evt:hb:{16-hex}` ids and identical inputs with different clocks produce the same id.
6. **Acceptance identity is deterministic and namespaced** (business-event) → `packages/business-domain/test/work-accepted-event.test.ts` (11/11): `evt:acc:{workId}` depends SOLELY on `workId` — different clocks and different LLM outputs produce the same id; `source:'acceptor'`; distinct from `hb:`, `att:`, and `sk:`.
7. **Retry conditionally appends once** (business-event) → `packages/app/test/supervisor/supervisor.test.ts:269` (`appendIfAbsent` no-ops on retry — spec: "Retry does not duplicate the decision"); `packages/database/test/business-adapters.test.ts:982` (`PgBusinessEventRepository.appendIfAbsent` at-most-once conditional append); live-PG `packages/database/test/business-event-roundtrip.integration.test.ts:178` (double `appendIfAbsent` of the same `event_id` leaves EXACTLY ONE ORIGINAL row via ON CONFLICT DO NOTHING).

### Unit 1

- business-event «Event construction is deterministic and isolated» → determinism/equality tests + purity boundary test.
- business-event «Composite empty selection is recorded» → empty-selection payload test.
- business-event «Skill-outcome identity is deterministic and non-material» → identity tests (non-materiality + heartbeat unchanged asserted in Unit 4).
- skill «Captured version is attributed» → payload preserves the intent-captured `activatedSkills` identities/versions (drift semantics exercised end-to-end in Unit 3).

### Unit 2

- context-compiler «LlmClient-compatible result» → spy test proves zero client calls; `messages`/`user` shapes asserted as consumable fields.
- context-compiler «Exact selected identities are surfaced» → `activatedSkills` equals segment-7 cohort in order (ASC), and refs match the rendered seg-7 bytes order-for-order (same selection, same array).
- context-compiler «Output extension is byte-stable» → golden pin + `buildDynamicSuffix` + `deriveCohort` bytes identical through the full `compileContext` path; `git diff` over the fixture directory is empty.
- context-compiler «Empty selection is explicit without rendering change» → `activatedSkills` is `[]` (empty list) with `skills: []` AND with the key absent, while segment 7 stays ABSENT (zero bytes).
- skill «Captured version is attributed» → refs carry `{ skillId, version }` only; version-drift end-to-end semantics deferred to Unit 3 (intent threading).

### Unit 3

- worker-cycle «Intent Recorded Before the Effect» → `prepareIntent` returns the exact compiler selection; drift test proves the captured snapshot is frozen at v1 after the store publishes v2; full-cycle test proves fetch-once (`listCalls=['acme']`) — finalize never re-reads skills.
- worker-cycle «Version drift does not alter the outcome» → the appended skill-outcome payload attributes v1 only (intent-time refs), end-to-end through `runWorker` → T1.
- worker-cycle «Atomic Terminal Close» → T1 appends `work.completed` then exactly one `work.skill-outcome` before `journal.complete` (trace-order proven); CAS loss/replay/DENY/invalid-plan/recovery-required emit no outcome (zero appends asserted on every non-success disposition).
- business-event «Terminal close commits its events» / «CAS loss leaves no orphan event» / «Atomic Worker Terminal Emission» → T1-success two-event contract + R5 orphan guards (CAS-loss, T2(ii), replay, DENY all assert zero appends).
- business-event «Composite empty selection is recorded» → R6 cycles (no skills) append one composite fact with `payload {version:1, activatedSkills: []}`.
- skill «Captured version is attributed» / «Failure emits no usage outcome» → v1 payload end-to-end + merged non-success dispositions test (invalid-plan/denied/recovery-required → zero appends).

### Unit 4

- worker-cycle «End-to-end happy path against live PostgreSQL» → full-cycle `it` persists Work completed v3 + exactly one receipt + `work.completed` + one skill-outcome in the same close (live SQL counts + event-row contract).
- worker-cycle «Stale-token close rolls back atomically» → live-PG test: holder presents token 0 against minted claim token 1 → T1 fencing CAS loses → rollback → claim-ownership gate → typed `UNRESOLVED_REQUIRES_HUMAN`; Work (in_progress v2 token 1), journal (in_flight token 1), receipt (0 rows) and BOTH event stores (0 rows) unchanged; zombie effect undone.
- business-event «Duplicate throwing append is rejected» → live-PG duplicate `evt:sk:att:acme:attempt-1` append throws `/duplicate key|unique/i` and preserves the ORIGINAL v1 payload row.
- business-event «Skill-outcome identity is deterministic and non-material» → v1 payload round-trip byte-identical; `work.skill-outcome` NOT in `MATERIAL_EVENT_TYPES` (declared set unchanged); heartbeat.ts sha256-pinned byte-identical to committed baseline.
- business-event «Pure Deterministic BusinessEvent» → `business-domain` manifest zero runtime deps + package-wide zero `@io/*`; builder's only import is `./types.js`; `openai` confined to `llm-client/src/deepseek-client.ts`.
- skill «Historical Work remains untouched» → historical pre-change `work.completed` row: replay via appendIfAbsent lands ON CONFLICT DO NOTHING (exactly one original row), reading never synthesizes a `work.skill-outcome` (no backfill; cold-start no-backfill E2E retained as the app-level proof).
- Namespaces disjoint sweep (4.4 GATE): `sk:` (skill-outcome-event.test.ts «disjoint sk: namespace»), `att:` (worker identity), `hb:` (heartbeat decision), `acc:` (acceptor) — each namespace's builder + exclusive source asserted; zero `evt:` collisions; no migration/backfill (`git status --porcelain -- packages/database/sql` empty).

## Deviations from Design

None — implementation matches design.md Interfaces/Contracts exactly. Notes (non-deviations):

1. `ActivatedSkillRef` is re-exported from `@io/business-domain` (defined once in Unit 1) rather than re-defined in `@io/context` — single source of truth; design's «Define/export ActivatedSkillRef» intent (context surfaces the type) is satisfied via the public re-export, and the boundary test's `@io/business-domain`-only import rule is respected.
2. The seg-7 render override in `compileContext` is implemented as a per-call closure over the selected array (SEGMENTS stays frozen and byte-stable) — the "render receives the selected Skill[]" design decision, with zero re-selection.
3. (Unit 3) The byte-identity pin for `worker/worker.ts` moved to the Unit-3 baseline and the PR2/PR4 normalization proofs gained `stripSkillOutcomeThreading` — the established PR1/PR2/PR4 pattern for a designed core-file modification; the proofs still land on the historical baselines, proving the drift is ONLY the two `activatedSkills` threading lines.
4. (Unit 3) `FinalizeInput.activatedSkills` is REQUIRED (not optional): the design's "thread the immutable selection to finalization" is a hard contract — every caller (worker, recovery, tests) supplies it explicitly; recovery and failure reconciles carry `[]` because they never emit outcomes.
5. (Unit 3) The dedicated finalize-level empty-selection test was folded into R6 (cycle-level empty-selection emission, `activatedSkills: []` payload) to stay inside the 340-line slice budget — the direct-level non-empty path remains covered by the T1-success test.
6. (Unit 4) The stale-token E2E drives `finalizeInFlightWorkAtomically` DIRECTLY (claim → insertInFlight → effect → stale finalize) rather than through `runWorker` — the worker always presents the correctly minted token, so the zombie-writer scenario (spec GIVEN: a holder supplies the WRONG token) can only be exercised at the finalize boundary, matching the unit-level stale-token proof against live PG. No production deviation.

## Issues Found

1. **Pre-existing latent `assist/source/organizeImports` violation in `packages/business-domain/src/index.ts`** — the HEAD file already fails `biome check` (verified against HEAD content); `biome check` is not a repo gate (`pnpm check` runs `biome format` + `biome lint` only, both green). New exports were placed in the biome-preferred sorted position; the full re-sort is churn outside this slice. Non-blocking.
2. None else — no `@io/*` imports added to context beyond the allowed `@io/business-domain`; no client accepted or invoked; golden fixture untouched; no consumers broken by the additive field (full-suite green).
3. (Unit 3) Pre-existing warning-only lint findings untouched by this slice (not introduced, not gate-failing): 6 `noNonNullAssertion` in `parity.test.ts:348–428` and 1 `noUnusedImports` (`EffectRecord`/`SandboxAction`) in `worker-reconcile.test.ts:19`. Reported for the record; `pnpm check` gates (`biome format` + `biome lint` exit 0) remain green.
4. (Unit 3) Two botched edit-tool applications during test authoring (a call-site override landing on the wrong test and a joined line) were detected by the RED→GREEN run and repaired before GREEN; net effect zero, final diff reviewed clean.
5. (Unit 4) The 4.1 RED run failed on a test-authoring gap (`E2E_REQUEST_HASH` not imported in worker-e2e.integration.test.ts) — repaired by adding the import, NOT a production defect; the stale-token production behavior (fencing CAS, rollback, claim-ownership gate) was already correct and passed unmodified. Also: the `WorkerDeps` optional `connection`/`repositories` fields needed explicit narrowing guards in the new E2E test for `tsc` strict (no production change).
6. (Unit 4) Full-suite skipped count moved 6 → 5: `pg-required.integration.test.ts` now RUNS because `IO_REQUIRE_PG=1` was injected for the isolated harness (its earlier skip was the shared-DB local default). Remaining skips are token-gated/offline suites, unrelated to this change.

## Remaining Tasks

- None — all 19 tasks (1.1–4.4) are complete. Next phase: sdd-verify.

## Workload / PR Boundary

- Mode: chained PR slice (auto-chain; stacked-to-main)
- Current work unit: `atomic-proof-boundaries-spec-gates` (Unit 4), stacked on Units 1–3
- Boundary (Unit 4): starts at the Unit 3 HEAD state, ends with live-PG stale-token rollback + roundtrip/duplicate/no-backfill + boundary/non-materiality/heartbeat proofs + `pnpm check` GATE green; focused 27/27; full `pnpm test` GATE A `1411 passed | 5 skipped` (isolated-PG, `IO_REQUIRE_PG=1`) and GATE B fresh non-PG validation `1410 passed | 6 skipped` (exit 0, ordinary suite only); NO production source changes (test-only slice)
- Review budget impact: 284 changed lines used (slice cap 360 respected) — test-only; 1041 cumulative implementation lines across Units 1–4 (per-slice accounting, stacked-to-main authorized)

## Status

4/4 tasks in Unit 4 batch complete (19/19 cumulative Units 1–4). **All 19 tasks [x] — ready for sdd-verify.**

CORRECTION (2026-08-13, gatekeeper, Unit 1): slice counts corrected from 218 (66+145+7) to 217 (66+145+6) wherever they appeared — Scope & PR Boundary, Rollback boundary (7→6 export lines), Files Changed table (index.ts +7→+6), total slice line, and Review budget impact. Added Work-Unit Budget & Full Snapshot section with disk-measured counts (6 tracked + 765 untracked = 771). Planning artifacts are not imputed to the Unit 1 implementation budget (217 ≤ 220). TDD/Work Unit Evidence otherwise preserved.

UNIT 2 (2026-08-13): added Unit 2 batch (tasks 2.1–2.5, 201 changed lines ≤ 260 cap) preserving ALL Unit 1 progress/evidence verbatim above. Unit 2 evidence: RED runs `4 failed | 17 passed (21)` and `1 failed | 11 passed (12)`; GREEN runs `33 passed (33)` focused and `55 passed (55)` packages/context; golden diff empty; full `pnpm test` `1398 passed | 6 skipped`. Attempt token `sha256:e3409ea7d60655a6178696f3a70cd1d705c5c9bae3257ae2b6979842030b448e` (native attempt acquired by orchestrator — no acquire/settle performed by apply).

CORRECTION (2026-08-13, gatekeeper, Unit 2 snapshot): the Full Snapshot table still carried the Unit 1 baseline total (771: 6 tracked + 765 untracked) after Unit 2 was applied. Snapshots are cumulative — the baseline is superseded by a fresh disk measurement of the whole change. Re-measured from disk after this edit: tracked 207 (Unit 1: +6 in `business-domain/src/index.ts`; Unit 2: 201 across `context/src/index.ts` +43, `segments.ts` +41, `context-compiler.test.ts` +70, `prefix-stability.test.ts` +47) + untracked (implementation Unit 1: 211; planning artifacts: 452; apply artifacts: `apply-progress.md` current count, `[x]` state inside `tasks.md` counted above; `.pi` runtime non-SDD: 3). Gatekeeper pre-correction observation: 207 tracked + 834 untracked = 1041 (apply-progress 168); final corrected total re-measured after the edit (see table above — the edit itself changed the file's line count). Unit budgets are authored implementation of the batch and are unchanged: Unit 1 = 217 ≤ 220, Unit 2 = 201 ≤ 260 (isolated accounting confirmed correct). All Unit 1/Unit 2 evidence and future-task entries preserved verbatim.

UNIT 3 (2026-08-13, apply): added Unit 3 batch (tasks 3.1–3.6, 339 changed lines ≤ 340 cap) preserving ALL Unit 1/Unit 2 progress/evidence verbatim above. Unit 3 evidence: RED runs `3 failed | 16 passed (19)` (worker-intent) and `5 failed | 12 passed (17)` (worker-finalize); GREEN runs `32 passed (32)` focused and `119 passed (119)` worker suite; byte-identity 11/11 (pin re-pinned + normalization proofs extended — PR1/SLICE3 baselines intact); full `pnpm test` `1402 passed | 6 skipped` (5 stale live-PG one-event assertions updated to the two-event contract; heartbeat gate decision unchanged — non-material proof). Required-field ripple: `recover.ts` + `parity.test.ts` + `worker-verify.test.ts` + `worker-reconcile.test.ts` carry `activatedSkills`. Attempt token `sha256:be3b95eaafff12fb2f10c4d98892671d59d1eea1b06fdd1432f749c6e4f69796` (native attempt acquired by orchestrator — no acquire/settle performed by apply).

UNIT 4 (2026-08-13, apply): added Unit 4 batch (tasks 4.1–4.4, 284 changed lines ≤ 360 cap — TEST-ONLY, zero production source changes) preserving ALL Unit 1/Unit 2/Unit 3 progress/evidence verbatim above. Unit 4 evidence: isolated dedicated PG 18.4 harness `io-unit4-iso-pg-9cad4d9e` (127.0.0.1:55432, NOT the shared `io_pg` on 5432; identity/port verified via `SELECT version()`; `DATABASE_URL` injected env-first without printing credentials; `IO_REQUIRE_PG=1` → PG tests required, none skipped); Safety Net `3 files, 19 passed (19)`; 4.1 RED `1 failed | 1 passed (2)` (missing `E2E_REQUEST_HASH` import — test-authoring repair) → GREEN `2 passed (2)`; 4.2 GREEN `17 passed (17)`; 4.3 GREEN `8 passed (8)`; focused set `27 passed (27)`; GATE `pnpm check` exit 0 — format-check 213 files, typecheck, build, lint (9 pre-existing warnings), full `pnpm test` `1411 passed | 5 skipped` (102 files passed | 2 skipped); spec-alignment sweep complete (all delta scenarios → passing tests; namespaces disjoint `sk:`/`att:`/`hb:`/`acc:`; no migration — `packages/database/sql` untouched). Harness cleaned after the run (`docker rm -f io-unit4-iso-pg-9cad4d9e`) with evidence recorded. Attempt token `sha256:6ffa0a5f507697259115c5a8c9bc578f33429fbf626a12c130bf2e7f2e22760b` (native attempt `skill-outcome-events-unit4-20260813-a1` acquired by orchestrator — no acquire/settle performed by apply).

GATEKEEPER CORRECTION (2026-08-13, documentary phase-gate fix — source/tests untouched, no acquire/settle/reset, no commit/stage/push/review; memory #6589/#6590): applied the 5 gatekeeper findings to this artifact only:
1. **Snapshot recomputed AFTER this edit from disk**: tracked 830 per-file (`git diff --numstat`, table above; Unit 1 = 6, Unit 2 = 201, Unit 3 = 339, Unit 4 = 284) + untracked per category (implementation 211; planning 454 with `tasks.md` at 61; apply artifacts = this file's final count; `.pi` 3). The stale published total **1730 (830 tracked + 900 untracked)** was internally inconsistent (its untracked rows summed 925 → 1755) and is superseded by the disk-measured table. Correct pre-edit measurement: **1783 (830 + 953)**; post-edit total in the table above.
2. **Two gates separated, not conflated**: GATE A = historical/native Unit 4 with `IO_REQUIRE_PG=1` on the dedicated isolated PG 18.4 harness → `pnpm check` exit 0, **1411 passed | 5 skipped**, PG executed. GATE B = fresh validation WITHOUT `IO_REQUIRE_PG` (gatekeeper-observed) → `pnpm check` exit 0, **1410 passed | 6 skipped** — confirms the ordinary suite only and does NOT replace GATE A.
3. **Native Unit 3 receipt immutable**: `sha256:216b8fe1…` keeps process_evidence `focused-36-worker-123-full-1402-typecheck-format-build-green`; documented in Native Evidence Reconciliation as STALE (`changed_lines` 339 and `full-1402` match; focused 36/worker 123 do not — corrected evidence is 32/119). The receipt was NOT altered and its label is NOT count authority.
4. **Native Unit 1 `changed_lines: 6`**: tracked-only measurement (excluded the 211 untracked lines); real Unit-1 slice = **217 by disk evidence** (66 + 145 + 6). Limitation documented; no settle fabricated.
5. **Spec Alignment expanded to 24/24**: complete matrix + 7 inherited scenarios traced to concrete existing tests (in-flight-before-effect `worker-intent.test.ts:318`, replay `worker-finalize.test.ts:505`, hash mismatch `worker-finalize.test.ts:529`, one receipt `single-receipt.integration.test.ts`, decision identity `heartbeat-decision-event.test.ts`, acceptance identity `work-accepted-event.test.ts`, retry appendIfAbsent `supervisor.test.ts:269` + `business-adapters.test.ts:982` + roundtrip `:178`). No tests executed during this correction.

All 19/19 tasks remain [x]; all Units 1–4 TDD/Work Unit/Files-Changed evidence preserved verbatim.

Session: validate-skill-outcome-events-design-20260813
Project: io
Scope: project
Topic: sdd/skill-outcome-events/apply-progress
Duplicates: 1
Revisions: 11
Created: 2026-08-13 10:53:00
