```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:330c714accf000e0e1d439752f4b62cbd768b3b0f493b98fefda47b915033e22
verdict: pass
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 19/19
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:35f47801fa772a5f8adb94dfc5f0d8f00bffa7cd6a1a7679ea349823628c4879
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:2713f73cb4238da33ff78965acd7227d3a26854b69e787a6dbc4a479d3ba001f
```

## Verification Report

**Change**: pro-escalation
**Version**: N/A
**Mode**: Strict TDD
**Source revision**: `fa37417d314fe9f610ab34c8528f9fea0ac0b81c` (`HEAD == origin/main`)
**Re-verification disposition**: Updates the prior failed report. The prior 15 compliant scenarios remain in the matrix; the four previously untested live scenarios now have passing credentialed runtime evidence.

### Completeness

| Metric | Value |
|---|---:|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |
| Requirements fully compliant | 7/7 |
| Scenarios compliant | 19/19 |

### Task Completion Audit

| Task | Implementation and runtime evidence | Result |
|---|---|---|
| 1.1 | Escalation matrix remains in `packages/business-domain/test/heartbeat.test.ts`; the current full suite passed. | Complete |
| 1.2 | `ModelTier`, threshold, risk vocabulary/rank, shared cursor resolution, `escalationModelFor`, and model-bearing activation are implemented. | Complete |
| 1.3 | Exact-threshold and Date/Math inverse-poison tests are present and passed in the current full suite. | Complete |
| 1.4 | Public exports, zero-`@io/*` boundary, and zero dependency assertions passed. | Complete |
| 1.5 | Current full `pnpm check` exited 0. | Complete |
| 2.1 | `llmModelFor` maps both tiers and is the only production site containing both concrete model strings. | Complete |
| 2.2 | `IntentInput.model`, sole mapper use, and stable-prefix equality tests passed. | Complete |
| 2.3 | Required `runWorker(..., model)` forwarding, Pro request, terminal close, and replay tests passed. | Complete |
| 2.4 | Dispatch forwards Pro to one oldest Work; empty queue remains cost-free. | Complete |
| 2.5 | `OnActivate(companyId, model)`, tick forwarding, and composition forwarding are implemented and tested. | Complete |
| 2.6 | All call sites type-check with an explicit tier; `tsc` passed in the full gate. | Complete |
| 2.7 | Protected-source pins and normalization proofs passed in the current full suite; the protected Git diff exited 0. | Complete |
| 2.8 | Fake LLM request/response model echo passed for Flash and Pro. | Complete |
| 2.9 | Credentialed live DeepSeek/PostgreSQL suite passed 3/3 sequentially on the first run. | Complete |
| 2.10 | Current five-stage gate passed with 1169 tests passed and 6 skipped. | Complete |

### Build and Test Execution

**Build/full gate**: Passed

```text
PATH=/data/node24/bin:$PATH pnpm check
exit: 0
format: Checked 198 files; no fixes applied
typecheck: passed
build: passed
lint: Checked 198 files; no fixes applied
tests: 90 files passed, 3 files skipped; 1169 tests passed, 6 skipped
output hash: sha256:2713f73cb4238da33ff78965acd7227d3a26854b69e787a6dbc4a479d3ba001f
```

**Full tests**: Passed

```text
PATH=/data/node24/bin:$PATH pnpm test
exit: 0
90 files passed, 3 files skipped; 1169 tests passed, 6 skipped
output hash: sha256:35f47801fa772a5f8adb94dfc5f0d8f00bffa7cd6a1a7679ea349823628c4879
```

**Live DeepSeek/PostgreSQL suite**: Passed on the first run; no flake re-run was needed.

```text
set -a; . /data/io/.env; set +a
IO_LIVE_LLM=1 PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/deepseek-live.integration.test.ts
run 1 exit: 0
1 file passed; 3/3 tests passed; 0 skipped
duration: 7.05s
output hash: sha256:7c3e1a65369a56196841837e59e1d05b8a2b2bb130965bb47de594bebe4fdc29
re-runs: 0
```

The paid live suite did not exhibit the known transient `invalid-plan` flake. The bounded allowance of three total live runs was not consumed beyond the first run.

**Prior focused evidence retained for continuity**:

