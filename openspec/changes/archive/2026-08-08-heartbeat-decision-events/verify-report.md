```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:0405bd90aaf4d1d21a04da010f01e3870e1309eab8aaaa335a88a017f397f310
verdict: pass
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 21/21
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:cab49e8097ae491ba5fbdddc3d8e264c6b09160e26ef70c2d5c61df19556f9cc
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:8bbd398973a611f4960d66c14c5368d878ebf779e6b97822cc003975ba9728dc
```

## Verification Report

**Change**: heartbeat-decision-events  
**Version**: N/A  
**Mode**: Strict TDD (final re-verification after deterministic gate fix)  
**Candidate**: `152768d` / tree `b43e57be798b4b2b98cac7a34fb00c712047919e`

### Completeness

| Metric | Value |
|---|---:|
| Tasks total | 15 |
| Tasks complete | 15 |
| Tasks incomplete | 0 |
| Requirements compliant | 6/6 |
| Scenarios compliant | 21/21 |

All OpenSpec task checkboxes are complete. The implementation commits are `a673db5` and `8f165d5`, the concurrent PostgreSQL remediation is `f3f9197`, and the deterministic Vitest gate fix is `152768d`.

### Build & Tests Execution

**Required full gate**: ✅ Passed

```text
PATH=/data/node24/bin:$PATH pnpm check
Exit: 0
Format: 196 files checked, no fixes
Typecheck: passed
Build: passed
Lint: 196 files checked, no errors
Tests: 89 files passed, 3 files skipped; 1140 tests passed, 6 skipped, 0 failed
Output hash: sha256:8bbd398973a611f4960d66c14c5368d878ebf779e6b97822cc003975ba9728dc
```

`vitest.config.ts` sets `fileParallelism: false`; therefore the aggregate gate ran the shared live-PostgreSQL suites sequentially and did not reproduce the prior cross-file `TRUNCATE` race.

**Configured test command**: ✅ Passed

```text
PATH=/data/node24/bin:$PATH pnpm test
Exit: 0
Test files: 89 passed, 3 skipped (92 total)
Tests: 1140 passed, 6 skipped, 0 failed (1146 total)
Output hash: sha256:cab49e8097ae491ba5fbdddc3d8e264c6b09160e26ef70c2d5c61df19556f9cc
```

**Focused requirement suite**: ✅ Passed

```text
PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/business-domain/test/heartbeat-decision-event.test.ts packages/business-domain/test/fakes.test.ts packages/business-domain/test/business-event.test.ts packages/business-domain/test/heartbeat.test.ts packages/database/test/business-adapters.test.ts packages/database/test/business-event-roundtrip.integration.test.ts packages/app/test/supervisor/supervisor.test.ts packages/app/test/composition/supervisor-deps.integration.test.ts packages/app/test/daemon/byte-identity.test.ts packages/app/test/worker-finalize.test.ts packages/context/test/context-compiler.test.ts packages/context/test/compile-context.test.ts
Exit: 0
Test files: 12 passed
Tests: 228 passed, 0 skipped, 0 failed
Output hash: sha256:ac54ca9aa007d587c81e674dbe687b1356abb83d4ce44731256463abdcc2f2b0
```

**Live PostgreSQL proof**: ✅ Ran; no live-PG test was skipped

```text
PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism --reporter=verbose packages/database/test/business-event-roundtrip.integration.test.ts packages/app/test/composition/supervisor-deps.integration.test.ts
Exit: 0
Test files: 2 passed
Tests: 18 passed, 0 skipped, 0 failed
Concurrent appendIfAbsent race: passed against live PostgreSQL
Output hash: sha256:9f38ebef880b8dab01ee1e16e769999798b669d690c1f07d81c6d1bb9fbb6f6d
```

**Coverage**: ➖ Skipped — `openspec/config.yaml` declares `testing.coverage: false`; no coverage command or threshold applies.

