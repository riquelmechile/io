# Apply Progress — businessevent

**Batches**: PR1 (tasks 1.1–1.6, `packages/business-domain`) + PR2 (tasks 2.1–2.6, `packages/database`) + PR3 (tasks 3.1–3.6, `packages/app`)
**Status**: ALL 18 TASKS COMPLETE (6/6 + 6/6 + 6/6). Ready for sdd-verify.
**Mode**: Strict TDD (RED → GREEN per task)
**Artifact store**: hybrid (OpenSpec + Engram) · Delivery: stacked-to-main auto-chain
**Baseline**: main@eef6efc (PR1 committed @794f009, PR2 committed @eef6efc), 866 passed | 6 skipped. PR3 working tree UNCOMMITTED (review-gated commit by orchestrator).

## Files changed (PR1 — committed, main@794f009)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/types.ts` | Modified | Added `BusinessEvent` interface (8 fields: eventId, companyId, aggregateKind, aggregateId, eventType, occurredAt, payload, source) |
| `packages/business-domain/src/ports/repositories.ts` | Modified | Added `BusinessEventRepository` port — surface EXACTLY `{ append, listByCompany }` |
| `packages/business-domain/src/ports/fakes.ts` | Modified | Added `InMemoryBusinessEventRepository` — ordered array, insertion-order reads, eventId uniqueness, `requireCompanyId` |
| `packages/business-domain/src/index.ts` | Modified | Exports `BusinessEvent`, `BusinessEventRepository`, `InMemoryBusinessEventRepository` (biome re-sorted exports) |
| `packages/business-domain/test/business-event.test.ts` | Created | 16 unit tests: shape, determinism, port surface, order, tenant isolation, duplicate id, empty companyId, R1 isolation |

## Files changed (PR2 — committed, main@eef6efc)

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

## Files changed (PR3 — UNCOMMITTED, working tree)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/app/src/worker/types.ts` | Modified | `events: BusinessEventRepository` added to `WorkerRepositories` (R5 wiring) |
| `packages/app/src/worker/finalize.ts` | Modified | `events` on `FinalizeRepositories`; `buildWorkCompletedEvent` factory (deterministic, terminal-facts only, `evt:{attemptId}`, R6/R7); `await events.append(...)` inserted in T1 BETWEEN `receipts.save` and `journal.complete` inside `connection.transaction` (R5 atomic) — CAS loss throws before it, so the rollback leaves zero events |
| `packages/app/src/composition/worker-deps.ts` | Modified | `events: new PgBusinessEventRepository(conn)` in the `repositories(conn)` factory (tx-bound when conn is tx) |
| `packages/app/test/worker-helpers.ts` | Modified | `RecordingEvents` fake (`appends: BusinessEvent[]`, mirrors `RecordingReceipts`) wired into `WorkerHarness` + `harness()` repos factory — recording event fake in ALL repos builds (3.2) |
| `packages/app/test/composition/worker-deps.test.ts` | Modified | +1 test: `repositories(conn)` binds a FRESH `PgBusinessEventRepository` (instanceof + fresh-per-call) (3.1) |
| `packages/app/test/worker-finalize.test.ts` | Modified | T1-success test asserts EXACTLY ONE event (`evt:{attemptId}`, payload = workId/state/receiptId/terminalState/evidenceId/attemptId/actor); +1 R6 test: fixed clock + different LLM output → byte-identical events; CAS-loss (T2(i) + T2(ii)) assert ZERO events; replay asserts no second append (3.3/3.4/3.5) |
| `packages/app/test/parity.test.ts` | Modified | App-world repos factory supplies `events: h.events` (compiles with the event fake — 3.2) |
| `packages/app/test/app-boundary.test.ts` | Modified | Assembled-wiring repos factory supplies `events: h.events` (3.2) |
| `packages/app/test/worker-reconcile.test.ts` | Modified | BLOCKER retry repos factory supplies `events: h.events` (3.2) |
| `packages/app/test/e2e/harness.ts` | Modified | `006_business_events.sql` added to the harness `MIGRATIONS` list (3.6) |
| `packages/app/test/e2e/worker-e2e.integration.test.ts` | Modified | E2E happy path asserts EXACTLY ONE `business_event` row (event_id/event_type/company_id/aggregate_kind/aggregate_id/source) + R9 structure-not-output: `compileContext` stable prefix byte-identical to the frozen golden pin (process token substituted), segment 12 (`recent-evidence`) ABSENT, no `evt:`/`business_event` leakage, suffix = current-work bytes only (3.6) |

**Not touched:** `packages/business-domain`, `packages/database` source (PR1/PR2 committed — only their exports imported), `packages/context/**` (segment 12 stays ABSENT — R9), `complete-work-flow.ts`, LLM client.