| Command | Prior exact result | Output hash |
|---|---|---|
| `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/heartbeat.test.ts packages/business-domain/test/heartbeat-decision-event.test.ts` | exit 0; 2 files passed; 53/53 tests passed | `sha256:323e2ecccc586dca2cb1808ea0adc7f0a8ef4163dae695dca5bac5a212b30a96` |
| `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/worker-model-tier.test.ts packages/app/test/worker-intent.test.ts packages/app/test/dispatch/dispatch.test.ts packages/app/test/supervisor/supervisor.test.ts packages/app/test/daemon/byte-identity.test.ts packages/app/test/worker-finalize.test.ts packages/app/test/worker-reconcile.test.ts` | exit 0; 7 files passed; 88/88 tests passed | `sha256:44946b6dcb28ce11ebc876bcc869e04fbe51b538e5d46bceff237a347fc9a979` |
| `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/app-boundary.test.ts packages/business-domain/test/heartbeat.test.ts packages/context/test/boundary.test.ts packages/app/test/daemon/byte-identity.test.ts` | exit 0; 4 files passed; 64/64 tests passed | `sha256:cc925653c08a024c713162922fbb6d31bf4bdf4bde03480d6be2930b8f72d030` |

The current `pnpm test` re-confirmed all in-process covering files in one runtime execution.

**Coverage**: Not available. Neither `@vitest/coverage-v8` nor `@vitest/coverage-istanbul` is installed as a direct workspace dependency, so changed-file coverage was not executed.

### Spec Compliance Matrix

| Requirement | Scenario | Passing test evidence | Result |
|---|---|---|---|
| Heartbeat — Deterministic Model-Tier Escalation | Threshold and above select Pro | `heartbeat.test.ts` — high and critical escalation cases; current full suite passed | COMPLIANT |
| Heartbeat — Deterministic Model-Tier Escalation | Below, absent, invalid, or seen risk defaults to Flash | `heartbeat.test.ts` — low, medium, absent, invalid, non-material, and cursor cases; current full suite passed | COMPLIANT |
| Heartbeat — Deterministic Model-Tier Escalation | Ambient nondeterminism cannot affect tier | `heartbeat.test.ts` — Date/Math spies and exact-threshold tests; current full suite passed | COMPLIANT |
| Heartbeat — Pure Heartbeat Decision | Decision type remains pure | `heartbeat.test.ts` — exact union, repeated values, and import/dependency boundary; current full suite passed | COMPLIANT |
| Worker Cycle — Structure-Not-Output Assertions | Serving model echoes the requested tier | `worker-model-tier.test.ts` — Fake LLM full-cycle echo for Flash and Pro; current full suite passed | COMPLIANT |
| Worker Cycle — Structure-Not-Output Assertions | Live default remains Flash | `deepseek-live.integration.test.ts` — live response model equals `deepseek-v4-flash`; credentialed run 3/3 passed | COMPLIANT |
| Worker Cycle — Structure-Not-Output Assertions | Cache structure is asserted | `deepseek-live.integration.test.ts` — live cache-hit/cache-miss fields and prompt accounting; credentialed run passed | COMPLIANT |
| Worker Cycle — Structure-Not-Output Assertions | Generated output remains unconstrained | `deepseek-live.integration.test.ts` — terminal/plan shape only, with no exact path/content/plan assertion; credentialed run passed | COMPLIANT |
| Worker Cycle — Structure-Not-Output Assertions | Live database verification is sequential | Live suite executed with `--no-file-parallelism`; `vitest.config.ts` also sets `fileParallelism: false`; 3/3 passed | COMPLIANT |
| Worker Cycle — Work-Bearing Cycle Preservation | Work-bearing cycle bypasses the gate | `worker-intent.test.ts` — Pro reaches the LLM through direct `runWorker`; current full suite passed | COMPLIANT |
| Worker Cycle — Work-Bearing Cycle Preservation | Selected tier reaches intent unchanged | `worker-intent.test.ts` and `worker-model-tier.test.ts` — Pro mapping and identical stable prefixes; current full suite passed | COMPLIANT |
| Worker Cycle — Work-Bearing Cycle Preservation | Full cycle retains terminal close | `worker-finalize.test.ts` — completed v3, one receipt, completed journal, and one event; current full suite passed | COMPLIANT |
| Worker Cycle — Work-Bearing Cycle Preservation | Replay remains idempotent | `worker-reconcile.test.ts` and `worker-finalize.test.ts` — recorded replay without another effect/receipt/event; current full suite passed | COMPLIANT |
| Work Dispatch — One Oldest-First Cycle per Activation | Activation dispatches one oldest Work with its model | `dispatch.test.ts` — one oldest Work and Pro request; current full suite passed | COMPLIANT |
| Work Dispatch — One Oldest-First Cycle per Activation | Empty actionable queue is cost-free | `dispatch.test.ts` — zero LLM, journal, and sandbox invocations; current full suite passed | COMPLIANT |
| Work Dispatch — Non-Invasive Heartbeat Wiring | Heartbeat decline performs no dispatch | `supervisor.test.ts` — decline callback remains empty and no activation occurs; current full suite passed | COMPLIANT |
| Work Dispatch — Non-Invasive Heartbeat Wiring | Existing boundaries preserve allowed byte changes | `byte-identity.test.ts`, `app-boundary.test.ts`, `heartbeat.test.ts`, and `context/boundary.test.ts`; current full suite and protected Git diff passed | COMPLIANT |
| Supervisor Timer — Non-Invasive Activation Seam | Recorded no-op receives the selected model | `supervisor.test.ts` — high-risk activation records `{companyId:'acme', model:'pro'}` and starts no Work; current full suite passed | COMPLIANT |
| Supervisor Timer — Non-Invasive Activation Seam | Existing paths preserve composed boundaries | `byte-identity.test.ts` — protected hashes and runWorker/tick normalization proofs; current full suite passed | COMPLIANT |

