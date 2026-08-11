# Tasks: Supervisor Recovery

TDD: RED→GREEN per task. `T=PATH=/data/node24/bin:$PATH pnpm test`; live-PG tasks (🏭) require `pnpm vitest run --no-file-parallelism` with docker PG up. Est. ~950 lines authored across 5 slices; largest slice ~340 lines.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (authored) | ~950 |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Slice count | 5 |
| Largest slice (lines) | Slice 2: ~340 |
| Threat/complex task isolated | Yes (task 4.1) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Durable undo log + sandbox port | PR 1 | `$T packages/app/test/sandbox/file-document-sandbox.test.ts` | `$T packages/app/test/sandbox/sandbox-durable-restart.integration.test.ts --no-file-parallelism` (🏭) | Revert PR 1; undo-log JSON inert, sandbox-port.ts additive |
| 2 | Designation + discovery | PR 2 | `$T packages/database/test/sql-migrations.test.ts` | `$T packages/database/test/business-pg-roundtrip.integration.test.ts --no-file-parallelism` (🏭) | Revert PR 2; migration column DEFAULT false inert |
| 3 | W2 journal abort + recovery reconcile | PR 3 | `$T packages/app/test/worker-restart.test.ts` | `$T packages/app/test/parity.test.ts` (parity gate 5) | Revert PR 3; markRetryable widened trigger is uniform |
| 4 | Recovery dispatch seam + supervisor wiring | PR 4 | `$T packages/app/test/daemon/byte-identity.test.ts` | `$T packages/app/test/composition/supervisor-recovery-wiring.test.ts` | Revert PR 4; extraction isolated + callback optional |
| 5 | E2E + reframed tests + live-PG | PR 5 | `$T packages/app/test/dispatch/dispatch.test.ts` | `$T packages/app/test/e2e/recovery-e2e.integration.test.ts --no-file-parallelism` (🏭) | Revert PR 5; test-only, no production code touched |

## Slice 1 — Durable undo log + sandbox port (Foundation — W3 prerequisite)

- [x] 1.1 RED `packages/app/test/sandbox/sandbox-port.test.ts`: `SandboxPort` exposes `snapshotUndoLog(): readonly EffectRecord[]`. GREEN: `packages/app/src/sandbox/sandbox-port.ts` — add method signature to interface. (R: sandbox-port "Universal Reversibility and Undo Log"; scenarios: "Undo log reflects applied state", "Snapshot returns applied entries")
- [x] 1.2 RED `packages/app/test/sandbox/file-document-sandbox.test.ts`: `execute` persists undo-log entry to `<rootDir>/.io/undo-log.json` before returning; fresh instance over same rootDir reconstructs prior entries. GREEN: `packages/app/src/sandbox/file-document-sandbox.ts` — add `durabilityPath` (default `<rootDir>/.io/undo-log.json`), `persist()` after `execute`/`undo`, `restore()` on construct, JSON `{counter, undoLog}`. (R: sandbox-port; scenarios: "Execute persists recovery evidence", "Restart reconstructs the undo log")
- [x] 1.3 RED `packages/app/test/sandbox/file-document-sandbox.test.ts`: `undo` persists removal; `snapshotUndoLog()` returns currently-applied entries only (excludes undone); counter survives restart; second `execute` increments counter. GREEN: `packages/app/src/sandbox/file-document-sandbox.ts` — `snapshotUndoLog()` method, undo triggers `persist()`, counter included in JSON. (R: sandbox-port; scenarios: "One undo entry per executed effect", "Snapshot returns applied entries")
- [x] 1.4 RED `packages/app/test/parity.test.ts` (B11 parity 5 — sandbox undo-log): `FileDocumentSandbox.snapshotUndoLog` ≡ `DurableSandboxFake.snapshotUndoLog` ≡ `InMemorySandbox.snapshotUndoLog` for applied/undone/no-effect states. GREEN: parity gate wiring. (R: sandbox-port; fake↔production parity)
- [x] 1.5 RED 🏭 `packages/app/test/sandbox/sandbox-durable-restart.integration.test.ts`: live `FileDocumentSandbox` over real temp dir survives simulated restart — undo log + counter reconstructed from JSON, effects re-playable. GREEN: confirmation. (R: sandbox-port; scenario: "Restart reconstructs the undo log" — live verification)
- [x] 1.6 Gate: `$T pnpm check` GREEN for slice 1.

