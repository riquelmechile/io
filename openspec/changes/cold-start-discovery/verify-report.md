```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b9110152155b807a467374aef60dca7fbda726278d2c585d9fae7dac2519ea56
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 24/24
test_command: DATABASE_URL=postgresql://io:io_dev@127.0.0.1:5434/io_dev IO_REQUIRE_PG=1 PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/cold-start-e2e.integration.test.ts
test_exit_code: 0
test_output_hash: sha256:af16436e77dc50c53e6938485be33857e565cd11d46dff8a21a50436b465428d
build_command: PATH=/data/node24/bin:$PATH pnpm build
build_exit_code: 0
build_output_hash: sha256:24c42b76aecef2c39c8a5639a3536efb936b03bdac9a8f8be50c0e71ffbc7af8
```

## Verification Report

**Change**: `cold-start-discovery`  
**Mode**: Strict TDD; hybrid artifact store  
**Candidate**: HEAD `5cad22277d9c866e632b6a65e43d930aa766b6ce`; tree `702218f28e1b285385744b0c542e0c136e08ed72`.  
**Commit chain**: `18cddf0` builder; `9fada4b` emission/materiality; `a5315ea` atomic PG seam; `2565175` composition/E2E; `f2c39de` closeout; `80c8dfc` Phase 5 evidence; `5cad222` no-backfill runtime proof.  
**Evidence revision**: envelope digest binds HEAD/tree, committed Phase 5 and remediation evidence, fresh runtime/build hashes, and authority revision.

### Completeness and Evidence

| Check | Result | Evidence |
|---|---|---|
| Tasks | ✅ | 18/18 checked; 0 pending |
| Fresh independent runtime | ✅ | 1 file, 3/3 passed, 0 skipped, exit 0 |
| Build | ✅ | `tsc -p tsconfig.build.json`, exit 0 |
| Phase 5 committed gate | ✅ | `pnpm check`: 100 passed/3 skipped files; 1380 passed/6 skipped tests; exit 0 |
| Phase 5 focused PG | ✅ | 2 files, 62/62 passed, 0 skipped; exit 0 |
| Coverage | ➖ | No coverage tool configured |

### Requirements Summary

| Requirement | Scenarios | Result |
|---|---:|---|
| Atomic Acceptance Event Emission | 5/5 | ✅ COMPLIANT |
| Read-Only Company Discovery | 3/3 | ✅ COMPLIANT |
| Idempotent Single Emission | 5/5 | ✅ COMPLIANT |
| Declared Material Event Types | 6/6 | ✅ COMPLIANT |
| Atomic Acceptance Fact | 5/5 | ✅ COMPLIANT |

### Scenario Compliance Matrix

| # | Scenario | Passing runtime evidence | Result |
|---:|---|---|---|
| 1 | Successful acceptance commits one event atomically | Phase 5 live-PG atomic suite | ✅ COMPLIANT |
| 2 | Crash between CAS and append is impossible | Phase 5 live-PG rollback case | ✅ COMPLIANT |
| 3 | Only accept emits `work.accepted` | Domain/full committed gate | ✅ COMPLIANT |
| 4 | Pre-change accepted Work is not backfilled | `cold-start-e2e` no-backfill case; fresh 3/3 | ✅ COMPLIANT |
| 5 | Cold-start chain through real path | `cold-start-e2e` real-path case; fresh 3/3 | ✅ COMPLIANT |
| 6 | Discovery returns distinct companies | PG/fake discovery tests in committed gate | ✅ COMPLIANT |
| 7 | Discovery preserves event facts | PG/fake snapshot tests in committed gate | ✅ COMPLIANT |
| 8 | Acceptance discovers zero-event company | `cold-start-e2e` real-path case; fresh 3/3 | ✅ COMPLIANT |
| 9 | Completed replay does not append | Committed full gate | ✅ COMPLIANT |
| 10 | Duplicate throwing append is rejected | Phase 5 live-PG/fake suites | ✅ COMPLIANT |
| 11 | Decision identity is deterministic | Committed full gate | ✅ COMPLIANT |
| 12 | Acceptance identity deterministic/namespaced | Builder unit suite | ✅ COMPLIANT |
| 13 | Retry conditionally appends once | Committed full gate | ✅ COMPLIANT |
| 14 | Completed event is material | Heartbeat unit suite | ✅ COMPLIANT |
| 15 | Accepted event is material | Heartbeat unit suite | ✅ COMPLIANT |
| 16 | Undeclared event is not material | Heartbeat unit suite | ✅ COMPLIANT |
| 17 | Decisions renew neither novelty nor context | Heartbeat/context tests in committed gate | ✅ COMPLIANT |
| 18 | Accepted event at/before cursor does not activate | Heartbeat unit suite | ✅ COMPLIANT |
| 19 | Cursor remains sole novelty guard | Heartbeat/use-case suites | ✅ COMPLIANT |
| 20 | Successful accept commits Work/event together | Phase 5 live-PG atomic suite | ✅ COMPLIANT |
| 21 | Version conflict commits no event | Phase 5 live-PG atomic suite | ✅ COMPLIANT |
| 22 | Invalid transition commits no event | Phase 5 live-PG atomic suite | ✅ COMPLIANT |
| 23 | Atomic rollback on post-CAS failure | Phase 5 live-PG atomic suite | ✅ COMPLIANT |
| 24 | Other transitions retain typed behavior/emissions | Domain/full committed gate | ✅ COMPLIANT |