**Compliance summary**: 19/19 scenarios compliant. The four scenarios that were `UNTESTED` in the prior report are now `COMPLIANT` through a passing credentialed live execution.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| Deterministic Model-Tier Escalation | Implemented | Pure rank-based rule over novel material events; invalid/absent risk defaults to Flash. |
| Pure Heartbeat Decision | Implemented | Exact `flash | pro` union; decision-event factory emits `decision.model`. |
| Structure-Not-Output Assertions | Implemented and verified | Live default model, cache structure, structure-only output assertions, and sequential execution passed at runtime. |
| Work-Bearing Cycle Preservation | Implemented | Required tier parameter reaches intent; mapper is at the app/LLM boundary; prefix remains unchanged. |
| One Oldest-First Cycle per Activation | Implemented | Dispatch forwards one selected tier and empty queue exits before worker invocation. |
| Non-Invasive Heartbeat Wiring | Implemented | Decline does not dispatch; protected boundaries and dependency constraints hold. |
| Non-Invasive Activation Seam | Implemented | Exact tier passes through tick, composition, dispatch, and worker. |

### Cross-Cutting Invariants

| Invariant | Evidence | Result |
|---|---|---|
| `business-domain` has zero `@io/*` imports | Source scan found no matching import; `packages/business-domain/package.json` has no dependencies; boundary tests passed. | PASS |
| `openai` is confined to `packages/llm-client/src/deepseek-client.ts` | Production source scan found only the owner import; app boundary test passed. | PASS |
| `packages/context` runtime dependencies are exactly `@io/business-domain` | Manifest contains exactly `{"@io/business-domain":"workspace:*"}`; context boundary tests passed. | PASS |
| No new runtime dependency | No package manifest changed across `44cfbf4^..fa37417`; pinned app dependency test passed. | PASS |
| No migration | No migration path changed across `44cfbf4^..fa37417`. | PASS |
| Protected cores remain byte-identical | Protected-path Git diff exited 0; hash-pin and normalization tests passed. | PASS |
| Both tiers share the same stable context prefix | `worker-intent.test.ts` Flash/Pro message and cohort equality assertions passed; only the request model differs. | PASS |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Separate pure `escalationModelFor` | Yes | Called by `evaluateHeartbeat`. |
| Local risk vocabulary and rank | Yes | No trust-kernel/domain coupling introduced. |
| Threshold fixed at `high` | Yes | Constant and boundary tests agree. |
| Mapper in `worker/model-tier.ts` | Yes | It is the sole tier-to-LLM-model mapping site. |
| Required third `runWorker` argument | Yes | Type-check and all call sites pass an explicit tier. |
| Two stacked implementation slices | Yes | Commits `44cfbf4` and `fa37417` are present on `origin/main`. |
| Same compiled prefix for both tiers | Yes | Runtime equality assertions passed. |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | PASS | `apply-progress.md` contains RED/GREEN evidence and a Phase-2 TDD cycle table. |
| All tasks have tests or explicit gate evidence | PASS | 15/15 tasks. |
| RED evidence files exist | PASS | All named test files exist; the new mapper test file is genuinely new. |
| GREEN confirmed | PASS | Current full suite passed 1169 tests; the credentialed live layer passed 3/3. |
| Triangulation adequate | PASS | Both tier values and all requirement branches have distinct covering cases. |
| Safety nets documented | PASS | Existing counts are recorded for modified suites; new files are marked N/A. |

**TDD compliance**: 6/6 process checks passed.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Unit/source-boundary | 26 newly added | 7 | Vitest |
| In-process integration | 3 newly added | 2 | Vitest with fakes |
| Live E2E | 3 passed | 1 | Vitest, DeepSeek, PostgreSQL |

The two implementation commits add 29 tests. The three live tests are existing covering tests modified only to pass the explicit Flash tier; all three executed and passed in this re-verification.

### Changed File Coverage

Coverage analysis skipped because no Vitest coverage provider is installed as a direct dependency.

