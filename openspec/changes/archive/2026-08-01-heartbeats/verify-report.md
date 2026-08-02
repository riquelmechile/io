```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:936159e5aa34bee66266e5b00c0d4197e457b65226ecd2ad1be107ec703ce207
verdict: pass
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 14/14
test_command: PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism
test_exit_code: 0
test_output_hash: sha256:ccf505b09bcada2b8ab60d42a575ab70e0fd3dc56dbe7854336824f0d41cb26a
build_command: PATH=/data/node24/bin:$PATH pnpm run format-check && pnpm run typecheck && pnpm run build && pnpm run lint
build_exit_code: 0
build_output_hash: sha256:74e3ae87541aeadfc4d5341b971e77c680f8481f8f575a3ac10a3a50227e9aa1
```

## Verification Report

**Change**: heartbeats
**Version**: N/A
**Mode**: Strict TDD
**Artifact mode**: Hybrid (OpenSpec + Engram)
**Verified revision**: `fb24258`
**Baseline**: `2f25358`

### Completeness

| Metric | Value |
|--------|-------|
| Requirements | 8/8 implemented |
| Scenarios | 14/14 covered by passing runtime tests |
| Tasks total | 10 |
| Tasks complete | 10 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Authoritative sequential full suite**: ✅ Passed

```text
PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism
Exit: 0
Test Files: 74 passed, 3 skipped (77 total)
Tests: 968 passed, 6 skipped (974 total)
Duration: 17.68s
Output SHA-256: ccf505b09bcada2b8ab60d42a575ab70e0fd3dc56dbe7854336824f0d41cb26a
```

No retry was required; the first authoritative sequential run passed.

**Live PostgreSQL heartbeat integration**: ✅ Passed and not skipped

```text
PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/heartbeat/heartbeat.integration.test.ts
Exit: 0
Test Files: 1 passed (1)
Tests: 1 passed (1)
Duration: 560ms
Output SHA-256: 1c849b7c454b27f29b80207e4fba890c5827bea379971d7f5f324c7fe08b313d
```

The live-PG test exercised both required outcomes: a completed worker cycle produced `{ kind: 'activate', model: 'flash' }`, while a fresh company produced `{ kind: 'no-llm-heartbeat' }`. It also confirmed that evaluation left the live event count and stored work unchanged.

**Quality stages**: ✅ Passed

```text
PATH=/data/node24/bin:$PATH pnpm run format-check && pnpm run typecheck && pnpm run build && pnpm run lint
Exit: 0
format-check: 165 files checked, no fixes
typecheck: passed
build: passed
lint: 165 files checked, no fixes
Output SHA-256: 74e3ae87541aeadfc4d5341b971e77c680f8481f8f575a3ac10a3a50227e9aa1
```

**Coverage**: ➖ Analysis skipped — no coverage provider is declared in the project toolchain.

### Requirement Compliance

| Requirement | Status | Independent implementation evidence |
|-------------|--------|-------------------------------------|
| R1 Pure Heartbeat Decision | ✅ COMPLIANT | `packages/business-domain/src/heartbeat.ts:1,9-18` defines the exact decision union and imports only local `BusinessEvent`; `packages/business-domain/package.json` has no dependency fields. A source-wide scan found zero `@io/*` imports in `packages/business-domain`. |
| R2 Declared Material Event Types | ✅ COMPLIANT | `packages/business-domain/src/heartbeat.ts:25-30` declares exactly `['work.completed']` and uses membership in that set for materiality. |
| R3 Deterministic Novelty Filter | ✅ COMPLIANT | `packages/business-domain/src/heartbeat.ts:45-69` depends only on `events` and `cursor`; the module contains no clock, randomness, generated-ID, or LLM access. |
| R4 Cursor-Defined Novelty | ✅ COMPLIANT | `packages/business-domain/src/heartbeat.ts:49-54` uses insertion index: absent cursor is `-1`, found cursor is its index, missing cursor is `events.length`; no time or lexical ID comparison is used. |
| R5 No-LLM Decision Guarantee | ✅ COMPLIANT | `evaluateHeartbeat(events, cursor)` at `packages/business-domain/src/heartbeat.ts:63-69` admits only the two specified inputs. The module's only import is `./types.js`; there is no model/LLM, work, delegation, or dynamic-context capability. |
| R6 Read-Only Evaluator Seam | ✅ COMPLIANT | `packages/app/src/heartbeat/evaluate.ts:20-29` performs one `listByCompany(companyId)` and directly returns the domain decision. It has no write path. `WorkerDeps.events` and `buildWorkerDeps` wire the repository at `packages/app/src/worker/types.ts:89-95` and `packages/app/src/composition/worker-deps.ts:45-56`. |
| R7 Tenant-Scoped Evaluation | ✅ COMPLIANT | `packages/app/src/heartbeat/evaluate.ts:25-29` rejects empty scope before the read and passes the validated company ID to `listByCompany`. Both in-memory and app tests prove cross-tenant isolation. |
| R8 Stable-Prefix Isolation | ✅ COMPLIANT | `CompileContextInput` at `packages/context/src/segments.ts:49-71` has no heartbeat input, and `compileContext` at `packages/context/src/index.ts:52-63` has no heartbeat path. `packages/context/package.json` has exactly one runtime dependency, `@io/business-domain`. `git diff 2f25358..fb24258 -- packages/context` and the equivalent diff for `packages/app/src/worker/worker.ts` were empty. |

