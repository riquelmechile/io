# Apply Progress — deepseek-live-e2e (PR 1 + PR 2, stacked-to-main)

Change: `deepseek-live-e2e` · Mode: **Strict TDD** · Store: hybrid
Slice: **PR1** = Phases 1–3 (composition root + harness widening + recorder); **PR2** = Phase 4 (double-gated live E2E). Both committed/left dirty per slice.
Test: `PATH=/data/node24/bin:$PATH pnpm test` · Gate: `PATH=/data/node24/bin:$PATH pnpm check` (EXIT 0).
Baseline: main@b935511 (PR1), 824 passed / 3 skipped. Final (PR2): **829 passed / 6 skipped** (+5 new passing: 4 retry-unit + 1 retry-integration; +3 new skips = the live suite, gate-closed — CORRECT).

---

## TDD Cycle Evidence — PR1 (Phases 1–3, committed b935511)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/app/test/composition/worker-deps.test.ts` | Unit | N/A (new file) | ✅ Written — module missing (transform error) | ✅ 4/4 | ✅ 4 cases (wiring, injectivity identity+behavior, sandbox root, now) | ✅ Format via biome; minimal 1.1 kept factory out |
| 1.2 | `packages/app/test/composition/worker-deps.test.ts` | Integration (live PG) + Unit | N/A (new block) | ✅ 2 failed — cycle pre-terminal `in_progress` (no `repositories`) + factory undefined | ✅ 6/6 | ✅ factory-fresh-adapters unit + full-cycle atomic (1 receipt, journal completed, work v3) | ✅ Final factory mirrors `completeWorkAtomically` verbatim |
| 2.1 | `packages/app/test/e2e/harness.integration.test.ts` | Integration (live PG) | ✅ C1 suite 3/3 before edit | ✅ 1 failed — injected llm ignored (`h.llm` ≠ injected) | ✅ 5/5 | ✅ injected-llm full cycle + default-path unchanged | ✅ Deps assembly extracted to `buildWorkerDeps` (net −70 lines in harness.ts) |
| 2.2 | C2–C5 E2E suites + `pnpm check` | E2E (live PG) | N/A (verify) | N/A (verify task) | ✅ full gate EXIT 0 | N/A | N/A |
| 3.1 | `packages/app/test/e2e/recording-llm-client.test.ts` | Unit | N/A (new file) | ✅ Written — module missing (transform error) | ✅ 3/3 | ✅ 3 cases (delegation, 2-call recording, custom client) | ✅ Format via biome |

## TDD Cycle Evidence — PR2 (Phase 4, THIS batch — UNCOMMITTED)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `packages/app/test/e2e/deepseek-live.integration.test.ts` | E2E (gated) | N/A (new file) | ✅ Gate neutralized → suite RAN (PG gate open) → 3 FAILED: `LlmError: Missing credentials` thrown SYNCHRONOUSLY by `new OpenAI()` (client.mjs:156) — zero network, zero spend; proves a plain run WOULD attempt model invocation | ✅ Gate restored → suite SKIPPED 3/3, exit 0 | ✅ double gate = both-permit / opt-in-absent / key-absent (expression covers all 3) | ✅ Mandatory expression kept verbatim |
| 4.2 | `deepseek-live.integration.test.ts` (+ mirror in `live-retry.integration.test.ts`) | E2E (gated) + Integration (live PG, fake) | ✅ e2e dir 19 passed before live edits | ✅ Live assertions written FIRST (cannot pass gate-closed by design — structure-only, real model) | ✅ Gate-closed: suite skips; assertion LOGIC proven by green mirror (live-retry.integration: work v3, 1 receipt, journal completed, receipt trace) + C2 | ✅ structure: result/DB work v3, receipt count scoped, journal scoped, effect applied+reversible, plan shape (create-document, non-empty relativePath, string content) — NO exact path/content | ✅ Scoped SQL (work_id / key) so retry test's rows don't pollute happy-path asserts |
| 4.3 | `deepseek-live.integration.test.ts` | E2E (gated) | N/A (new block) | ✅ Written first (echo/cache/cohort — live-only) | ✅ Gate-closed green; logic pre-proven: recorder unit tests 3/3 (PR1), deriveCohort unit tests, extractUsage logic unit-tested in llm-client | ✅ model echo + cache fields ≥ 0 + prompt = hit+miss + cohort user === deriveCohort({companyId, process:'low-risk-documents', schemaVersion:1}) | ✅ presence-not-value (hit can be 0 for a fresh cohort — documented) |
| 4.4 | `packages/app/test/e2e/live-retry.test.ts` (unit) + `live-retry.integration.test.ts` (live PG, fake) + live file | Unit + Integration | N/A (new files) | ✅ RED: unit 4 tests written first (helper missing → transform error) + integration first run FAILED (denied delegation-not-found — caught missing seed; then randomUUID missing — caught) | ✅ Unit 4/4 + integration 1/1 (fresh key `live-1/2-…`, SQL reset to accepted/v1, exactly 2 attempts, no 3rd completion, first key NO journal row, second key journal completed, 1 receipt, receipt traces to 2nd attempt) | ✅ 4 unit cases: fresh-key retry, bounded (2 invalid → exactly 2, no 3rd), never-retry non-invalid-plan, stop-on-success; integration proves raw-SQL reset unblocks re-claim vs live PG | ✅ Retry loop extracted to test-local `live-retry.ts` (single source of truth, reused by live file); worker source untouched |
| 4.5 | FULL `pnpm check` | Gate | ✅ 824/3 baseline | N/A (verify) | ✅ **EXIT 0 — 829 passed / 6 skipped** (live suite SKIPPED; no spend; key never set/printed; opt-in command documented in file header) | N/A | N/A |

