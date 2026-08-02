# Apply Progress: heartbeats — PR1 (business-domain heartbeat module)

- Batch: 1 (FIRST apply batch)
- Scope: **PR1 ONLY** — `packages/business-domain` heartbeat module (tasks 1.1–1.6)
- Mode: Strict TDD (RED → GREEN per task, `PATH=/data/node24/bin:$PATH pnpm vitest run` per task)
- Baseline: `main@2f25358`, business-domain suite 9 files / 208 tests passing (safety net)
- Chain: `stacked-to-main`; PR1 targets `main`, PR2 stacks on PR1. Review budget: ~140–180 lines (within 400).

## Completed tasks

- [x] 1.1 RED `packages/business-domain/test/heartbeat.test.ts`: decision-branch equality + boundary (zero `@io/*` src scan, empty package.json deps). [R1, R8]
- [x] 1.2 GREEN create `packages/business-domain/src/heartbeat.ts` (`HeartbeatDecision`, `HeartbeatCursor`); re-export from `src/index.ts`. [R1]
- [x] 1.3 RED+GREEN `MATERIAL_EVENT_TYPES` + `isMaterialEvent` table. [R2]
- [x] 1.4 RED+GREEN `hasMaterialNovelty` / `evaluateHeartbeat` insertion-index cursor. [R4]
- [x] 1.5 RED+GREEN determinism: identical inputs → identical decision; no `Date`/`Math.random`/generated ids in module (structural). [R3]
- [x] 1.6 RED+GREEN inverse-poison + cross-tenant isolation via `InMemoryBusinessEventRepository`. [R5, R7]

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/heartbeat.test.ts` | Unit | ✅ 208/208 (business-domain) | ✅ Written — suite failed: `Cannot find module '../src/heartbeat.js'` | ✅ Passed 6/6 after 1.2 | ✅ 6 cases (both branches + union shape + index types + 2 boundary) | ✅ Clean |
| 1.2 | `test/heartbeat.test.ts` | Unit | N/A (new files) | ✅ (via 1.1 RED) | ✅ Passed 6/6 | ➖ Single (type-only module) | ✅ Clean |
| 1.3 | `test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written — 3 failed (`MATERIAL_EVENT_TYPES` undefined, `isMaterialEvent` not a function) | ✅ Passed 9/9 | ✅ 8 undeclared eventTypes + declared | ✅ Clean |
| 1.4 | `test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written — 12 failed (functions absent) | ✅ Passed 24/24 after 1.4 impl | ✅ 7 novelty scenarios + lexicographic discriminator | ✅ Clean |
| 1.5 | `test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written with 1.4 batch (same two functions absent → genuine failure) | ✅ Passed 24/24 (determinism + ambient-patch + structural scan) | ✅ 3 cases (repeated calls, patched clock/random, source scan) | ✅ Clean |
| 1.6 | `test/heartbeat.test.ts` | Unit | ✅ 9/9 | ✅ Written with 1.4 batch (functions absent → genuine failure) | ✅ Passed 24/24 (inverse-poison, signature-only, import-set, cross-tenant) | ✅ 4 cases | ✅ Clean |

Note: 1.4/1.5/1.6 cover the SAME two pure functions (`hasMaterialNovelty`, `evaluateHeartbeat`) — the design treats the determinism/purity discipline as one slice. Their RED tests were written together (before any implementation of those functions) and went GREEN together in one minimal implementation; each task's RED is genuine (observed failure) and each task's GREEN is execution-confirmed.

## Work Unit Evidence

| Evidence | Required value |
|----------|----------------|
| Focused test command + exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/heartbeat.test.ts` → **1 file passed, 24/24 tests passed** |
| Runtime harness | **N/A** — pure domain module, no I/O boundary (matches tasks.md Work Unit 1 harness) |
| Rollback boundary | Revert `src/heartbeat.ts`, `src/index.ts` heartbeat exports, `test/heartbeat.test.ts`; zero data impact, additive only |

## Files changed

| File | Action | What was done |
|------|--------|---------------|
| `packages/business-domain/src/heartbeat.ts` | Created | `HeartbeatDecision`, `HeartbeatCursor`, `MATERIAL_EVENT_TYPES`, `isMaterialEvent`, `hasMaterialNovelty` (insertion-index), `evaluateHeartbeat`. Zero `@io/*` imports, imports only `./types.js` |
| `packages/business-domain/src/index.ts` | Modified | Re-export heartbeat types + values |
| `packages/business-domain/test/heartbeat.test.ts` | Created | 24 tests across R1–R5, R7, R8 (decision, materiality, insertion-index novelty, determinism, inverse-poison, cross-tenant, boundary) |

## Gate result

- `PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check, typecheck, build, lint, full test run)
  - Tests: **960 passed | 6 skipped** (75 files) — baseline 936 → +24 (all from heartbeat.test.ts)
  - No biome warnings on changed files (1 unused-import warning found and fixed during the run)

## Deviations from design

None — implementation matches design.md (decision/cursor shapes, insertion-index cursor algorithm points 1–6, `MATERIAL_EVENT_TYPES` as `readonly ['work.completed']`).

## Issues found

None.

## Remaining (PR2 — NOT this batch)

- [ ] 2.1 RED+GREEN seam plumbing: `WorkerDeps.events: BusinessEventRepository`, `RecordingEvents.listCalls`, `buildWorkerDeps` wiring, composition assert. [R6]
- [ ] 2.2 RED `packages/app/test/heartbeat/evaluate.test.ts` decision table + zero writes. [R6, R7]
- [ ] 2.3 GREEN `packages/app/src/heartbeat/evaluate.ts` `evaluateHeartbeatForCompany`. [R6]
- [ ] 2.4 RED+GREEN live-PG sequential integration test. [R6, R7]
- Phase gate: `pnpm check`. Rollback = revert PR2 files; PR1 domain module stays.

## Status

6/6 PR1 tasks complete. PR1 verified (focused + full gate green), changes left UNCOMMITTED in the working tree for the orchestrator's review-gated commit. Ready for PR2 apply batch.
