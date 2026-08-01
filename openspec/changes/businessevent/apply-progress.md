# Apply Progress — businessevent

**Batches**: PR1 (tasks 1.1–1.6, `packages/business-domain`) + PR2 (tasks 2.1–2.6, `packages/database`)
**Status**: PR1 COMPLETE (6/6) · PR2 COMPLETE (6/6) — 12/12 tasks done. Next batch: PR3 (tasks 3.1–3.6, `packages/app`).
**Mode**: Strict TDD (RED → GREEN per task)
**Artifact store**: hybrid (OpenSpec + Engram) · Delivery: stacked-to-main auto-chain
**Baseline**: main@794f009 (PR1 committed), 845 passed | 6 skipped. PR2 working tree UNCOMMITTED (review-gated commit by orchestrator).

## Files changed (PR1 — committed, main@794f009)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/types.ts` | Modified | Added `BusinessEvent` interface (8 fields: eventId, companyId, aggregateKind, aggregateId, eventType, occurredAt, payload, source) |
| `packages/business-domain/src/ports/repositories.ts` | Modified | Added `BusinessEventRepository` port — surface EXACTLY `{ append, listByCompany }` |
| `packages/business-domain/src/ports/fakes.ts` | Modified | Added `InMemoryBusinessEventRepository` — ordered array, insertion-order reads, eventId uniqueness, `requireCompanyId` |
| `packages/business-domain/src/index.ts` | Modified | Exports `BusinessEvent`, `BusinessEventRepository`, `InMemoryBusinessEventRepository` (biome re-sorted exports) |
| `packages/business-domain/test/business-event.test.ts` | Created | 16 unit tests: shape, determinism, port surface, order, tenant isolation, duplicate id, empty companyId, R1 isolation |

## Files changed (PR2 — UNCOMMITTED, working tree)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/database/sql/006_business_events.sql` | Created | `business_event` table (10 NOT NULL columns, JSONB payload, `id SERIAL PRIMARY KEY`) + `uq_business_event_event_id` UNIQUE + `idx_business_event_company_id` + `idx_business_event_aggregate`, all `IF NOT EXISTS` (R4/R7/R8) |
| `packages/database/src/business-event-adapter.ts` | Created | `PgBusinessEventRepository` — INSERT-only `append` (no upsert, empty-companyId guard) + tenant-scoped `listByCompany` (`WHERE company_id = $1 ORDER BY id ASC`), rows through `parseBusinessEventRow`, throw on corrupt (R4/R7/R8) |
| `packages/database/src/row-guards.ts` | Modified | Added `parseBusinessEventRow` — mirrors `parseBusinessReceiptRow`: 6 non-empty strings, `occurredAt` number, `payload` plain object (not null/array) (R4) |
| `packages/database/src/index.ts` | Modified | Exports `PgBusinessEventRepository` + `parseBusinessEventRow` (R4 mutation/export surface) |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Created | Live-PG round-trip (all 8 fields via guard), insertion order, cross-tenant isolation, empty-companyId parity, duplicate `event_id` rejected + original kept (8 tests, sequential) |
| `packages/database/test/sql-migrations.test.ts` | Modified | Added `006` DDL describe block: file ships, 10 NOT NULL columns, UNIQUE + tenant + aggregate indexes, all statements idempotent (4 tests) |
| `packages/database/test/row-guards.test.ts` | Modified | Added `parseBusinessEventRow` block: accepts valid (all fields), opaque payload, rejects 16 corrupt variants with non-empty reason (3 tests) |
| `packages/database/test/boundary.test.ts` | Modified | Added INSERT-only adapter guard (INSERT present + 9 columns, NO UPDATE/DELETE, surface = append+listByCompany) + export surface includes `PgBusinessEventRepository`/`parseBusinessEventRow` (4 tests + 2 loop-generated over new src file) |

