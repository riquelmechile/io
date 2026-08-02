```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:032dd5dea57cbd9611d4e1b9262689b794ceab399e47755cdb9214944f562ce6
verdict: fail
blockers: 1
critical_findings: 1
requirements: 6/7
scenarios: 12/13
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:8c58c2130f4c342f726e9dcc2f9df57bc1f472af44d53aa32bbb1409ca246079
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:6f42e366ec18c562d8d8bf06570db612d6044a692c052357a26f8c45518658f1
```

## Verification Report

**Change**: work-dispatch  
**Version**: N/A  
**Mode**: Strict TDD  
**Artifact mode**: Hybrid (OpenSpec + Engram)  
**Verified revision**: `65f1a046ec78fd6ee96b8364083da0ffe1776af9`  
**Pre-change baseline**: `9501b7ee826fdbef03b95a3a6a869bb5619c11ee`

### Completeness

| Metric | Value |
|---|---:|
| Requirements | 6/7 compliant |
| Scenarios | 12/13 compliant |
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |
| Blockers | 1 |
| Critical findings | 1 |
| Warnings | 0 |
| Suggestions | 0 |

All tasks are marked complete, so full verification was executed. The implementation is not archive-ready because the collision-free portion of Deterministic Dispatch Identity is false for valid identifier strings.

### Build and Test Execution