## Slice 2 — Designation + discovery (migration + pure CAS + port + PG/fake parity)

- [x] 2.1 RED `packages/database/test/sql-migrations.test.ts`: migration 011 adds `recovery_requested BOOLEAN NOT NULL DEFAULT false` to work table + partial index `WHERE recovery_requested AND state='in_progress'`, idempotent (`IF NOT EXISTS`). GREEN: `packages/database/sql/011_recovery_designation.sql`. (R: work-lifecycle "Operator Recovery Designation")
- [x] 2.2 RED `packages/business-domain/test/work/request-recovery.test.ts`: operator designates `in_progress` Work — version bumps N→N+1, state unchanged `in_progress`, token preserved; stale expectedVersion → `version-conflict`; empty companyId rejected; domain `Work` type unchanged (no `recoveryRequested` field). GREEN: `packages/business-domain/src/use-cases/request-recovery.ts` — non-transition CAS use-case (`setRecoveryRequest` plain CAS, state unchanged), zero `@io/*` imports. (R: work-lifecycle; scenarios: "Designation preserves lifecycle state", "Designation fences stale-version zombies without a new token", "Recovery metadata stays outside Work", "Unresolved escalation permits explicit re-designation")
- [x] 2.3 RED `packages/business-domain/test/ports/repositories.test.ts`: `WorkRepository.listRecoveryRequestedByCompany(companyId)` returns only `in_progress` + `recovery_requested=true`; `setRecoveryRequest(companyId, workId, expectedVersion, requested)` returns typed `CasResult`, empty `companyId` rejected. GREEN: `packages/business-domain/src/ports/repositories.ts` — add method signatures; `packages/business-domain/src/ports/fakes.ts` — `InMemoryWorkRepository` implementation (marker `Map`, partial-index semantics). (R: work-lifecycle; scenario: "Recovery metadata stays outside Work")
- [x] 2.4 RED `packages/database/test/business-adapters.test.ts`: PG `listRecoveryRequestedByCompany` uses partial index + returns only `in_progress`; `setRecoveryRequest` CAS bumps version, sets/clears `recovery_requested`, returns typed `CasResult`; `parseWorkRow` parses `recovery_requested` as boolean (default false). GREEN: `packages/database/src/work-adapter.ts` — add both methods (SQL: `WHERE recovery_requested AND state='in_progress'` + `UPDATE … SET recovery_requested=$N, version=version+1 WHERE … AND version=$M`); `packages/database/src/row-guards.ts` — parse `recovery_requested`; `packages/database/test/connection-fake.ts` — SELECT parser extended for bare-boolean + literal WHERE conditions. (R: work-lifecycle; PG parity with fake from 2.3)
- [x] 2.5 RED `packages/app/test/parity.test.ts` (B11 parity 6 — designation): `InMemoryWorkRepository` ≡ `PgWorkRepository` for `listRecoveryRequestedByCompany` + `setRecoveryRequest` CAS (matching, stale, absent, cross-tenant, non-in_progress, clear+re-designate). GREEN: parity gate. (R: work-lifecycle; fake↔PG parity)
- [x] 2.6 Gate: `$T pnpm check` GREEN for slice 2.

## Slice 3 — W2 journal abort + recovery reconcile (finalize no-effect branch + recovery matrix)

