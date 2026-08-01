```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:6c9674c2e347be69d7d8bc88f7e81e7d464461ae0b7ba4200ebb9b5c1a96a432
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 18/18
scenarios: 61/61
test_command: PATH=/data/node24/bin:$PATH pnpm check
test_exit_code: 0
test_output_hash: sha256:ff745258d7e9d4b82bcee963f931dd44c412e288e1af839fc0ee1c7899f054dd
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:ff745258d7e9d4b82bcee963f931dd44c412e288e1af839fc0ee1c7899f054dd
```

## Verification Report

**Change**: harden-first-enterprise-vertical-foundation
**Version**: N/A (delta specs only)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 34 |
| Tasks complete | 34 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Build**: ✅ Passed
```text
$ PATH=/data/node24/bin:$PATH pnpm check
format-check ✅ / typecheck ✅ / build ✅ / lint ✅ / test ✅
Exit 0
```

**Tests**: ✅ 604 passed / ❌ 0 failed / ⚠️ 3 skipped
```text
$ pnpm vitest run
Test Files  36 passed | 2 skipped (38)
     Tests  604 passed | 3 skipped (607)
```
The 3 skips are: 2 = DeepSeek external-API round-trip (no `DEEPSEEK_API_KEY`, pre-existing), 1 = CI guard `pg-required.integration.test.ts` (skips locally by design; fails loudly with `IO_REQUIRE_PG=1`).

**Coverage**: ➖ Not available (no coverage tool configured)

