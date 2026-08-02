```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:e80901d992a72ffe80c626db12930bae766439a177d516b3d38a7a41b4afed65
verdict: pass
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 13/13
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:373bbcb1b1dc9143170531f2dd0d84581a82d4c94776867753ff28b346eb772f
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:338b8f738474551c454ee99f7a9d393ab85d0c18133017e4523719a8707067f6
```

## Verification Report

**Change**: work-dispatch  
**Version**: N/A  
**Mode**: Strict TDD re-verification  
**Artifact mode**: Hybrid (OpenSpec + Engram)  
**Verified revision**: `4be8d9b80421def17a3fe195908f81e37288548e`  
**Remediation base**: `65f1a046ec78fd6ee96b8364083da0ffe1776af9`  
**Pre-change baseline**: `9501b7ee826fdbef03b95a3a6a869bb5619c11ee`

### Executive Summary

The remediation closes the prior dispatch-key collision. `dispatchIdempotencyKeyFor` now rejects `:` in both identity components before preserving the mandated `wk:${companyId}:${workId}` format for valid inputs. The focused regression tests pass 13/13, both adversarial collision probes throw, all 13 specification scenarios pass at runtime, the full gate is green, and protected boundaries remain unchanged.

### Prior Critical Closure

| Finding | Previous state | Remediation evidence | Re-verification | Status |
|---|---|---|---|---|
| CRITICAL-1 — `('a:b','c')` and `('a','b:c')` both serialized to `wk:a:b:c` | OPEN / blocking | `packages/app/src/dispatch/keys.ts:18-29` rejects `:` in `companyId` and `workId`; `packages/app/test/dispatch/keys.test.ts:61-80` adds four RED→GREEN tests | Focused keys suite 13/13; direct Node probe observed both calls throw with component-specific errors | **CLOSED** |

### Completeness

| Metric | Value |
|---|---:|
| Requirements | 7/7 compliant |
| Scenarios | 13/13 compliant |
| Tasks total | 13 |
| Tasks complete | 13 |
| Tasks incomplete | 0 |
| Blockers | 0 |
| Critical findings | 0 |
| Warnings | 0 |
| Suggestions | 0 |

All tasks are complete. Full verification was executed against the committed remediation revision.

### Build and Test Execution

| Check | Command | Exit | Exact result | Output hash |
|---|---|---:|---|---|
| Focused remediation | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/dispatch/keys.test.ts` | 0 | 1 file passed; 13 tests passed | `sha256:638d1b04919d3cc46ac154cbcd874dfa8275bb8993259cb514b38808fda12c21` |
| Test runner | `PATH=/data/node24/bin:$PATH pnpm test` | 0 | 82 files passed, 3 skipped (85); 1071 tests passed, 6 skipped (1077) | `sha256:373bbcb1b1dc9143170531f2dd0d84581a82d4c94776867753ff28b346eb772f` |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` | 0 | format, typecheck, build, lint, and test passed; 82 files passed, 3 skipped; 1071 tests passed, 6 skipped | `sha256:338b8f738474551c454ee99f7a9d393ab85d0c18133017e4523719a8707067f6` |
| Authoritative sequential suite | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism` | 0 | 82 files passed, 3 skipped (85); 1071 tests passed, 6 skipped (1077) | `sha256:336498bedbda86446fb11c4dab57e8e1a2f4fc76d372dbba057b7d802bbab08c` |
| Related changed tests | Sequential Vitest over the 12 test files changed since `9501b7e` | 0 | 12 files passed; 284 tests passed | `sha256:d52efc3cd10ed3b43548370113af391da9f1ab26056ec4d9df38b8064691da4a` |
| Relevant live PostgreSQL | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts packages/app/test/dispatch/dispatch.integration.test.ts` | 0 | 2 files passed; 44 tests passed | `sha256:69916bcf88efc8d7159b39ae537322d646729a3bf0c9f4eee95e87fafadab38b` |
| Collision probe | Node 24 import of `dispatchIdempotencyKeyFor`; invoke `('a:b','c')` and `('a','b:c')` | 0 | Both calls threw; messages identified `companyId` and `workId` respectively | Not part of strict envelope |

PostgreSQL was reachable: both relevant live-PG files executed and passed 44/44 rather than skipping. Coverage analysis was skipped because `openspec/config.yaml` sets `testing.coverage: false` and `coverage_threshold: 0`.

### Requirement and Scenario Compliance

