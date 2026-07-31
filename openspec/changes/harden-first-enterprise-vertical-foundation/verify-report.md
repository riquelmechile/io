```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:7367d67aa5a3a1c5d0832355947405bdd8636b9595fe0399f4cb1a6a2207e0a7
verdict: fail
blockers: 4
critical_findings: 4
requirements: 18/21
scenarios: 42/46
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:e9c93ceeb80c1e963da848f708011b5968105e34884e454f0eefbd93daacf287
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:24c42b76aecef2c39c8a5639a3536efb936b03bdac9a8f8be50c0e71ffbc7af8
```

## Verification Report

**Change**: harden-first-enterprise-vertical-foundation
**Version**: N/A
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 37 |
| Tasks complete | 37 |
| Tasks incomplete | 0 |

### Authority Preflight
**Result**: ✅ Review authority present (not missing)

| Check | Result | Details |
|-------|--------|---------|
| `gentle-ai sdd-status` next | `verify` | apply all_done; tasks 37/37; archive blocked pending PASS verify |
| Lineage | `review-1a05131a48ca7df7` | compact-v2 `state=approved`, receipt present |
| Receipt terminal | `approved` | final_candidate_tree `e06055bce53f7cbbfcd66de5cd5a402d445f0167` == `HEAD^{tree}` |
| Working tree | clean | `main...origin/main`, 0 untracked |
| Store revision | `sha256:5ae3a00a948fac31bf3597bde34fa909e611e4f4182c1a24fae3c4db85ded1dd` | matches receipt-bound state |
| `review validate --gate final-verification` | ⚠️ inventory noise | CLI returns `authority_corrupted` at receipt-discovery across 42 lineages; per-lineage export + receipt+state are coherent and tree-matched. Substantive verification admitted by sdd-status `next=verify` + approved receipt matching HEAD |

### Build & Tests Execution
**Build**: ✅ Passed (exit 0)
```text
pnpm build
$ tsc -p tsconfig.build.json
(exit 0)
```

**Tests**: ✅ 459 passed / ❌ 0 failed / ⚠️ 22 skipped
```text
pnpm test
 Test Files  29 passed | 3 skipped (32)
      Tests  459 passed | 22 skipped (481)
 Duration  ~686ms
```

**pnpm check**: ✅ Passed (format + typecheck + build + lint + test) exit 0