**Requirement summary**: 8/8 compliant.

### Spec Compliance Matrix

| # | Requirement | Scenario | Passing covering test | Result |
|---|-------------|----------|-----------------------|--------|
| 1 | R1 | Decision type remains pure | `packages/business-domain/test/heartbeat.test.ts` — stable branches, exact union, zero `@io/*`, empty dependency manifest | ✅ COMPLIANT |
| 2 | R2 | Declared event is material | `heartbeat.test.ts` — `treats a declared eventType as material` | ✅ COMPLIANT |
| 3 | R2 | Undeclared event is not material | `heartbeat.test.ts` — `treats every undeclared eventType as non-material` | ✅ COMPLIANT |
| 4 | R3 | Equal inputs produce equal decisions | `heartbeat.test.ts` — `produces identical decisions for identical inputs across repeated calls` | ✅ COMPLIANT |
| 5 | R3 | Ambient nondeterminism is unavailable | `heartbeat.test.ts` — ambient clock/random variation plus source scan | ✅ COMPLIANT |
| 6 | R4 | Unseen material event activates Flash | `heartbeat.test.ts` — absent cursor/material event activation | ✅ COMPLIANT |
| 7 | R4 | Cursor has seen all material events | `heartbeat.test.ts` — cursor at last material and trailing non-material cases | ✅ COMPLIANT |
| 8 | R4 | Cursor is ahead of the stream | `heartbeat.test.ts` — missing/ahead cursor ID returns no-LLM | ✅ COMPLIANT |
| 9 | R5 | Surrounding world cannot poison the decision | `heartbeat.test.ts` — inverse-poison decision assertions, exact signature, and local-import-only boundary | ✅ COMPLIANT |
| 10 | R6 | Evaluator reads and decides | `packages/app/test/heartbeat/evaluate.test.ts` — unseen event, one scoped list, Flash decision; live-PG integration also passed | ✅ COMPLIANT |
| 11 | R6 | Evaluation performs zero writes | `evaluate.test.ts` — list-call and append baselines; live-PG test confirms unchanged event/work state | ✅ COMPLIANT |
| 12 | R7 | Cross-tenant events are isolated | Domain repository test and `evaluate.test.ts` company A/B evaluation | ✅ COMPLIANT |
| 13 | R7 | Empty company scope is rejected | `evaluate.test.ts` — rejection with empty `listCalls` | ✅ COMPLIANT |
| 14 | R8 | Context boundary remains unchanged | `packages/context/test/context-compiler.test.ts` — forbidden heartbeat content cannot enter the stable prefix; `packages/context/test/boundary.test.ts` — exact runtime dependency and import boundary | ✅ COMPLIANT |

**Compliance summary**: 14/14 scenarios compliant on the authoritative sequential run.

### Invariant Checks

| Invariant | Result | Evidence |
|-----------|--------|----------|
| `business-domain` has zero `@io/*` imports | ✅ | Source scan returned no matches; runtime boundary test passed. |
| `business-domain` has zero declared dependencies | ✅ | `packages/business-domain/package.json` has no dependency fields; test passed. |
| Heartbeat module has no `@io/llm-client` import | ✅ | Only import is `./types.js`. |
| Heartbeat module reads no clock/random source | ✅ | No `Date`, `Math.random`, `performance.now`, `crypto`, or identifier generator occurs in executable module code; source test passed. |
| Context runtime dependencies remain exactly `@io/business-domain` | ✅ | Manifest inspection and `packages/context/test/boundary.test.ts` passed. |
| `compileContext` admits no heartbeat input | ✅ | `CompileContextInput` and `compileContext` source inspection show no heartbeat field/path. |
| `runWorker` unchanged | ✅ | `git diff --exit-code 2f25358..fb24258 -- packages/app/src/worker/worker.ts` returned 0 with empty output. |
| `packages/context` unchanged | ✅ | `git diff --exit-code 2f25358..fb24258 -- packages/context/package.json packages/context/src` returned 0 with empty output. |

