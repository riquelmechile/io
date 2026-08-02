# Apply Progress: Work Dispatch — PR 1 (tasks 1.1–1.6) + PR 2 (tasks 2.1–2.7)

**Change**: work-dispatch · **Batches**: PR 1 of 2 (committed `1339791`) + PR 2 of 2 (UNCOMMITTED candidate) · **Mode**: STRICT TDD
**Artifact store**: HYBRID (openspec file + engram `sdd/work-dispatch/apply-progress`)
**Date**: 2026-08-02 · **Delivery**: auto-chain · chain-strategy `stacked-to-main` · review budget 400 lines/PR

## Status

**success** — all 13 tasks complete (PR1 1.1–1.6 committed; PR2 2.1–2.7 GREEN, full gate GREEN, live-PG sequential GREEN, candidate normalized, nothing committed for PR2).

---

## PART 1 — PR 1 (tasks 1.1–1.6) — COMMITTED `1339791`

## Per-Task Status (PR 1)

| Task | Status | RED (written first) | GREEN (executed) | Evidence |
|------|--------|---------------------|------------------|----------|
| 1.1 | ✅ done | `transitions.test.ts` +3 tests (imports missing `ACTIONABLE_WORK_STATES`) | constant + re-export; 53/53 pass | 3 new tests |
| 1.2 | ✅ done | `fakes.test.ts` +3 tests (method missing) | port method + InMemory map-filter; 61/61 pass | 3 new tests |
| 1.3 | ✅ done | `sql-migrations.test.ts` 009 block (file missing) | `009_work_company_state_index.sql`; 24/24 pass | 3 new tests |
| 1.4 | ✅ done | `business-adapters.test.ts` +3 tests (method missing) + connection-fake `ANY($N)` support | `PgWorkRepository.listActionableByCompany`; 38/38 pass | 3 new tests |
| 1.5 | ✅ done | integration + parity tests written pre-GREEN (live PG, failed at RED) | adapter method satisfied them; 40/40 sequential live-PG | 4 new tests |
| 1.6 | ✅ done | gate GREEN | `pnpm check` all stages pass; business-domain boundary test (zero `@io/*`) passes | 1042 tests |

## TDD Cycle Evidence (PR 1)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `business-domain/test/transitions.test.ts` | Unit | ✅ 50/50 | ✅ Written | ✅ Passed (53/53) | ✅ 3 cases | ➖ None needed |
| 1.2 | `business-domain/test/fakes.test.ts` | Unit | ✅ 58/58 | ✅ Written | ✅ Passed (61/61) | ✅ 3 cases | ✅ Clean |
| 1.3 | `database/test/sql-migrations.test.ts` | Unit | ✅ 21/21 | ✅ Written | ✅ Passed (24/24) | ➖ Single stmt + idempotency | ➖ None needed |
| 1.4 | `database/test/business-adapters.test.ts` | Unit | ✅ 35/35 | ✅ Written | ✅ Passed (38/38) | ✅ 4 cases | ✅ Clean |
| 1.5 | `database/test/business-pg-roundtrip.integration.test.ts` | Integration (live PG) | ✅ 36/36 | ✅ Written | ✅ Passed (40/40 seq) | ✅ 4 cases (incl. parity) | ✅ Clean |
| 1.6 | gate `pnpm check` + boundary tests | Suite | N/A | N/A | ✅ Passed | N/A | N/A |

Safety-net baseline (PR 1): 163/163 passing across the 4 unit files BEFORE edits; RED confirmed 12 new tests failing (164 pre-existing still passing); all GREEN afterwards.

