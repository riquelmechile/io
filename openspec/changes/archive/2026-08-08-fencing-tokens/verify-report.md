```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d8a3127ab6625e92c3e124e2a0125afb0bc7ae7d221ea1d73b98b29d684a871b
verdict: pass
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 36/36
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:526f3320a62f871359f8c1a6715c108411eb215e0cbef8cdd998bbfb82cc60a6
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:44091f800d46ea11363afcbf89e87822c75eb727bf8ec4b3bc0d4d536279f0a2
```

## Verification Report

**Change**: fencing-tokens  
**Version**: N/A  
**Mode**: Strict TDD  
**Source revision**: `03532b78c42973547142f776be0ce78f49b24e18` (`HEAD == origin/main`)  
**Artifact mode**: Hybrid

The retrieved specifications contain **7 requirements and 36 scenarios**, not 35: work-lifecycle has 9 scenarios, worker-cycle has 13, and idempotency-journal has 14. The measured count controls this report and validator admission.

### Completeness

| Metric | Value |
|---|---:|
| Tasks total | 18 |
| Tasks complete | 18 |
| Tasks incomplete | 0 |
| Requirements fully compliant | 7/7 |
| Scenarios compliant | 36/36 |

Native status reported `taskProgress: 18/18`, `dependencies.verify: ready`, `nextRecommended: verify`, no blocked reasons, and repo-local edit authority for `/data/io`. All five implementation commits are present on `origin/main`.

### Build and Test Execution

**Full gate**: PASS on the first run; the known race flake did not recur.

```text
PATH=/data/node24/bin:$PATH pnpm check
exit: 0
format: Checked 198 files; no fixes applied
typecheck: passed
build: passed
lint: Checked 198 files; no fixes applied; 9 warnings
tests: 90 files passed, 3 files skipped; 1243 tests passed, 6 skipped
output hash: sha256:44091f800d46ea11363afcbf89e87822c75eb727bf8ec4b3bc0d4d536279f0a2
```

**Full tests**: PASS.

```text
PATH=/data/node24/bin:$PATH pnpm test
exit: 0
90 files passed, 3 files skipped; 1243 tests passed, 6 skipped
output hash: sha256:526f3320a62f871359f8c1a6715c108411eb215e0cbef8cdd998bbfb82cc60a6
```

**Focused live-PostgreSQL evidence**: PASS on the first run, sequential as required.

```text
PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/app/test/e2e/marker-restart.integration.test.ts --no-file-parallelism --reporter=verbose
exit: 0
2 files passed; 50/50 tests passed; 0 skipped
output hash: sha256:11bfd8510d50b88e77b80c04608b657d007e085ffc2afdb24edcc5b9863ceead
```

Live named evidence included:

- **Work-level fencing**: 3 live-PG tests — claim→close with token 1 and one receipt; stale-token close rejected without mutation; token-0 version-only close remains valid.
- **Journal fencing**: 5 live-PG tests — pre-effect token store; matching marker plus fresh-read durability; stale marker rejection; token-free status-guarded completion plus UNRESOLVED; stale terminal close full rollback.
- **Race fix**: 3 live-PG race tests — one typed claim loser, a 25-iteration hammer, and two concurrent terminal closes producing exactly one receipt. The hammer performed 25 independent two-claim races: 25 winners, 25 typed losers, zero throws.
- **Restart E2E**: 1 live-PG test — marker survives a fresh connection and controlled retry completes with exactly one receipt.

**Coverage**: Not available. No Vitest coverage provider or coverage script is installed, so changed-file coverage was not executed.

### Spec Compliance Matrix