### Spec Compliance Matrix

| Requirement | Scenario | Passing test evidence | Result |
|---|---|---|---|
| Sequential Checkpointed Tick | No-LLM decision advances the cursor | `packages/app/test/supervisor/supervisor.test.ts` — `no-llm-heartbeat appends ONE decision event before the checkpoint and MUST NOT run onActivate` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Activation is consumed and renewed by novelty | `packages/app/test/supervisor/supervisor.test.ts` — `activation is consumed once, then renewed by a NEW work.completed` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Callback failure leaves activation retryable | `packages/app/test/supervisor/supervisor.test.ts` — `a THROWING onActivate leaves the cursor un-persisted; the next tick re-invokes` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Both branches emit | `packages/app/test/supervisor/supervisor.test.ts` — `BOTH decision branches emit EXACTLY one heartbeat.decision with the branch payload` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Retry does not duplicate the decision | `packages/app/test/supervisor/supervisor.test.ts` — `a retried tick with the SAME unadvanced cursor keeps EXACTLY one decision event` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Append failure remains retryable | `packages/app/test/supervisor/supervisor.test.ts` — `an APPEND failure fails the tick BEFORE callback and checkpoint, then retries` | ✅ COMPLIANT |
| Sequential Checkpointed Tick | Companies are processed sequentially | `packages/app/test/supervisor/supervisor.test.ts` — `companies are processed SEQUENTIALLY — company-b never starts while company-a is mid-tick` | ✅ COMPLIANT |
| Non-Invasive Activation Seam | Recorded no-op is valid | `packages/app/test/supervisor/supervisor.test.ts` — `a recorded no-op onActivate is valid: the company arrives, no Work is started` | ✅ COMPLIANT |
| Non-Invasive Activation Seam | Existing paths remain unchanged | `packages/app/test/daemon/byte-identity.test.ts` — `every protected core source is byte-identical to its committed baseline`; independent Git comparison from `07eea12` to `HEAD` | ✅ COMPLIANT |
| Append-Only Repository Port | Port surface prevents mutation | `packages/business-domain/test/business-event.test.ts` — exact four-method port and fake surface tests | ✅ COMPLIANT |
| Append-Only Repository Port | Duplicate conditional append preserves the original | `packages/business-domain/test/fakes.test.ts`, `packages/database/test/business-adapters.test.ts`, and the live-PG round-trip suite | ✅ COMPLIANT |
| Append-Only Repository Port | PostgreSQL conditional append is single-issuance | `packages/database/test/business-event-roundtrip.integration.test.ts` — concurrent `Promise.all` calls converge on one stored row | ✅ COMPLIANT |
| Model-Independent Event Facts | Model output cannot change a worker event | `packages/app/test/worker-finalize.test.ts` — equal terminal-close facts with different LLM output produce identical events | ✅ COMPLIANT |
| Model-Independent Event Facts | Supervisor fact contains only gate inputs and outcome | `packages/business-domain/test/heartbeat-decision-event.test.ts` — exact shape, branch payload, and clock-independent identity | ✅ COMPLIANT |
| Idempotent Single Emission | Completed replay does not append | `packages/app/test/worker-finalize.test.ts` — completed replay asserts zero new event appends | ✅ COMPLIANT |
| Idempotent Single Emission | Duplicate throwing append is rejected | `packages/business-domain/test/business-event.test.ts` and live-PG duplicate append test reject the duplicate and preserve the original | ✅ COMPLIANT |
| Idempotent Single Emission | Decision identity is deterministic | `packages/business-domain/test/heartbeat-decision-event.test.ts` — equal identity inputs across clocks retain the same `evt:hb:{digest}` | ✅ COMPLIANT |
| Idempotent Single Emission | Retry conditionally appends once | `packages/app/test/supervisor/supervisor.test.ts` — failed-tick retry retains one original decision event | ✅ COMPLIANT |
| Declared Material Event Types | Declared event is material | `packages/business-domain/test/heartbeat.test.ts` — `work.completed` evaluates material | ✅ COMPLIANT |
| Declared Material Event Types | Undeclared event is not material | `packages/business-domain/test/heartbeat.test.ts` — undeclared event variants evaluate non-material | ✅ COMPLIANT |
| Declared Material Event Types | Decision events neither renew novelty nor context | `packages/business-domain/test/heartbeat.test.ts`, `packages/context/test/context-compiler.test.ts`, and `packages/context/test/compile-context.test.ts` — decision-only tails produce no novelty and segment 12 remains absent with unchanged compiled bytes | ✅ COMPLIANT |