## Work Unit Evidence (PR2)

| Unit | Focused test result | Runtime harness result | Rollback boundary |
|------|--------------------|-----------------------|-------------------|
| 4.1 gate | `pnpm vitest run packages/app/test/e2e/deepseek-live.integration.test.ts` → RED 3 failed (gate off, Missing credentials, zero network) → GREEN 3 skipped, exit 0 | Gate-closed: plain test run never constructs/invokes the model | Delete the live test file → zero spend/runtime impact |
| 4.2+4.3 live assertions | Same focused run: suite skipped (assertions compile + skip); logic mirrored green in `live-retry.integration.test.ts` (terminal structure vs live PG) | Opt-in (orchestrator): `IO_LIVE_LLM=1 DEEPSEEK_API_KEY=… pnpm vitest run …/deepseek-live.integration.test.ts` — NOT run here (cost safety) | Revert the live test file |
| 4.4 retry | `pnpm vitest run packages/app/test/e2e/live-retry.test.ts packages/app/test/e2e/live-retry.integration.test.ts` → 4/4 + 1/1 (fresh key, SQL reset, ≤2, no 3rd completion, worker untouched) | Full retry cycle vs live PG with FakeLlm (invalid-plan → reset → valid): work completed v3, 1 receipt, journal completed for 2nd key only | Delete `live-retry.{ts,test.ts,integration.test.ts}` |

## Proof: double gate works (Req 3)

- The gate is the FIRST thing evaluated in the file: `describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')` at module scope, before any harness/client construction (module-top `await pgReachable()` is the PG probe, same as C2 — no model construction).
- RED proof: with the gate temporarily neutralized, the suite RAN and failed 3/3 with `LlmError: Missing credentials` — the openai SDK constructor (client.mjs:156) throws SYNCHRONOUSLY with no key. Zero network, zero spend — but it proves that WITHOUT the gate, a plain test run attempts model invocation (and would spend with a key present).
- GREEN proof: gate restored → suite SKIPPED 3/3, `pnpm check` EXIT 0, 829 passed / 6 skipped. CI has no key → always skip.
- `DEEPSEEK_API_KEY` appears in the file ONLY inside the gate guard expression and comments (never read into a variable, never printed, never logged).

## Proof: NO API was spent in this phase

- `IO_LIVE_LLM` was NEVER set; `DEEPSEEK_API_KEY` was NEVER loaded/read; the real `DeepSeekClient` was NEVER invoked (SDK constructor never reached except in the RED run, which threw BEFORE any HTTP — no key present).
- The live suite is gate-closed: `env | grep DEEPSEEK` → unset; `IO_LIVE_LLM` unset. Verification is gate-closed green only; the orchestrator runs the live proof separately.

## Proof: bounded retry mechanism (Req 5, test-only)

- Retry logic lives ONLY in test-local `packages/app/test/e2e/live-retry.ts` (`runLiveCycleWithBoundedRetry`): fresh key per attempt (`live-${n}-${uuid}`), retry ONLY `invalid-plan`, hard cap `maxAttempts = 2` — a third completion is impossible by construction. `resetWork` = raw SQL `UPDATE work SET state='accepted', version=1 WHERE company_id=$3 AND work_id=$4` (save is INSERT-only; updateIfVersion only increments; invalid-plan leaves NO journal row and NO sandbox effect).
- Live-PG integration proof: first completion invalid-plan → reset → second completion (fresh key) claims + completes; first key has NO journal row, second key journal `completed`, work v3, exactly 1 receipt tracing to the 2nd attempt.
- Unit proof: fresh-key retry (2 attempts, distinct keys, reset once), bounded (2 invalid → exactly 2, no 3rd), never-retry non-invalid-plan, stop-on-success.
- Worker source untouched: `git diff --stat -- packages/app/src/worker packages/llm-client packages/app/package.json pnpm-lock.yaml` → EMPTY.