**Coverage**: ➖ Not available (no coverage tool in project scripts)

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Activation Window Gate | Future-start grant rejected at step 12 | `pipeline.test.ts` > future-start window DENY step 12 | ✅ COMPLIANT |
| Activation Window Gate | Currently active grant allowed | `model.test.ts` > isWindowActive start<=now<expiry | ✅ COMPLIANT |
| Activation Window Gate | Future-start temp role inactive | `identity.test.ts` > excludes future-start temporary assignment | ✅ COMPLIANT |
| In-Memory Separation of Duties | Self-approval denied | `sod.test.ts` > denies proposer==approver at low + allowsLowCombination | ✅ COMPLIANT |
| In-Memory Separation of Duties | Self-approval denied at every tier | `sod.test.ts` > it.each ALL_TIERS proposer==approver | ✅ COMPLIANT |
| In-Memory Separation of Duties | Distinct proposer and approver allowed | `sod.test.ts` > four-way ALLOW + low combinable ALLOW | ✅ COMPLIANT |
| In-Memory Separation of Duties | Self-verification denied | `sod.test.ts` > denies verifier==executor at every tier | ✅ COMPLIANT |
| Mandatory Company Tenant Scope | Scoped read returns only matching rows | `fakes.test.ts` / `business-adapters.test.ts` cross-company get | ✅ COMPLIANT |
| Mandatory Company Tenant Scope | Unscoped read is impossible | `ports/repositories.ts` required companyId + port tests | ✅ COMPLIANT |
| Mandatory Company Tenant Scope | Cross-company access rejected | `fakes.test.ts` Work/Delegation/Receipt cross-company undefined | ✅ COMPLIANT |
| Delegation Company Scope | Delegation carries company scope | `types.test.ts` + `fakes.test.ts` scoped get | ✅ COMPLIANT |
| Delegation Activation Window | Future-start delegation not active | (none found) | ❌ UNTESTED |
| Delegation Activation Window | Currently active delegation | (none found) | ❌ UNTESTED |
| Delegation Authority Fields | Active delegation with all fields | `types.test.ts` > requires companyId plus all authority fields | ✅ COMPLIANT |
| Delegation Authority Fields | Missing required field rejected | no runtime test; `assertValidDelegationRow` omits budget/authorityScope | ❌ UNTESTED |
| Work Company Scope and Version | Work carries company scope and version | `types.test.ts` / `use-cases.test.ts` propose v0 | ✅ COMPLIANT |
| Work Optimistic Concurrency | Concurrent transition conflicts | `fakes.test.ts` + `business-adapters` + PG CAS match/stale | ✅ COMPLIANT |
| Work Optimistic Concurrency | Stale write rejected | `fakes.test.ts` / adapters VersionConflictError | ✅ COMPLIANT |
| Work Transition Use Cases | Propose creates work | `use-cases.test.ts` > proposeWork creates proposed v0 | ✅ COMPLIANT |
| Work Transition Use Cases | Illegal transition rejected by use case | `use-cases.test.ts` > verify from accepted rejected | ✅ COMPLIANT |
| Work Transition Use Cases | Self-approval rejected at transition time | `use-cases.test.ts` > evaluate DENY — no persist | ✅ COMPLIANT |
| Idempotency for Work Transitions | Same key same hash replays | `use-cases.test.ts` > idempotency replay | ✅ COMPLIANT |
| Idempotency for Work Transitions | Same key different hash denied | `use-cases.test.ts` > IdempotencyConflictError | ✅ COMPLIANT |
| Work Execution Fields | Valid proposed work | `types.test.ts` / `validation.test.ts` | ✅ COMPLIANT |
| Work Execution Fields | Missing delegation reference rejected | `types.test.ts` empty delegationId + command validation | ✅ COMPLIANT |
| Work Execution Fields | Missing company scope rejected | `validation.test.ts` rejects missing/empty companyId | ✅ COMPLIANT |
| Receipt Company Scope | Receipt carries company scope | `types.test.ts` + fakes scoped get | ✅ COMPLIANT |
| Receipt Links Authority/Work/Outcome | Complete receipt fields | `types.test.ts` > requires companyId, terminalEventId, prior fields | ✅ COMPLIANT |
| Receipt Links Authority/Work/Outcome | Missing required field rejected | `assertValidReceiptRow` exists; **no covering test** | ❌ UNTESTED |
| Single Issuance | First issuance succeeds | `fakes.test.ts` first save succeeds | ✅ COMPLIANT |
| Single Issuance | Duplicate terminal event rejected | `fakes.test.ts` + PG integration UNIQUE pair | ✅ COMPLIANT |
| Atomic Transaction Boundary | Commit persists all statements | `connection-fake.test.ts` + PG integration commit | ✅ COMPLIANT |
| Atomic Transaction Boundary | Rollback discards all statements | `connection-fake.test.ts` + PG integration rollback | ✅ COMPLIANT |
| Atomic Transaction Boundary | Nested transaction rejected | `connection-fake.test.ts` NestedTransactionError; PG guard present | ✅ COMPLIANT |
| Business Table Unique Constraints | Duplicate business key rejected | PG integration duplicate company_id rejected | ✅ COMPLIANT |
| Business Table Unique Constraints | Duplicate terminal-event receipt rejected | PG integration + fakes | ✅ COMPLIANT |
| DbConnection Port Interface | Asynchronous execute, query, and transaction | `connection-port.test.ts` | ✅ COMPLIANT |
| DbConnection Port Interface | No driver types or schema knowledge | `connection-port.test.ts` + boundary tests | ✅ COMPLIANT |
| Validate Command Input Shape | Valid command accepted | `validation.test.ts` | ✅ COMPLIANT |
| Validate Command Input Shape | Malformed command rejected | `validation.test.ts` | ✅ COMPLIANT |
| Validate Persisted Row Integrity | Well-formed row accepted | `validation.test.ts` assertValidWorkRow | ✅ COMPLIANT |
| Validate Persisted Row Integrity | Corrupt row rejected | `validation.test.ts` version string / illegal state | ✅ COMPLIANT |
| Validate Transition Legality | Legal transition accepted | `validation.test.ts` proposed→accepted | ✅ COMPLIANT |
| Validate Transition Legality | Illegal transition rejected | `validation.test.ts` accepted→verified | ✅ COMPLIANT |
| Validate Structured LLM Plan | Well-formed plan accepted | `validation.test.ts` | ✅ COMPLIANT |
| Validate Structured LLM Plan | Malformed plan rejected | `validation.test.ts` missing description/actions | ✅ COMPLIANT |