## Files Changed (PR 1 — committed `1339791`)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/transitions.ts` | Modified | `ACTIONABLE_WORK_STATES: readonly ['accepted']` (mirrors `MATERIAL_EVENT_TYPES`) |
| `packages/business-domain/src/index.ts` | Modified | Re-export `ACTIONABLE_WORK_STATES` |
| `packages/business-domain/src/ports/repositories.ts` | Modified | `WorkRepository.listActionableByCompany(companyId)` port method |
| `packages/business-domain/src/ports/fakes.ts` | Modified | `InMemoryWorkRepository.listActionableByCompany` — guard-first, Map-iteration insertion order, company-scoped |
| `packages/business-domain/test/transitions.test.ts` | Modified | 1.1 RED tests (value, readonly-tuple type, membership) |
| `packages/business-domain/test/fakes.test.ts` | Modified | 1.2 RED tests (oldest-first mixed state/tenant; empty; empty-companyId zero reads via instrumented Map) |
| `packages/database/sql/009_work_company_state_index.sql` | Created | `CREATE INDEX IF NOT EXISTS idx_work_company_state ON work (company_id, state)` |
| `packages/database/test/sql-migrations.test.ts` | Modified | 1.3 RED 009 block (ships, index SQL, IF NOT EXISTS idempotency) |
| `packages/database/src/work-adapter.ts` | Modified | `PgWorkRepository.listActionableByCompany` — `WHERE company_id=$1 AND state=ANY($2) ORDER BY id ASC` + `parseWorkRow` guard (D7) |
| `packages/database/test/business-adapters.test.ts` | Modified | 1.4 RED unit tests (SQL shape, order, tenant scope, empty guard pre-SQL) |
| `packages/database/test/connection-fake.ts` | Modified | Test harness: `parseSelect` supports `col = ANY($N)` (additive, backward-compatible) |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modified | 1.5 RED live-PG tests (insertion order, tenant scope, guard parity, InMemory↔PG parity) + applies SCHEMA_009 |
| `packages/app/test/worker-finalize.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` (delegates to inner) |
| `packages/app/test/worker-reconcile.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` |
| `packages/app/test/parity.test.ts` | Modified | Interface-cascade stub `listActionableByCompany` on `RacingWorkRepository` |

> NOTE (PR 1): adding `listActionableByCompany` to the `WorkRepository` port interface (design A1) requires every explicit implementer to declare it. The three `RacingWorkRepository` doubles under `packages/app/test/` got 4-line additive delegation stubs — same convention as supervisor-timer PR1 (`da494ae`). No `app/src` file was touched in PR 1.

---

## PART 2 — PR 2 (tasks 2.1–2.7) — UNCOMMITTED CANDIDATE

## Per-Task Status (PR 2)

| Task | Status | RED (written first) | GREEN (executed) | Evidence |
|------|--------|---------------------|------------------|----------|
| 2.1 | ✅ done | `dispatch/keys.test.ts` +9 tests (module missing → import failure) | `app/src/dispatch/keys.ts`; 9/9 pass | 9 new tests |
| 2.2 | ✅ done | `dispatch/dispatch.test.ts` +3 tests (module missing) | `dispatch/types.ts` + `dispatchCompanyActivation`; 8/8 pass (file) | 3 new tests |
| 2.3 | ✅ done | named-mapping tests (invalid-plan/denied settle; LlmError propagates) | settle-vs-propagate in `dispatch.ts` (typed never throws); 8/8 pass (file) | 3 new tests |
| 2.4 | ✅ done | replay + orphan safety tests | journal-replay via key+hash (no 2nd effect/receipt); in_progress excluded; 8/8 pass (file) | 2 new tests |
| 2.5 | ✅ done | `composition/supervisor-dispatch.test.ts` +4 tests (module missing) | `app/src/composition/supervisor-dispatch.ts`; 4/4 pass | 4 new tests |
| 2.6 | ✅ done | `dispatch/dispatch.integration.test.ts` +4 live-PG tests (RED: sandbox EEXIST collision found) | per-test harness isolation; 4/4 sequential live-PG | 4 new tests |
| 2.7 | ✅ done | gate GREEN + byte-identity + boundaries | `pnpm check` all stages pass; 8 files 0-byte diff | 1067 tests |

## TDD Cycle Evidence (PR 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `app/test/dispatch/keys.test.ts` | Unit | N/A (new) | ✅ Written (module missing) | ✅ Passed (9/9) | ✅ 6 cases (scope, collision, transition-stability, exclusion) | ➖ None needed |
| 2.2 | `app/test/dispatch/dispatch.test.ts` | Unit | N/A (new) | ✅ Written (module missing) | ✅ Passed | ✅ 3 cases (empty, oldest-first, empty-companyId) | ✅ Clean |
| 2.3 | `app/test/dispatch/dispatch.test.ts` | Unit | ✅ 3/3 | ✅ Written | ✅ Passed | ✅ 3 cases (invalid-plan, denied, LlmError) | ➖ None needed |
| 2.4 | `app/test/dispatch/dispatch.test.ts` | Unit | ✅ 6/6 | ✅ Written | ✅ Passed | ✅ 2 cases (replay, orphan) | ➖ None needed |
| 2.5 | `app/test/composition/supervisor-dispatch.test.ts` | Unit | N/A (new) | ✅ Written (module missing) | ✅ Passed (4/4) | ✅ 4 cases (shape, real-path, decline, activate) | ✅ Clean (Promise<void> awaitable seam) |
| 2.6 | `app/test/dispatch/dispatch.integration.test.ts` | Integration (live PG) | N/A (new) | ✅ Written | ✅ Passed (4/4 seq) | ✅ 4 cases (full cycle, re-activation, empty, composed root) | ✅ Clean (per-test harness isolation) |
| 2.7 | gate `pnpm check` + byte-identity + boundaries | Suite | N/A | N/A | ✅ Passed | N/A | N/A |