- [x] 3.1 RED `packages/app/test/worker-finalize.test.ts`: `reconcilePostEffectFailure` no-effect branch (`in_progress` + `effect.applied===false`) calls `journal.markRetryable(attemptId, retainedToken)` and returns `cas-lost-retryable` (NOT `recovery-required`). GREEN: `packages/app/src/worker/finalize.ts` — `reconcilePostEffectFailure` no-effect branch: `markRetryable` with retained token → `{ ok: false, reason: 'cas-lost-retryable', current }`. (R: idempotency-journal "Retryable Marker on Finalize CAS Loss"; scenarios: "W2 abort requires no preceding undo", "Marker is distinct from in-flight and completed")
- [x] 3.2 RED `packages/app/test/worker-restart.test.ts:171-206`: RED→GREEN flip — crash after `insertInFlight` BEFORE effect now returns `cas-lost-retryable` with marker `aborted_retryable` (NOT `recovery-required` with row stuck `in_flight`). Assert marker persisted, no undo called. GREEN: verification — the widened `markRetryable` trigger in `reconcilePostEffectFailure` resolves W2 through `recoverInFlightWork`'s shared reconcile path. (R: worker-cycle "Journal-Anchored Reconciliation"; scenario: "W2 becomes retryable without undo")
- [x] 3.3 RED `packages/app/test/worker-restart.test.ts`: W1 (no journal row, entry===undefined) returns `{ ok: false, reason: 'resume' }` (new typed outcome) when called from supervisor context (NOT `UNRESOLVED_REQUIRES_HUMAN`). Verify token retained, no journal write. GREEN: `packages/app/src/worker/recover.ts` — W1 branch returns `{ ok: false, reason: 'resume' }` when `entry===undefined`; widen `RecoveryResult` union type. (R: worker-cycle; scenario: "W1 resumes with no journal row")
- [x] 3.4 RED `packages/app/test/worker-recovery-matrix.test.ts`: full W1/W2/W3 recovery matrix — W1→resume, W2→markRetryable→cas-lost-retryable, W3→undo→markRetryable→cas-lost-retryable, missing-evidence→UNRESOLVED, idempotent re-tick, stale-token→rejected, terminal-Work→UNRESOLVED, already-aborted_retryable→recovery-required, already-completed→replay. GREEN: `packages/app/src/worker/recover.ts` — supervisor entry point dispatching per-window; reuses `recoverInFlightWork` + retained token read. (R: worker-cycle + io-persistence-recovery-contract; scenarios: W3 undoes, unresolvable terminal, CAS loss applied-effect, stale token rejected, missing evidence escalates, idempotent on re-tick, W1 resumes, W2 abort retryable, W3 compensates, unsafe escalates — 10 scenarios)
- [x] 3.5 RED `packages/app/test/parity.test.ts` (B11 parity 5 — journal no-effect reconcile): `reconcilePostEffectFailure` no-effect → `markRetryable` parity: fake (`InMemoryJournal`) ≡ PG (`PgIdempotencyJournalRepository`) for matching/stale token outcomes. GREEN: parity gate threading. (R: idempotency-journal; scenario: "Fake and PostgreSQL parity")
- [x] 3.6 Gate: `$T pnpm check` GREEN for slice 3.

## Slice 4 — Recovery dispatch seam + supervisor tick wiring (ISOLATED complex extraction)

- [x] 4.1 🔴 ISOLATED RED `packages/app/test/daemon/byte-identity.test.ts`: baseline byte-identity pin for extracted `runClaimedWork` — the post-claim body (steps 2–7: authority→intent→reconcile→effect→verify→finalize) produces identical compiled bytes. GREEN: `packages/app/src/worker/worker.ts` — extract `runClaimedWork(work, deps, model)` containing steps 2–7; `runWorker` calls it after claim gate (steps 1 unchanged). Re-verify byte-identity pins match baseline. **This is the design-flagged complex extraction — run solo, never bundled.** (R: work-dispatch "Designated Recovery Dispatch"; design D5 extraction seam)
- [x] 4.2 RED `packages/app/test/dispatch/dispatch.test.ts`: `dispatchRecovery(companyId, work, deps, model)` resumes `in_progress` Work through `runClaimedWork` — no claim, no token mint, same `wk:` key + SHA-256 hash as normal dispatch, context/cohort prefix unchanged. GREEN: `packages/app/src/dispatch/dispatch.ts` — add `dispatchRecovery` function: derives `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor` from Work, calls `runClaimedWork(work, deps.worker, model)`, returns `DispatchResult`. (R: work-dispatch; scenarios: "Recovery resumes without re-claim", "Recovery reuses dispatch identity", "Recovery preserves LLM context")
- [x] 4.3 RED `packages/app/test/supervisor/tick.test.ts`: `onRecovery(companyId)` runs after `onActivate`, before `cursors.upsert`; recovery failure leaves cursor unadvanced (retryable); `onRecovery` runs on both `activate` and `no-llm-heartbeat` branches; runs exactly once per company per tick; companies processed sequentially. GREEN: `packages/app/src/supervisor/types.ts` — add `OnRecovery = (companyId: string) => void | Promise<void>`, add `onRecovery?` to `StartSupervisorOptions` (`SupervisorDeps` UNCHANGED); `packages/app/src/supervisor/tick.ts` — invoke `await onRecovery?.(companyId)` after `onActivate` block, before `cursors.upsert`. (R: supervisor-timer "Sequential Checkpointed Tick"; scenarios: all 10 tick ordering scenarios)
- [x] 4.4 RED `packages/app/test/composition/supervisor-recovery-wiring.test.ts`: composition builds `onRecovery` closure over work/journal/sandbox — `listRecoveryRequestedByCompany` → for each: `work.get` → if `in_progress`: `recoverInFlightWork` → if resume: `dispatchRecovery` → `setRecoveryRequest(clear)`; marker cleared on success/escalation; `requestRecovery` wired as admin entry. GREEN: `packages/app/src/composition/supervisor-dispatch.ts` — build `onRecovery` closure; `packages/app/src/composition/worker-deps.ts` — `FileDocumentSandbox(sandboxRoot, durabilityPath)`. (R: supervisor-timer + composition wiring)
- [x] 4.5 Gate: `$T pnpm check` GREEN for slice 4. Verify `worker.ts` byte-identity pins unchanged from baseline.

