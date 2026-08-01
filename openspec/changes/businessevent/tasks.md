# Tasks: BusinessEvent — Deterministic Append-Only Business-Fact Log

Strict TDD: each task is RED (failing test) → GREEN (minimal code); tests ship with code. Stacked-to-main, auto-chain. Baseline main@b1662e5 (~829 tests).
Legend: V1=`PATH=/data/node24/bin:$PATH pnpm --filter @io/business-domain test`; V2=`PATH=/data/node24/bin:$PATH pnpm --filter @io/database vitest run --no-file-parallelism`; V3=`PATH=/data/node24/bin:$PATH pnpm --filter @io/app test`; G=`PATH=/data/node24/bin:$PATH pnpm check`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500–680 total (PR1 ~120–160, PR2 ~180–240, PR3 ~200–280) |
| 400-line budget risk | High total; each PR ≤400 |
| Chained PRs recommended | Yes |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test | Runtime harness | Rollback |
|------|------|----|--------------|-----------------|----------|
| 1 | domain type+port+fake | PR1 | `V1 business-event` | N/A — pure domain, no I/O boundary | revert PR1 commit |
| 2 | INSERT-only adapter+006+guard | PR2 | `V2 business-event` | live PG round-trip (io_dev) | revert PR2; drop business_event |
| 3 | app T1 emission+wiring | PR3 | `V3 worker-finalize` | E2E cycle → one row | revert PR3; remove events wiring |

## PR1 — business-domain (one batch, ≤6)

- [x] 1.1 RED business-event.test.ts: shape + equal facts → equal events (R1;R6). GREEN `BusinessEvent` in src/types.ts. →V1
- [x] 1.2 RED port keys === {append,listByCompany} (R2). GREEN `BusinessEventRepository` in ports/repositories.ts. →V1
- [x] 1.3 RED interleaved companies → insertion order (R3); list A excludes B (R8). GREEN `InMemoryBusinessEventRepository` in ports/fakes.ts. →V1
- [x] 1.4 RED duplicate eventId rejected, original kept (R7). GREEN uniqueness check in fake append. →V1
- [x] 1.5 RED empty companyId throws (R8). GREEN requireCompanyId in fake. →V1
- [x] 1.6 RED boundary: no @io/* import, no runtime dep (R1 isolation). GREEN export type+port+fake from index.ts; deps empty. →V1+G

## PR2 — database (one batch, ≤6)

- [x] 2.1 RED sql-migrations.test.ts: 006 DDL — table, UNIQUE event_id, company+aggregate indexes (R4). GREEN sql/006_business_events.sql. →V2 sql-migrations
- [x] 2.2 RED row-guards.test.ts: parseBusinessEventRow accepts valid, rejects malformed (R4). GREEN guard in row-guards.ts. →V2 row-guards
- [x] 2.3 RED business-event-roundtrip.integration.test.ts: live PG round-trip all fields via guard (R4); cross-tenant isolation (R8). GREEN `PgBusinessEventRepository` (INSERT + scoped SELECT ORDER BY id) in business-event-adapter.ts. →V2 business-event
- [x] 2.4 RED duplicate event_id rejected, original kept (R7 PG). GREEN UNIQUE(event_id), no upsert. →V2 business-event
- [x] 2.5 RED boundary.test.ts: INSERT present, no UPDATE/DELETE; export surface (R4 mutation). GREEN export adapter+guard from index.ts. →V2 boundary
- [x] 2.6 Gate: G + sequential PG suite green (R4). →G+V2

## PR3 — app (two batches; T1 isolated)

Batch A — wiring (≤6):
- [ ] 3.1 RED worker-deps.test.ts: factory binds events (R5). GREEN `events` on WorkerRepositories (worker/types.ts) + FinalizeRepositories; `events: new PgBusinessEventRepository(conn)` in composition/worker-deps.ts. →V3 worker-deps
- [ ] 3.2 RED worker-helpers.ts + parity.test.ts compile with event fake in all repos builds (R5). GREEN recording event fake in harness. →V3 parity

Batch B — T1 atomic (isolated, ≤4):
- [ ] 3.3 RED worker-finalize.test.ts: close commits Work+receipt+journal+exactly one event (R5 commit); same facts / different LLM → identical event (R6). GREEN buildWorkCompletedEvent + events.append between receipts.save and journal.complete in worker/finalize.ts T1. →V3 worker-finalize
- [ ] 3.4 RED CAS loss → zero events (TxTrackingConnection rollback) (R5 orphan). GREEN append inside connection.transaction so throw aborts. →V3 worker-finalize
- [ ] 3.5 RED completed replay → no second append (R7 replay). GREEN assert replay early-return before T1 (path unchanged). →V3 worker-finalize
- [ ] 3.6 RED E2E structure: one business_event row after full cycle; compileContext bytes unchanged, segment 12 absent (R9). GREEN apply 006 in e2e/harness.ts; structure-not-output assert. →e2e+G

Coverage: R1 1.1/1.6 · R2 1.2 · R3 1.3 · R4 2.1–2.6 · R5 3.1–3.4 · R6 1.1/3.3 · R7 1.4/2.4/3.5 · R8 1.3/1.5/2.3 · R9 3.6. All 12 scenarios mapped.