## Proof: structure/model/KV/cohort assertions (to be exercised live by the orchestrator)

- 4.2 structure: `result.ok`, work `completed` v3 (result + stored), EXACTLY ONE `business_receipt` (scoped by work_id), journal `completed` (scoped by key), effect applied (`existsSync` + `wasApplied`) and reversible (`undo` → gone), plan shape ONLY (steps.length > 0, `create-document`, non-empty `relativePath`, string `content`).
- 4.3 echo/KV/cohort: `lastResponse.model === 'deepseek-v4-flash'`; `promptCacheHitTokens`/`promptCacheMissTokens` present and ≥ 0; `promptTokens === hit + miss`; `lastRequest.user === deriveCohort({companyId: 'acme-corp', process: 'low-risk-documents', schemaVersion: 1})`.
- 4.4 live wiring: same `runLiveCycleWithBoundedRetry` helper with the real `DeepSeekClient` + real SQL reset; asserts ≤2 completions, terminal success (fails loudly otherwise).

## Coupling evidence

- `openai` appears in `packages/app` ONLY inside boundary tests that ASSERT confinement (packages/app/test/boundary.test.ts, app-boundary.test.ts — both pass); no app src import. The live test imports `DeepSeekClient` from `@io/llm-client` (the only SDK boundary).
- `packages/app/package.json` diff: 0 lines (no new runtime deps); `pnpm-lock.yaml` diff: 0 lines.
- App imports `@io/{context,llm-client,database,business-domain}` — all pre-existing workspace deps.

## Security evidence

- `DEEPSEEK_API_KEY` referenced ONLY as the boolean gate guard (`!process.env.DEEPSEEK_API_KEY`) — value never read into a variable, never logged, never printed, never committed.
- File header + gate comments document: "never print key", "never add key to workflows". CI has no key → always skip.

## Files changed (PR2, UNCOMMITTED — left dirty for orchestrator review)

| File | Action | What |
|------|--------|------|
| `packages/app/test/e2e/deepseek-live.integration.test.ts` | Created | Double-gated live E2E (4.1–4.5): mandatory `describe.skipIf(!KEY \|\| IO_LIVE_LLM !== '1')`, structure-not-output assertions, model echo + KV accounting + cohort, bounded retry wiring, opt-in header docs |
| `packages/app/test/e2e/live-retry.ts` | Created | Test-local `runLiveCycleWithBoundedRetry` (fresh key, only invalid-plan, cap 2, resetWork callback) |
| `packages/app/test/e2e/live-retry.test.ts` | Created | 4 unit tests: fresh-key retry, bounded/no-3rd, never-retry non-invalid-plan, stop-on-success |
| `packages/app/test/e2e/live-retry.integration.test.ts` | Created | Live-PG (FakeLlm) proof: invalid-plan → raw-SQL reset → fresh-key completion; journal/receipt traces |
| `openspec/changes/deepseek-live-e2e/tasks.md` | Modified | 4.1–4.5 marked `[x]` |

PR1 files (committed b935511): `src/composition/worker-deps.ts`, `test/composition/worker-deps.test.ts`, `test/e2e/harness.ts`, `test/e2e/harness.integration.test.ts`, `test/e2e/recording-llm-client.{ts,test.ts}`, `tasks.md` (1.1–3.1).

## Review budget impact (PR2)

Authored additions ≈ **470 lines** (live test 244, live-retry.ts 75, live-retry.test.ts 110, live-retry.integration.test.ts 165) — all NEW files, all test code; ZERO production source. Slightly above the nominal 400-line budget but autonomous test-only scope (the orchestrator's `auto-chain` decision with PR2 = Phase 4 stands).

## Status

10/10 tasks complete (1.1, 1.2, 2.1, 2.2, 3.1 from PR1 + 4.1–4.5 from PR2). All 6 worker-cycle Reqs / 14 scenarios covered (Req1→1.1/1.2 · Req2→4.2 · Req3→4.1 · Req4→4.2/4.3 · Req5→4.4 · Req6→4.3). Gate-closed verification complete (829/6, EXIT 0); live proof is the orchestrator's opt-in run. Tree left dirty (no commits).