## Files Changed (PR 2 — uncommitted candidate)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/app/src/dispatch/keys.ts` | Created | `dispatchIdempotencyKeyFor` (`wk:${companyId}:${workId}`) + `dispatchRequestHashFor` (SHA-256 over `{companyId,workId,delegationId,description}`, node:crypto builtin) |
| `packages/app/src/dispatch/types.ts` | Created | `DispatchDeps` (`work`, `worker`, `actor`) + `DispatchResult` (settled/dispatched variants) |
| `packages/app/src/dispatch/dispatch.ts` | Created | `dispatchCompanyActivation(companyId, deps)`: reject empty companyId pre-read → `listActionableByCompany` → first → key+hash → unchanged `runWorker` → settled DispatchResult (typed failures never throw; thrown propagate) |
| `packages/app/src/composition/supervisor-dispatch.ts` | Created | `buildSupervisorDispatch` → `{ deps: SupervisorDeps; onActivate: OnActivate }` composing `buildWorkerDeps` + `buildSupervisorDeps`, `actor = principals.executor`; awaitable seam (tick checkpoints AFTER onActivate resolves) |
| `packages/app/test/dispatch/keys.test.ts` | Created | 2.1 RED: 9 tests (wk: scheme, determinism, company scope, collision-freedom, SHA-256 hex, transition-stability, field exclusion/inclusion) |
| `packages/app/test/dispatch/dispatch.test.ts` | Created | 2.2–2.4 RED: 8 tests (empty queue zero worker/LLM; empty companyId pre-read reject via RecordingWorkRepository; one oldest-first runWorker + journal key/hash/attemptId; invalid-plan settles; denied settles; LlmError propagates; replay no 2nd effect/receipt; in_progress orphan excluded) |
| `packages/app/test/dispatch/dispatch.integration.test.ts` | Created | 2.6 RED live-PG: 4 tests (full cycle → completed v3 + 1 receipt + 1 event + journal closed under derived key; re-activation → dispatched:false + 1 receipt stays; empty queue → zero rows; composed root via onActivate) — per-test scratch DB + sandbox root |
| `packages/app/test/composition/supervisor-dispatch.test.ts` | Created | 2.5 RED: 4 tests (`{deps,onActivate}` shape; onActivate drives real dispatch path; no-llm-heartbeat → zero dispatch; activate → onActivate fires) |

> NOTE (PR 2, 2.6 RED): the first live-PG run exposed a sandbox EEXIST collision — all tests shared ONE harness sandbox root while the canned plan always writes `docs/quarterly-close.md`. Fixed by booting a per-test harness (own scratch DB `io_dev_e2e_dispatch_N` + own sandbox root) — this also hardens isolation for the sequential run.

## Test Evidence (PR 2)

- **RED confirmations**: `keys.test.ts` → module-missing import failure; `dispatch.test.ts` → module-missing; `supervisor-dispatch.test.ts` → module-missing; `dispatch.integration.test.ts` → 2 failed at RED (sandbox EEXIST collision — a REAL test-design defect caught by TDD, fixed before GREEN).
- **Unit GREEN**: keys 9/9 · dispatch 8/8 · supervisor-dispatch 4/4 (25 new unit tests total).
- **Full gate** (`PATH=/data/node24/bin:$PATH pnpm check`): format ✅ (biome normalized 3 new files) · typecheck (tsc strict, noEmit) ✅ · build ✅ · lint (biome) ✅ · test ✅ — **Test Files 82 passed | 3 skipped (85) · Tests 1067 passed | 6 skipped (1073)** (1042 PR1 + 25 new).
- **Live-PG sequential** (`pnpm vitest run --no-file-parallelism` on dispatch + roundtrip + supervisor-deps integration): **48/48 passed** (dispatch 4, business-pg-roundtrip 40, supervisor-deps 4).
- **Boundary (2.7)**: business-domain zero `@io/*` (unchanged, existing tests pass); `openai` appears ONLY in `llm-client/src/deepseek-client.ts` (app-boundary test scans all package src trees; only src hit is a comment in `context/src/index.ts`, not an import); NO package.json / pnpm-lock changes (git diff empty) — only builtin `node:crypto` added.