| Check | Command | Exit | Exact result | Output hash |
|---|---|---:|---|---|
| Test runner | `PATH=/data/node24/bin:$PATH pnpm test` | 0 | 82 files passed, 3 skipped (85); 1067 tests passed, 6 skipped (1073) | `sha256:8c58c2130f4c342f726e9dcc2f9df57bc1f472af44d53aa32bbb1409ca246079` |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` | 0 | format, typecheck, build, lint, and test passed; 82 files passed, 3 skipped; 1067 tests passed, 6 skipped | `sha256:6f42e366ec18c562d8d8bf06570db612d6044a692c052357a26f8c45518658f1` |
| Live-PG sequential | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism` | 0 | 82 files passed, 3 skipped; 1067 tests passed, 6 skipped | `sha256:fa8f92751f3b20fb040f9241b6ef71462bad7d88581077908792223c12eee446` |
| Relevant live-PG suites | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts packages/app/test/dispatch/dispatch.integration.test.ts` | 0 | 2 files passed; 44 tests passed | Not used in the strict envelope |
| Collision probe | Node 24 import of `dispatchIdempotencyKeyFor`; compare `('a:b','c')` with `('a','b:c')` | 1 | Both returned `wk:a:b:c`; collision reproduced | Not used in the strict envelope |

PostgreSQL was reachable. The relevant real-PG suites executed rather than skipping and passed 44/44 tests. Coverage analysis was skipped because `openspec/config.yaml` explicitly sets `testing.coverage: false` and `coverage_threshold: 0`.

### Requirement and Scenario Compliance

| Requirement | Scenario | Implementation evidence | Runtime test evidence | Result |
|---|---|---|---|---|
| R1 Deterministic Dispatch Identity | Key is deterministic and company-scoped | `packages/app/src/dispatch/keys.ts:18-20` | `packages/app/test/dispatch/keys.test.ts:32-60`; independent delimiter probe | ❌ FAILING — exact format is deterministic and scoped for ordinary fixtures, but it is not collision-free for unrestricted non-empty string IDs |
| R1 Deterministic Dispatch Identity | Hash survives lifecycle transitions | `packages/app/src/dispatch/keys.ts:22-32` | `packages/app/test/dispatch/keys.test.ts:62-112` | ✅ COMPLIANT |
| R2 One Oldest-First Cycle per Activation | Activation dispatches one oldest Work | `packages/app/src/dispatch/dispatch.ts:31-49` | `packages/app/test/dispatch/dispatch.test.ts:68-104`; live PG `dispatch.integration.test.ts:65-116` | ✅ COMPLIANT |
| R2 One Oldest-First Cycle per Activation | Empty actionable queue is cost-free | `packages/app/src/dispatch/dispatch.ts:31-35` | `packages/app/test/dispatch/dispatch.test.ts:44-54`; live PG `dispatch.integration.test.ts:144-163` | ✅ COMPLIANT |
| R3 Non-Invasive Heartbeat Wiring | Heartbeat decline performs no dispatch | `packages/app/src/composition/supervisor-dispatch.ts:26-52` using unchanged `tickCompany` | `packages/app/test/composition/supervisor-dispatch.test.ts:86-123` | ✅ COMPLIANT |
| R3 Non-Invasive Heartbeat Wiring | Existing boundaries remain unchanged | New sibling composition/dispatch modules only | Full gate plus byte hashes, import scans, and manifest diff below | ✅ COMPLIANT |
| R4 Journal Replay Safety | Re-activation replays once | Derived key/hash reach unchanged `runWorker`; replay is returned without sandbox effect or receipt | `packages/app/test/dispatch/dispatch.test.ts:159-196`; live-PG receipt count remains one | ✅ COMPLIANT |
| R5 Failure Settlement Controls Cursor Progress | Typed failure consumes activation | `dispatchCompanyActivation` returns every typed `WorkerResult` without branching or throwing; resolved `onActivate` checkpoints last | `dispatch.test.ts:107-144` plus `supervisor.test.ts:142-155` | ✅ COMPLIANT |
| R5 Failure Settlement Controls Cursor Progress | Thrown error remains retryable | No catch surrounds `runWorker`; `onActivate` is awaited before cursor upsert | `dispatch.test.ts:146-156` plus `supervisor.test.ts:157-181` | ✅ COMPLIANT |
| R6 Crash-Recovery Non-Guarantee | Orphaned in-progress Work is not auto-resumed | Actionable states contain only `accepted`; dispatch has no recovery call | `packages/app/test/dispatch/dispatch.test.ts:198-214` | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | Accepted Work is returned oldest first | In-memory Map iteration and PG `ORDER BY id ASC`, both tenant/state filtered | `fakes.test.ts:223-236`; `business-adapters.test.ts:327-336`; live PG `business-pg-roundtrip.integration.test.ts:326-335` | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | No actionable Work returns empty | Both adapters return an empty array | `fakes.test.ts:238-244`; `business-adapters.test.ts:338-344`; live PG `business-pg-roundtrip.integration.test.ts:337-342` | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | Empty tenant scope fails before access | Guards run before Map iteration or SQL query | `fakes.test.ts:246-266`; `business-adapters.test.ts:346-356`; live-PG parity test | ✅ COMPLIANT |

**Compliance summary**: 6/7 requirements and 12/13 scenarios are compliant.

### Correctness and Static Evidence

| Requirement | Status | Notes |
|---|---|---|
| Deterministic Dispatch Identity | ❌ Not fully implemented | SHA-256 canonicalization and transition stability are correct. Collision freedom is not: IDs are validated only as non-empty strings, so delimiter ambiguity is legal. |
| One Oldest-First Cycle per Activation | ✅ Implemented | Dispatch reads once, selects index 0, and calls unchanged `runWorker` once; empty selection returns before worker/LLM use. |
| Non-Invasive Heartbeat Wiring | ✅ Implemented | New `buildSupervisorDispatch` composes the existing `OnActivate` seam without modifying protected sources. |
| Journal Replay Safety | ✅ Implemented | Same key/hash replay returns the recorded result and tests assert no second sandbox execution or receipt. |
| Failure Settlement Controls Cursor Progress | ✅ Implemented | Every returned `WorkerResult`, including every typed failure reason, resolves; only a thrown exception escapes. Existing supervisor tests prove resolve-before-checkpoint and throw-before-checkpoint behavior. |
| Crash-Recovery Non-Guarantee | ✅ Implemented honestly | Dispatch neither calls `recoverInFlightWork` nor selects `in_progress`; `FileDocumentSandbox` has no `snapshotUndoLog`. No exactly-once or automatic-resume promise was found. |
| Tenant-Scoped Actionable Work Selection | ✅ Implemented | `ACTIONABLE_WORK_STATES` is `readonly ['accepted']`; fake and PG implementations are guarded, scoped, filtered, and ordered. |

### Byte-Identity Confirmation

The eight protected files are byte-identical to baseline `9501b7e`; baseline and current SHA-256 values matched for every file.

| Protected file | SHA-256 |
|---|---|
| `packages/app/src/supervisor/supervisor.ts` | `5e7fa7cd205ce02daed6e5efe1d4ec176e02e7075a7f856621ccdff52be123da` |
| `packages/app/src/supervisor/tick.ts` | `b8e81aab75232af7fe2cea2329582a113bc710d68fbbed782bc14139294c880d` |
| `packages/app/src/supervisor/types.ts` | `7d795f73e0db4ee26dd302b092b55a366b45cbad6b22101a089bee7c4092c935` |
| `packages/app/src/worker/worker.ts` | `f20a9403439d9f8b3aa926518febb34e7afc78a4a1a2a61f8786ee044ff49a28` |
| `packages/app/src/heartbeat/cycle.ts` | `9808756b51a37907bfc0b070fbf364c15f028e0ff3e0777abf94af1c90a50e75` |
| `packages/app/src/heartbeat/evaluate.ts` | `56984e32f758e1a17b02937b20658cb91452a016d33331f5b907d806540efbe0` |
| `packages/app/src/composition/supervisor-deps.ts` | `612b1b51a9ced6c6da52411caebaeb1816ea7e1cf1903786de9acee6b1515b3d` |
| `packages/app/src/composition/worker-deps.ts` | `2a8917ec8e591e53dc791e933ecdd6af3a30584725ae54fabc8aacce7ab79165` |

### Boundary Invariants

| Invariant | Result | Evidence |
|---|---|---|
| Business-domain has zero `@io/*` imports | ✅ | Import-specific source scan returned no matches; textual matches are comments only. |
| `openai` import is confined to `deepseek-client.ts` | ✅ | The only production import is `packages/llm-client/src/deepseek-client.ts:1`; other production occurrences are comments. |
| No new runtime dependencies | ✅ | `git diff --quiet 9501b7e -- package.json pnpm-lock.yaml packages/*/package.json` exited 0. |
| Cursor writes remain supervisor-only | ✅ | The only production `cursors.upsert` call is unchanged `packages/app/src/supervisor/tick.ts:38`. |
| Heartbeat evaluation remains read-only | ✅ | Protected heartbeat and supervisor files are byte-identical to baseline. |

### Design Coherence

| Decision | Followed? | Notes |
|---|---|---|
| A1 — extend `WorkRepository` with actionable read | ✅ Yes | Port, in-memory fake, PG adapter, migration 009, and parity tests are present. |
| B1 — deterministic `wk:` key plus SHA-256 | ❌ Partial | Exact key format and canonical hash are present, but the key is not collision-free over the currently valid identifier domain. |
| C1 — new sibling dispatch composition via `OnActivate` | ✅ Yes | `buildSupervisorDispatch` returns `{deps,onActivate}` and awaits dispatch before checkpointing. |
| Failure classification table | ✅ Yes | All typed `WorkerResult` values settle because dispatch returns them uniformly; thrown errors propagate because there is no catch. |
| Crash-recovery scope boundary | ✅ Yes | No dispatch recovery wiring or automatic-resume claim was added; the shipped file sandbox lacks the required undo-log snapshot seam. |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | Both PR tables are present in `apply-progress.md`. |
| All tasks accounted for | ✅ | 11 implementation tasks have RED/GREEN test evidence; 2 gate tasks have executed gate evidence. |
| RED test files exist | ✅ | Every reported test file exists. |
| GREEN confirmed | ✅ | Full runner, full gate, and relevant live-PG suites passed. |
| Triangulation adequate | ❌ | The R1 collision test uses only delimiter-free IDs and misses a legal delimiter-ambiguity collision. |
| Safety nets | ✅ | Modified files report passing pre-change safety nets; new files are correctly marked new. |

**TDD compliance**: 5/6 checks passed. The missing collision case is substantive because the production behavior violates the scenario.

### Test Layer Distribution

| Layer | Tests | Files | Result |
|---|---:|---:|---|
| Unit/component-with-fakes | 236 | 10 changed test files | ✅ 236/236 passed |
| Integration (live PostgreSQL) | 44 | 2 changed test files | ✅ 44/44 passed sequentially |
| E2E | 0 | 0 | Not configured (`testing.e2e: false`) |
| **Total related changed test files** | **280** | **12** | **✅ 280/280 passed** |

### Changed File Coverage

Coverage analysis skipped: the authoritative project configuration disables coverage (`testing.coverage: false`, threshold 0).

### Assertion Quality

No banned tautologies, ghost loops, smoke-only checks, or assertions that avoid production code were found. One semantic adequacy defect remains:

| File | Line | Assertion | Issue | Severity |
|---|---:|---|---|---|
| `packages/app/test/dispatch/keys.test.ts` | 50-59 | `expect(new Set(keys).size).toBe(4)` | The fixtures contain no `:` delimiters, so the test does not exercise ambiguity in the exact `wk:${companyId}:${workId}` encoding. | CRITICAL |

### Quality Metrics

**Formatter**: ✅ Biome passed  
**Type checker**: ✅ TypeScript strict check passed  
**Build**: ✅ TypeScript build passed  
**Linter**: ✅ Biome passed

### Issues Found

#### CRITICAL

1. **Dispatch idempotency keys collide for currently valid identifiers.** `dispatchIdempotencyKeyFor('a:b', 'c')` and `dispatchIdempotencyKeyFor('a', 'b:c')` both return `wk:a:b:c`. The domain and command guards accept arbitrary non-empty strings and do not forbid `:`. This violates R1's collision-free requirement and its first scenario. The green test suite does not contain the adversarial delimiter case.

#### WARNING

None.

#### SUGGESTION

None. The critical contract mismatch requires a design/spec decision: either constrain and validate the identifier grammar so `:` is impossible, or revise the key encoding requirement to be unambiguous.

### Verdict

**FAIL**

The full gate and live-PostgreSQL suites are green, 13/13 tasks are complete, and 12/13 scenarios comply. Independent runtime probing disproved the required collision-free identity property, leaving one blocker and one critical finding. Do not archive until the identifier/key contract is corrected and covered by a regression test.
