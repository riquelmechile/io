# Tasks: supervisor-timer — workless heartbeat wake-ups

Strict TDD per task: RED (failing test) → GREEN (minimal impl) → commit-ready; tests ship with code. Threat matrix: `N/A` per design (no routing/shell/process boundary) — no threat RED tasks.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600 total (PR1 ~347, PR2 ~260) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 business-domain + database → PR2 app supervisor + composition (stacked-to-main) |
| Delivery strategy | auto-chain |
| Decision needed before apply | No |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Domain + DB foundation (tailCursor, cursor port/fake, listCompanyIds, migration 008, PG adapters) | PR 1 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test packages/database/test --no-file-parallelism` | PG roundtrip over real `PgDbConnection` | Drop 008 + revert additive bd/db lines; baseline byte-identical |
| 2 | Supervisor module + composition wiring | PR 2 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/supervisor packages/app/test/composition` | In-process supervisor over fakes + PG-backed composition test | Delete `supervisor/` + `supervisor-deps.ts`; worker path untouched |

## Batch 1 — business-domain foundation (PR 1, unit)

- [x] **1.1 Pure `tailCursor`** — modify `business-domain/src/heartbeat.ts`, `test/heartbeat.test.ts`; export from `src/index.ts`. RED→GREEN: multi-event stream → `{ lastEventId }` of final event; empty → `undefined`. AC: pure, zero `@io/*` (boundary check green).
- [x] **1.2 `HeartbeatCursorStore` port + fake** — create `src/ports/cursors.ts`; modify `src/ports/fakes.ts`, `test/fakes.test.ts`, `src/index.ts`. RED→GREEN: `get` miss → `undefined`; `upsert` create/replace; upsert A leaves B unchanged. AC: tenant isolation holds.
- [x] **1.3 `listCompanyIds()` on events port + fake** — modify `src/ports/repositories.ts`, `src/ports/fakes.ts`, `test/fakes.test.ts`. RED→GREEN: interleaved A/B/repeats → each id once (insertion-first-seen); no event mutation. AC: port stays append + read-only.

## Batch 2 — database adapters (PR 1, **PG-integration: run `--no-file-parallelism`**)

- [x] **2.1 Migration 008 + `PgHeartbeatCursorRepository`** — create `database/sql/008_heartbeat_cursor.sql`, `src/heartbeat-cursor-adapter.ts`, `test/heartbeat-cursor-roundtrip.integration.test.ts`; modify `src/row-guards.ts` (`parseHeartbeatCursorRow`), `src/index.ts`, `test/sql-migrations.test.ts`. RED→GREEN: upsert round-trip; ON CONFLICT replace; A/B isolation; empty `companyId` rejected pre-SQL; 008 ships w/ PK on `company_id`. AC: `describe.skipIf(!reachable)`, TRUNCATE beforeEach.
- [x] **2.2 PG `listCompanyIds()`** — modify `src/business-event-adapter.ts`, `test/business-event-roundtrip.integration.test.ts`. RED→GREEN: `SELECT DISTINCT company_id` → distinct across interleaved companies; event snapshot unchanged. AC: read-only, no mutation.

## Batch 3 — supervisor module (PR 2, **complex — isolated**, unit over fakes)

- [x] **3.1 Supervisor core** — create `app/src/supervisor/types.ts`, `tick.ts`, `supervisor.ts`, `app/test/supervisor/supervisor.test.ts`. RED→GREEN (injected `schedule`, no real timers): one interval ticks both companies; `stop()` blocks later ticks; cursor advances on no-llm AND activate; activate once then renew after new `work.completed`; sequential call order; restart resumes from persisted cursor; `onActivate` recorded no-op. AC: `now?` reserved/unused (not in decision logic); gate receives stored cursor.

## Batch 4 — composition (PR 2, integration)

- [x] **4.1 `buildSupervisorDeps`** — create `app/src/composition/supervisor-deps.ts` + integration test. RED→GREEN: wires `PgBusinessEventRepository` + `PgHeartbeatCursorRepository` over `DbConnection`; one tick advances a real cursor. AC: not called by `buildWorkerDeps`; pool-bound only.
