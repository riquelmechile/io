# Tasks: heartbeat-decision BusinessEvents

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~390 total: PR 1 ~240, PR 2 ~150 |
| 400-line budget risk | Low (per slice; aggregate straddles budget, hence chained) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 domain + storage → PR 2 supervisor wiring |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `buildHeartbeatDecisionEvent` factory + `appendIfAbsent` port/fake/PG adapter + exports + tests | PR 1 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/heartbeat-decision-event.test.ts packages/business-domain/test/fakes.test.ts packages/database/test/business-adapters.test.ts` | Live PG: `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/database/test/business-event-roundtrip.integration.test.ts` (docker-compose PG) | Revert PR 1 commit: factory/port/fake/adapter/exports/tests removed; `tick.ts` untouched |
| 2 | `tick.ts` emit wiring + supervisor tick scenarios | PR 2 | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/supervisor/supervisor.test.ts` | N/A — wiring runs over the port seam proven in PR 1; no new I/O boundary; e2e out of scope | Revert PR 2 commit: `tick.ts` back to byte-identical baseline; PR 1 port stays inert |

Strict TDD: RED → minimal GREEN per task; tests ship with code. Full gate: `PATH=/data/node24/bin:$PATH pnpm check`. Conventional commits, no AI attribution.

## Phase 1 / PR 1: Domain factory + at-most-once append (~240 lines, standalone)

- [x] 1.1 RED: create `packages/business-domain/test/heartbeat-decision-event.test.ts` — failing tests: shape/payload contract (`heartbeat.decision`/`heartbeat`/companyId/`supervisor`/`{decision,model?,cursor}`), `model:'flash'` only for activate, absent cursor → payload `null`, clock changes no identity field, deterministic `evt:hb:{digest16}` across clocks (business-event: Model-Independent Event Facts, Idempotent Single Emission).
- [x] 1.2 GREEN: create `packages/business-domain/src/heartbeat-decision-event.ts` — `buildHeartbeatDecisionEvent(companyId, decision, cursor?, now?)`; sha256 of `companyId\0{lastEventId|''}\0kind` hex slice 16; `node:crypto` only; export from `src/index.ts`.
- [x] 1.3 RED: extend `packages/business-domain/test/fakes.test.ts` — `appendIfAbsent` inserts once; duplicate no-ops returning the stored original; `append` still throws (Append-Only Repository Port / "Duplicate conditional append preserves the original").
- [x] 1.4 GREEN: add `appendIfAbsent` to `BusinessEventRepository` (`src/ports/repositories.ts`, document both semantics); implement in `InMemoryBusinessEventRepository` (`src/ports/fakes.ts`).
- [x] 1.5 GREEN-compile: add `appendIfAbsent` (delegate to inner fake) to `TracingEvents` (`packages/app/test/supervisor/supervisor.test.ts`) and `RecordingEvents` (`packages/app/test/worker-helpers.ts`) — all four implementers compile-green.
- [x] 1.6 RED: extend `packages/database/test/business-adapters.test.ts` — `ON CONFLICT (event_id) DO NOTHING` single-issuance; rowCount 0 → SELECT original; empty companyId rejected (Append-Only Repository Port / "PostgreSQL conditional append is single-issuance").
- [x] 1.7 GREEN: implement `PgBusinessEventRepository.appendIfAbsent` (`packages/database/src/business-event-adapter.ts`) — same columns as `append`; cast `execute(...) as { rowCount?: number }` (work-adapter.ts:106 idiom); rowCount 0 → SELECT + `parseBusinessEventRow`. No `implements` clause — pin via tests.
- [x] 1.8 RED+GREEN: extend `packages/database/test/business-event-roundtrip.integration.test.ts` — live PG double `appendIfAbsent` → exactly one original row; no migration; run sequentially.
- [x] 1.9 RED+GREEN: extend `packages/business-domain/test/heartbeat.test.ts` — `heartbeat.decision` is not material and does not renew novelty (heartbeat: Declared Material Event Types).
- [x] 1.10 Gate + commit: `pnpm check` green; business-domain has zero `@io/*` imports; commit slice 1. (Gate: format/typecheck/build/lint exit 0; full suite green sequential `--no-file-parallelism` 1136 passed / 6 skipped; zero `@io/*` imports proven by the existing src-wide boundary test. COMMIT DEFERRED to orchestrator per this run's contract — changes left staged in the working tree.)

## Phase 2 / PR 2: Supervisor tick wiring (~150 lines, stacks on PR 1)

- [x] 2.1 RED: extend `packages/app/test/supervisor/supervisor.test.ts` — both branches append exactly one decision before callback/checkpoint; callback throw → cursor unadvanced, retryable; append failure → tick fails before callback/checkpoint; retry with unadvanced cursor keeps exactly one event; multi-company sequential (supervisor-timer: Sequential Checkpointed Tick, all 7 scenarios).
- [x] 2.2 GREEN: wire emit in `packages/app/src/supervisor/tick.ts` — preserve leading `!companyId` guard (lines 27-29); insert `await deps.events.appendIfAbsent(buildHeartbeatDecisionEvent(companyId, decision, cursor))` after gate + tail read, before `onActivate`/upsert; never catch append errors.
- [x] 2.3 RED+GREEN seam: recorded no-op `onActivate` receives the company without starting Work (Non-Invasive Activation Seam / "Recorded no-op is valid").
- [x] 2.4 Byte-identity acceptance: `git diff` proves `cycle.ts`, `evaluate.ts`, `supervisor.ts`, worker path byte-identical; `heartbeat.decision` ∉ `MATERIAL_EVENT_TYPES`; no runtime dep or migration added ("Existing paths remain unchanged").
- [x] 2.5 Gate + commit: `pnpm check` green; commit slice 2. (Gate: format/typecheck/build/lint exit 0; full suite 1139 passed / 6 skipped / 0 failed sequential AND parallel this run. COMMIT DEFERRED to orchestrator per this run's contract — changes left staged in the working tree.)

## Global Acceptance Criteria

- Emit only in supervisor-owned `tick.ts`; `cycle.ts`/`evaluate.ts`/`supervisor.ts`/worker path byte-identical.
- `heartbeat.decision` ∉ `MATERIAL_EVENT_TYPES`; compiled context segment 12 stays absent.
- No new runtime deps (`node:crypto` builtin only); no migration; `business_event` + `uq_business_event_event_id` unchanged.
- Couplings: `openai` only in `packages/llm-client/src/deepseek-client.ts`; business-domain zero `@io/*`; `packages/context` deps = `@io/business-domain` only.
- `PATH=/data/node24/bin:$PATH pnpm test` and `pnpm check` green; live PG sequential (`--no-file-parallelism`).
