# Tasks: Pro Escalation (§13.2 Model Tier)

Sequencing: `heartbeat-decision-events` must apply+archive FIRST (its factory: `'flash'`→`decision.model`, one line). Strict TDD: RED→GREEN per task; tests ship with code. Conventional commits, no AI attribution. Prefix: `PATH=/data/node24/bin:$PATH`.

Codes: HB=heartbeat, WC=worker-cycle, WD=work-dispatch, ST=supervisor-timer; S#=scenario.

## Review Workload Forecast

Estimated changed lines: ~350–500 (PR1 ~150–220; PR2 ~200–280 incl. ~54 mechanical one-line edits)
400-line budget risk: High
Chained PRs recommended: Yes
Suggested split: PR1 then PR2, stacked-to-main, each ≤400
Chain strategy: stacked-to-main
Decision needed before apply: No

### Work Units

1. PR1 domain rule + tests. Focused: `pnpm vitest run packages/business-domain/test/heartbeat.test.ts`; harness N/A (pure function, no runtime boundary); rollback: revert PR1, prior type restored, app untouched.
2. PR2 threading + tests. Focused: `pnpm test`, live `pnpm vitest run --no-file-parallelism packages/app/test/e2e/deepseek-live.integration.test.ts`; harness: FakeLlm asserts `requests[0].model` both tiers; rollback: revert PR2, flash hardcoded, PR1 dormant.

## Phase 1: PR1 Domain Rule

- [x] 1.1 RED `packages/business-domain/test/heartbeat.test.ts`: `escalationModelFor`: `pro` for novel material `high`/`critical`; `flash` for low/medium/absent/invalid/non-material/at-or-before-cursor (HB Escalation S1,S2).
- [x] 1.2 GREEN `packages/business-domain/src/heartbeat.ts`: `ModelTier`, `PRO_ESCALATION_THRESHOLD='high'`, local `VALID_RISK_CLASSES`+`RISK_RANK`, `resolveCursorIndex`, `escalationModelFor`; `evaluateHeartbeat` returns `{kind:'activate',model}` (HB Escalation, Pure Decision).
- [x] 1.3 RED Date/Math spies: same (events,cursor) same tier under varied clock/randomness; exact-`high` boundary; GREEN (HB Escalation S3).
- [x] 1.4 RED boundary test (zero `@io/*`, no runtime deps, pure union); GREEN export `ModelTier`, `PRO_ESCALATION_THRESHOLD`, `VALID_RISK_CLASSES`, `escalationModelFor` from `packages/business-domain/src/index.ts` (HB Pure Decision S1).
- [x] 1.5 `pnpm check` green; commit `feat(business-domain): add deterministic model-tier escalation rule`.

PR1 acceptance: standalone green; app unchanged; zero `@io/*`; no runtime deps/migration.

## Phase 2: PR2 App Threading

- [x] 2.1 RED mapper test; GREEN create `packages/app/src/worker/model-tier.ts`: `llmModelFor` flash→`deepseek-v4-flash`, pro→`deepseek-v4-pro` (WC Work-Bearing S2).
- [x] 2.2 RED intent test: request model from tier, stable prefix unchanged; GREEN `IntentInput.model: ModelTier` in `packages/app/src/worker/intent.ts`; map only via `llmModelFor` (WC Work-Bearing S2).
- [x] 2.3 RED `runWorker(input,deps,'pro')` bypasses gate, FakeLlm sees `deepseek-v4-pro`; terminal close + replay idempotent (`'flash'`); GREEN required 3rd arg in `packages/app/src/worker/worker.ts` feeds `prepareIntent` (WC Work-Bearing S1,S3,S4).
- [x] 2.4 RED dispatch records tier: one oldest Work with `pro`; empty queue zero worker/LLM invocations; GREEN `dispatchCompanyActivation(companyId,deps,model)` in `packages/app/src/dispatch/dispatch.ts` (WD One-Oldest S1,S2).
- [x] 2.5 RED recorded no-op seam receives `(companyId,'pro')`; `no-llm-heartbeat` no dispatch; GREEN `OnActivate(companyId,model)` in `packages/app/src/supervisor/types.ts`; `tick.ts` passes `decision.model`; `packages/app/src/composition/supervisor-dispatch.ts` closes over both (ST Seam S1; WD Wiring S1).
- [x] 2.6 Mechanical: add `'flash'` to ~54 `runWorker(` test call sites across ~19 `packages/app/test/**` files (tsc errors = RED); keep terminal/replay assertions (WC Work-Bearing S3,S4).
- [x] 2.7 RED source-inspection test, BOTH variants: `supervisor.ts`, `cycle.ts`, `evaluate.ts`, gate byte-identical; only `tick.ts`+`runWorker` differ; `runWorker` differs only by model parameter (WD Wiring S2; ST Seam S2); GREEN fix drift.
- [x] 2.8 RED FakeLlm integration echoes model both tiers; GREEN harness wiring (WC Assertions S1).
- [x] 2.9 Live E2E: flash echo, cache fields, unconstrained output, sequential `pnpm vitest run --no-file-parallelism`; SKIPPED — no live credentials (double-gated) (WC Assertions S2–S5).
- [x] 2.10 `pnpm check` green (1170 passed | 6 skipped). Commit left to orchestrator (RDD native flow).

PR2 acceptance: byte-identity (`supervisor.ts`, `cycle.ts`, `evaluate.ts`, gate); `tick.ts`/`runWorker` thread tier only; zero `@io/*` in business-domain; `openai` confined to `packages/llm-client/src/deepseek-client.ts`; `packages/context` deps only `@io/business-domain`; no runtime deps/migration; both tiers share SAME prefix.