## TDD Cycle Evidence (cumulative PR1 + PR2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/business-domain/test/business-event.test.ts` | Unit | ✅ 158/158 | ✅ Written — tsc TS2305 | ✅ tsc clean + 3/3 | ✅ 3 cases | ✅ types.ts repaired |
| 1.2 | same | Unit | ✅ | ✅ Written — tsc TS2724 | ✅ tsc clean + 4/4 | ➖ Single (exact-surface) | ➖ None needed |
| 1.3 | same | Unit | ✅ | ✅ Written — runtime ctor missing | ✅ 9/9 | ✅ 4 cases | ➖ None needed |
| 1.4 | same | Unit | ✅ | ✅ Written — dup not rejected | ✅ 11/11 | ✅ 2 cases | ➖ None needed |
| 1.5 | same | Unit | ✅ | ✅ Written — no throw | ✅ 13/13 | ✅ 2 cases | ➖ None needed |
| 1.6 | same | Unit | ✅ | ✅ Written — exports missing | ✅ 16/16 | ✅ 3 cases | ✅ biome format pass |
| 2.1 | `packages/database/test/sql-migrations.test.ts` | Unit | ✅ 212/212 (db suite) | ✅ Written — 4/4 failed (006 file absent) | ✅ 14/14 | ✅ 4 cases (file, columns, indexes, idempotency) | ✅ columns aligned to 004 style |
| 2.2 | `packages/database/test/row-guards.test.ts` | Unit | ✅ (covered) | ✅ Written — 3/3 failed (guard not exported) | ✅ 8/8 | ✅ 3 cases (valid, opaque payload, 16 corrupt variants) | ➖ None needed |
| 2.3 | `packages/database/test/business-event-roundtrip.integration.test.ts` | Integration (live PG) | ✅ (covered) | ✅ Written — import resolution failed (adapter absent) | ✅ 6/6 | ✅ 3 cases (round-trip, order, cross-tenant + empty) | ➖ None needed |
| 2.4 | same file | Integration (live PG) | ✅ | ✅ Written — **RED proven**: with `uq_business_event_event_id` dropped, duplicate raw INSERT succeeds → test's `rejects` would fail; constraint restored → rejects | ✅ 8/8 | ✅ 2 cases (dup rejected + original kept; distinct ids allowed) | ➖ None needed |
| 2.5 | `packages/database/test/boundary.test.ts` | Unit | ✅ (covered) | ✅ Written — 2/2 failed (exports missing) | ✅ 52/52 | ✅ 4 cases (INSERT present, no UPDATE/DELETE, surface, export keys) | ✅ normalized regex for string-concat SQL |
| 2.6 | gate + full suite | Gate | ✅ | — | ✅ `pnpm check` GREEN | — | ✅ biome clean, no fixes needed |

Notes: 2.4's RED is a real proof of test teeth — the UNIQUE constraint is enforced by the 006 migration (production code); the adapter is plain INSERT (no upsert). Drop the index and duplicates are accepted (verified live), so the test genuinely gates the constraint. 2.3/2.4 run against live PG (io_dev, io_pg container) sequentially.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/database` → **233 passed | 1 skipped** (14 files; baseline 212 + 21 new). Per-file: sql-migrations 14, row-guards 8, business-event-roundtrip 8, boundary 52 |
| Runtime harness command/scenario and exact result | Live PostgreSQL (docker `io_pg`, postgresql://io:io_dev@localhost:5432/io_dev): `business-event-roundtrip.integration.test.ts` ran REAL PG (not skipped — reachable probe passed) — append→list round-trip, `ORDER BY id ASC`, cross-tenant isolation, UNIQUE duplicate rejection all verified against PG 18.4 |
| Rollback boundary | Revert PR2 working tree (`git checkout -- packages/database/src/index.ts packages/database/src/row-guards.ts packages/database/test/*.ts` + delete `packages/database/sql/006_business_events.sql`, `packages/database/src/business-event-adapter.ts`, `packages/database/test/business-event-roundtrip.integration.test.ts`); drop `business_event` table if already applied. No other package touched — `packages/business-domain` (PR1, committed) untouched, `packages/app`, `packages/context` untouched. |

## Gate

PR2 working tree: `PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check ✅, typecheck ✅, build ✅, lint ✅, tests: **866 passed | 6 skipped**). Baseline 845 + 21 new = 866 exactly. Sequential PG suite: **233 passed | 1 skipped**. No biome import-style warnings (lint clean, no fixes applied).

## Requirement coverage (cumulative)

R1 (1.1/1.6) · R2 (1.2) · R3 (1.3) · R4 (2.1–2.6) · R6 (1.1) · R7 (1.4/2.4) · R8 (1.3/1.5/2.3) — all 21 PR2 tests passing, live PG proven. R5/R9 remain for PR3.

## Deviations from design

None — implementation matches design.md exactly (006 DDL, adapter SQL, `parseBusinessEventRow` shape, tx-bound-vs-pool-bound construction mirrors `PgBusinessReceiptRepository`). Notes: (1) `pnpm --filter @io/database vitest run --no-file-parallelism` is a silent no-op like PR1's filter (package.json has no test script) — effective focused command is `pnpm vitest run --no-file-parallelism packages/database`. (2) 006 table body uses single-space columns (004 style) so the exact-string DDL assertions pass. (3) Boundary INSERT regex normalizes quoted string-concatenation before matching.

## Remaining

- PR3: tasks 3.1–3.6 (`packages/app`) — worker T1 emission, wiring, E2E (depends on PR1+PR2)