| Requirement | Scenario | Passing test and key assertion | Result |
|---|---|---|---|
| Work Execution Fields | Valid proposed work | `database/test/row-guards.test.ts` — `parseWorkRow(workRow())` is `ok: true`; token-0 case returns `fencingToken === 0`; `business-domain/test/types.test.ts` pins proposed/version/token fields | COMPLIANT |
| Work Execution Fields | Missing delegation reference rejected | `database/test/row-guards.test.ts` — empty `delegationId` yields `ok: false` and a `/delegationId/i` reason | COMPLIANT |
| Work Execution Fields | Empty companyId rejected | `database/test/row-guards.test.ts` — empty `companyId` yields `ok: false` and a `/companyId/i` reason | COMPLIANT |
| Optimistic Concurrency via CAS | Successful CAS bumps version | `business-domain/test/fakes.test.ts` and live `business-pg-roundtrip.integration.test.ts` — stored and returned version becomes N+1 | COMPLIANT |
| Optimistic Concurrency via CAS | Stale expectedVersion conflicts | Same files — reason is `version-conflict`; stored version/state remain unchanged | COMPLIANT |
| Optimistic Concurrency via CAS | Concurrent writers have one winner | Same files — winner and conflict arrays each have length 1 | COMPLIANT |
| Optimistic Concurrency via CAS | Claim mints from epoch | `business-domain/test/fakes.test.ts`, `database/test/business-adapters.test.ts`, and live roundtrip — token 0 becomes 1 in the claim CAS | COMPLIANT |
| Optimistic Concurrency via CAS | Stale token cannot close Work | `business-domain/test/fakes.test.ts` and live roundtrip — `fencing-conflict`; state/token/version unchanged | COMPLIANT |
| Optimistic Concurrency via CAS | Fake and PostgreSQL parity | `app/test/parity.test.ts` — claim, stale close, and matching close compare outcomes, token, version, and stored state | COMPLIANT |
| Single-Winner Claim via CAS | Exactly one winner among workers | `app/test/worker-claim.test.ts` — exactly one success and one `version-conflict`; stored token advances once | COMPLIANT |
| Single-Winner Claim via CAS | Losing claimant does not proceed | `app/test/worker-claim.test.ts` — loser reason pinned; at most one effect/journal row and zero receipts | COMPLIANT |
| Single-Winner Claim via CAS | Same-token resume preserves context bytes | `app/test/worker-restart.test.ts` — token 7 survives restart/reopen; `daemon/byte-identity.test.ts` normalization restores baseline; context source scan has zero token matches | COMPLIANT |
| Atomic Terminal Close | Replay returns recorded result | `app/test/worker-finalize.test.ts` — exact replay result; zero receipts/events/undo/transactions and unchanged Work | COMPLIANT |
| Atomic Terminal Close | Hash mismatch denied | `app/test/worker-finalize.test.ts` — exact `idempotency-conflict`; zero receipt/effect/transaction | COMPLIANT |
| Atomic Terminal Close | One receipt per terminal event | `app/test/worker-finalize.test.ts` and live roundtrip — receipt saves/query length is exactly 1 | COMPLIANT |
| Atomic Terminal Close | Live PostgreSQL happy path | Live roundtrip — token 1, completed Work version 3, exactly one receipt | COMPLIANT |
| Atomic Terminal Close | Stale token rolls back atomically | `app/test/worker-finalize.test.ts` — zero receipt/event/complete, one rollback, unchanged Work/journal; live journal-layer test finds no journal row or receipt | COMPLIANT |
| Journal-Anchored Reconciliation | Applied effect reversed then attempt closed | `app/test/worker-reconcile.test.ts` — one undo and durable `aborted_retryable` marker with retained token | COMPLIANT |
| Journal-Anchored Reconciliation | No effect applied leads to clean replay | `app/test/worker-restart.test.ts` — `recovery-required`, no undo, no marker, Work remains in progress | COMPLIANT |
| Journal-Anchored Reconciliation | Unresolvable state reported honestly | `app/test/worker-finalize.test.ts` — exact `UNRESOLVED_REQUIRES_HUMAN`, completed journal sentinel, no undo/marker/receipt/event | COMPLIANT |
| Journal-Anchored Reconciliation | CAS loss sets retryable marker | `app/test/worker-reconcile.test.ts` — exact `cas-lost-retryable`; marker status/token pinned and same-token reopen retains N | COMPLIANT |
| Journal-Anchored Reconciliation | Stale reconciliation token rejected | `app/test/worker-reconcile.test.ts` — call rejects; row remains `in_flight` with token 1 | COMPLIANT |
| Journal Status and Lookup | Same key/hash replays | `business-domain/test/idempotency.test.ts`, `app/test/worker-finalize.test.ts`, and live roundtrip — stored result returned without effect | COMPLIANT |
| Journal Status and Lookup | Same key/different hash denied | `app/test/worker-reconcile.test.ts` and live roundtrip — exact DENY/`idempotency-conflict` | COMPLIANT |
| Journal Status and Lookup | In-flight attempt never replayed | `business-domain/test/idempotency.test.ts` and `app/test/worker-reconcile.test.ts` — `attempt-in-flight`/recovery, no effect | COMPLIANT |
| Journal Status and Lookup | Fresh key records in-flight before effect | `business-domain/test/idempotency.test.ts` and live journal test — row is `in_flight`, carries N, and has no result | COMPLIANT |
| Journal Status and Lookup | Tenant scope enforced | `business-domain/test/idempotency.test.ts` and adapter tests — other tenant sees no row; empty identifiers reject | COMPLIANT |
| Journal Status and Lookup | Status guard preserves honest unresolved close | `business-domain/test/idempotency.test.ts` and live journal test — token-free `complete` stores the exact UNRESOLVED sentinel | COMPLIANT |
| Journal Status and Lookup | Completion rejects non-in-flight | `business-domain/test/idempotency.test.ts` and `database/test/idempotency-adapter.test.ts` — completed/marker rows reject and remain unchanged | COMPLIANT |
| Journal Status and Lookup | Pre-fencing row remains valid | `business-domain/test/idempotency.test.ts`, parity, and live roundtrip — token 0 stores and remains valid | COMPLIANT |
| Retryable Marker on CAS Loss | Marker set with matching token | `business-domain/test/idempotency.test.ts`, worker reconcile, and live journal test — status is `aborted_retryable`, token retained | COMPLIANT |
| Retryable Marker on CAS Loss | Marker is distinct | `business-domain/test/idempotency.test.ts` — status equals `aborted_retryable` and is neither other status | COMPLIANT |
| Retryable Marker on CAS Loss | Marker survives restart | `app/test/worker-restart.test.ts`, live fresh-read test, and live marker-restart E2E — status/token persist after restart | COMPLIANT |
| Retryable Marker on CAS Loss | Stale token cannot mark retryable | Domain, adapter, parity, worker, and live tests — rejection with unchanged status/token | COMPLIANT |
| Retryable Marker on CAS Loss | Fake and PostgreSQL parity | `app/test/parity.test.ts` — matching, stale, token-0, and reopen rows/outcomes match | COMPLIANT |
| Retryable Marker on CAS Loss | Controlled retry retains token | `business-domain/test/idempotency.test.ts`, `app/test/worker-restart.test.ts`, and parity — original attempt/token N retained despite supplied token 99 | COMPLIANT |

