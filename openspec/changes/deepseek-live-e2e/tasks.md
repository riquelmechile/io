# Tasks: DeepSeek Live End-to-End Worker Cycle

Change `deepseek-live-e2e` · Strict TDD (RED→GREEN per unit) · Baseline main@0c124fd (813 passed/3 skipped).
Test `PATH=/data/node24/bin:$PATH pnpm test`; gate `pnpm check`; live PG `postgresql://io:io_dev@localhost:5432/io_dev`.
Read-only (no semantics change): `packages/app/src/worker/*`, `packages/llm-client/**`. No new runtime deps. Threat matrix: N/A.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350–500 authored (design 200–300 likely low; IO 2–3× underestimate history) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 composition+harness+recorder → PR2 double-gated live E2E |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----------------------|-----------------|-------------------|
| 1 | Composition root + harness delegation + recorder (Phases 1–3) | PR1 | `pnpm vitest run packages/app/test/composition/worker-deps.test.ts packages/app/test/e2e` | Live-PG scratch E2E (FakeLlm), real scenario | Delete worker-deps.ts+test, revert harness.ts → baseline C2–C5 |
| 2 | Double-gated live E2E (Phase 4) | PR2 | gate-closed `pnpm vitest run …/deepseek-live.integration.test.ts` (skips); opt-in `IO_LIVE_LLM=1 …` | Real DeepSeek + live PG (opt-in only) | Delete the test file; zero runtime/spend impact |

## Phase 1: Composition Root — Req 1 (no deps)

- [x] 1.1 RED→GREEN wiring + injectivity: test `packages/app/test/composition/worker-deps.test.ts` asserts `buildWorkerDeps` yields pool-bound work/delegation/receipts/journal + sandbox + connection + principals and `deps.llm === supplied`; create `packages/app/src/composition/worker-deps.ts` (`BuildWorkerDepsInput` + `buildWorkerDeps`). [LLM client remains injectable]
- [x] 1.2 RED→GREEN atomic finalize: test runs full cycle (FakeLlm + live PG) via `repositories(tx)`; assert one `business_receipt`, journal `completed`, work `completed` committed atomically, factory binds tx conn mirroring `completeWorkAtomically`; implement `repositories(conn)` factory. [Wired worker finalizes atomically]

## Phase 2: Harness Widening — Req 1 reuse (deps: Phase 1)

- [x] 2.1 RED→GREEN: test `createE2eHarness({ options.llm })` accepts injected `LlmClient`, builds deps via `buildWorkerDeps`, default `cannedLlm()` unchanged; modify `packages/app/test/e2e/harness.ts` (`E2eHarness.llm: LlmClient`, `E2eHarnessOptions.llm?`, delegate deps in `openFreshWorkerStack`).
- [x] 2.2 VERIFY: run C2–C5 E2E suites + `pnpm check`; confirm green, default fake path unchanged.

## Phase 3: RecordingLlmClient — Reqs 4/6 capture (deps: Phase 1)

- [x] 3.1 RED→GREEN: test recorder delegates `complete`, stores `lastRequest`/`lastResponse`/`callCount`; add test-local `RecordingLlmClient` (NOT exported from app src).

## Phase 4: Double-Gated Live E2E — ISOLATED complex unit, Reqs 2–6 (deps: Phases 1–3)

- [ ] 4.1 Gate + cost-safety: create `packages/app/test/e2e/deepseek-live.integration.test.ts` with `describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')`; prove plain `pnpm test` (no key / no opt-in) skips + stays green; never print key. [Req 3: both permit / opt-in absent / key absent]
- [ ] 4.2 Happy-path structure: bootstrap harness with `RecordingLlmClient(new DeepSeekClient())`; assert `result.ok`, work `completed` v3, one receipt, journal `completed`, effect applied + reversible (`undo`), plan shape (`create-document`, non-empty `relativePath`, string `content`) — NO exact path/content/plan. [Req 2 both; Req 4 output-unconstrained]
- [ ] 4.3 Model echo + KV accounting: assert `lastResponse.model === 'deepseek-v4-flash'`, cache hit/miss present `>= 0`, `promptTokens === hit + miss`, `lastRequest.user === deriveCohort({companyId, process:'low-risk-documents', schemaVersion:CONTEXT_SCHEMA_VERSION})` (cohort `user`). [Req 4 echo + cache; Req 6]
- [ ] 4.4 Bounded retry (test-only): ≤2 attempts, fresh key `live-${n}-${uuid}`, SQL reset `UPDATE work SET state='accepted', version=1`, retry only `invalid-plan`, no 3rd completion, worker source unchanged. [Req 5 all 3]
- [ ] 4.5 VERIFY live proof + cost-safety: gate-closed suite green (no spend); deliberate `IO_LIVE_LLM=1 pnpm vitest run …/deepseek-live.integration.test.ts` passes; confirm key never printed/committed; `pnpm check` green.

Coverage: Req1→1.1/1.2 · Req2→4.2 · Req3→4.1 · Req4→4.2/4.3 · Req5→4.4 · Req6→4.3 (all 6 reqs / 14 scenarios).