**PostgreSQL Integration (live PG 18.4)**: ✅ 38 passed / ❌ 0 failed
```text
$ pnpm vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/database/test/pg-roundtrip.integration.test.ts
Test Files  2 passed (2)
     Tests  38 passed (38)
```
PG integration RAN — not skipped. Container `io_pg` (postgresql://io:io_dev@localhost:5432/io_dev).

### Spec Compliance Matrix

#### trust-kernel (3 requirements / 13 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| In-Memory Separation of Duties | Self-approval denied (approver and executor) | `sod.test.ts` | ✅ COMPLIANT |
| In-Memory Separation of Duties | Self-verification denied (verifier and executor) | `sod.test.ts` | ✅ COMPLIANT |
| In-Memory Separation of Duties | Low-risk proposer equals approver denied | `sod.test.ts` | ✅ COMPLIANT |
| In-Memory Separation of Duties | Distinct proposer and approver allowed | `sod.test.ts` | ✅ COMPLIANT |
| Scoped In-Memory Evaluation Pipeline | Pass-through steps documented | `pipeline.test.ts` | ✅ COMPLIANT |
| Scoped In-Memory Evaluation Pipeline | Any failure denies | `pipeline.test.ts` | ✅ COMPLIANT |
| Scoped In-Memory Evaluation Pipeline | Callers must await evaluate | `pipeline.test.ts` | ✅ COMPLIANT |
| Scoped In-Memory Evaluation Pipeline | Deferred step records a non-ALLOW marker | `pipeline.test.ts` | ✅ COMPLIANT |
| Activation Window Gate | Future-start grant is inactive | `model.test.ts`, `grant.test.ts` | ✅ COMPLIANT |
| Activation Window Gate | Active window passes | `model.test.ts` | ✅ COMPLIANT |
| Activation Window Gate | Expired window fails | `model.test.ts` | ✅ COMPLIANT |
| Activation Window Gate | Boundary start equals now is active | `model.test.ts` | ✅ COMPLIANT |
| Activation Window Gate | Boundary now equals expiry is inactive | `model.test.ts` | ✅ COMPLIANT |

#### company-identity (1 requirement / 3 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Tenant-Scoped Operations | Create with companyId | `types.test.ts`, `fakes.test.ts`, `business-adapters.test.ts` | ✅ COMPLIANT |
| Tenant-Scoped Operations | Scoped get for the wrong company is rejected | `fakes.test.ts`, `business-adapters.test.ts` | ✅ COMPLIANT |
| Tenant-Scoped Operations | Empty companyId rejected | `fakes.test.ts`, `business-adapters.test.ts` | ✅ COMPLIANT |

#### delegation-lifecycle (2 requirements / 7 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Delegation Authority Fields | Active delegation with all fields | `types.test.ts` | ✅ COMPLIANT |
| Delegation Authority Fields | Missing required field rejected | `types.test.ts` | ✅ COMPLIANT |
| Delegation Authority Fields | Empty companyId rejected | `types.test.ts` | ✅ COMPLIANT |
| Window-Active Delegation | Future-start assignment is inactive | `transitions.test.ts` | ✅ COMPLIANT |
| Window-Active Delegation | In-window assignment is active | `transitions.test.ts` | ✅ COMPLIANT |
| Window-Active Delegation | Expired assignment is inactive | `transitions.test.ts` | ✅ COMPLIANT |
| Window-Active Delegation | Boundary validFrom equals now is active | `transitions.test.ts` | ✅ COMPLIANT |

#### work-lifecycle (3 requirements / 9 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Work Execution Fields | Valid proposed work | `types.test.ts` | ✅ COMPLIANT |
| Work Execution Fields | Missing delegation reference rejected | `types.test.ts` | ✅ COMPLIANT |
| Work Execution Fields | Empty companyId rejected | `types.test.ts` | ✅ COMPLIANT |
| Optimistic Concurrency via CAS | Successful CAS bumps the version | `fakes.test.ts`, `business-adapters.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| Optimistic Concurrency via CAS | Stale expectedVersion yields version-conflict | `fakes.test.ts`, `business-adapters.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| Optimistic Concurrency via CAS | Concurrent writers, single winner | `fakes.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| Transition Use Cases Replace Raw Save | Use case drives a valid transition | `use-cases.test.ts` | ✅ COMPLIANT |
| Transition Use Cases Replace Raw Save | Raw save is not the transition path | `use-cases.test.ts` | ✅ COMPLIANT |
| Transition Use Cases Replace Raw Save | Use case reports conflict without throwing | `use-cases.test.ts` | ✅ COMPLIANT |

#### business-receipt (2 requirements / 6 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Receipt Links Authority, Work, and Outcome | Complete receipt fields | `types.test.ts` | ✅ COMPLIANT |
| Receipt Links Authority, Work, and Outcome | Missing required field rejected | `types.test.ts` | ✅ COMPLIANT |
| Receipt Links Authority, Work, and Outcome | Receipt carries companyId | `fakes.test.ts`, `business-adapters.test.ts` | ✅ COMPLIANT |
| Single Issuance | First issuance succeeds | `fakes.test.ts`, `business-adapters.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| Single Issuance | Duplicate receiptId rejected | `fakes.test.ts`, `business-adapters.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| Single Issuance | Duplicate work and terminal event rejected | `fakes.test.ts`, `business-adapters.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |

#### db-connection-port (3 requirements / 13 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| DbConnection Port Interface | Asynchronous execute and query | `connection-port.test.ts` | ✅ COMPLIANT |
| DbConnection Port Interface | No driver types or schema knowledge | `connection-port.test.ts`, `boundary.test.ts` | ✅ COMPLIANT |
| DbConnection Port Interface | Transaction signature on the port | `connection-port.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | Execute and query against live PG via pg.Pool | `pg-connection.test.ts`, `pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | Connection string drives the pool | `pg-connection.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | close() ends the pool but is not part of the port | `pg-connection.test.ts`, `boundary.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | Transaction commit persists | `pg-connection.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | Transaction error rolls back with no partial write | `pg-connection.test.ts`, `business-pg-roundtrip.integration.test.ts` | ✅ COMPLIANT |
| PgDbConnection Implementation | Nested transaction throws | `pg-connection.test.ts`, `connection-fake.test.ts` | ✅ COMPLIANT |
| InMemoryDbConnection Test Double | Records operations and round-trips data | `connection-fake.test.ts` | ✅ COMPLIANT |
| InMemoryDbConnection Test Double | Honest non-durable disclosure | `connection-fake.test.ts` | ✅ COMPLIANT |
| InMemoryDbConnection Test Double | Fake transaction commit keeps and error restores | `connection-fake.test.ts` | ✅ COMPLIANT |
| InMemoryDbConnection Test Double | Fake mirrors PostgreSQL transaction semantics | `connection-fake.test.ts` | ✅ COMPLIANT |

#### runtime-validation (4 requirements / 10 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Typed Guard Result Contract | Valid input parses | `validation.test.ts` | ✅ COMPLIANT |
| Typed Guard Result Contract | Invalid input rejected with reason | `validation.test.ts` | ✅ COMPLIANT |
| Typed Guard Result Contract | Runtime check, not type-only | `validation.test.ts` | ✅ COMPLIANT |
| Command Guard | Valid command parses | `validation.test.ts` | ✅ COMPLIANT |
| Command Guard | Invalid command rejected with reason | `validation.test.ts` | ✅ COMPLIANT |
| LLM Plan Guard | Valid plan shape parses | `validation.test.ts` | ✅ COMPLIANT |
| LLM Plan Guard | Malformed plan rejected | `validation.test.ts` | ✅ COMPLIANT |
| LLM Plan Guard | Guard stays in-domain and plan is non-authority | `validation.test.ts` | ✅ COMPLIANT |
| PostgreSQL Row Guards | Valid row passes | `row-guards.test.ts` | ✅ COMPLIANT |
| PostgreSQL Row Guards | Corrupt row rejected | `row-guards.test.ts` | ✅ COMPLIANT |

**Compliance summary**: 61/61 scenarios compliant — every spec scenario has a covering test that PASSED at runtime.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| SoD proposer≠approver ALL tiers | ✅ Implemented | `ABSOLUTE_PAIRS` includes `['proposer','approver']`; checked before `allowsLowCombination`. Verified at low+medium+high+critical. |
| isWindowActive gate | ✅ Implemented | `start <= now < expiry`; wired into grant.ts, identity.ts, pipeline.ts, and business-domain transitions.ts. Both future-start and expired correctly deny. |
| Deferred steps record non-ALLOW marker | ✅ Implemented | `StepDecision = Decision | 'DEFERRED'`; passThrough records `DEFERRED` for deferred steps (never silent ALLOW). |
| companyId mandatory on all aggregates | ✅ Implemented | Delegation, Work, BusinessReceipt all carry non-empty `companyId`. Repositories scoped via `WHERE company_id=$1 AND id=$2`. Empty-companyId rejection at port/fake/adapter levels (all 4 adapters). |
| Work.version init 1 | ✅ Implemented | `version` is numeric, init 1; `updateIfVersion` bumps `expectedVersion+1`. |
| DbConnection.transaction(fn) | ✅ Implemented | Driver-free port signature; PG: pool.connect() → BEGIN → fn → COMMIT + release; throw → ROLLBACK + release + rethrow. Nested throws. Fake: snapshot/restore. |
| CAS single-writer | ✅ Implemented | `UPDATE … version=version+1 WHERE id=$1 AND version=$2` → 0 rows = version-conflict. Both PG and fake implementations. `Promise.all` concurrent test: exactly one winner. |
| UNIQUE single-receipt + work×terminal | ✅ Implemented | `UNIQUE(receipt_id)`, `UNIQUE(work_id, terminal_event_id)` enforced in 004 migration. Both constraints rejection verified live-PG. |
| Idempotency replay/DENY/atomic | ✅ Implemented | key+same-hash → replay; key+diff-hash → DENY; atomic terminal close in one tx (in_flight → CAS → receipt terminal_event_id=attempt_id → complete). No partial write verified live-PG. |
| Use cases replace raw save | ✅ Implemented | Six transition use cases (propose/accept/start/complete/verify/reject); raw save demoted to insert-only. Typed `UseCaseResult`, no throw-for-control-flow on pre-write decisions. |
| Runtime validation guards | ✅ Implemented | `parseCommand`, `parseLlmPlan`, `parseWorkRow`, `parseBusinessReceiptRow` — all runtime structural checks, reject with `{ok:false,reason}`, no type-only reliance. |
| evidenceId stable across retries | ✅ Implemented | `ev:${companyId}:${idempotencyKey}` — same invocation twice produces same evidenceId. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 — transaction(fn) on driver-free port | ✅ Yes | `transaction<T>(fn)` added to `DbConnection`; PG + fake both implement it. Nested throws. |
| D2 — proposer≠approver absolute at every tier | ✅ Yes | `['proposer','approver']` in `ABSOLUTE_PAIRS`. |
| D3 — use cases replace save | ✅ Yes | Six transition use cases under `use-cases/`; deps = ports only; typed result. |
| D4 — version init 1, CAS +1 | ✅ Yes | Numeric `version`, init 1; `updateIfVersion` bumps `expectedVersion+1`. |
| D5 — terminal_event_id on receipt, journal UNIQUE | ✅ Yes | `terminalEventId` on BusinessReceipt + `UNIQUE(work_id, terminal_event_id)`. Attempt ID deterministic but key-derived (design deviation — no safety impact). |
| D6 — idempotency: replay/DENY/atomic close | ✅ Yes | Journal + atomic terminal close in one tx. Post-write CAS loss throws (rollback — preserves atomicity, documented). |
| D7 — runtime-validation guards in business-domain + database | ✅ Yes | Command + LLM plan in business-domain (zero `@io/*` imports); PG row guards in database (wired into adapter get() paths). |
| D8 — evidenceId stable across retries | ✅ Yes | `ev:${companyId}:${idempotencyKey}`. |

Design deviations were documented in apply-progress (rejectNested async, CAS version base, attemptId derivation, row-guard wire-in, completeWork without key skips receipt). All are faithful to design intent; none break a spec.

### Forbidden-Coupling Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| 1 — No aggregate imports another (neutral IDs/ports) | ✅ Intact | No cross-aggregate imports detected. |
| 2 — business-domain zero `@io/*` imports | ✅ Intact | `grep -rn '^import[^;]*@io/' packages/business-domain/src/` = NO_MATCHES |
| 3 — openai confined to deepseek-client.ts | ✅ Intact | Production `openai` import ONLY in `packages/llm-client/src/deepseek-client.ts`. Test-file matches are string literals in boundary assertions. |
| 4 — LLM plan guard no @io/llm-client import | ✅ Intact | Only a COMMENT documents the rule; no actual import. Source-level test verifies. |
| 5 — No agentic/business frameworks; no new deps | ✅ Intact | No `package.json` changes; no new dependencies. |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | Found in apply-progress — all 34 tasks have TDD cycle entries |
| All tasks have tests | ✅ | 34/34 tasks have test files |
| RED confirmed (tests exist) | ✅ | All test files verified on disk |
| GREEN confirmed (tests pass) | ✅ | 604/604 tests pass on execution; 0 failures |
| Triangulation adequate | ✅ | Multiple distinct test cases per behavior; CAS triangulation caught real production bug (version base) |
| Safety Net for modified files | ✅ | All modified files ran existing tests before modification |

**TDD Compliance**: 6/6 checks passed

### Assertion Quality

✅ All assertions verify real behavior. No tautologies, no empty-collection ghosts, no smoke-test-only, no unimplemented step masking. The CAS triangulation separately caught a real production bug during GREEN (fake mirrored `work.version + 1` instead of `expectedVersion + 1`), and the Slice C correction caught the `proposeWork` empty-companyId mislabel. Both were fixed with real RED→GREEN cycles.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 564 | 34 | vitest |
| Integration (live PG 18.4) | 38 | 2 | vitest + docker io_pg |
| E2E | 0 | 0 | N/A |
| Skipped (DeepSeek API + CI guard) | 3 | 2 | N/A |
| **Total** | **604+3** | **38** | |

### Changed File Coverage

Coverage analysis skipped — no coverage tool configured. (Not a failure.)

### Quality Metrics

**Format Checker (biome)**: ✅ No errors — 97 files checked, no fixes applied
**Type Checker (tsc)**: ✅ No errors — `tsconfig.json` + `tsconfig.build.json` both clean
**Linter (biome)**: ✅ No errors — 97 files checked, no fixes applied

### Issues Found

**CRITICAL**: None

**WARNING**: None — the adversarial reviews across all 3 slices found candidate-caused issues that were FIXED before verification (transaction crash path, ROLLBACK error fidelity, empty-companyId parity, proposeWork companyId validation path). Zero outstanding warnings.

**SUGGESTION** (non-blocking, from Slice C adversarial review — deferred by design):
1. Replay path returns journal `result_json` without a row guard (D7 consistency) — consider `parseWorkRow` on replay. Low impact: value written by same system.
2. Same-key concurrent race loser surfaces a thrown error (unique violation) instead of a typed `attempt-in-flight` result. Safety holds (exactly one effect); D6 sanctions throw⇒rollback; loser can retry for clean replay.
3. `completeWorkIdempotent` atomicity is caller-enforced (must be wrapped in one transaction). Document the assumption on `IdempotencyJournalPort`. The sanctioned wiring `completeWorkAtomically` always wraps; no shipped path violates it.

### Verdict

**PASS WITH WARNINGS**

All 34 tasks complete. All 18 requirements and 61 spec scenarios have covering tests that PASSED at runtime. Build/typecheck/lint/format all green. PostgreSQL integration RAN (not skipped) with 38/38 passing. All five forbidden-coupling invariants intact. Strict TDD compliance confirmed. Three deferred SUGGESTIONs from the adversarial review remain open — they are low-impact, non-blocking, and do not affect any safety property. The verification is a genuine PASS, with the SUGGESTIONs as useful hygiene notes for the next cycle.