**Compliance summary**: 36/36 scenarios are compliant through current passing runtime execution.

### Correctness (Static Evidence)

| Requirement | Status | Static evidence |
|---|---|---|
| Work Execution Fields | Implemented | `Work.fencingToken` is required; row guard accepts only non-negative integers; migration defaults both columns to 0. |
| Optimistic Concurrency via CAS | Implemented | Fake and PG mint within claim CAS; terminal CAS checks version plus token and returns typed conflicts. |
| Single-Winner Claim via CAS | Implemented | `startWork` supplies `{kind:'claim'}`; `runWorker` captures returned Work and stops losers before intent/effect. |
| Atomic Terminal Close | Implemented | Transaction-bound Work CAS, receipt, event, and status-guarded journal completion; replay exits before transaction. |
| Journal-Anchored Reconciliation | Implemented | Applied-effect CAS loss undoes then token-gates `markRetryable`; no-effect and terminal disagreements follow honest paths. |
| Journal Status and Lookup | Implemented | Exact three-status union; token stored pre-effect; token-free lookup/complete; status guard prevents regressions. |
| Retryable Marker on CAS Loss | Implemented | Matching-token transition, stale rejection, restart durability, and same-token reopen exist in fake and PG adapters. |

### Cross-Cutting Invariants

| Invariant | Evidence | Result |
|---|---|---|
| Zero actual `@io/*` imports in business-domain source | Source scan found only ten documentation-comment mentions and zero import/export statements; full boundary tests passed. | PASS |
| Dispatch/tick/supervisor/intent/heartbeat source unchanged since `ce0fe4e` | `git diff ce0fe4e..HEAD -- packages/app/src` lists only four `worker/*` files; targeted protected-path diff exited 0; byte-identity tests passed. | PASS |
| Token absent from compiled-context source | `packages/context/src` scan found zero `fencingToken`/`fencing_token` matches; context tests passed. | PASS |
| No package manifest changed since `ce0fe4e` | Targeted Git diff returned no files. | PASS |
| `openai` production import confined to DeepSeek adapter | Production scan found the only actual import at `packages/llm-client/src/deepseek-client.ts:1`; other mentions are comments. | PASS |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Token crosses the domain port | Yes | Required on journal entries and `markRetryable`; `complete` remains token-free. |
| `FencingDirective` evolves `updateIfVersion` | Yes | Claim, terminal, and version-only forms are implemented in fake and PG. |
| Typed `fencing-conflict` | Yes | Returned when version matches but terminal token does not. |
| Claim uses server-side increment plus `RETURNING` | Yes | PG SQL increments and validates the returned numeric BIGINT. |
| Token check applies to claim-owned closes | Yes | Worker/idempotent close supplies terminal directive; plain admin transition remains version-only. |
| Replay token-free; resume retains token | Yes | Replay exits before mutation; marker reopen retains stored attempt/token. |
| Byte-identity proof extended | Yes | Worker normalization covers both fencing slices and passed. |
| Two slices each below 400 changed lines | No | Delivery was re-sliced into five commits, but four commits still exceed 400 changed lines; this is a design/review-budget deviation, not a spec failure. |

