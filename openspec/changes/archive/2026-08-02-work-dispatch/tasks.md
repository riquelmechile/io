# Tasks: Work Dispatch

Paths below relative to `packages/`. Commands (prefix `PATH=/data/node24/bin:$PATH`): runner `pnpm test`; gate `pnpm check`; live-PG `pnpm vitest run --no-file-parallelism`. Strict-TDD: RED test first → GREEN; tests ship with code.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~510–610 (~5 new + ~5 modified src, 1 migration, ~4 test files) |
| Per-PR split | PR 1 ≈ 230–280 · PR 2 ≈ 280–330 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal (PR) | Focused test command | Runtime harness | Rollback boundary |
|------|-----------|----------------------|-----------------|-------------------|
| 1 | Actionable port + adapter + 009 (PR 1) | runner → `business-domain database` | live-PG `database/test/business-pg-roundtrip.integration.test.ts` | revert PR 1; no callers |
| 2 | `dispatch/` + `buildSupervisorDispatch` (PR 2) | runner → `app/test/dispatch app/test/composition` | live-PG seq; gate | revert PR 2; `onActivate` no-op |

## PR 1 — Business Domain + Database

- [x] 1.1 RED `business-domain/test/transitions.test.ts`; GREEN `ACTIONABLE_WORK_STATES: readonly ['accepted']` in `src/transitions.ts`; re-export `src/index.ts`. (work-lifecycle R)
- [x] 1.2 RED `business-domain/test/fakes.test.ts` (accepted oldest-first, mixed state/tenant; empty result; empty `companyId` rejects pre-read); GREEN `listActionableByCompany(companyId)` in `src/ports/repositories.ts` + InMemory map-filter (insertion order) in `src/ports/fakes.ts`. (work-lifecycle scenarios 1–3)
- [x] 1.3 RED 009 block in `database/test/sql-migrations.test.ts`; GREEN `database/sql/009_work_company_state_index.sql`: `CREATE INDEX IF NOT EXISTS idx_work_company_state ON work (company_id, state)`.
- [x] 1.4 RED unit test; GREEN `PgWorkRepository.listActionableByCompany` in `database/src/work-adapter.ts`: `WHERE company_id=$1 AND state=ANY($2) ORDER BY id ASC` + `parseWorkRow`.
- [x] 1.5 live-PG (isolated): extend `database/test/business-pg-roundtrip.integration.test.ts` (insertion-order, tenant-scope) + InMemory↔PG parity per `app/test/parity.test.ts`. (work-lifecycle scenario 1)
- [x] 1.6 PR 1 gate green; zero `@io/*` in business-domain (boundary test).

## PR 2 — App Dispatch + Composition

- [x] 2.1 RED `app/test/dispatch/keys.test.ts` (key `wk:${companyId}:${workId}` deterministic/company-scoped/collision-free; hash identical across `accepted → in_progress → completed`; excludes state/version/outcome/deliverable/evidenceRefs); GREEN `app/src/dispatch/keys.ts` SHA-256 over `{companyId,workId,delegationId,description}`. (work-dispatch R1)
- [x] 2.2 COMPLEX — RED `app/test/dispatch/dispatch.test.ts` (empty queue ⇒ `{ok:true,dispatched:false}`, zero worker/LLM; one oldest-first `runWorker`; empty `companyId` rejects pre-read); GREEN `app/src/dispatch/types.ts` (`DispatchDeps`, `DispatchResult`) + `dispatchCompanyActivation(companyId, deps)` in `app/src/dispatch/dispatch.ts`: first → key+hash → `runWorker({companyId,actor,workId,expectedVersion,idempotencyKey,requestHash}, deps.worker)`; attemptId via `attemptIdFor`. (R2; work-lifecycle empty scope)
- [x] 2.3 COMPLEX — RED named-mapping test + GREEN settle-vs-propagate in `dispatch.ts`; policy typed never throws / typed settles, thrown propagates: typed `{ok:false}` (incl. `invalid-plan`) settles (cursor advances, no hot loop); thrown propagates. (R5)
- [x] 2.4 RED safety: replay — matching key+hash re-activation journal-replays, no second effect/receipt (`UNIQUE(work_id, terminal_event_id)`) (R4); orphan — post-claim `in_progress` Work excluded, not auto-resumed (R6).
- [x] 2.5 RED `app/test/composition/supervisor-dispatch.test.ts` (`{deps,onActivate}` shape; `no-llm-heartbeat` ⇒ no read/worker/LLM); GREEN `app/src/composition/supervisor-dispatch.ts`: compose `buildWorkerDeps` + `buildSupervisorDeps`, actor = `principals.executor`; roots untouched. (R3 scenario 1)
- [x] 2.6 live-PG sequential (isolated): dispatch integration.
- [x] 2.7 PR 2 gate: byte-identity of `supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`, `supervisor-deps.ts`, `worker-deps.ts` (git diff vs baseline); gate green; boundaries (zero `@io/*`, `openai` only in `deepseek-client.ts`, no new runtime deps). (R3 scenario 2)