## Slice 5 — E2E + reframed tests + live-PG (🏭 requires docker PG)

- [x] 5.1 RED `packages/app/test/dispatch/dispatch.test.ts:215-231`: reframe scenario name to "Normal dispatch never auto-resumes an orphan (R6)" — dispatch STILL excludes `in_progress` Work, zero LLM requests, zero journal rows, Work untouched. GREEN: update scenario name + spec reference; assertion body unchanged (behavior preserved). (R: work-dispatch "Crash-Recovery Non-Guarantee"; scenarios: "Normal dispatch never auto-resumes an orphan", "Supervisor recovery is a separate path")
- [x] 5.2 RED `packages/app/test/worker-restart.test.ts:171-206`: verify W2 dead-end flip — crash after `insertInFlight` before effect now asserts `cas-lost-retryable` with marker `aborted_retryable` (replaces `recovery-required` with row stuck `in_flight`). GREEN: confirmation from slice 3.2 change. (R: worker-cycle; scenario: "W2 becomes retryable without undo" — verification)
- [x] 5.3 RED 🏭 `packages/app/test/e2e/recovery-e2e.integration.test.ts`: full supervisor recovery E2E — designate orphaned `in_progress` Work → tick discovers → W2 journal reconcile (markRetryable) → `dispatchRecovery` resumes → effect→verify→finalize → completed, exactly one receipt, journal `completed`. GREEN: e2e harness (seed Work, designate, pump supervisor tick, assert completion). (R: io-persistence-recovery-contract "Recovery Matrix"; E2E proof)
- [x] 5.4 RED 🏭 `packages/app/test/sandbox/sandbox-durable-restart.integration.test.ts`: live-PG path — `FileDocumentSandbox` durability survives simulated process restart; undo log + counter restored from `.io/undo-log.json`. GREEN: live-PG verification. (R: sandbox-port; live-PG parity)
- [x] 5.5 RED 🏭 `packages/database/test/business-pg-roundtrip.integration.test.ts`: designation→list→recovery roundtrip against live PG — `setRecoveryRequest` CAS, `listRecoveryRequestedByCompany` partial-index query, marker cleared on completion. GREEN: migration 011 applied in PG setup, live verification. (R: work-lifecycle; PG roundtrip)
- [x] 5.6 Full gate: `$T pnpm vitest run --no-file-parallelism` all live-PG tasks GREEN; `$T pnpm check` GREEN.

## Requirement Coverage Trace

| Requirement | Scenarios | Tasks |
|---|---|---|
| sandbox-port: Universal Reversibility and Undo Log | 5 | 1.1–1.5 |
| idempotency-journal: Retryable Marker on Finalize CAS Loss | 7 | 3.1, 3.2, 3.4, 3.5 |
| worker-cycle: Journal-Anchored Reconciliation | 8 | 3.2–3.4, 5.2 |
| supervisor-timer: Sequential Checkpointed Tick | 10 | 4.3, 4.4 |
| work-lifecycle: Operator Recovery Designation | 4 | 2.1–2.5 |
| io-persistence-recovery-contract: Recovery Matrix | 5 | 3.4, 5.3 |
| work-dispatch: Designated Recovery Dispatch | 3 | 4.1, 4.2 |
| work-dispatch: Crash-Recovery Non-Guarantee | 2 | 5.1 |
| **Total** | **44** | **29 tasks** |