**Compliance summary**: 42/46 scenarios compliant (4 UNTESTED CRITICAL)

**Requirement rollup**: 18/21 requirements fully scenario-compliant
- FAIL requirements: Delegation Activation Window (0/2), Delegation Authority Fields (1/2), Receipt Links Authority/Work/Outcome (1/2)

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Activation Window Gate | ✅ Implemented | `isWindowActive` in model.ts; wired grant/identity/pipeline |
| In-Memory Separation of Duties | ✅ Implemented | `['proposer','approver']` in ABSOLUTE_PAIRS |
| Mandatory Company Tenant Scope | ✅ Implemented | companyId on aggregates; get(id, companyId) |
| Delegation Company Scope | ✅ Implemented | companyId + scoped repository |
| Delegation Activation Window | ❌ Incomplete | validFrom/validUntil fields only; no `isWindowActive` evaluation path for Delegation |
| Delegation Authority Fields | ⚠️ Partial | fields present; missing-field runtime guard incomplete (no budget/scope asserts) |
| Work Company Scope and Version | ✅ Implemented | companyId + version on Work |
| Work Optimistic Concurrency | ✅ Implemented | updateWithVersion CAS + VersionConflictError |
| Work Transition Use Cases | ✅ Implemented | propose/accept/start/complete/verify/reject |
| Idempotency for Work Transitions | ✅ Implemented | IdempotencyStore port + fake + PG adapter + use-case wire |
| Work Execution Fields | ✅ Implemented | types + validation |
| Receipt Company Scope | ✅ Implemented | companyId + scoped get |
| Receipt Links + terminalEventId | ⚠️ Partial | fields + assertValidReceiptRow; no dedicated missing-field tests |
| Single Issuance | ✅ Implemented | UNIQUE(work_id, terminal_event_id) + fake rejection |
| Atomic Transaction Boundary | ✅ Implemented | port + InMemory + PgDbConnection |
| Business Table Unique Constraints | ✅ Implemented | sql/003 + greenfield 002 |
| DbConnection Port Interface | ✅ Implemented | three ops |
| Validate Command/Row/Transition/LLM | ✅ Implemented | validation/guards.ts + ValidationError |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| SoD absolute-pair fix | ✅ Yes | ABSOLUTE_PAIRS includes proposer/approver |
| isWindowActive in kernel | ✅ Yes | model.ts + grant/identity/pipeline |
| Mandatory company scope at port | ✅ Yes | required companyId param |
| transaction(fn) on DbConnection | ✅ Yes | PG BEGIN/COMMIT/ROLLBACK; nested throws |
| Work CAS + split insert/update | ✅ Yes | save insert; updateWithVersion CAS |
| Idempotency journal | ✅ Yes | port + PG table UNIQUE(company,op,key) |
| Use cases + guards in business-domain | ✅ Yes | use-cases/ + validation/ |
| TransactionRunner vs DbConnection.tx | ⚠️ Deviates | Design data-flow shows evaluate/evidence/receipt inside DbConnection.transaction; impl uses TransactionRunner without tx handle and runs evaluate/idempotency outside tx (apply-progress + review R2-001/R2-002) |
| Delegation window reuse isWindowActive | ❌ Not followed | no delegation activation helper wired |

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | apply-progress #5785 TDD Cycle Evidence table present |
| All tasks have tests | ⚠️ | 36/37 task groups have tests; hygiene 9.x structural; **delegation window tasks absent from task list but present in delta specs** |
| RED confirmed (tests exist) | ✅ | listed test files exist under packages/*/test |
| GREEN confirmed (tests pass) | ✅ | 459 passed on this run |
| Triangulation adequate | ✅ | multi-case for SoD tiers, window edges, CAS, validation, idempotency |
| Safety Net for modified files | ✅ | apply-progress reports safety nets on modified packages |

**TDD Compliance**: 5/6 checks passed (delegation-window gap is a spec/implementation hole, not a missing TDD evidence row)

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | majority of 459 | trust-kernel, business-domain, database unit | vitest |
| Integration | subset (skipped locally when PG down) | `*.integration.test.ts` | vitest + real PG when reachable |
| E2E | 0 | — | not installed |
| **Total** | **459 passed + 22 skipped** | **32 files** | |

### Changed File Coverage
Coverage analysis skipped — no coverage tool detected

### Assertion Quality
**Assertion quality**: ✅ All sampled assertions verify real behavior (decision DENY/ALLOW, version bumps, throws ValidationError/VersionConflictError/IdempotencyConflictError, undefined cross-company). No tautologies found in change-related tests.

### Quality Metrics
**Linter**: ✅ No errors (`biome lint` via pnpm check)
**Type Checker**: ✅ No errors (`tsc -p tsconfig.json` + build)

### Issues Found
**CRITICAL**:
1. **UNTESTED** — Delegation Activation Window / Future-start delegation not active: no evaluator applies `isWindowActive(validFrom, now, validUntil)` to Delegation; no covering test.
2. **UNTESTED** — Delegation Activation Window / Currently active delegation: same gap.
3. **UNTESTED** — Delegation Authority Fields / Missing required field rejected: no runtime test; `assertValidDelegationRow` does not assert budget/authorityScope.
4. **UNTESTED** — Receipt Links / Missing required field rejected: `assertValidReceiptRow` exists but has zero tests.

**WARNING**:
1. Local PG unreachable → 22 integration tests skipped via `describe.skipIf(!reachable)`; CI adds postgres:18 service (task 9.1). Not a silent pass.
2. Design data-flow vs implementation: evaluate/idempotency outside transaction; TransactionRunner erases tx DbConnection handle (review findings R2-001, R2-002 classified info at finalize).
3. Idempotency `in_progress` → proceed may re-enter side effects (review R2-004) — not a failed scenario under current specs, but durability footgun.
4. `gentle-ai review validate` inventory CLI reports `authority_corrupted` despite coherent approved receipt for lineage `review-1a05131a48ca7df7` matching HEAD — tool/inventory issue; does not restore missing_review_authority.

**SUGGESTION**:
1. Add `isDelegationActive(d, now)` reusing kernel `isWindowActive` + unit tests for future-start and active windows.
2. Extend `assertValidDelegationRow` for budget/authorityScope and add receipt/delegation missing-field validation tests.
3. After CRITICAL fixes, re-run sdd-verify then archive.

### Verdict
FAIL
4 CRITICAL untested delta scenarios (delegation activation window ×2, delegation missing-field, receipt missing-field). Runtime suite is green (459 passed) and most hardening is proven, but independent verification cannot PASS while required scenarios lack covering tests.
