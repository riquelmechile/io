# Apply Progress — deepseek-live-e2e (PR 1 of 2, stacked-to-main)

Change: `deepseek-live-e2e` · Batch: 1 (first) · Mode: **Strict TDD** · Store: hybrid
Slice: **PR1** = Phases 1–3 (composition root + harness widening + recorder). Phase 4 (live E2E) is PR2 — NOT implemented.
Test: `PATH=/data/node24/bin:$PATH pnpm test` · Gate: `PATH=/data/node24/bin:$PATH pnpm check` (EXIT 0).
Baseline: main@0c124fd, 813 passed / 3 skipped. Final: **824 passed / 3 skipped** (+11 new tests, same 3 pre-existing skips).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/app/test/composition/worker-deps.test.ts` | Unit | N/A (new file) | ✅ Written — module missing (transform error) | ✅ 4/4 | ✅ 4 cases (wiring, injectivity identity+behavior, sandbox root, now) | ✅ Format via biome; minimal 1.1 kept factory out |
| 1.2 | `packages/app/test/composition/worker-deps.test.ts` | Integration (live PG) + Unit | N/A (new block) | ✅ 2 failed — cycle pre-terminal `in_progress` (no `repositories`) + factory undefined | ✅ 6/6 | ✅ factory-fresh-adapters unit + full-cycle atomic (1 receipt, journal completed, work v3) | ✅ Final factory mirrors `completeWorkAtomically` verbatim |
| 2.1 | `packages/app/test/e2e/harness.integration.test.ts` | Integration (live PG) | ✅ C1 suite 3/3 before edit | ✅ 1 failed — injected llm ignored (`h.llm` ≠ injected) | ✅ 5/5 | ✅ injected-llm full cycle + default-path unchanged | ✅ Deps assembly extracted to `buildWorkerDeps` (net −70 lines in harness.ts) |
| 2.2 | C2–C5 E2E suites + `pnpm check` | E2E (live PG) | N/A (verify) | N/A (verify task) | ✅ full gate EXIT 0 | N/A | N/A |
| 3.1 | `packages/app/test/e2e/recording-llm-client.test.ts` | Unit | N/A (new file) | ✅ Written — module missing (transform error) | ✅ 3/3 | ✅ 3 cases (delegation, 2-call recording, custom client) | ✅ Format via biome |

## Work Unit Evidence (PR1)

| Unit | Focused test result | Runtime harness result | Rollback boundary |
|------|--------------------|-----------------------|-------------------|
| 1 — composition root (1.1+1.2) | `pnpm vitest run packages/app/test/composition/worker-deps.test.ts` → 6/6 pass | Full worker cycle via `buildWorkerDeps` + FakeLlm + live PG scratch (`io_dev_e2e_worker_deps`): ONE `business_receipt`, journal `completed`, work `completed` v3 — atomic via `repositories(tx)` factory | Delete `src/composition/worker-deps.ts` + `test/composition/` → revert to harness baseline; no worker/llm-client source touched |
| 2 — harness widening (2.1+2.2) | `pnpm test packages/app` → 23 files / 137 pass (C1–C5 all run vs live PG, 0 PG skips) | `pnpm check` EXIT 0: format+typecheck+build+lint+test, 824/3; injected-llm cycle + default fake path both verified | Revert `test/e2e/harness.ts` + `harness.integration.test.ts` → baseline C1–C5 |
| 3 — recorder (3.1) | `pnpm vitest run packages/app/test/e2e/recording-llm-client.test.ts` → 3/3 pass | N/A (test-local pure wrapper; no runtime boundary beyond delegation asserts) | Delete `test/e2e/recording-llm-client.{ts,test.ts}` → zero runtime impact |

## Proof: composition root keeps finalize atomic

- `buildWorkerDeps` returns `repositories(conn)` binding `PgWorkRepository(conn)`, `PgBusinessReceiptRepository(conn)`, `PgIdempotencyJournalRepository(conn)` — identical to `completeWorkAtomically` (packages/database/src/complete-work-flow.ts:32-39).
- Test `worker-deps.test.ts` "finalizes atomically through the composition root": full `runWorker` cycle via composed deps vs live PG ⇒ `result.work.state === 'completed'` v3, `SELECT count(*) FROM business_receipt === 1`, journal `completed` with `attemptId === result.attemptId`, stored work `completed` v3.
- Factory unit test proves FRESH adapters per call (`txRepos.work !== deps.work` etc.) — T1 gets tx-scoped repos, never the pool-bound autocommit instances.
- Worker/`llm-client` source untouched (`git diff` shows zero changes under `packages/app/src/worker/*`, `packages/llm-client/**`); worker source semantics unchanged (the pre-existing `WorkerDeps.connection?/repositories?/llm` seams are FILLED by the composition root).

## Proof: harness widening is additive

- `E2eHarness.llm: FakeLlmClient` → `LlmClient`; `E2eHarnessOptions.llm?: LlmClient` (default `options.llm ?? cannedLlm(options.llmContent)` — default path byte-identical).
- `createE2eHarness` + `openFreshWorkerStack` both delegate deps assembly to `buildWorkerDeps` (single production wiring; `openFreshWorkerStack` reuses `harness.llm` — behavior identical for the canned FakeLlmClient).
- C2 (worker-e2e), C3 (replay-deny), C4 (single-receipt ×2), C5 (marker-restart) all pass vs live PG unchanged; C1 harness smoke passes (5 tests).
- New widening test: injected FakeLlmClient drives the REAL cycle (1 request recorded, 1 receipt) + default path returns a `FakeLlmClient`.

## Focused + Full verification

- Focused: `pnpm vitest run packages/app/test/composition/worker-deps.test.ts packages/app/test/e2e` → all pass.
- Full gate: `PATH=/data/node24/bin:$PATH pnpm check` → **EXIT 0**; format ✓ typecheck ✓ build ✓ lint ✓ (3 pre-existing warnings); tests **824 passed / 3 skipped** (baseline 813/3).
- E2E vs live PG: 0 PG skips in app suites (C1–C5 all ran; PG reachable). The only skips are the pre-existing `pg-required` CI-guard and the gated live-DeepSeek round-trip (no key — correct).
- No live DeepSeek calls made; no API spend; gate stays green WITHOUT `IO_LIVE_LLM`/key.

## Coupling evidence

- `openai` appears in `packages/app` ONLY inside boundary tests that ASSERT confinement (`packages/app/test/boundary.test.ts`, `app-boundary.test.ts`) — both pass; no app src import.
- `packages/app/package.json` diff: 0 lines (no new runtime deps); `pnpm-lock.yaml` diff: 0 lines.
- App imports only `@io/{database,llm-client}` (type-only for llm-client), `business-domain` via worker, plus local `src/*` — within the allowed coupling set.

## Files changed (PR1, UNCOMMITTED — left dirty for orchestrator review)

| File | Action | What |
|------|--------|------|
| `packages/app/src/composition/worker-deps.ts` | Created | `BuildWorkerDepsInput` + `buildWorkerDeps` (composition root; `repositories(conn)` mirrors `completeWorkAtomically`) |
| `packages/app/test/composition/worker-deps.test.ts` | Created | 6 tests: wiring, injectivity, sandbox root, now, factory freshness, full-cycle atomic finalize vs live PG |
| `packages/app/test/e2e/harness.ts` | Modified | `llm: LlmClient`; `options.llm?`; deps delegated to `buildWorkerDeps` (createE2eHarness + openFreshWorkerStack) |
| `packages/app/test/e2e/harness.integration.test.ts` | Modified | +2 widening tests (injected llm full cycle; default path unchanged) |
| `packages/app/test/e2e/recording-llm-client.ts` | Created | Test-local `RecordingLlmClient` (NOT exported from app src) |
| `packages/app/test/e2e/recording-llm-client.test.ts` | Created | 3 tests: delegation, recording, custom client |
| `openspec/changes/deepseek-live-e2e/tasks.md` | Modified | 1.1–3.1 marked `[x]` |

## Review budget impact (PR1)

Authored additions+deletions ≈ **648** (450 new-file lines + 198 modified diff). Above the nominal 400-line budget — driven mostly by TDD test files (worker-deps.test.ts 253, widening test +96, recorder tests 91) plus the harness extraction. Production code is small (worker-deps.ts 61 lines; harness.ts net −70). The orchestrator's `auto-chain`/`stacked-to-main` decision with PR1 = Phases 1–3 is honored; flag for review-slicing if the 648-line diff is too heavy (candidate split: PR1a composition root, PR1b harness widening + recorder).

## Status

5/5 PR1 tasks complete (1.1, 1.2, 2.1, 2.2, 3.1). Phase 4 (4.1–4.5) deferred to PR2. Ready for orchestrator review; tree left dirty (no commits).