## Work Unit Evidence (PR 2 — dispatch + composition)

| Evidence | Value |
|---|---|
| Focused test command and result | `pnpm vitest run packages/app/test/dispatch packages/app/test/composition/supervisor-dispatch.test.ts` → 25/25 |
| Runtime harness command/scenario and result | live-PG sequential (dispatch + roundtrip + supervisor-deps) → 48/48 on real PG 18.4; full-cycle dispatch: work completed v3, EXACTLY ONE receipt, journal completed under `wk:` key + `attemptIdFor` scheme, EXACTLY ONE work.completed event; re-activation settles `dispatched:false` with receipt count unchanged (R4) |
| Rollback boundary | delete the 4 new `app/src/dispatch/*` + `app/src/composition/supervisor-dispatch.ts` files and the 4 new test files; `onActivate` wiring reverts to the supervisor-timer no-op — zero impact on any other file; all byte-identical files untouched |

## Candidate State (UNCOMMITTED — PR 2)

`git status --short` (working tree after PR 1 committed at `1339791`):
```
 M openspec/changes/work-dispatch/tasks.md
?? packages/app/src/composition/supervisor-dispatch.ts
?? packages/app/src/dispatch/
?? packages/app/test/composition/supervisor-dispatch.test.ts
?? packages/app/test/dispatch/
```

`git diff --stat` (tracked): only `openspec/changes/work-dispatch/tasks.md` — 12 changed lines (6 checkbox flips `[ ]→[x]` for 2.1–2.7).

New-file line count (the PR 2 authored content): `app/src/dispatch/` 112 lines (keys 33 + types 29 + dispatch 50) + `supervisor-dispatch.ts` 52 lines = **164 src lines**; tests: keys 113 + dispatch 215 + supervisor-dispatch 163 + dispatch.integration 197 = **688 test lines**. Total authored ≈ 852 lines (src within the per-PR budget; test volume is the TDD deliverable).

**Byte-identical files — verified UNCHANGED in PR 2** (git diff vs HEAD is 0 bytes for each): `packages/app/src/supervisor/supervisor.ts`, `supervisor/tick.ts`, `supervisor/types.ts`, `worker/worker.ts`, `heartbeat/cycle.ts`, `heartbeat/evaluate.ts`, `composition/supervisor-deps.ts`, `composition/worker-deps.ts`. (`worker/cycle.ts` does not exist — absent, as documented.)

## Deviations from Design

1. `buildSupervisorDispatch.onActivate` returns an **awaitable `Promise<void>`** (async wrapper discarding the DispatchResult) rather than returning the DispatchResult-shaped promise directly. Rationale: `OnActivate` is typed `void | Promise<void>` in `supervisor/types.ts`, and the supervisor tick AWAITS the callback before checkpointing the cursor ("side effect FIRST, checkpoint LAST") — a fire-and-forget `void` wrapper would break crash-safety. Behavior matches design exactly: dispatch runs, then the cursor advances.
2. Dispatch integration tests use **per-test scratch databases + sandbox roots** (design said "isolated"; the shared-harness variant hit the real EEXIST collision — documented above). Same isolation intent, stronger isolation.

Otherwise none — implementation matches design.md (B1 key/hash, R2 one-oldest-first, R5 settle-vs-propagate, R4 replay, R6 orphan exclusion, C1 wiring via OnActivate, actor = principals.executor).

## Issues Found

1. **PR 2 test-design defect (fixed via TDD RED)**: shared sandbox root across dispatch integration tests → `EEXIST` on the second full-cycle dispatch (canned plan always writes `docs/quarterly-close.md`). Fixed with per-test harness (own scratch DB + sandbox root). This is why 2.6's RED showed 2 failing tests before GREEN.
2. **OnActivate type contract**: returning `Promise<DispatchResult>` is NOT assignable to `Promise<void>` (tsc strict) — needed the async wrapper. Not a design deviation, an implementation detail of the seam.
3. PR 1 pre-existing flake (known, untouched by PR 2): `business-pg-roundtrip.integration.test.ts` duplicate-key on concurrent terminal closes — passes in isolation and full sequential rerun (40/40).
4. First `pnpm check` run failed only on biome format (3 new files) + the onActivate typing; both fixed before the GREEN gate.

## Next Recommended

`sdd-verify` on the full work-dispatch change (PR 1 committed + PR 2 candidate) after the PR 2 candidate is reviewed/merged — or `sdd-archive` to sync the delta specs once verification passes.