**Compliance summary**: 24/24 normative scenarios have passing runtime coverage.

### No-Backfill Re-evaluation

The committed remediation creates live-PG pre-change state with accepted Work and zero events, then executes event-log discovery and the real one-shot supervisor pump. Fresh execution proves `listCompanyIds()=[]`, zero synthesized `business_event`, zero receipts, zero LLM requests, and unchanged Work `accepted`@v1. The empty assertion is non-vacuous because production discovery runs against seeded Work and the companion case in the same file proves non-empty discovery after acceptance emission.

### Correctness and Design Coherence

| Decision | Result | Evidence |
|---|---|---|
| D1/D3/D4 emission and deterministic identity | ✅ | Pure builder; append only after successful CAS; `evt:acc:{workId}` |
| D2/D6 atomicity and typed failures | ✅ | One transaction-scoped connection; resolved pre-write failures; throw rolls back |
| D5/D9 materiality and cursor-only novelty | ✅ | Exact material set; cursor algorithm unchanged |
| D7 existing emitters retained | ✅ | Completion and heartbeat emissions unchanged |
| D8 no migration/backfill | ✅ | Fresh live-PG no-backfill scenario passes |
| D10 production composition and real path | ✅ | Composition seam and unbypassed supervisor E2E pass |

Production code is unchanged from `80c8dfc` to remediation commit `5cad222`; only the missing test and evidence changed. Previously proven Phase 5 requirements therefore remain valid, and source inspection through HEAD found no design deviation.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | Phase 1–4 RED/GREEN records and remediation coverage record present |
| Behavioral units have tests | ✅ | 5/5 work units have named test evidence |
| RED confirmed | ✅ | Four implementation units recorded genuine RED; remediation began from verifier `UNTESTED` |
| GREEN confirmed | ✅ | Fresh E2E 3/3 plus committed Phase 5 gates |
| Triangulation | ✅ | Identity, failures, cursor, rollback, re-pump, empty/non-empty discovery |
| Safety nets | ✅ | Baselines and current focused/full evidence recorded |

### Test Layers, Coverage, and Quality

| Layer | Added behavioral tests | Files |
|---|---:|---:|
| Unit | 19 | 4 |
| Integration (live PG) | 7 | 1 |
| E2E (live PG) | 3 | 1 |
| **Total** | **29** | **6** |

Coverage analysis skipped — no coverage tool configured. Phase 5 typecheck/build/lint/test gate passed; nine lint warnings are pre-existing and outside this change. **Assertion quality**: ✅ no tautology, ghost loop, smoke-only assertion, or assertion without production execution found in changed tests.

### Review Authority and Harness Cleanup

Reviewed remediation lineage `review-b22a8cc50ed7283d` is authoritative and approved: snapshot `sha256:b22a8cc50ed7283d9eb64d1e02daf785cf5d13698fe66fca3f2c361fa520709a`, revision/receipt/bundle `sha256:767eb82a516e409a322af8a2404b6388ca7fd9459cbfd19e02efdc3a546b5ec9`, reliability result captured with no findings. Read-only `review validate --gate pre-commit` returned `allow`; base tree `0c0aebe72b25b5529d3927a8ac95196c655cb6f6`, candidate tree `702218f28e1b285385744b0c542e0c136e08ed72`, evidence hash `sha256:7b442819e70a80456200d11ff08108d3f99c05890870389a7a8845fe3374c5b1`.

Harness identity was verified before start: `io-phase4-iso-pg-3cdff5d7`, `postgres:18.4`, loopback `127.0.0.1:5434`, volume `io-phase4-iso-pg-vol-3cdff5d7`; server reported PostgreSQL 18.4 and database `io_dev`. Shared `io_pg` (5432), unrelated `medusa-build-pg` (5433), and unrelated databases were not targeted. Harness was stopped after the run and preserved; final state `exited`.

### Issues Found

**CRITICAL**: None.  
**WARNING**: Nine pre-existing lint warnings remain outside this change; coverage tooling is not configured.  
**SUGGESTION**: None.

### Verdict

**PASS** — all 5 requirements, 24/24 scenarios, and 18/18 tasks are proven with zero CRITICAL findings. The stale 23/24 FAIL is replaced. The change is **ready for archive**.