### Deviations Audit

| Reported deviation | Verification against delta specs | Disposition |
|---|---|---|
| Line counts exceeded forecast | Full implementation diff is 2,555 additions and 161 deletions. Commit changed-line totals are 412, 630, 320, 871, and 647; four of five exceed 400. Runtime/spec behavior is unaffected, but the design's review-size promise was not met. | WARNING |
| `aborted_retryable` rows are not completed by the worker terminal branch | Consistent. The journal spec requires `complete` to reject non-`in_flight`; the T2(ii) scenario explicitly closes an `in_flight` row. Marker retries return typed UNRESOLVED without effect/receipt. | COMPLIANT |
| Stale-token reconciliation fails loud | Consistent. The specs require stale `markRetryable` rejection without mutation, not a particular return type. The underlying Work terminal CAS still returns typed `fencing-conflict`. | COMPLIANT |
| Partially vacuous REDs | No behavior/spec violation; current tests pass and assertions are substantive. Tasks 1.6, 2.6, and 2.7 did not demonstrate an independently failing behavioral RED because earlier tasks had already landed the behavior. | TDD WARNING |
| `cmd.fencingToken ?? 0` | Consistent with token 0 as the valid pre-fencing epoch and with unclaimed admin closes; claim-owned closes supply their minted token. | COMPLIANT |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | PASS | `apply-progress.md` contains per-task RED/GREEN/triangulation/safety-net evidence for both slices. |
| All implementation tasks have test evidence | PASS | 16/16 implementation tasks name covering files; gate tasks 3.1/3.2 have executed evidence. |
| RED files exist | PASS | Every named test file exists. |
| Behavioral RED independently demonstrated | WARNING | Tasks 1.6, 2.6, and 2.7 were contract-pinning/vacuous at their task boundary because behavior landed earlier. |
| GREEN confirmed | PASS | Full suite 1243/1243 passing tests; focused live-PG evidence 50/50. |
| Triangulation adequate | PASS | Different tokens, statuses, hashes, tenants, fake/PG implementations, restart, and concurrency outcomes are asserted. |
| Safety nets documented | PASS | Modified suites report prior counts; no unsupported `N/A (new)` claim was found. |

**TDD compliance**: runtime and assertion quality pass; process evidence has one non-blocking warning covering three task boundaries.

### Test Layer Distribution