### Assertion Quality

No critical or warning-level assertion defects were found. Empty-state assertions have non-empty behavioral companions, type-presence assertions are followed by value assertions, and byte-identity loops use fixed non-empty arrays with an explicit length guard. One low-value companion assertion remains at `packages/business-domain/test/heartbeat.test.ts:379`: `expect(world).toBeTruthy()` is tautological for the two literal objects; the same test still executes production code and determinism is independently covered by Date/Math spies.

### Quality Metrics

**Linter**: PASS — Biome checked 198 files with no fixes.
**Type checker**: PASS — `tsc -p tsconfig.json` exited 0.
**Build**: PASS — `tsc -p tsconfig.build.json` exited 0.

### Canonical Verification Evidence

The `evidence_revision` is the SHA-256 digest of the exact UTF-8 bytes inside the following block, from `schema:` through the final newline:

```text
schema: gentle-ai.verification-evidence/v1
change: pro-escalation
source_revision: fa37417d314fe9f610ab34c8528f9fea0ac0b81c
task_completion: 15/15
requirements: 7/7
scenarios: 19/19
scenario_statuses:
  heartbeat/deterministic-model-tier-escalation/threshold-and-above-select-pro: COMPLIANT
  heartbeat/deterministic-model-tier-escalation/defaults-to-flash: COMPLIANT
  heartbeat/deterministic-model-tier-escalation/ambient-nondeterminism: COMPLIANT
  heartbeat/pure-heartbeat-decision/decision-type-remains-pure: COMPLIANT
  worker-cycle/structure-not-output/serving-model-echo: COMPLIANT
  worker-cycle/structure-not-output/live-default-flash: COMPLIANT
  worker-cycle/structure-not-output/cache-structure: COMPLIANT
  worker-cycle/structure-not-output/generated-output-unconstrained: COMPLIANT
  worker-cycle/structure-not-output/live-database-sequential: COMPLIANT
  worker-cycle/work-bearing-preservation/bypasses-gate: COMPLIANT
  worker-cycle/work-bearing-preservation/tier-reaches-intent: COMPLIANT
  worker-cycle/work-bearing-preservation/terminal-close: COMPLIANT
  worker-cycle/work-bearing-preservation/replay-idempotent: COMPLIANT
  work-dispatch/one-oldest-first/oldest-with-model: COMPLIANT
  work-dispatch/one-oldest-first/empty-cost-free: COMPLIANT
  work-dispatch/non-invasive-wiring/decline-no-dispatch: COMPLIANT
  work-dispatch/non-invasive-wiring/byte-boundaries: COMPLIANT
  supervisor-timer/non-invasive-seam/recorded-no-op-model: COMPLIANT
  supervisor-timer/non-invasive-seam/composed-boundaries: COMPLIANT
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:35f47801fa772a5f8adb94dfc5f0d8f00bffa7cd6a1a7679ea349823628c4879
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:2713f73cb4238da33ff78965acd7227d3a26854b69e787a6dbc4a479d3ba001f
live_e2e_command: set -a; . /data/io/.env; set +a; IO_LIVE_LLM=1 PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/deepseek-live.integration.test.ts
live_e2e_runs: 1
live_e2e_exit_codes: [0]
live_e2e_result: tests=3/3 skipped=0
live_e2e_output_hashes: [sha256:7c3e1a65369a56196841837e59e1d05b8a2b2bb130965bb47de594bebe4fdc29]
live_e2e_disposition: passed-first-run-no-flake
protected_diff_exit_code: 0
cross_cutting_invariants: PASS
```

### Issues Found

**CRITICAL**

None.

**WARNING**

1. Several source comments remain stale after the correct model threading: `packages/app/src/composition/supervisor-dispatch.ts:21-25`, `packages/app/src/supervisor/tick.ts:18`, and the dispatch header still describes an unchanged worker. This does not change runtime behavior but conflicts with the implemented seam.
2. `apply-progress.md` remains historically inconsistent with current evidence: it reports 1170 passed and 6 skipped while current authoritative runs report 1169 passed and 6 skipped; it also reports 12 new PR2 tests while the implementation diff adds 13. Current runtime and diff-derived counts control this report.

**SUGGESTION**

1. Replace the low-value `expect(world).toBeTruthy()` companion assertion with a meaningful ambient-input isolation assertion or remove it; stronger determinism tests already cover the behavior.

### Verdict

**PASS WITH WARNINGS**

All 15 tasks are complete, all 7 requirements and 19 scenarios have passing runtime evidence, the credentialed live suite passed on its first run, the full test and build gates passed, and all cross-cutting invariants hold. The remaining findings are documentation/evidence-quality warnings and do not block archive readiness.
