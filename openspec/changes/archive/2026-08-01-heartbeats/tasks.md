# Tasks: Heartbeats — deterministic novelty filter (§13.2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~270–350 total (PR1 ~140–180, PR2 ~130–170) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (domain) → PR2 (app), stacked-to-main |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure heartbeat module, exports, unit tests | PR1 | `pnpm vitest run packages/business-domain/test/heartbeat.test.ts` | N/A — pure function, no I/O boundary | Revert `src/heartbeat.ts`, `src/index.ts` exports, test |
| 2 | Read-only evaluator, `WorkerDeps.events` seam, live-PG proof | PR2 | `pnpm vitest run packages/app/test/heartbeat --no-file-parallelism` | Live PG `io_dev`; post-cycle ⇒ activate, fresh ⇒ no-llm | Revert `src/heartbeat/`, `types.ts`/`worker-deps.ts` wiring, tests |

Prefix every command with `PATH=/data/node24/bin:$PATH`. Strict TDD: RED must fail before GREEN.

## Phase 1: PR1 — business-domain heartbeat (pure filter)

Per-task verify: `pnpm vitest run packages/business-domain/test/heartbeat.test.ts`.

- [x] 1.1 RED `packages/business-domain/test/heartbeat.test.ts`: both decision branches equal across repeated construction; boundary: zero `@io/*` src scan + empty `package.json` deps (copy business-event boundary). [R1, R8]
- [x] 1.2 GREEN create `packages/business-domain/src/heartbeat.ts` (`HeartbeatDecision`, `HeartbeatCursor`); re-export from `src/index.ts`. [R1]
- [x] 1.3 RED+GREEN `MATERIAL_EVENT_TYPES === ['work.completed']`; `isMaterialEvent` table: declared → material, undeclared → not. [R2]
- [x] 1.4 RED+GREEN (isolated, subtle) `hasMaterialNovelty`/`evaluateHeartbeat` insertion-index cursor: absent + material → activate; cursor at/after last material → no-llm; missing id → no-llm (`index = events.length`). Never compares id strings. [R4]
- [x] 1.5 RED+GREEN determinism: identical inputs → identical decision; varied clock/randomness/id sources → unchanged; no `Date`/`Math.random` in module. [R3]
- [x] 1.6 RED+GREEN inverse-poison: identical events+cursor under differing fake work/delegation/context worlds → identical decision; cross-tenant isolation via `InMemoryBusinessEventRepository` (A material, B none → B no-llm). [R5, R7]

Phase gate: `pnpm check`.

## Phase 2: PR2 — app read-only seam

Per-task verify: `pnpm vitest run packages/app/test/heartbeat` (add `--no-file-parallelism` for 2.4).

- [x] 2.1 RED+GREEN seam plumbing: RED asserts top-level `events` on deps (fails); GREEN `src/worker/types.ts` adds `events: BusinessEventRepository` to `WorkerDeps`, `test/worker-helpers.ts` adds `RecordingEvents.listCalls`, `src/composition/worker-deps.ts` wires `events: new PgBusinessEventRepository(connection)`; `test/composition/worker-deps.test.ts` asserts instance. [R6]
- [x] 2.2 RED `packages/app/test/heartbeat/evaluate.test.ts`: table — empty stream → no-llm; unseen `work.completed` → activate; seen cursor → no-llm; `listCalls.length === 1`, `appends.length === 0`; empty `companyId` rejected before list. [R6, R7]
- [x] 2.3 GREEN create `packages/app/src/heartbeat/evaluate.ts` `evaluateHeartbeatForCompany({events}, companyId, cursor?)`: reject empty tenant before read; exactly one `listByCompany`; return domain decision; zero writes. [R6]
- [x] 2.4 RED+GREEN `packages/app/test/heartbeat/heartbeat.integration.test.ts` (sequential; `skipIf(!reachable && !e2eRequirePg)`; e2e harness): post-`runWorker` cycle ⇒ activate; fresh company ⇒ no-llm. [R6, R7]

Phase gate: `pnpm check`.

## Coverage

R1:1.1,1.2 · R2:1.3 · R3:1.5 · R4:1.4 · R5:1.6 · R6:2.1–2.4 · R7:1.6,2.2,2.4 · R8:1.1.
Scenarios: 1→1.1; 2–3→1.3; 4–5→1.5; 6–8→1.4; 9→1.6; 10→2.2,2.4; 11,13→2.2; 12→1.6,2.4; 14→1.1.