| Requirement | Scenario | Implementation evidence | Runtime test evidence | Result |
|---|---|---|---|---|
| R1 Deterministic Dispatch Identity | Key is deterministic and company-scoped | `keys.ts:18-29` rejects the delimiter in both components and preserves the exact format for valid inputs | `keys.test.ts:32-80`; focused 13/13; direct two-vector collision probe | ✅ COMPLIANT |
| R1 Deterministic Dispatch Identity | Hash survives lifecycle transitions | `keys.ts:32-43` hashes only canonical identity fields | `keys.test.ts:82-132`; focused 13/13 | ✅ COMPLIANT |
| R2 One Oldest-First Cycle per Activation | Activation dispatches one oldest Work | `dispatch.ts:31-49` selects index 0 and invokes unchanged `runWorker` once | `dispatch.test.ts:68-104`; live PG `dispatch.integration.test.ts:65-116` | ✅ COMPLIANT |
| R2 One Oldest-First Cycle per Activation | Empty actionable queue is cost-free | `dispatch.ts:31-35` returns before worker invocation | `dispatch.test.ts:44-54`; live PG `dispatch.integration.test.ts:144-163` | ✅ COMPLIANT |
| R3 Non-Invasive Heartbeat Wiring | Heartbeat decline performs no dispatch | New `buildSupervisorDispatch` uses the existing awaited `OnActivate` seam; protected tick logic is unchanged | `supervisor-dispatch.test.ts:86-123`; full and related suites passed | ✅ COMPLIANT |
| R3 Non-Invasive Heartbeat Wiring | Existing boundaries remain unchanged | New sibling composition/dispatch modules only | Full gate, byte identity, import scans, cursor-write scan, and manifest diff below | ✅ COMPLIANT |
| R4 Journal Replay Safety | Re-activation replays once | Derived key/hash reach unchanged journal-aware `runWorker` | `dispatch.test.ts:159-196`; live PG re-activation retains one receipt | ✅ COMPLIANT |
| R5 Failure Settlement Controls Cursor Progress | Typed failure consumes activation | Every returned typed worker result resolves as a settled dispatch result | `dispatch.test.ts:107-144`; existing supervisor checkpoint tests | ✅ COMPLIANT |
| R5 Failure Settlement Controls Cursor Progress | Thrown error remains retryable | No catch surrounds `runWorker`; awaited activation precedes unchanged cursor upsert | `dispatch.test.ts:146-156`; existing supervisor throw-before-checkpoint test | ✅ COMPLIANT |
| R6 Crash-Recovery Non-Guarantee | Orphaned in-progress Work is not auto-resumed | Actionable states remain only `accepted`; dispatch contains no recovery path | `dispatch.test.ts:198-214` | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | Accepted Work is returned oldest first | In-memory insertion order and PG `ORDER BY id ASC`, both tenant/state scoped | fake, adapter, and live-PG actionable-selection tests; related suite 284/284 | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | No actionable Work returns empty | Both repository implementations return an empty list | fake, adapter, and live-PG empty-result tests; related suite 284/284 | ✅ COMPLIANT |
| R7 Tenant-Scoped Actionable Work Selection | Empty tenant scope fails before access | Guards execute before Map iteration or SQL query | fake, adapter, and live-PG pre-access rejection tests; related suite 284/284 | ✅ COMPLIANT |

**Compliance summary**: 7/7 requirements and 13/13 scenarios are compliant with passing runtime coverage.

### Correctness and Static Evidence

| Requirement | Status | Notes |
|---|---|---|
| Deterministic Dispatch Identity | ✅ Implemented | The valid component domain excludes `:`, making the exact colon-delimited encoding unambiguous; canonical SHA-256 behavior remains transition-stable. |
| One Oldest-First Cycle per Activation | ✅ Implemented | One oldest accepted Work is selected; empty queues return before worker/LLM use. |
| Non-Invasive Heartbeat Wiring | ✅ Implemented | Dispatch is composed through the existing awaited activation seam with no protected-source changes. |
| Journal Replay Safety | ✅ Implemented | Matching key/hash replay avoids a second effect and receipt. |
| Failure Settlement Controls Cursor Progress | ✅ Implemented | Typed results settle; thrown errors propagate before checkpointing. |
| Crash-Recovery Non-Guarantee | ✅ Implemented honestly | `in_progress` Work remains excluded and no automatic recovery or exactly-once guarantee is claimed. |
| Tenant-Scoped Actionable Work Selection | ✅ Implemented | Fake and PG implementations are guard-first, scoped, filtered, and oldest-first. |

### Byte-Identity Confirmation

`git diff --exit-code 9501b7e HEAD -- <eight protected files>` exited 0. Current SHA-256 values match the previously verified baseline values:

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
| Business-domain has zero `@io/*` imports | ✅ | Import-specific scan of `packages/business-domain/src/**/*.ts` returned no matches. |
| `openai` production import is confined to `deepseek-client.ts` | ✅ | The only production import match is `packages/llm-client/src/deepseek-client.ts:1`; other matches are test fixtures. |
| No new runtime dependencies | ✅ | Manifest/lockfile diff from `9501b7e` exited 0. |
| Cursor writes remain supervisor-only | ✅ | The only production `cursors.upsert` call is unchanged `packages/app/src/supervisor/tick.ts:38`. |
| Heartbeat evaluation remains read-only | ✅ | Protected heartbeat and supervisor files are byte-identical to baseline. |