### Design Coherence

| Decision | Followed? | Notes |
|----------|-----------|-------|
| New pure domain module and index export | ✅ Yes | Implemented in `heartbeat.ts` and exported from `src/index.ts:42-48`. |
| Cursor is `{ lastEventId: string }` | ✅ Yes | Exact readonly type at `heartbeat.ts:18`. |
| Cursor comparison uses insertion index | ✅ Yes | `findIndex` plus numeric index comparison; lexicographic discriminator test passed. |
| Missing cursor ID is treated as ahead | ✅ Yes | Missing ID maps to `events.length`. |
| Free app evaluator plus top-level event port | ✅ Yes | `evaluateHeartbeatForCompany` and `WorkerDeps.events` match the design. |
| Pool-bound PG event repository wiring | ✅ Yes | `buildWorkerDeps` creates `PgBusinessEventRepository(connection)` at top level. |
| Material set remains declared/extensible | ✅ Yes | Constant tuple drives `isMaterialEvent`. |
| No worker-cycle/compiler change | ✅ Yes | Baseline diffs are empty for `runWorker` and `packages/context`. |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD evidence reported | ✅ | Apply-progress contains a 10-row RED/GREEN/TRIANGULATE/REFACTOR table. |
| All tasks have tests | ✅ | 10/10 task rows point to test files that exist. |
| RED evidence structurally consistent | ✅ | New test/module status matches `git diff --name-status`; historical RED outputs are recorded for every task row. |
| GREEN confirmed independently | ✅ | Every listed test file passed in the current sequential full suite; live-PG heartbeat integration passed separately and was not skipped. |
| Triangulation adequate | ✅ | Both decision branches, declared/undeclared materiality, multiple cursor positions, ambient variation, tenant isolation, and read/write behavior have varying expectations. |
| Safety nets consistent | ✅ | Applicable modified-file rows report pre-change safety nets; N/A rows correspond to newly added tests/modules. |

**TDD compliance**: 10/10 tasks have complete reported evidence and current green execution evidence. Historical RED states cannot be recreated without modifying the verified revision, so they were validated against recorded outputs and file history rather than re-run.

### Test Layer Distribution

| Layer | Change-related tests | Files | Tool |
|-------|----------------------|-------|------|
| Unit | 32 | 3 | Vitest |
| Integration | 1 | 1 | Vitest + live PostgreSQL |
| E2E | 0 | 0 | N/A |
| **Total** | **33** | **4** | |

The unit count includes 24 domain heartbeat tests, 7 app evaluator tests, and the modified composition-root wiring test. The integration count is the live-PG heartbeat test.

### Changed File Coverage

Coverage analysis skipped — no coverage provider is declared in the project toolchain.

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `packages/business-domain/test/heartbeat.test.ts` | 215 | `expect(world).toBeTruthy()` | The fixed fixture object is necessarily truthy and does not strengthen the inverse-poison proof. The scenario remains covered by the decision assertion, exact two-parameter signature, and import-boundary test. | WARNING |

**Assertion quality**: 0 CRITICAL, 1 WARNING.

### Quality Metrics

**Formatter**: ✅ No issues  
**Type checker**: ✅ No errors  
**Build**: ✅ Passed  
**Linter**: ✅ No errors or warnings

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. The repository has a documented pre-existing, non-deterministic parallel-PG race in `business-pg-roundtrip.integration.test.ts` around `idempotency_journal_attempt_id_key`. The candidate does not modify that test or the idempotency-journal/`completeWorkAtomically` path. The sanctioned sequential suite passed on its first run, so this warning does not affect the candidate verdict.
2. `apply-progress.md` and the Engram task/apply artifacts still state that PR2 is uncommitted, but the verified revision is committed at `fb24258`. This is stale process metadata only.
3. The inverse-poison test contains one redundant truthiness assertion on a fixed fixture object. Its behavioral and structural companion assertions still cover R5.

**SUGGESTION**:

1. Add a heartbeat-named compile-time boundary assertion for the exact `CompileContextInput` surface. Current R8 coverage is valid through the existing forbidden-leading and context package-boundary tests plus static source inspection, but a direct assertion would make the mapping more obvious to future reviewers.

### Verdict

**PASS WITH WARNINGS**

The implementation satisfies 8/8 requirements and all 14 scenarios have passing runtime coverage. The authoritative sequential suite, live-PG heartbeat integration, formatting, type checking, build, and lint all passed. No candidate-caused blocker or critical finding was found.