**Compliance summary**: 21/21 scenarios compliant at runtime.

### Requirement-by-Requirement Breakdown

| Requirement | Scenarios | Status | Implementation and runtime evidence |
|---|---:|---|---|
| Sequential Checkpointed Tick | 7/7 | ✅ COMPLIANT | `tickCompany` reads the cursor, evaluates, derives the pre-append tail, awaits `appendIfAbsent`, then invokes the callback and checkpoints. Failures propagate and company iteration remains sequential. |
| Non-Invasive Activation Seam | 2/2 | ✅ COMPLIANT | Emission is confined to `supervisor/tick.ts`; the recorded no-op and byte-identity tests passed. `tick.ts` is the approved exception. |
| Append-Only Repository Port | 3/3 | ✅ COMPLIANT | Port, fake, and PG adapter expose two append semantics plus read-only listings. Duplicate preservation and the concurrent live-PG race passed. |
| Model-Independent Event Facts | 2/2 | ✅ COMPLIANT | The factory uses only company, cursor, decision, and an injectable timestamp; worker model-independence and package-boundary tests passed. |
| Idempotent Single Emission | 4/4 | ✅ COMPLIANT | SHA-256-derived `evt:hb:` identity, conditional retry behavior, worker replay, and throwing duplicate semantics passed. |
| Declared Material Event Types | 3/3 | ✅ COMPLIANT | The material set remains exactly `['work.completed']`; decision events remain non-material and cannot enter context segment 12. |

### Correctness (Static Evidence)

| Invariant | Status | Evidence |
|---|---|---|
| Protected cores byte-identical | ✅ | `git diff --exit-code 07eea12..HEAD` returned 0 for `supervisor.ts`, `types.ts`, `cycle.ts`, `evaluate.ts`, `worker.ts`, and `dispatch/{dispatch,keys,types}.ts`; the runtime byte-pin test passed. |
| `tick.ts` deliberate exception | ✅ | `tick.ts` is the only protected-core source changed; SHA-256 `674c9eb4415e690b6a0cc0b6e553bc6d59322ab93f201beb1ccc7951ea8ce43c` matches the updated approval pin. |
| No new runtime dependencies | ✅ | Root lockfile and all package manifests are byte-identical to `07eea12`; `node:crypto` is built in. |
| No migration | ✅ | `packages/database/sql` is byte-identical to `07eea12`; the existing unique event-id index is reused. |
| `heartbeat.decision` excluded from materiality | ✅ | `MATERIAL_EVENT_TYPES` remains exactly `['work.completed']`; novelty and context tests passed. |
| Business-domain package boundary | ✅ | Source scan and runtime boundary tests found zero `@io/*` imports; the package manifest declares no dependencies. |
| OpenAI confinement | ✅ | Source inspection finds the production `openai` import only in `packages/llm-client/src/deepseek-client.ts`. |
| Context dependency boundary | ✅ | `packages/context/package.json` runtime dependencies contain only `@io/business-domain`. |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Pure factory in `heartbeat-decision-event.ts` | ✅ Yes | Uses `node:crypto`, the empty-string absent-cursor sentinel, and an injected clock only for `occurredAt`. |
| `appendIfAbsent` returns the stored original on conflict | ✅ Yes | Fake and PG adapter both preserve and return the original. |
| PG `ON CONFLICT` plus rowCount/SELECT | ✅ Yes | Implementation matches the design and passed sequential and concurrent live-PG tests. |
| Pre-append tail and supervisor-owned emission | ✅ Yes | `tickCompany` derives the tail before append and emits before callback/checkpoint. |
| No migration or package dependency | ✅ Yes | Independent Git comparisons confirm both invariants. |
| Sequential aggregate test gate | ✅ Yes | `fileParallelism: false` aligns the root gate with the documented shared-live-PG execution mode. |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | Apply-progress contains PR 1, PR 2, and remediation TDD Cycle Evidence tables. |
| All tasks have tests or gate evidence | ✅ | 15/15 tasks plus remediation R.1 are bound to test, compile, byte-pin, or aggregate-gate evidence. |
| RED confirmed | ✅ | All nine changed/created test files exist; behavior-driving, integration, and approval-pin tests are non-vacuous. |
| GREEN confirmed | ✅ | Full gate, configured test command, focused requirement suite, and live-PG suite all passed. |
| Triangulation adequate | ✅ | Both branches, cursor variants, duplicate/original semantics, failures/retries, multiple companies, and sequential/concurrent persistence cases are exercised. |
| Safety net for modified files | ✅ | Apply-progress records pre-change baselines; new files correctly report N/A, and remediation records a 13/13 baseline. |

