# Apply Progress: heartbeats — PR1 + PR2 (all 10 tasks complete)

- Batches: 1 (PR1) + 2 (PR2, this batch) — MERGED cumulative state
- Scope: **PR1** `packages/business-domain` heartbeat module (tasks 1.1–1.6) → **PR2** `packages/app` read-only evaluator seam (tasks 2.1–2.4)
- Mode: Strict TDD (RED → GREEN per task, `PATH=/data/node24/bin:$PATH pnpm vitest run` per task)
- Baseline: `main@2f25358` (PR1) → `main@b22e8c5` (PR2 start; PR1 committed); PR2 changes left UNCOMMITTED
- Chain: `stacked-to-main`; PR1 targets `main` (committed @b22e8c5), PR2 stacks on PR1. Review budget: each PR ≤400 lines (PR2 ~130–170).

## Completed tasks

### Phase 1 (PR1) — business-domain heartbeat module

- [x] 1.1 RED `packages/business-domain/test/heartbeat.test.ts`: decision-branch equality + boundary (zero `@io/*` src scan, empty package.json deps). [R1, R8]
- [x] 1.2 GREEN create `packages/business-domain/src/heartbeat.ts` (`HeartbeatDecision`, `HeartbeatCursor`); re-export from `src/index.ts`. [R1]
- [x] 1.3 RED+GREEN `MATERIAL_EVENT_TYPES` + `isMaterialEvent` table. [R2]
- [x] 1.4 RED+GREEN `hasMaterialNovelty` / `evaluateHeartbeat` insertion-index cursor. [R4]
- [x] 1.5 RED+GREEN determinism: identical inputs → identical decision; no `Date`/`Math.random`/generated ids in module (structural). [R3]
- [x] 1.6 RED+GREEN inverse-poison + cross-tenant isolation via `InMemoryBusinessEventRepository`. [R5, R7]

### Phase 2 (PR2) — app read-only seam

- [x] 2.1 RED+GREEN seam plumbing (ATOMIC): `WorkerDeps.events: BusinessEventRepository` (types.ts), `RecordingEvents.listCalls` (worker-helpers.ts), pool-bound `events: new PgBusinessEventRepository(connection)` (composition root), composition test asserts instance. [R6]
- [x] 2.2 RED `packages/app/test/heartbeat/evaluate.test.ts`: decision table — empty stream → no-llm; unseen `work.completed` → activate; seen cursor → no-llm; `listCalls.length === 1`, `appends` unchanged (zero evaluator writes); empty `companyId` rejected before list. [R6, R7]
- [x] 2.3 GREEN create `packages/app/src/heartbeat/evaluate.ts` `evaluateHeartbeatForCompany({events}, companyId, cursor?)`: reject empty tenant before read; exactly one `listByCompany`; return domain decision; zero writes. [R6]
- [x] 2.4 RED+GREEN `packages/app/test/heartbeat/heartbeat.integration.test.ts` (sequential, `skipIf(!reachable && !e2eRequirePg)`, e2e harness): post-`runWorker` cycle ⇒ activate flash; fresh company ⇒ no-llm-heartbeat; live event count unchanged after evaluation. [R6, R7]

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `business-domain/test/heartbeat.test.ts` | Unit | ✅ 208/208 (business-domain) | ✅ Written — suite failed: `Cannot find module '../src/heartbeat.js'` | ✅ Passed 6/6 after 1.2 | ✅ 6 cases (both branches + union shape + index types + 2 boundary) | ✅ Clean |
| 1.2 | `business-domain/test/heartbeat.test.ts` | Unit | N/A (new files) | ✅ (via 1.1 RED) | ✅ Passed 6/6 | ➖ Single (type-only module) | ✅ Clean |
| 1.3 | `business-domain/test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written — 3 failed (`MATERIAL_EVENT_TYPES` undefined, `isMaterialEvent` not a function) | ✅ Passed 9/9 | ✅ 8 undeclared eventTypes + declared | ✅ Clean |
| 1.4 | `business-domain/test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written — 12 failed (functions absent) | ✅ Passed 24/24 after 1.4 impl | ✅ 7 novelty scenarios + lexicographic discriminator | ✅ Clean |
| 1.5 | `business-domain/test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written with 1.4 batch (same two functions absent → genuine failure) | ✅ Passed 24/24 (determinism + ambient-patch + structural scan) | ✅ 3 cases (repeated calls, patched clock/random, source scan) | ✅ Clean |
| 1.6 | `business-domain/test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written with 1.4 batch (functions absent → genuine failure) | ✅ Passed 24/24 (inverse-poison, signature-only, import-set, cross-tenant) | ✅ 4 cases | ✅ Clean |
| 2.1 | `app/test/composition/worker-deps.test.ts` | Unit | ✅ 7/7 (composition) + ✅ 19/19 (worker-authority/finalize) | ✅ Written — `deps.events` undefined → `instanceof PgBusinessEventRepository` failed (1 failed / 6 passed) | ✅ Passed 26/26 after ATOMIC wiring | ✅ 1 (assert + existing adapter asserts) | ✅ Clean |
| 2.2 | `app/test/heartbeat/evaluate.test.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module '../../src/heartbeat/evaluate.js'` (module absent) | ✅ Passed 7/7 after 2.3 | ✅ 6 cases: empty stream / unseen activate / seen cursor / mid-stream activate / one-list-zero-writes / empty-tenant / cross-tenant | ✅ Clean |
| 2.3 | `app/src/heartbeat/evaluate.ts` + `evaluate.test.ts` | Unit | ✅ 7/7 | ✅ (via 2.2 RED) | ✅ Passed 7/7 | ✅ (via 2.2 triangulation) | ✅ Clean |
| 2.4 | `app/test/heartbeat/heartbeat.integration.test.ts` | Integration (live PG) | N/A (new file) | ✅ Written — seam module temporarily removed → import failed (module not found) | ✅ Passed 1/1 against live PG (io_pg) | ✅ 2 assertions: post-cycle activate + fresh-company no-llm + live-count unchanged | ✅ Clean |