## TDD Cycle Evidence (cumulative PR1 + PR2 + PR3)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.6 | `packages/business-domain/test/business-event.test.ts` | Unit | ✅ 158/158 | ✅ tsc TS2305/TS2724 + runtime ctor missing | ✅ 16/16 | ✅ 3 cases | ✅ biome format pass |
| 2.1–2.6 | `packages/database/test/*` | Unit + Integration (live PG) | ✅ 212/212 (db suite) | ✅ 006 absent; guard not exported; dup constraint proven by dropping the index | ✅ 233/233 incl. live round-trip | ✅ per scenario | ✅ 004-style DDL; regex normalized |
| 3.1 | `packages/app/test/composition/worker-deps.test.ts` | Unit | ✅ 145 passed / 3 skipped (app suite) | ✅ Written — `events` undefined → toBeInstanceOf failed (1 failed / 6 passed) | ✅ 7/7 | ➖ Single (structural wiring) | ✅ factory doc updated (CAS+receipt+journal+event) |
| 3.2 | `worker-helpers.ts` + parity + finalize + boundary + reconcile tests | Unit (type-driven) | ✅ (covered) | ✅ `tsc --noEmit`: 8 TS2322 errors — every repos build missing `events` | ✅ tsc clean + 42/42 across 4 test files | ✅ 5 construction sites (harness, finalize×3, parity, app-boundary, reconcile) | ➖ None needed |
| 3.3 | `packages/app/test/worker-finalize.test.ts` | Unit | ✅ (covered) | ✅ 2 failed — appends empty (no append yet) | ✅ 8/8 | ✅ 2 cases (exactly-one-event + R6 identical-with-different-LLM) | ✅ finalize.ts T1 doc rewritten |
| 3.4 | same file (CAS-loss + T2(ii)) | Unit | ✅ (covered) | ✅ teeth-proven: append moved BEFORE the CAS guard → test FAILED (`expected 0 but got 1`), proving it pins the placement | ✅ 8/8 restored | ✅ 2 cases (T2(i) in_progress + T2(ii) terminal) | ✅ restored correct placement |
| 3.5 | same file (replay) | Unit | ✅ (covered) | ✅ teeth-proven: replay early-return disabled → test FAILED (full close instead of replay — second append would occur) | ✅ 8/8 restored | ➖ Single (R7 replay path) | ✅ restored early-return |
| 3.6 | `packages/app/test/e2e/worker-e2e.integration.test.ts` | E2E (live PG, sequential) | ✅ (covered) | ✅ `relation "business_event" does not exist` (table absent) + prefix-vs-golden mismatch fixed via process-token substitution | ✅ 1/1 + worker-deps live 7/7 | ✅ 3 cases (one row + exact row shape; golden-pin bytes unchanged; segment 12 absent + no leakage) | ✅ R9 assertion rewritten to substitute the cohort discriminator |

## Work Unit Evidence (PR3)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app` → **147 passed | 3 skipped** (26 files passed | 1 skipped; baseline 145 + 2 new). Live-PG blocks ran (PG reachable): worker-e2e 1/1, worker-deps live cycle 7/7 |
| Runtime harness command/scenario and exact result | Live PostgreSQL (docker `io_pg`, postgresql://io:io_dev@localhost:5432/io_dev), sequential: E2E full cycle commits ONE `business_event` row (verified by live SELECT: event_id `evt:att:acme-corp:e2e-close-1`, event_type `work.completed`, source `worker`) and `compileContext` output stays byte-frozen (golden pin + process token) with segment 12 absent |
| Rollback boundary | Revert the PR3 working tree (`git checkout -- packages/app/src/worker/types.ts packages/app/src/worker/finalize.ts packages/app/src/composition/worker-deps.ts packages/app/test/*.ts packages/app/test/composition/*.ts packages/app/test/e2e/*.ts`) → PR3 gone, PR1+PR2 untouched (committed). No other package touched — `packages/business-domain`, `packages/database`, `packages/context` unchanged |

## Gate

PR3 working tree: `PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check ✅, typecheck ✅, build ✅, lint ✅, tests: **868 passed | 6 skipped**). Baseline 866 + 2 new = 868 exactly. Focused sequential app suite: 147 passed | 3 skipped. No biome import-style warnings (the 11 changed files are `biome check` clean; `biome check --write` import-order assists on untouched files were reverted — the gate's lint step does not enforce them).

## Requirement coverage (cumulative — ALL 9)

R1 (1.1/1.6) · R2 (1.2) · R3 (1.3) · R4 (2.1–2.6) · R5 (3.1–3.4) · R6 (1.1/3.3) · R7 (1.4/2.4/3.5) · R8 (1.3/1.5/2.3) · R9 (3.6). All 12 scenarios mapped, all covered by passing tests.

## Deviations from design

None — implementation matches design.md exactly (`events` on both repository interfaces, `events: new PgBusinessEventRepository(conn)` in the factory, `buildWorkCompletedEvent` payload shape identical, append between `receipts.save` and `journal.complete`, 006 in the harness migration list). Notes: (1) The live-PG worker tests break between 3.3 GREEN and 3.6 GREEN because T1 starts appending against the not-yet-migrated scratch DB — expected mid-cycle red, resolved by 3.6's harness 006. (2) The R9 byte-unchanged assertion compares the compiled prefix to the frozen golden pin with the cohort discriminator (process token) substituted, because the E2E's process (`low-risk-documents`) legitimately differs from the context fixture's `planning` — every STABLE segment byte still matches the pin. (3) `biome check --write` applies import-organization assists to untouched files; the gate's lint step (`biome lint .`) does not, so those edits were reverted to keep the PR3 diff minimal.

## Remaining

None — all 18 tasks complete. Next phase: sdd-verify.