| Layer | Added tests | Files/evidence | Tools |
|---|---:|---|---|
| Unit/source-boundary/parity | 53 | Business-domain, adapter, row-guard, migration, byte-identity files | Vitest |
| In-process worker integration | 17 | Worker claim/finalize/reconcile/restart and parity files | Vitest with fakes |
| Live PostgreSQL integration | 9 | `business-pg-roundtrip.integration.test.ts` | Vitest + PostgreSQL |
| Existing live E2E modified for token flow | 1 passed | `marker-restart.integration.test.ts` | Vitest + PostgreSQL |

Diff-derived counts find 79 added `it`/`test` declarations. The focused live command executed all 49 roundtrip tests plus the one marker-restart E2E test.

### Changed File Coverage

Coverage analysis skipped because no Vitest coverage provider or coverage script is installed.

### Assertion Quality

No critical or warning-level assertion defects were found in the changed fencing-token tests.

- No tautological constant assertions or smoke-only tests exist.
- Empty-state assertions have non-empty or mutation companions in the same behavior.
- Type-presence assertions are followed by concrete reason/value/state assertions.
- Loops are non-vacuous: byte-identity pins assert nine inputs first; migration statements assert at least two; race hammer iterates a fixed 25 times; corruption tables are fixed non-empty literals.
- SQL-shape assertions intentionally pin adapter contracts specified by the design.
- No changed test uses `vi.mock`, so no mock/assertion-ratio concern exists.

**Assertion quality**: PASS — all mapped scenarios exercise production behavior and assert observable outcomes.

### Quality Metrics

**Formatter**: PASS — 198 files checked, no fixes.  
**Type checker**: PASS — `tsc -p tsconfig.json`.  
**Build**: PASS — `tsc -p tsconfig.build.json`.  
**Linter**: PASS with 9 warnings — six non-null assertions in `app/test/parity.test.ts`, one unused type import in `worker-reconcile.test.ts`, and two unused transaction parameters in the live race hammer. These are test-code maintainability suggestions, not runtime failures.

### Canonical Verification Evidence

The `evidence_revision` is the SHA-256 digest of the exact UTF-8 bytes inside the following block, from `schema:` through the final newline:

