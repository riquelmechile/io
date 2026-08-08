# Apply Progress: Pro Escalation — PR1 (Phase 1, tasks 1.1–1.5) + PR2 (Phase 2, tasks 2.1–2.10)

**Date**: 2026-08-08
**Batch**: PR1 domain rule (slice 1 of 2) + PR2 app threading (slice 2 of 2)
**Mode**: Strict TDD (RED→GREEN→TRIANGULATE→REFACTOR), hybrid artifact store
**Status**: Phase 1 AND Phase 2 complete — all 15 tasks `[x]`. `pnpm check` fully green (1170 passed | 6 skipped). Live E2E documented-skipped (no live credentials). PR2 commit left to orchestrator (native RDD flow).

## Completed Tasks

### Phase 1 (PR1)

- [x] 1.1 RED `heartbeat.test.ts`: `escalationModelFor` matrix (pro high/critical; flash low/medium/absent/invalid/non-material/at-or-before-cursor)
- [x] 1.2 GREEN `heartbeat.ts`: `ModelTier`, `PRO_ESCALATION_THRESHOLD='high'`, `VALID_RISK_CLASSES`+`RISK_RANK`, `resolveCursorIndex`, `escalationModelFor`; `evaluateHeartbeat` returns `{kind:'activate', model}` resolved tier
- [x] 1.3 RED Date/Math spies (same inputs → same tier) + exact-`high` boundary; GREEN
- [x] 1.4 RED boundary test (zero `@io/*`, no runtime deps, pure union); GREEN exports from `index.ts`
- [x] 1.5 `pnpm check` green (format-check, typecheck, build, lint, 1155 tests)

### Phase 2 (PR2)

- [x] 2.1 RED mapper test (`worker-model-tier.test.ts`); GREEN `packages/app/src/worker/model-tier.ts`: `llmModelFor` flash→`deepseek-v4-flash`, pro→`deepseek-v4-pro`
- [x] 2.2 RED intent test (request model from tier, stable prefix unchanged); GREEN `IntentInput.model: ModelTier` in `worker/intent.ts`; map only via `llmModelFor`
- [x] 2.3 RED `runWorker(input,deps,'pro')` bypasses gate, FakeLlm sees `deepseek-v4-pro`; GREEN required 3rd arg in `worker.ts` feeds `prepareIntent`
- [x] 2.4 RED dispatch records tier (one oldest Work with `pro`; empty queue zero worker/LLM invocations); GREEN `dispatchCompanyActivation(companyId,deps,model)` in `dispatch.ts`
- [x] 2.5 RED recorded no-op seam receives `(companyId,'pro')`; `no-llm-heartbeat` no dispatch; GREEN `OnActivate(companyId,model)` in `supervisor/types.ts`; `tick.ts` passes `decision.model`; `composition/supervisor-dispatch.ts` closes over both
- [x] 2.6 Mechanical: `'flash'` added to all 56 `runWorker(` test call sites across 19 `packages/app/test/**` files (tsc errors = RED); terminal/replay assertions unchanged
- [x] 2.7 RED source-inspection test, BOTH variants: `supervisor.ts`, `cycle.ts`, `evaluate.ts`, gate byte-identical; only `tick.ts`+`runWorker` differ; `runWorker` differs only by model parameter; GREEN pins updated for the 4 legitimately-threaded files
- [x] 2.8 RED FakeLlm integration echoes model both tiers; GREEN test-local `EchoingFakeLlmClient` harness wiring
- [x] 2.9 Live E2E: SKIPPED (documented) — `DEEPSEEK_API_KEY` + `IO_LIVE_LLM=1` double gate not open; PG unreachable. Not faked.
- [x] 2.10 `pnpm check` green (all 5 gates; 1170 passed | 6 skipped). Commit intentionally left to orchestrator.