Note: 2.2/2.3 share one cycle (2.2 RED → 2.3 GREEN → 2.2 GREEN). 2.4's RED was observed by temporarily removing the seam module so the integration import genuinely failed before GREEN.

## Work Unit Evidence

| Evidence | Required value |
|----------|----------------|
| Focused test command + exact result | PR1: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/heartbeat.test.ts` → 24/24 passed. PR2: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/heartbeat packages/app/test/composition/worker-deps.test.ts` → **3 files passed, 15/15 tests passed** |
| Runtime harness command/scenario + exact result | PR1: N/A (pure domain module). PR2: `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/heartbeat/heartbeat.integration.test.ts` → **1/1 passed against live PG (io_pg)** — post-cycle activate, fresh-company no-llm, live `business_event` count unchanged (zero writes proven) |
| Rollback boundary | Revert PR2 files only: `app/src/heartbeat/evaluate.ts`, `types.ts` events field, `worker-deps.ts` wiring, `worker-helpers.ts` listCalls, `heartbeat/` tests, `worker-deps.test.ts` assert. PR1 domain module stays. Zero data impact, additive only. |

## Files changed (cumulative)

| File | Action | What was done |
|------|--------|---------------|
| `packages/business-domain/src/heartbeat.ts` | Created (PR1) | `HeartbeatDecision`, `HeartbeatCursor`, `MATERIAL_EVENT_TYPES`, `isMaterialEvent`, `hasMaterialNovelty` (insertion-index), `evaluateHeartbeat`. Zero `@io/*` imports |
| `packages/business-domain/src/index.ts` | Modified (PR1) | Re-export heartbeat types + values |
| `packages/business-domain/test/heartbeat.test.ts` | Created (PR1) | 24 tests across R1–R5, R7, R8 |
| `packages/app/src/heartbeat/evaluate.ts` | Created (PR2) | `evaluateHeartbeatForCompany({events}, companyId, cursor?)`: rejects empty tenant BEFORE read; exactly one `listByCompany`; delegates to pure `evaluateHeartbeat`; ZERO writes |
| `packages/app/src/worker/types.ts` | Modified (PR2) | Added `events: BusinessEventRepository` to top-level `WorkerDeps` (read-only heartbeat seam; type already imported from `@io/business-domain/src/ports/repositories.js`) |
| `packages/app/src/composition/worker-deps.ts` | Modified (PR2) | Wired `events: new PgBusinessEventRepository(connection)` — pool-bound, read-only, outside any transaction |
| `packages/app/test/worker-helpers.ts` | Modified (PR2) | `RecordingEvents` gains `listCalls: string[]` tracking (already satisfies `WorkerDeps.events` via existing `events: RecordingEvents`) |
| `packages/app/test/heartbeat/evaluate.test.ts` | Created (PR2) | 7 tests: decision table, exactly-one-list + zero-writes proof, empty-tenant rejection before list, cross-tenant isolation |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Created (PR2) | 1 sequential live-PG test: post-cycle activate, fresh-company no-llm, live count unchanged |
| `packages/app/test/composition/worker-deps.test.ts` | Modified (PR2) | Assert `deps.events instanceof PgBusinessEventRepository` |

## Gate result (cumulative)

- PR1 gate: `PATH=/data/node24/bin:$PATH pnpm check` → GREEN — 960 passed | 6 skipped (75 files).
- PR2 gate (this batch): `PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check, typecheck, build, lint, full test run) — **968 passed | 6 skipped (77 files)** = 960 + 8 new (7 seam + 1 live-PG integration). Zero biome warnings on changed files.

## Deviations from design

None — implementation matches design.md: free `evaluateHeartbeatForCompany` + top-level `WorkerDeps.events` (skills precedent), pool-bound `PgBusinessEventRepository` in `buildWorkerDeps` (additive; T1 factory unchanged), zero writes proven via `RecordingEvents.listCalls`/`appends`.

## Issues found

None. (2.2's initial `appends.length === 0` assertions counted SEED appends from test setup — corrected to baseline-captured `writesBefore` so the zero-writes proof targets the EVALUATOR, not the seed.)

## Status

**10/10 tasks complete** (PR1 1.1–1.6 + PR2 2.1–2.4). Both gates green. PR2 changes left UNCOMMITTED in the working tree for the orchestrator's review-gated commit (PR2 stacked on PR1 @b22e8c5). Ready for sdd-verify.