```text
schema: gentle-ai.verification-evidence/v1
change: fencing-tokens
source_revision: 03532b78c42973547142f776be0ce78f49b24e18
task_completion: 18/18
requirements: 7/7
scenarios: 36/36
scenario_statuses:
  work-lifecycle/work-execution-fields/valid-proposed-work: COMPLIANT
  work-lifecycle/work-execution-fields/missing-delegation-reference-rejected: COMPLIANT
  work-lifecycle/work-execution-fields/empty-company-id-rejected: COMPLIANT
  work-lifecycle/optimistic-concurrency/successful-cas-bumps-version: COMPLIANT
  work-lifecycle/optimistic-concurrency/stale-expected-version: COMPLIANT
  work-lifecycle/optimistic-concurrency/concurrent-writers-single-winner: COMPLIANT
  work-lifecycle/optimistic-concurrency/claim-mints-from-pre-fencing-epoch: COMPLIANT
  work-lifecycle/optimistic-concurrency/stale-token-cannot-close-work: COMPLIANT
  work-lifecycle/optimistic-concurrency/fake-postgresql-parity: COMPLIANT
  worker-cycle/single-winner-claim/exactly-one-winner: COMPLIANT
  worker-cycle/single-winner-claim/losing-claimant-does-not-proceed: COMPLIANT
  worker-cycle/single-winner-claim/same-token-resume-preserves-context-bytes: COMPLIANT
  worker-cycle/atomic-terminal-close/replay-recorded-result: COMPLIANT
  worker-cycle/atomic-terminal-close/hash-mismatch-denied: COMPLIANT
  worker-cycle/atomic-terminal-close/one-receipt-per-terminal-event: COMPLIANT
  worker-cycle/atomic-terminal-close/live-postgresql-happy-path: COMPLIANT
  worker-cycle/atomic-terminal-close/stale-token-rolls-back-atomically: COMPLIANT
  worker-cycle/journal-anchored-reconciliation/applied-effect-reversed-then-closed: COMPLIANT
  worker-cycle/journal-anchored-reconciliation/no-effect-clean-replay: COMPLIANT
  worker-cycle/journal-anchored-reconciliation/unresolvable-state-reported-honestly: COMPLIANT
  worker-cycle/journal-anchored-reconciliation/cas-loss-sets-retryable-marker: COMPLIANT
  worker-cycle/journal-anchored-reconciliation/stale-reconciliation-token-rejected: COMPLIANT
  idempotency-journal/status-and-lookup/same-key-same-hash-replays: COMPLIANT
  idempotency-journal/status-and-lookup/same-key-different-hash-denied: COMPLIANT
  idempotency-journal/status-and-lookup/in-flight-never-replayed: COMPLIANT
  idempotency-journal/status-and-lookup/fresh-key-records-in-flight-pre-effect: COMPLIANT
  idempotency-journal/status-and-lookup/tenant-scope-enforced: COMPLIANT
  idempotency-journal/status-and-lookup/status-guard-preserves-unresolved-close: COMPLIANT
  idempotency-journal/status-and-lookup/completion-rejects-non-in-flight: COMPLIANT
  idempotency-journal/status-and-lookup/pre-fencing-row-valid: COMPLIANT
  idempotency-journal/retryable-marker/marker-set-on-cas-loss: COMPLIANT
  idempotency-journal/retryable-marker/distinct-status: COMPLIANT
  idempotency-journal/retryable-marker/survives-restart: COMPLIANT
  idempotency-journal/retryable-marker/stale-token-rejected: COMPLIANT
  idempotency-journal/retryable-marker/fake-postgresql-parity: COMPLIANT
  idempotency-journal/retryable-marker/controlled-retry-retains-token: COMPLIANT
test_command: PATH=/data/node24/bin:$PATH pnpm test
test_exit_code: 0
test_output_hash: sha256:526f3320a62f871359f8c1a6715c108411eb215e0cbef8cdd998bbfb82cc60a6
build_command: PATH=/data/node24/bin:$PATH pnpm check
build_exit_code: 0
build_output_hash: sha256:44091f800d46ea11363afcbf89e87822c75eb727bf8ec4b3bc0d4d536279f0a2
live_e2e_command: PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/app/test/e2e/marker-restart.integration.test.ts --no-file-parallelism --reporter=verbose
live_e2e_runs: 1
live_e2e_exit_codes: [0]
live_e2e_result: files=2/2 tests=50/50 skipped=0
live_e2e_output_hashes: [sha256:11bfd8510d50b88e77b80c04608b657d007e085ffc2afdb24edcc5b9863ceead]
live_e2e_disposition: passed-first-run-no-flake
race_hammer_result: iterations=25/25 claims=50 typed-losses=25 throws=0
protected_diff_exit_code: 0
cross_cutting_invariants: PASS
strict_tdd_runtime: PASS_WITH_PROCESS_WARNINGS
```

### Issues Found

**CRITICAL**

None.

**WARNING**

1. The planning handoff stated 35 scenarios, but the actual retrieved specs contain 36. This report uses the authoritative measured total.
2. Review-size design commitments were not met: four of five delivered commits exceed the 400 changed-line budget, despite the original two-slice `<400` plan.
3. Strict-TDD history is partially non-demonstrative for tasks 1.6, 2.6, and 2.7: their tests are substantive and pass now, but earlier tasks had already made the behavior green before those task-level RED runs.

**SUGGESTION**

1. Clean the nine Biome warnings in changed tests, especially the six non-null assertions in parity setup.
2. Correct planning metadata and future slice forecasts using actual fixture/signature ripple before implementation begins.

### Verdict

**PASS WITH WARNINGS**

All 18 tasks are complete, all 7 requirements and all 36 measured scenarios have passing runtime evidence, the full gate and standalone tests passed with the expected 1243 passed and 6 skipped, live-PostgreSQL fencing and restart suites passed 50/50 sequentially, and every cross-cutting invariant holds. Remaining findings concern planning accuracy, review size, and historical TDD process evidence; none is a specification or runtime blocker.