### Design Coherence

| Decision | Followed? | Notes |
|---|---|---|
| A1 — extend `WorkRepository` with actionable read | ✅ Yes | Port, in-memory fake, PG adapter, migration 009, parity, and live-PG tests are present. |
| B1 — exact deterministic `wk:` key plus SHA-256 | ✅ Yes | Delimiter validation now makes the exact required format collision-free for valid inputs. |
| C1 — sibling dispatch composition via `OnActivate` | ✅ Yes | The composition root awaits dispatch before unchanged cursor checkpointing. |
| Failure classification table | ✅ Yes | Typed results settle uniformly; thrown errors propagate. |
| Crash-recovery scope boundary | ✅ Yes | No recovery wiring or automatic-resume claim was introduced. |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | PR1, PR2, and remediation RED→GREEN evidence is present in `apply-progress.md`. |
| All tasks accounted for | ✅ | 13/13 tasks complete; 11 implementation tasks have test evidence and 2 gate tasks have command evidence. |
| RED tests exist | ✅ | Every reported test file exists; remediation added four tests before the guard. |
| GREEN confirmed | ✅ | Focused 13/13, related 284/284, runner 1071/1071, gate green, and sequential 1071/1071. |
| Triangulation adequate | ✅ | R1 now includes both delimiter positions, error specificity, and a valid-format anchor. |
| Safety nets | ✅ | The remediation records 9/9 pre-change safety-net tests; all unchanged earlier evidence remains consistent with the committed diff. |

**TDD compliance**: 6/6 checks passed.

### Test Layer Distribution

| Layer | Tests | Files | Result |
|---|---:|---:|---|
| Unit/component with fakes | 240 | 10 | ✅ 240/240 passed |
| Integration (live PostgreSQL) | 44 | 2 | ✅ 44/44 passed sequentially |
| E2E | 0 | 0 | Not configured (`testing.e2e: false`) |
| **Total related changed test files** | **284** | **12** | **✅ 284/284 passed** |

### Changed File Coverage

Coverage analysis skipped: the authoritative project configuration disables coverage (`testing.coverage: false`, threshold 0).

### Assertion Quality

The previous R1 semantic adequacy defect is closed: the generic four-pair uniqueness assertion is now complemented by direct delimiter-rejection tests for both components and by an exact valid-format anchor. The remediation assertions call production code and verify observable behavior; no tautologies, ghost loops, smoke-only checks, or assertions disconnected from production code were found.

**Assertion quality**: ✅ All assertions verify real behavior.

### Quality Metrics

**Formatter**: ✅ Biome passed  
**Type checker**: ✅ TypeScript strict check passed  
**Build**: ✅ TypeScript build passed  
**Linter**: ✅ Biome passed

### Canonical Verification Evidence

The exact evidence preimage hashed by `evidence_revision` is:

```text
verified_revision=4be8d9b80421def17a3fe195908f81e37288548e
baseline_revision=9501b7e826fdbef03b95a3a6a869bb5619c11ee
test_command=PATH=/data/node24/bin:$PATH pnpm test
test_exit_code=0
test_output_hash=sha256:373bbcb1b1dc9143170531f2dd0d84581a82d4c94776867753ff28b346eb772f
build_command=PATH=/data/node24/bin:$PATH pnpm check
build_exit_code=0
build_output_hash=sha256:338b8f738474551c454ee99f7a9d393ab85d0c18133017e4523719a8707067f6
sequential_command=PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism
sequential_exit_code=0
sequential_output_hash=sha256:336498bedbda86446fb11c4dab57e8e1a2f4fc76d372dbba057b7d802bbab08c
focused_keys_output_hash=sha256:638d1b04919d3cc46ac154cbcd874dfa8275bb8993259cb514b38808fda12c21
related_tests_output_hash=sha256:d52efc3cd10ed3b43548370113af391da9f1ab26056ec4d9df38b8064691da4a
live_pg_output_hash=sha256:69916bcf88efc8d7159b39ae537322d646729a3bf0c9f4eee95e87fafadab38b
requirements=7/7
scenarios=13/13
byte_identity_exit_code=0
runtime_manifest_diff_exit_code=0
```

### Issues Found

#### CRITICAL

None. Previous CRITICAL-1 is **CLOSED**.

#### WARNING

None.

#### SUGGESTION

None.

### Risks

The specified crash-recovery non-guarantee remains: a post-claim failure may leave excluded `in_progress` Work orphaned until the separately scoped recovery capability exists. This is intentional, tested, and not a verification blocker.

### Verdict

**PASS**

The remediation restores collision-free dispatch identity for valid inputs without regressing the other six requirements. All 7 requirements, 13 scenarios, 13 tasks, runtime gates, byte-identity checks, and boundary invariants pass. The change is archive-ready.