## Files Changed (cumulative, PR1 + PR2)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/heartbeat.ts` | Modified (PR1) | `ModelTier` union, `PRO_ESCALATION_THRESHOLD='high'`, `VALID_RISK_CLASSES`+`RISK_RANK`, shared `resolveCursorIndex`, `escalationModelFor`; `evaluateHeartbeat` selects resolved tier |
| `packages/business-domain/src/index.ts` | Modified (PR1) | Export `ModelTier`, `PRO_ESCALATION_THRESHOLD`, `VALID_RISK_CLASSES`, `escalationModelFor` |
| `packages/business-domain/test/heartbeat.test.ts` | Modified (PR1) | +15 tests: escalation matrix, determinism, boundary, index parity |
| `packages/business-domain/test/heartbeat-decision-event.test.ts` | Modified (PR1) | Widened `activate` branch assertion to `'flash' \| 'pro'` |
| `packages/app/src/worker/model-tier.ts` | Created (PR2) | `llmModelFor(tier): LlmModel` — ONLY tier→model mapping site |
| `packages/app/src/worker/intent.ts` | Modified (PR2) | `IntentInput.model: ModelTier`; `request.model = llmModelFor(input.model)` |
| `packages/app/src/worker/worker.ts` | Modified (PR2) | `runWorker(input, deps, model)` required 3rd arg → `prepareIntent({..., model})` |
| `packages/app/src/dispatch/dispatch.ts` | Modified (PR2) | `dispatchCompanyActivation(companyId, deps, model)` → `runWorker(..., model)` |
| `packages/app/src/supervisor/types.ts` | Modified (PR2) | `OnActivate(companyId, model)` |
| `packages/app/src/supervisor/tick.ts` | Modified (PR2) | `onActivate?.(companyId, decision.model)` |
| `packages/app/src/composition/supervisor-dispatch.ts` | Modified (PR2) | `onActivate: async (companyId, model) => dispatchCompanyActivation(..., model)` |
| `packages/app/test/worker-model-tier.test.ts` | Created (PR2) | 2.1 mapper tests + 2.8 echo integration (EchoingFakeLlmClient both tiers) |
| `packages/app/test/worker-intent.test.ts` | Modified (PR2) | 2.2 tier/prefix tests + 2.3 pro-bypass test + `model: 'flash'` on existing inputs |
| `packages/app/test/dispatch/dispatch.test.ts` | Modified (PR2) | 2.4 pro-tier dispatch test + `'flash'` at dispatch call sites |
| `packages/app/test/supervisor/supervisor.test.ts` | Modified (PR2) | 2.5 recorded no-op receives `(companyId, 'pro')` |
| `packages/app/test/daemon/byte-identity.test.ts` | Modified (PR2) | 2.7 source-inspection variants + pins updated for 4 threaded files |
| `packages/app/test/composition/supervisor-dispatch.test.ts` | Modified (PR2) | onActivate call sites gain model arg |
| `packages/app/test/dispatch/dispatch.integration.test.ts` | Modified (PR2) | dispatch + onActivate call sites gain model arg |
| 19 test files under `packages/app/test/**` | Modified (PR2) | Mechanical `'flash'` 3rd arg at all `runWorker(` call sites |

## TDD Cycle Evidence (Phase 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `worker-model-tier.test.ts` | Unit | N/A (new) | ✅ import failure (module missing) | ✅ 2/2 | ✅ 2 cases (flash, pro) | ➖ None needed (2-line pure fn) |
| 2.2 | `worker-intent.test.ts` | Unit | ✅ 15/15 | ✅ 2 failures: request model hardcoded `deepseek-v4-flash` for pro; prefix-share test | ✅ 17/17 (with worker-intent) | ✅ 3 cases: pro model, both tiers same prefix, cohort intact | ✅ mapped via `llmModelFor` (no duplicate mapping) |
| 2.3 | `worker-intent.test.ts` | Unit | ✅ 15/15 | ✅ pro-request failed (3rd arg ignored → `deepseek-v4-flash`) | ✅ 16/16 | ✅ 2 cases: pro reaches request; flash default still green | ✅ single `model` param threaded to prepareIntent |
| 2.4 | `dispatch/dispatch.test.ts` | Unit | ✅ 8/8 | ✅ pro-tier test failed (dispatch ignored 3rd arg → flash) | ✅ 9/9 | ✅ 2 cases: pro tier recorded; empty queue cost-free unchanged | ✅ model param forwarded unchanged |
| 2.5 | `supervisor/supervisor.test.ts` | Unit | ✅ 17/17 | ✅ recorded no-op got `(companyId)` only — model `pro` lost | ✅ 18/18 | ✅ 2 cases: pro received; no-llm-heartbeat no dispatch (existing) | ✅ `decision.model` passed at single call site |
| 2.6 | 19 test files | Unit/Integration | ✅ 265/268 | ✅ tsc TS2345 missing arg at ~55 sites + byte-identity drift RED | ✅ tsc clean; 279/282 app | ✅ script paren-matched all shapes (single-line, multi-line object, Promise.all) | ✅ biome canonical form (format-check gate) |
| 2.7 | `daemon/byte-identity.test.ts` | Unit (source-inspect) | ✅ 3/3 | ✅ drift detected: tick.ts hash changed; normalization mismatch (multi-line sig) | ✅ 7/7 (4 variants pass) | ✅ 2 variants: byte-identical set + normalization→PR1 bytes | ✅ normalization matches biome-canonical source |
| 2.8 | `worker-model-tier.test.ts` | Integration | ✅ 2/2 | ✅ (covered by 2.3 pro-request RED — before threading, pro reached flash) | ✅ 5/5 | ✅ 2 cases: flash echo + pro echo through full cycle | ✅ test-local echo fake (no production change) |
| 2.9 | `e2e/deepseek-live.integration.test.ts` | Live E2E | n/a | n/a (gated) | ✅ 3 skipped (documented — no credentials) | n/a | n/a |
| 2.10 | `pnpm check` | Gate | n/a | n/a | ✅ exit 0 — all 5 gates; 1170 passed / 6 skipped | n/a | n/a |