**TDD Compliance**: 6/6 checks passed.

### Test Layer Distribution

Changed or created test files in the implementation commits:

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Unit | 180 | 7 | Vitest |
| Integration | 18 | 2 | Vitest + live PostgreSQL |
| E2E | 0 | 0 | Not configured |
| **Total** | **198** | **9** | |

The focused requirement run also includes unchanged inherited worker/context tests and totals 228 passing tests across 12 files.

### Changed File Coverage

Coverage analysis skipped — `testing.coverage: false` and no project coverage command is configured.

### Assertion Quality

**Assertion quality**: ✅ All assertions introduced or modified by this change exercise production behavior or guarded structural invariants. The live race test issues two real concurrent calls, uses race-winner-independent convergence assertions, and proves one stored row. No tautologies, unguarded ghost loops, assertion-free tests, smoke-only tests, or mock-heavy changed tests were found.

### Quality Metrics

**Formatter**: ✅ 196 files checked, no fixes required  
**Linter**: ✅ 196 files checked, no errors  
**Type Checker**: ✅ `tsc -p tsconfig.json` passed  
**Build**: ✅ `tsc -p tsconfig.build.json` passed  
**Required aggregate gate**: ✅ `pnpm check` exited 0

### Issues Found

**CRITICAL**: None.

**WARNING**

1. The launch metadata named Engram observation `#6009` for this change, but `#6009` resolves to the unrelated `daemon-lifecycle` spec. The correct active heartbeat spec topic is `sdd/heartbeat-decision-events/spec`, observation `#6022`, and it matches the three OpenSpec delta files used for this verification. This metadata mismatch did not affect compliance results.

**SUGGESTION**

1. Update the leading `PgBusinessEventRepository` class comment, which still describes the adapter surface as exactly `append + listByCompany` despite the implemented `appendIfAbsent + listCompanyIds` methods.

### Evidence Revision

`evidence_revision` hashes the preserved canonical evidence preimage containing candidate HEAD/tree identity, hashes for proposal/spec/design/tasks/apply-progress and `vitest.config.ts`, exact command/output hashes, requirement/scenario totals, and independent invariant results.

### Verdict

**PASS WITH WARNINGS**

All 6 requirements and 21 scenarios are compliant. The deterministic full gate, configured test command, focused requirement suite, and live PostgreSQL proof all pass; there are no blockers or critical findings. The observation-ID metadata warning is non-blocking.