## Test Summary (PR2)

- **Total tests written (PR2)**: 12 new (2 mapper, 3 intent/prepareIntent, 1 cycle pro, 1 dispatch tier, 1 supervisor seam, 2 echo integration, 2 byte-identity variants)
- **Total tests passing**: app 279/282 (3 skipped live-PG); full suite 1170/1176 (6 skipped)
- **Layers used**: Unit (10), Integration (2), Live E2E (gated)
- **Approval tests**: existing terminal/replay/finalize tests kept byte-identical except the required `'flash'` arg
- **Pure functions created**: `llmModelFor`

## Work Unit Evidence (PR2 — work unit `pr2-app-threading`)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test` → **42 files passed | 1 skipped, 279 passed | 3 skipped**; focused `worker-model-tier.test.ts worker-intent.test.ts` → 2 files, 22 tests passed |
| Runtime harness command/scenario and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/deepseek-live.integration.test.ts` → **1 file skipped, 3 tests skipped** (cost-safe double gate: `DEEPSEEK_API_KEY` unset + `IO_LIVE_LLM≠1`; PG unreachable). Documented skip — NOT faked. FakeLlm echo integration (both tiers) passes in-process instead. |
| Rollback boundary | `git checkout HEAD -- packages/app/src packages/app/test` (or revert of the PR2 commit) — restores PR1 state: `runWorker`/dispatch 2-arg, `OnActivate(companyId)`, flash-only request model; PR1 domain rule (business-domain) untouched and dormant. No migration/state to unwind. |

## Workload / PR Boundary

- Mode: **stacked PR slice** (auto-chain, stacked-to-main) — PR2 of 2
- Work unit: `pr2-app-threading`
- Boundary: starts after PR1 (`44cfbf4`); ends with all 10 Phase-2 tasks implemented + `pnpm check` green; commit left to orchestrator.
- Measured changed lines: **637 code lines** (`git diff HEAD --numstat` for `packages/**`: 496 added / 141 deleted). NOTE: exceeds the ~400 review budget. Drivers: (1) ~72 lines of biome-mandated re-flow of 9 multi-line object-arg call sites (format-check gate REQUIRES the expanded 3-arg form — verified by probe; not author choice), (2) full TDD evidence for 8 tasks (~12 new tests), (3) 56 mechanical `'flash'` sites + 12 dispatch/onActivate sites. Excludes the pre-existing openspec planning trail (682 lines, untracked planning artifacts from earlier phases — not PR2 code). Flagged for orchestrator: if strict 400-line budget required, PR2 could be split further, but the mechanical/churn lines are unavoidable.

## Deviations from Design

1. Task 2.2 text said "intent.ts+types.ts"; design.md File Changes lists only `worker/intent.ts` for `IntentInput.model` — implemented per design (intent.ts only; `worker/types.ts` unchanged, verified no diff needed).
2. `OnActivate` seam type per design: `(companyId, model) => void | Promise<void>` — implemented exactly.
3. runWorker signature kept biome-canonical single-line→multi-line as the formatter requires; byte-identity normalization accounts for the wrapped signature (proven: stripping model threading restores PR1 baseline hash exactly).

## Issues Found / Notes

1. **Byte-identity pin updates (4 files)** — tick.ts, supervisor/types.ts, worker.ts, dispatch.ts legitimately change for threading; pins updated to new verified bytes. `supervisor.ts`, `cycle.ts`, `evaluate.ts`, `dispatch/keys.ts`, `dispatch/types.ts` stay byte-identical (pins unchanged).
2. **`heartbeat-decision-event.ts` factory still hardcodes `model: 'flash'`** in the emitted decision-event payload (pre-existing from PR1, documented follow-up from design.md Coordination). NOT in PR2 scope; flagged for orchestrator. Type-valid today; behaviorally the persisted decision event carries `flash` for `pro` activations until switched.
3. **Line-budget overage** — see Workload section. The biome re-flow of multi-line call sites is the largest single non-author line driver.
4. Live E2E documented-skip (no `DEEPSEEK_API_KEY`, `IO_LIVE_LLM≠1`, PG unreachable). The default-flash live assertion (`response?.model === 'deepseek-v4-flash'`) remains unchanged for when credentials are provided.

## Status

15/15 tasks complete across both phases. `pnpm check` exit 0. Ready for orchestrator review + RDD commit of PR2. Next: sdd-verify.
