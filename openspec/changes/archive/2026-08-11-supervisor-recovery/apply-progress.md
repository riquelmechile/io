# Apply Progress: supervisor-recovery — Slice 1 (Durable undo log + sandbox port)

> Phase: APPLY — Slice 1 only (tasks 1.1–1.6). Strict TDD (RED→GREEN per task).
> Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm vitest run`.
> Status: SLICE 1 COMPLETE — `pnpm check` GREEN.

## Summary

Made the production sandbox's undo log survive a process restart: `SandboxPort`
now exposes `snapshotUndoLog(): readonly EffectRecord[]` and the shipped
`FileDocumentSandbox` persists its `{counter, undoLog}` state to
`<rootDir>/.io/undo-log.json` after every mutation, restoring it on construct.
Parity gate (B11 parity 5) pins `FileDocumentSandbox` ≡ `DurableSandboxFake` ≡
`InMemorySandbox` for applied/undone/no-effect snapshot behavior. This is the
W3 prerequisite: recovery can now distinguish "effect applied" from "effect
never ran" across a process restart.

## Tasks done

- [x] 1.1 Port exposes `snapshotUndoLog()` — RED `test/sandbox/sandbox-port.test.ts` (3 tests) → GREEN `sandbox-port.ts` interface member.
- [x] 1.2 `execute` persists undo-log entry to `<rootDir>/.io/undo-log.json` before returning; fresh instance reconstructs — RED (runtime: no JSON file) → GREEN `file-document-sandbox.ts` (`durabilityPath`, `persist()`, `restore()`, JSON `{counter, undoLog}`).
- [x] 1.3 `undo` persists removal; `snapshotUndoLog()` applied-only; counter survives restart; second execute increments — RED → GREEN (`persist()` in `undo`, counter in JSON).
- [x] 1.4 Parity gate B11 parity 5 — RED → GREEN in `test/parity.test.ts` (3 tests).
- [x] 1.5 Live filesystem restart integration — RED → GREEN `test/sandbox/sandbox-durable-restart.integration.test.ts` (no PG needed; filesystem durability only).
- [x] 1.6 Gate: `pnpm check` GREEN (format → typecheck → build → lint → test).

## Files changed

### Production (slice-1 scope only)

| File | Change |
|------|--------|
| `packages/app/src/sandbox/sandbox-port.ts` | `SandboxPort` gains `snapshotUndoLog(): readonly EffectRecord[]`. |
| `packages/app/src/sandbox/file-document-sandbox.ts` | `durabilityPath` (default `<rootDir>/.io/undo-log.json`), `persist()` after `execute`+`undo`, `restore()` on construct, `snapshotUndoLog()`. No-leak preserved: a persist failure reverses the file AND drops the in-memory entry. |

### Test doubles (forced by the port interface widening — `implements SandboxPort`)

| File | Change |
|------|--------|
| `packages/app/test/worker-helpers.ts` | `RecordingSandbox.snapshotUndoLog()` delegates to inner. |
| `packages/app/test/app-boundary.test.ts` | `TraceSandbox.snapshotUndoLog()` delegates to inner. |
| `packages/app/test/worker-verify.test.ts` | `TraceSandbox.snapshotUndoLog()` delegates to inner. |
| `packages/app/test/worker-effect.test.ts` | `InTxAwareSandbox.snapshotUndoLog()` delegates to inner. |

### New tests (ship with code, strict TDD)

| File | Tests | Covers |
|------|-------|--------|
| `packages/app/test/sandbox/sandbox-port.test.ts` | 3 | Port contract: snapshot returns applied entries, excludes undone, empty fresh. |
| `packages/app/test/sandbox/file-document-sandbox.test.ts` | 6 | execute persists before returning; fresh instance reconstructs; undo persists removal; snapshot applied-only; counter survives restart + increments; persist-failure no-leak. |
| `packages/app/test/sandbox/sandbox-durable-restart.integration.test.ts` | 1 | Live fs simulated restart: undo log + counter reconstructed, effects re-playable. |
| `packages/app/test/parity.test.ts` (B11 parity 5) | 3 | FileDocumentSandbox ≡ DurableSandboxFake ≡ InMemorySandbox for applied/undone/no-effect. |

## Test evidence

- RED phase: 10 failed (3 port-contract runtime + 6 file-document + 1 integration — the port tests fail at TYPECHECK level: `TS2339 Property 'snapshotUndoLog' does not exist on type 'SandboxPort'/'FileDocumentSandbox'`), parity 5 runtime-fails (no method). All RED tests reference production surface that did not exist yet.
- GREEN phase (focused): `pnpm vitest run packages/app/test/sandbox packages/app/test/parity.test.ts` → **5 files, 34 tests passed** (3 new port + 6 new file-document + 1 new integration + 24 parity incl. 3 new parity-5).
- Full suite after slice: `pnpm check` → **Test Files 79 passed | 17 skipped (96); Tests 1147 passed | 112 skipped (1262)**.
- Baseline full suite (pre-slice, with new test files present but production unchanged): 1137 passed, 7 failed (the 7 new durability RED tests), 112 skipped. Net: **+10 passing** (7 RED→GREEN + 3 port contract that were type-RED, now green), 13 new test cases.
- Live-PG suites skip cleanly without docker (pre-existing behavior, `fileParallelism: false` already global in `vitest.config.ts`).

## Gate verdict

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN (exit 0)**:
- `format-check` ✅ (201 files, 1 fixed by `pnpm format`)
- `typecheck` ✅ (`tsc -p tsconfig.json`, exit 0)
- `build` ✅
- `lint` ✅ (0 errors; 9 pre-existing warnings, verified identical on stashed baseline)
- `test` ✅ 1147 passed, 112 skipped

## Deviations / notes

1. **Test-double widening**: adding `snapshotUndoLog()` to the `SandboxPort` interface forces every `implements SandboxPort` class to provide it. Four test doubles (worker-helpers, app-boundary, worker-verify, worker-effect) got 1-line delegating implementations. `recover.ts` was NOT touched (slice 3) — its `SandboxPort & { snapshotUndoLog() }` intersection still typechecks (redundant but valid).
2. **No-leak ordering**: `execute` writes the effect file → records the in-memory entry → persists JSON. If `persist()` throws (e.g. durabilityPath under a file — ENOTDIR), the file is reversed AND the entry dropped, so no leak survives and the snapshot stays truthful. Covered by the dedicated "durability-persist failure" test.
3. **fsync window**: persistence uses `writeFileSync` (OS page-cache durability). `fdatasyncSync` deliberately NOT added — the spec defers physical-media durability; process-restart durability is the contract.
4. **Durability parity scope**: parity is on undo-log SNAPSHOT behavior, not storage medium — `absolutePath` is excluded from the compared shape (production resolves real tmp paths; fakes use a virtual FS).
5. Workload guard: slice-1 authored production delta ≈ 90 lines (port + adapter), within the 220-line budget; tests ship with code per strict TDD.

## Risks for reviewer

- **persist/no-leak ordering** (file-document-sandbox.ts `execute`): persist failure reverses file + drops entry — verify the guard `if (this.undoLog.applied(...))` and that a `record()` failure (FailingUndoLog path) still surfaces the ORIGINAL error.
- **fsync window**: a crash between the effect-file write and the undo-log JSON write could still lose evidence (page-cache only). Accepted by spec; flagged for the reviewer.
- **Undo persist failure**: `undo()` reverses + removes the entry, then persists; a persist throw propagates (mirrors `DurableSandboxFake`). Reviewer may scrutinize whether undo should swallow persist errors (we mirror the fake — fail loud).
- **Default durabilityPath** now writes `.io/undo-log.json` under `sandboxRoot` in production composition (`worker-deps.ts` constructs with default) — additive, jailed under root; slice 4 will pass an explicit path.

---

# Apply Progress: supervisor-recovery — Slice 2 (Designation + discovery)

> Phase: APPLY — Slice 2 only (tasks 2.1–2.6). Strict TDD (RED→GREEN per task).
> Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm vitest run`; live-PG UP (docker `io_pg`, postgres:18.4).
> Status: SLICE 2 COMPLETE — `pnpm check` GREEN (exit 0).

## Summary

Added the operator recovery designation capability: migration 011 adds an
inert `work.recovery_requested` boolean column + partial index; a pure domain
use-case (`requestRecovery`) performs a plain CAS designation (version N→N+1,
state UNCHANGED, fencing token PRESERVED — the version bump fences a
stale-version zombie's terminal close without minting a new token); the
`WorkRepository` port gains `setRecoveryRequest` (marker CAS) +
`listRecoveryRequestedByCompany` (partial-index discovery); both are
implemented in the in-memory fake and the PG adapter with B11 parity 6
pinning fake ≡ PG. The domain `Work` type stays PURE — no `recoveryRequested`
field anywhere on the entity.

## Tasks done

- [x] 2.1 Migration 011 — RED `sql-migrations.test.ts` (4 tests) → GREEN `packages/database/sql/011_recovery_designation.sql`. Live-applied to PG twice (idempotent); partial index verified (`indpred` non-null).
- [x] 2.2 Use-case — RED `business-domain/test/work/request-recovery.test.ts` (14 tests) → GREEN `request-recovery.ts` + `setRecoveryRequest` port signature + fake method (the use-case's runtime dependency) + exports.
- [x] 2.3 Port + fake — RED `business-domain/test/ports/repositories.test.ts` (11 tests) → GREEN `repositories.ts` `listRecoveryRequestedByCompany` + `fakes.ts` marker `Map` + partial-index list.
- [x] 2.4 PG adapter — RED `business-adapters.test.ts` (12 tests) → GREEN `work-adapter.ts` (2 methods), `row-guards.ts` (recoveryRequested boolean guard, default false), `connection-fake.ts` SELECT parser extended for bare-boolean + literal WHERE conditions (designation predicate round-trip).
- [x] 2.5 Parity — RED `parity.test.ts` B11 parity 6 (6 tests) → GREEN fake ≡ PG for matching/stale/absent/cross-tenant/non-in_progress/clear+re-designate.
- [x] 2.6 Gate — `pnpm check` GREEN (format → typecheck → build → lint → test).

## Files changed

### Production

| File | Change |
|------|--------|
| `packages/database/sql/011_recovery_designation.sql` | **Created** — `ALTER TABLE work ADD COLUMN IF NOT EXISTS recovery_requested BOOLEAN NOT NULL DEFAULT false` + partial index `idx_work_recovery_requested ON work (company_id) WHERE recovery_requested AND state='in_progress'`. Additive + inert (DEFAULT false), matches 010 precedent. |
| `packages/business-domain/src/use-cases/request-recovery.ts` | **Created** — non-transition CAS use-case. ZERO `@io/*` imports (relative imports only). Typed `UseCaseResult<Work>`, no throw-for-control-flow. Restricts designation to `in_progress` (invalid-transition otherwise); `requested` flag supports clear + explicit re-designation (spec S4). |
| `packages/business-domain/src/ports/repositories.ts` | `WorkRepository` gains `setRecoveryRequest(companyId, workId, expectedVersion, requested): Promise<CasResult>` + `listRecoveryRequestedByCompany(companyId): Promise<readonly Work[]>`. |
| `packages/business-domain/src/ports/fakes.ts` | `InMemoryWorkRepository` gains side marker `Map<string, boolean>` + both methods (partial-index list semantics: `state==='in_progress' && marker`). |
| `packages/business-domain/src/use-cases/index.ts` | Exports `requestRecovery` + command/result types. |
| `packages/business-domain/src/index.ts` | Public surface exports the use-case + types. |
| `packages/database/src/work-adapter.ts` | `PgWorkRepository` gains both methods. List: `WHERE company_id=$1 AND recovery_requested AND state='in_progress' ORDER BY id ASC` with `recovery_requested AS "recoveryRequested"` in the projection (parsed by the row guard, never a Work field). Set: `UPDATE work SET recovery_requested=$4, version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3`, rowCount→CasResult, version-conflict with current on 0 rows. |
| `packages/database/src/row-guards.ts` | `parseWorkRow` validates `recoveryRequested` is boolean when present; absent → default false (get/listActionable don't project it). Not added to the returned `Work`. |

### Test doubles / test infra

| File | Change |
|------|--------|
| `packages/database/test/connection-fake.ts` | `parseSelect` extended: WHERE conditions now split on `AND` and parsed as bound-param / `ANY($N)` / bare boolean column (`recovery_requested`) / literal (`state='in_progress'`, `true|false`). Required for the designation SELECT to round-trip. All existing shapes re-verified (full suite green). |
| `packages/app/test/parity.test.ts` | `RacingWorkRepository` gains 2 delegating methods (interface widening); B11 parity 6 block added. |
| `packages/app/test/worker-reconcile.test.ts` | `RacingWorkRepository` gains 2 delegating methods. |
| `packages/app/test/worker-finalize.test.ts` | `RacingWorkRepository` gains 2 delegating methods. |

### New tests (ship with code, strict TDD)

| File | Tests | Covers |
|------|-------|--------|
| `packages/database/test/sql-migrations.test.ts` (011 block) | 4 | Ships file; column `BOOLEAN NOT NULL DEFAULT false` + IF NOT EXISTS; partial index predicate; every statement idempotent. |
| `packages/business-domain/test/work/request-recovery.test.ts` | 14 | S1 state preserved + version N+1; S2 token preserved + stale version-N close fenced; stale expectedVersion → version-conflict; empty companyId rejected; invalid-command/not-found; invalid-transition on non-in_progress; S3 Work purity (type-level `never` guard + runtime key check + no new `in_progress` edge via `canTransitionWork`); S4 designate→clear→re-designate. |
| `packages/business-domain/test/ports/repositories.test.ts` | 11 | list partial-index semantics (mixed state/tenant, marker gate, leaves-in_progress exclusion, empty list, empty companyId before store read); setRecoveryRequest typed CasResult (matching/stale/absent/cross-tenant/clear+re-designate, empty companyId). |
| `packages/database/test/business-adapters.test.ts` (designation block) | 12 | List SQL shape + round-trip partial-index discovery; set SQL shape + CAS (version bump, state/token preserved, clear, stale, absent/cross-tenant, empty companyId before SQL); parseWorkRow boolean + default-false + corrupt rejection. |
| `packages/app/test/parity.test.ts` (B11 parity 6) | 6 | fake ≡ PG: matching, stale, absent, cross-tenant, designated non-in_progress never discovered, clear+re-designate. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/database/test/sql-migrations.test.ts` | Unit | ✅ 28/28 | ✅ Written (4 failed: file missing) | ✅ 32 passed | ✅ 4 cases (file/column/index/idempotency) | ➖ None needed |
| 2.2 | `packages/business-domain/test/work/request-recovery.test.ts` | Unit | ✅ 106/106 (business-domain suite) | ✅ Written (module missing — 0 ran) | ✅ 14 passed | ✅ 14 cases (4 spec scenarios + guards) | ➖ None needed |
| 2.3 | `packages/business-domain/test/ports/repositories.test.ts` | Unit | ✅ 109/109 | ✅ Written (8 failed: list method missing) | ✅ 11 passed (all 3 suites: 120) | ✅ 11 cases | ➖ None needed |
| 2.4 | `packages/database/test/business-adapters.test.ts` | Unit | ✅ 48/48 | ✅ Written (12 failed: methods missing) | ✅ 12 passed (3 files: 84) | ✅ 12 cases (SQL shape + round-trip + guards) | ✅ Parser union-narrowing fix after typecheck |
| 2.5 | `packages/app/test/parity.test.ts` | Unit | ✅ 16/16 (parity file) | ✅ Written (1st run failed on a TEST bug — wrong expectedVersion in seed, fixed) | ✅ 22 passed | ✅ 6 cases | ➖ None needed |
| 2.6 | gate | — | ✅ 1256 passed baseline | — | ✅ 1304 passed | — | — |

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm vitest run packages/business-domain/test packages/database/test packages/app/test/parity.test.ts packages/app/test/worker-reconcile.test.ts packages/app/test/worker-finalize.test.ts` → **31 files passed, 731 passed | 1 skipped (732)** |
| Runtime harness command/scenario and exact result | Migration 011 live-applied TWICE to `io_pg` → column `boolean NOT NULL DEFAULT false`, partial index with `indpred` non-null. Throwaway live-PG probe (`PgWorkRepository` over `PgDbConnection`): designate (v2→3, token 1 preserved) → discovered → stale designation fenced (`version-conflict`) → zombie close at v2 fenced (`version-conflict`) → clear (list empty). Full `pnpm check` with live PG UP → 1304 passed, live-PG suites ran (skipped 112→6). |
| Rollback boundary | Revert PR 2: drop migration 011 (inert column DEFAULT false), revert `work-adapter.ts`/`row-guards.ts`/`repositories.ts`/`fakes.ts`/`request-recovery.ts` + the 3 test-double delegate additions + connection-fake parser extension. No other slice's production file touched. |

## Test evidence (exact counts)

- Baseline full suite (PG UP, pre-slice-2): **Test Files 93 passed | 3 skipped (96); Tests 1256 passed | 6 skipped (1262)** — live-PG suites RAN (skipped collapsed from 112 → 6).
- After slice 2: **Test Files 95 passed | 3 skipped (98); Tests 1304 passed | 6 skipped (1310)**. Net **+48 passing** (4 + 14 + 11 + 12 + 6 = 47 new tests + 1 migrated count shift), 47 new test cases, 0 failures.
- Focused RED→GREEN per task recorded above; every RED run failed ONLY on the newly referenced surface.

## Gate verdict

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN (exit 0)**:
- `format-check` ✅ (204 files; 4 files auto-fixed once by `pnpm format`)
- `typecheck` ✅ (`tsc -p tsconfig.json`, exit 0)
- `build` ✅
- `lint` ✅ (9 warnings — identical set to slice-1 baseline: 6× parity noNonNullAssertion in pre-existing parity-3, 1× unused import in worker-reconcile, 2× unused param in business-pg-roundtrip; none in slice-2 authored code)
- `test` ✅ **1304 passed, 6 skipped** (live-PG suites ran)

## Deviations / notes

1. **Use-case calls `setRecoveryRequest`, not `updateIfVersion`**: tasks.md/design File-Changes table say the use-case uses "plain `updateIfVersion`", but `updateIfVersion` takes a `Work` and its SQL never writes `recovery_requested` — it cannot set the marker. The design's Interfaces section (authoritative) defines `setRecoveryRequest` as the plain version+1 CAS (no FencingDirective, state unchanged). The use-case delegates to it; the CAS mechanics are exactly "plain updateIfVersion semantics + marker". Task 2.2's task.md line was updated to reflect this.
2. **Parity block numbered B11 parity 6, not 5**: slice 1 already consumed "B11 parity 5" for the sandbox undo-log; numbering continues to 6 to avoid a collision.
3. **`WORK_TRANSITIONS` is module-private** (not exported); the "no new in_progress edge" assertion uses the public `canTransitionWork` guard (in_progress → completed is the ONLY true edge).
4. **connection-fake parser extension** (shared test double): `parseSelect` WHERE conditions are now split on `AND` and parsed generically (param / ANY / bare boolean / literal). Purely additive — every existing SQL shape re-verified by the full suite.
5. **Live-PG roundtrip tests deferred to task 5.5** (business-pg-roundtrip designation block, slice 5). Slice 2 proves the adapter against the in-memory connection + a throwaway live-PG probe + migration applied live; task 5.5 will ship the durable integration test.
6. **`setRecoveryRequest` PG impl re-reads the row after a matched CAS** to build the `CasResult` value (the method receives no Work object); a vanishing row after a matched CAS throws a fail-loud integrity error (claim-mint precedent, R4-001 boundary guard) — unreachable in practice.
7. Test-double widening: 3 `RacingWorkRepository` doubles (parity/worker-reconcile/worker-finalize) got 2 delegating methods because the `WorkRepository` interface widened (mirrors slice-1 SandboxPort precedent).

## Risks for reviewer

- **PG `setRecoveryRequest` success path does a post-CAS `get()`** — one extra SELECT per designation; the fail-loud vanish-throw is a boundary guard. Verify the value construction (`{ ...current, version: expectedVersion + 1 }`) matches fake parity in all cases.
- **connection-fake parser rewrite** — the highest-blast-radius change of the slice (shared across ~10 adapter test files). Full suite green, but scrutinize the condition-split (regex edge: column names/values containing "AND" would mis-split — none exist today).
- **`listRecoveryRequestedByCompany` SQL** uses the bare-boolean predicate `AND recovery_requested` — verify live PG actually uses the partial index (EXPLAIN in slice 5's roundtrip) and that the InMemoryDbConnection projection alias (`recovery_requested AS "recoveryRequested"`) stays in sync with `parseWorkRow`.
- **Marker lifecycle on terminal close**: a designated Work that completes keeps the stale marker in the side Map / PG column (partial index hides it). Slice 4's recovery flow clears it on success/escalation (design D2 data flow). Reviewer may confirm the inert-stale-marker semantics are acceptable until then.
- **Use-case `in_progress` guard**: `requestRecovery` rejects non-in_progress Work (invalid-transition). Clearing a marker on a terminal Work (design: "work.get → in_progress? no → clear marker") happens at the PORT level in slice 4, not through the use-case — confirm that split is honored.

---

# Apply Progress: supervisor-recovery — Slice 3 (W2 journal abort + recovery reconcile matrix)

> Phase: APPLY — Slice 3 only (tasks 3.1–3.6). Strict TDD (RED→GREEN per task).
> Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm vitest run`; live-PG UP (docker `io_pg`).
> Status: SLICE 3 COMPLETE — `pnpm check` GREEN (exit 0).

## Summary

Widened the `markRetryable` trigger (design D3): `reconcilePostEffectFailure`'s no-effect branch
(`in_progress` + `effect.applied===false`) now marks the attempt `aborted_retryable` with the
RETAINED token instead of leaving the row `in_flight` forever — un-sticking the W2 dead-end
(previously `recovery-required` with a permanently-stuck row). W1 (no journal row) now returns the
new typed `resume` outcome (design D7) instead of `UNRESOLVED_REQUIRES_HUMAN`. Added the supervisor
recovery entry point `recoverDesignatedWork(deps, work)` (design D5) that derives the journal
identity deterministically from the Work row (`wk:` key + SHA-256 hash + `att:` attemptId) and
dispatches per crash window. W3 undo failures now close honestly as `UNRESOLVED_REQUIRES_HUMAN`
(spec "Missing evidence or undo failure escalates"). B11 parity 7 pins the W2 reconcile outcome
fake ≡ PG for matching/stale tokens. The change is UNIFORM across CAS-loss/verify-fail/restart
(design "Migration / Rollout"), so the worker-verify no-effect pins flipped with it.

## Tasks done

- [x] 3.1 RED `worker-finalize.test.ts` (2 tests) → GREEN `finalize.ts`: no-effect branch calls `journal.markRetryable(attemptId, retainedToken)` → `{ ok:false, reason:'cas-lost-retryable', current }`. Also removed the now-dead `recovery-required` variants from `FinalizeResult` + `PostEffectReconcileResult` (the pre-effect `recovery-required` in worker.ts:187 is a DIFFERENT path — untouched).
- [x] 3.2 RED→GREEN flip `worker-restart.test.ts:171-206` (+ 2 uniform flips in `worker-verify.test.ts`): W2 no-effect → `cas-lost-retryable` + durable `aborted_retryable` marker, NO undo (was `recovery-required`, row stuck `in_flight`).
- [x] 3.3 RED `worker-restart.test.ts` (W1 test) → GREEN `recover.ts`: `entry===undefined` → `{ ok:false, reason:'resume' }`; `RecoveryResult` union widened.
- [x] 3.4 RED `worker-recovery-matrix.test.ts` (10 tests) → GREEN `recover.ts` (`recoverDesignatedWork` supervisor entry) + `finalize.ts` (W3 undo-failure catch → UNRESOLVED).
- [x] 3.5 RED `parity.test.ts` B11 parity 7 (2 tests) → GREEN (fake ≡ PG for matching/stale W2 reconcile).
- [x] 3.6 Gate: `pnpm check` GREEN — **1319 passed, 6 skipped** (live-PG ran).

## Files changed

### Production

| File | Change |
|------|--------|
| `packages/app/src/worker/finalize.ts` | `reconcilePostEffectFailure` no-effect branch: `markRetryable(input.attemptId, input.fencingToken)` (NO undo) → `cas-lost-retryable`. Applied branch: `sandbox.undo` wrapped in try/catch — undo failure → `journal.complete(UNRESOLVED)` → `UNRESOLVED_REQUIRES_HUMAN` (never re-execute). Removed dead `recovery-required` from `FinalizeResult` + `PostEffectReconcileResult`. |
| `packages/app/src/worker/recover.ts` | W1 branch (`entry===undefined`) → `{ ok:false, reason:'resume' }` (was UNRESOLVED). `RecoveryResult` widened with `resume`. NEW `recoverDesignatedWork(deps, work)` supervisor entry: derives `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor`/`attemptIdFor` from the Work row → `recoverInFlightWork` (retained token read fresh inside, D6). |

### Tests (ship with code, strict TDD)

| File | Change |
|------|--------|
| `packages/app/test/worker-finalize.test.ts` | +2 tests (no-effect → markRetryable → cas-lost-retryable; stale-token still claim-gated). |
| `packages/app/test/worker-restart.test.ts` | W2 test FLIPPED (cas-lost-retryable + durable marker, no undo); +1 W1 resume test (token retained, no journal write); header comment updated. |
| `packages/app/test/worker-verify.test.ts` | 2 no-effect tests FLIPPED (uniform change): direct reconcile + verify-fail cycle → cas-lost-retryable + marker. |
| `packages/app/test/worker-recovery-matrix.test.ts` | **NEW** — 10 tests: W1→resume, W2→markRetryable, W3→undo→markRetryable, undo-failure→UNRESOLVED, idempotent re-tick, stale-token→rejected, terminal-Work→UNRESOLVED, aborted_retryable→recovery-required, completed→replay, re-tick-after-escalation→replay. |
| `packages/app/test/parity.test.ts` | B11 parity 7 (+2): W2 reconcile matching/stale — `InMemoryIdempotencyJournalRepository` ≡ `PgIdempotencyJournalRepository` via `reconcilePostEffectFailure`. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `worker-finalize.test.ts` | Unit | ✅ 10/10 | ✅ 2 failed | ✅ 12 passed | ✅ 2 cases (+stale-gate) | ✅ removed dead union members |
| 3.2 | `worker-restart.test.ts` + `worker-verify.test.ts` | Unit | ✅ 4/4 (restart) | ✅ 3 failed (2 verify + 1 restart) | ✅ 26 passed (3 files) | ✅ 3 flips (uniform) | ➖ None needed |
| 3.3 | `worker-restart.test.ts` | Unit | ✅ 4/4 | ✅ 1 failed | ✅ 5 passed | ✅ 1 case + existing W2/W3 cases | ➖ None needed |
| 3.4 | `worker-recovery-matrix.test.ts` | Unit | N/A (new) | ✅ 10 failed (entry missing) | ✅ 10 passed | ✅ 10 scenarios | ✅ lint fixes (unused import/var/param) |
| 3.5 | `parity.test.ts` | Unit | ✅ 22/22 | ✅ 2 failed | ✅ 24 passed | ✅ 2 cases (matching/stale) | ✅ seed fix (local acceptedWork takes no overrides) |
| 3.6 | gate | — | ✅ 1304 baseline | — | ✅ 1319 passed | — | — |

### Test Summary

- **Total tests written**: 15 new + 3 flipped (2 verify + 1 restart)
- **Total tests passing**: 1319 (baseline 1304, +15)
- **Layers used**: Unit (15)
- **Approval tests**: 3 behavior-change flips (W2 no-effect semantics) — the strict-TDD "update the approval test to reflect NEW expected behavior" path
- **Pure functions created**: 0 new (entry point is a coordinator; identity derivation reuses existing pure `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor`/`attemptIdFor`)

## Test evidence (exact counts)

- Baseline (PG UP, pre-slice-3): Test Files 95 passed | 3 skipped (98); Tests 1304 passed | 6 skipped (1310).
- After slice 3: Test Files **96 passed | 3 skipped (99)**; Tests **1319 passed | 6 skipped (1325)**. Net **+15 passing** (2 + 1 + 10 + 2), 15 new test cases, 0 failures, live-PG suites ran.

## Gate verdict

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN (exit 0)**:
- `format-check` ✅ (205 files; 2 auto-fixed once by `pnpm format`)
- `typecheck` ✅ (`tsc -p tsconfig.json`, exit 0)
- `build` ✅
- `lint` ✅ (9 warnings — IDENTICAL set to slice-2 baseline: 6× parity noNonNullAssertion (pre-existing parity-3), 1× unused import worker-reconcile, 2× unused param business-pg-roundtrip; zero in slice-3 authored code)
- `test` ✅ **1319 passed, 6 skipped**

## Deviations / notes

1. **worker-verify.test.ts:230/:341 flipped as part of 3.2** (NOT listed in the task text): the widened trigger lives in the SHARED `reconcilePostEffectFailure`, and design "Migration / Rollout" explicitly declares the change "uniform across CAS-loss/verify-fail/restart". The two verify no-effect pins (direct reconcile + verify-fail cycle) asserted the OLD `recovery-required` behavior and broke the moment 3.1 landed — they were updated to the new marker semantics as part of the same behavior change.
2. **worker.ts comments at :200-201 are now stale** ("in_progress+no effect → clean replay (no undo) → recovery-required") but CANNOT be touched — `worker/worker.ts` is byte-identity pinned (daemon/byte-identity.test.ts) and any edit (even a comment) would drift the pin. The code path is unchanged (the call site returns `reconciled.reason`); only the shared reconcile's semantics changed. Flagged for the reviewer.
3. **Stale-token → rejected = fail-loud throw** (not a typed result): `markRetryable` (fake + PG) throws `fencing token mismatch`/0-row on a stale token. The matrix test asserts `rejects.toThrow` + row unchanged — consistent with the PRE-EXISTING pinned contract in worker-finalize.test.ts:379 (`rejects.toThrow(/fencing token mismatch/i)`, R4-001 "fail loud"). The worker-cycle spec's "typed failure" is realized as the fail-loud rejection; the supervisor composition (slice 4) must treat it as an escalation.
4. **`FinalizeResult`/`PostEffectReconcileResult` lost their `recovery-required` variants**: finalize never returns it post-change (worker.ts:187's pre-effect `recovery-required` is `WorkerResult` — untouched). Typecheck proves no caller depended on the dead variant.
5. **Parity seed gotcha**: parity.test.ts defines its OWN `acceptedWork()` with NO overrides param — passing `{ state: 'in_progress' }` was silently ignored at runtime (esbuild strips types) → the reconcile saw `accepted` state and returned UNRESOLVED. Fixed by seeding the Work object explicitly (this is why RED ran green-logic).
6. **Undo-failure → UNRESOLVED catch** added to the applied branch: NEW behavior beyond the no-effect widening, required by the matrix scenario "missing-evidence→UNRESOLVED" (worker-cycle spec "Missing evidence or undo failure escalates"). No existing test pinned undo-throw propagation.
7. `recoverDesignatedWork` imports `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor` (dispatch/keys.ts — NOT dispatch.ts, which is slice 4's byte-pinned territory) and `attemptIdFor` (worker/intent.ts). dispatch.ts, worker.ts, supervisor/, composition/ untouched.

## Work Unit Evidence

- Focused test command and exact result: `pnpm vitest run packages/app/test/worker-finalize.test.ts packages/app/test/worker-restart.test.ts packages/app/test/worker-verify.test.ts packages/app/test/worker-reconcile.test.ts packages/app/test/parity.test.ts packages/app/test/worker-recovery-matrix.test.ts` → **6 files passed, 91 passed (91)**.
- Runtime harness: N/A (no live-PG suite in this slice; PG stayed UP and the full `pnpm check` ran the live-PG suites — 6 skipped, identical to slice-2 baseline).
- Rollback boundary: revert PR 3 — revert `finalize.ts` (restore no-effect `recovery-required` + remove undo catch + restore union variants) and `recover.ts` (restore W1 UNRESOLVED, drop `recoverDesignatedWork`), revert the 4 test files' flips + delete `worker-recovery-matrix.test.ts` + remove parity 7. No other slice's production file touched (worker.ts byte-pin intact).

## Risks for reviewer

- **No-effect branch semantics** (the core change): verify the `markRetryable` trigger widening is correct for ALL three callers (finalize CAS-loss T2, verify-fail, restart recovery). The row now goes `in_flight → aborted_retryable` even with NO applied effect — the "Marker is distinct from in-flight and completed" spec scenario; the marker invites a controlled same-token retry (reopen), never a failure-complete. Scrutinize: can a no-effect `aborted_retryable` reopen cause a double effect? (Answer per design: no — the effect provably never ran; the reopen re-executes once under the same key.)
- **Token retention**: every reconcile write presents the RETAINED token (finalize: the worker's claim token; recovery: `work.fencingToken` read fresh in `recoverInFlightWork`). The stale-token matrix + parity 7 tests pin the claim gate. Verify no path re-mints (D6).
- **worker.ts stale comment** (lines 200-201): describes the OLD no-effect disposition. Deliberately NOT updated (byte-identity pin). Confirm the code path (return `reconciled.reason`) is what the tests assert.
- **Undo-failure catch**: the applied branch now swallows undo errors and closes UNRESOLVED (journal.complete seals the key — future same-key calls replay the sentinel). Verify "never re-execute without durable non-execution proof" holds and that the seal is the intended escalation (slice 4 must surface it).
- **`recoverDesignatedWork` identity derivation**: the journal key/hash/attemptId are deterministic functions of the Work row. If a designated Work's identity fields (delegationId/description) changed between the original dispatch and recovery, the derived hash would NOT match the original attempt's row — recovery would treat the old attempt as a DIFFERENT key and the reconcile would miss it. In practice the fields are lifecycle-stable (keys.ts contract); reviewer may scrutinize this assumption.
- **Stale-token throw propagation**: `recoverDesignatedWork` can THROW (fencing-token mismatch). The composition (slice 4) must catch/settle it or the tick cursor un-advances → hot retry. Flagged for slice 4.

---

# Apply Progress: supervisor-recovery — Slice 4 (Recovery dispatch seam + supervisor wiring)

> Phase: APPLY — Slice 4 only (tasks 4.1–4.5). Strict TDD (RED→GREEN per task).
> Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm vitest run`; live-PG UP (docker `io_pg`).
> Status: SLICE 4 COMPLETE — `pnpm check` GREEN (exit 0). **1340 passed, 6 skipped.**

## Summary

Built the recovery dispatch seam + supervisor wiring: the worker's post-claim
body (steps 2–7) is extracted to `runClaimedWork` (design D5) with a
BYTE-IDENTITY-PROVEN mechanical extraction; `dispatchRecovery` resumes a
designated `in_progress` orphan through that seam WITHOUT re-claiming (retained
token, deterministic `wk:` identity); the supervisor tick gains the optional
`onRecovery(companyId)` callback (after `onActivate`, before the checkpoint, on
BOTH decision branches) with `SupervisorDeps` UNCHANGED; and the composition
root builds the `onRecovery` closure over work/journal/sandbox —
discover → reconcile (W1/W2/W3) → resume → clear marker — plus the
`requestRecovery` admin designation entry. The production sandbox now receives
its durability path explicitly (`worker-deps.ts`). All 21 new tests ship with
code; `pnpm check` GREEN with the byte-identity pins re-verified (the
normalization proofs show the ONLY allowed drift in each pinned source).

## Tasks done

- [x] 4.1 🔴 ISOLATED byte-identity extraction — RED `byte-identity.test.ts` (2 failed: the reverse-inline proof + the chained PR2 proof) → GREEN `worker/worker.ts`: `runClaimedWork(work, deps, model, cmd)` holds steps 2–7 VERBATIM (body byte-identical, only an identity-const preamble added); `runWorker` calls it after the claim gate. Pins re-verified: `worker.ts` 32f55a40 → **936ada78**; the reverse-inline normalization (`inlineRunClaimedWork`) restores the slice-3 baseline exactly.
- [x] 4.2 RED `dispatch.test.ts` (3 failed: `dispatchRecovery is not a function`) → GREEN `dispatch/dispatch.ts`: `dispatchRecovery(companyId, work, deps, model)` derives `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor` from the Work and calls `runClaimedWork(work, deps.worker, model, {identity})` → `DispatchResult`. `dispatch.ts` pin b8a0de46 → **7e48fbd7**; strip-normalization proves the ONLY drift is the additive function + import.
- [x] 4.3 RED `supervisor/supervisor.test.ts` (5 failed) → GREEN `supervisor/types.ts` (`OnRecovery` + `onRecovery?` in `StartSupervisorOptions`, `SupervisorDeps` UNCHANGED), `supervisor/tick.ts` (`await onRecovery?.(companyId)` AFTER `onActivate`, BEFORE `cursors.upsert` — both branches), `supervisor/supervisor.ts` (threads `options.onRecovery`). Pins: tick aa5ddab3 → **e8f9c81a**, types 0e6a67b8 → **887648e0**, supervisor 5e7fa7cd → **9287e0ad**; strip-normalizations restore slice-3 bytes; PR1 chain updated.
- [x] 4.4 RED `composition/supervisor-recovery-wiring.test.ts` (NEW, 8 failed) → GREEN `composition/supervisor-dispatch.ts` (the `onRecovery` closure + `requestRecovery` admin entry) + `composition/worker-deps.ts` (`FileDocumentSandbox(sandboxRoot, undefined, durabilityPath)` with `durabilityPath?` input).
- [x] 4.5 Gate: `pnpm check` GREEN — format/typecheck/build/lint/test all pass; byte-identity pins verified unchanged (all 11 byte-identity tests green).

## Files changed

### Production

| File | Change |
|------|--------|
| `packages/app/src/worker/worker.ts` | Extract steps 2–7 to `runClaimedWork(work, deps, model, cmd)` (claim-gate-free seam); `runWorker` calls it after the claim gate (step 1 UNCHANGED). Body VERBATIM — purely mechanical. |
| `packages/app/src/worker/types.ts` | NEW `ClaimedWorkIdentity` type (companyId/workId/idempotencyKey/requestHash — the identity is CALLER-carried, never re-derived from Work). |
| `packages/app/src/dispatch/dispatch.ts` | NEW `dispatchRecovery(companyId, work, deps, model)` — direct resume through `runClaimedWork`, deterministic `wk:` identity, retained token, `DispatchResult` return. |
| `packages/app/src/supervisor/types.ts` | NEW `OnRecovery = (companyId) => void\|Promise<void>`; `onRecovery?` in `StartSupervisorOptions`; `TickCompany` widened. `SupervisorDeps` UNCHANGED (invariant #4). |
| `packages/app/src/supervisor/tick.ts` | `await onRecovery?.(companyId)` after the `onActivate` block, before `cursors.upsert` — both decision branches, exactly once per company per tick. |
| `packages/app/src/supervisor/supervisor.ts` | Threads `options.onRecovery` into `tickCompany`. |
| `packages/app/src/composition/supervisor-dispatch.ts` | Builds the `onRecovery` closure over work/journal/sandbox (`RecoverDeps`): `listRecoveryRequestedByCompany` → fresh `work.get` → terminal race-net clear → `recoverDesignatedWork` → RESUMABLE (`resume`\|`cas-lost-retryable`\|`recovery-required`) → `dispatchRecovery` (flash tier) → clear marker with FRESH version read; replay/UNRESOLVED/stale-token settle (marker cleared). Plus `requestRecovery` admin entry. |
| `packages/app/src/composition/worker-deps.ts` | `BuildWorkerDepsInput.durabilityPath?`; `new FileDocumentSandbox(sandboxRoot, undefined, input.durabilityPath)`. |

### Tests (ship with code, strict TDD)

| File | Tests | Covers |
|------|-------|--------|
| `packages/app/test/daemon/byte-identity.test.ts` | +4 | D5 mechanical-extraction proof (reverse-inline → slice-3 worker bytes); dispatch.ts additive-only proof; tick.ts onRecovery-only proof; supervisor.ts threading-only proof. PR1/PR2 chains updated. |
| `packages/app/test/dispatch/dispatch.test.ts` | +3 | Recovery resumes without re-claim (token/state/version untouched); reuses exact `wk:` key + SHA-256 hash + `att:` attemptId; preserves LLM context bytes + cohort prefix vs normal dispatch. |
| `packages/app/test/supervisor/supervisor.test.ts` | +6 | onRecovery order (append→activate→recover→upsert); runs on the no-llm branch (onActivate MUST NOT); throwing onRecovery leaves cursor unadvanced + retries; append failure precedes onRecovery; exactly-once per company per tick via startSupervisor; sequential through recovery. |
| `packages/app/test/composition/supervisor-recovery-wiring.test.ts` | +8 (NEW) | onRecovery/requestRecovery seam shape; W1 resume → COMPLETED end-to-end (in-memory DB fake + real FileDocumentSandbox; receipt + journal completed + marker cleared + durable undo-log file); W2 markRetryable → reopen → COMPLETED; completed-attempt replay settles (zero LLM); stale-token fail-loud settle (no throw, no hot retry); requestRecovery admin designation; terminal Work invisible to discovery; explicit durabilityPath honored by worker-deps. |
| `packages/app/test/daemon/daemon.test.ts` | mock widened | `buildDispatch` mock returns the full `{deps, onActivate, onRecovery, requestRecovery}` shape (recorded no-ops). |

## TDD Cycle Evidence

| Task | RED | GREEN | Test counts |
|------|-----|-------|-------------|
| 4.1 (SOLO) | byte-identity: 2 failed (reverse-inline proof + chained PR2 proof — `runClaimedWork` not found) | worker.ts extraction; 11 passed | worker/dispatch suites: 127 passed (behavior preserved) |
| 4.2 | dispatch.test.ts: 3 failed (`dispatchRecovery is not a function`) | dispatchRecovery; 12 passed (file) | — |
| 4.3 | supervisor.test.ts: 5 failed (onRecovery never invoked) | types/tick/supervisor; 24 passed (file) | — |
| 4.4 | supervisor-recovery-wiring.test.ts: 8 failed (`composed.onRecovery is not a function`) | supervisor-dispatch + worker-deps; 8 passed | — |
| 4.5 | — | — | **pnpm check GREEN: 1340 passed \| 6 skipped** |

## Test evidence (exact counts)

- Baseline full suite (PG UP, pre-slice-4, `ee0e572`): **96 files passed | 3 skipped (99); Tests 1319 passed | 6 skipped (1325)** — the slice-3 gate state.
- After slice 4: **97 files passed | 3 skipped (100); Tests 1340 passed | 6 skipped (1346)**. Net **+21 passing**, 21 new test cases (byte-identity +4, supervisor +6, dispatch +3, composition +8), 0 failures, live-PG suites ran (6 skipped — identical to slice-3 baseline).
- Focused RED→GREEN per task recorded above; every RED run failed ONLY on the newly referenced surface.

## Gate verdict

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN (exit 0)**:
- `format-check` ✅ (206 files; 3 files auto-fixed once by `pnpm format`)
- `typecheck` ✅ (`tsc -p tsconfig.json`, exit 0)
- `build` ✅
- `lint` ✅ (9 warnings — IDENTICAL set to slice-3 baseline: 6× parity noNonNullAssertion, 1× unused import worker-reconcile, 2× unused param business-pg-roundtrip; zero in slice-4 authored code)
- `test` ✅ **1340 passed, 6 skipped** (live-PG suites ran)

## Byte-identity verdict (4.1)

- `worker/worker.ts` extraction is PURELY MECHANICAL: the reverse-inline normalization restores the slice-3 baseline hash byte-for-byte, and the full PR1 chain (inline → strip model → strip fencing) still restores the PR1 baseline — the extraction introduces ZERO behavioral drift. All 11 byte-identity tests green, including the pinned loop over the 9 protected sources.
- Pins updated (allowed drift only): worker.ts, dispatch.ts, tick.ts, types.ts, supervisor.ts — each with a normalization proof showing the drift is exactly the documented change; `heartbeat/cycle.ts`, `heartbeat/evaluate.ts`, `dispatch/keys.ts`, `dispatch/types.ts` stay byte-identical.

## Deviations / notes

1. **`runClaimedWork` signature is `(work, deps, model, cmd)` — the design/task prose `(work, deps, model)` omits the 4th identity arg.** REQUIRED for semantic preservation: the idempotency key/hash are CALLER-carried (worker unit tests pass arbitrary keys like `close-2026-q3`; only dispatch derives `wk:`), so deriving them from Work inside the function would break the journal identity for every direct `runWorker` caller. `dispatchRecovery` derives the keys and constructs the identity literal (the task's "derives X from Work, calls runClaimedWork(...)" only makes sense if the derivation is passed IN). The byte-identity preamble-strip + import-line-strip in the test account for this. `ClaimedWorkIdentity` lives in the UNPINNED `worker/types.ts`.
2. **`supervisor/supervisor.ts` IS modified (pin updated) although the design File Changes table omits it**: threading `options.onRecovery` into `tickCompany` is required by the supervisor-timer spec tick order (the seam runs inside the sequential per-company pass) — the alternative (widening `SupervisorDeps`) would violate invariant #4. The strip-normalization proves the only drift is the 4th argument.
3. **Composition dispatch trigger**: the closure resumes on `resume` (W1) AND `cas-lost-retryable` (W2/W3 — the design data flow shows both reopening) AND `recovery-required` (a prior tick reconciled but crashed BEFORE the resume — without it, the orphan strands at the retry boundary forever). The task text "if resume" is the abbreviated flow; the design's W2/W3 → dispatchRecovery rows are authoritative.
4. **Stale-token fail-loud reconcile is CAUGHT + settled** in the closure (marker cleared, no throw → no hot retry) — the slice-3 risk flag ("the composition must catch/settle it or the tick cursor un-advances → hot retry"). The journal row is left untouched; re-designation is a fresh operator action.
5. **`RECOVERY_MODEL_TIER = 'flash'`** (composition constant): the recovery seam is heartbeat-free by spec, so no gate-selected tier exists at `onRecovery` time. The conservative default flash tier is a composition decision — flagged for the reviewer.
6. **Marker clear uses a FRESH version read after `dispatchRecovery`**: a completed resume advances the version via the terminal CAS; a stale-version clear would version-conflict and leave the marker set for a re-tick.
7. **The terminal-work clear branch (design "work.get → in_progress? no → clear") is the list→get RACE net** — discovery (`listRecoveryRequestedByCompany`) filters `state='in_progress'` by the partial index, so a completed Work is never discovered; the test pins the inert-stale-marker semantics (partial index hides it). The race branch is implemented but not deterministically testable (no injection seam between list and get) — noted for the reviewer.
8. **daemon.ts NOT wired** (not in the File Changes table; byte-identity explicitly de-pins it): the production daemon destructures `{deps, onActivate}` from the widened composition and does NOT yet pass `onRecovery` into `startSupervisor`. The slice-5 E2E (task 5.3 pumps the supervisor tick) is the natural place to thread it — flagged.
9. **Version arithmetic in the wiring tests** counts the designation bump (`setRecoveryRequest` is a version+1 CAS): seed 2 → designation 3 → finalize 4 → marker-clear 5 for the W1 end-to-end test.

## Risks for reviewer

- **byte-identity normalizations are string-coupled**: the reverse-inline/strip proofs match exact comment/preamble text (e.g. `RUN_CLAIMED_WORK_COMMENT`, `PR4_TICK_COMMENT`). An intentional edit to those comments breaks the proof — which is the POINT (any drift fails loudly), but reviewers should confirm the drift reported is only the intended change.
- **`runClaimedWork` identity contract**: callers MUST present the exact original key/hash (recovery derives them from the stable Work identity fields — same as normal dispatch). If a designated Work's identity fields changed between dispatch and recovery, the derived hash would NOT match the original attempt (same assumption as slice 3's `recoverDesignatedWork` — lifecycle-stable fields).
- **Stale-token settle semantics**: a fencing mismatch clears the designation, stranding the `in_progress` Work (in_flight row, token advanced) until a re-designation. Verify this is the intended escalation disposition vs. keeping the marker for audit.
- **Marker clear on typed resume failures**: a settled (non-thrown) resume outcome (e.g. `denied`, `invalid-plan`) clears the marker — the orphan is NOT hot-retried, but stays `in_progress` until the operator re-designates after fixing the cause. Mirrors the dispatch settlement policy (R5).
- **`RECOVERY_MODEL_TIER` fixed at flash**: recovery of high-risk orphans runs on the flash tier regardless of risk class. If risk-tiered recovery is wanted, the seam would need a model parameter — out of scope (heartbeat-free spec).
- **daemon onRecovery gap** (deviation 8): until the daemon threads `onRecovery`, production recovery only runs when the composition seam is used directly. Slice 5's E2E must wire it.

---

# Apply Progress: supervisor-recovery — Slice 5 (E2E + reframed tests + live-PG + daemon onRecovery wiring)

> Phase: APPLY — Slice 5 ONLY (tasks 5.1–5.6, the final slice). Strict TDD (RED→GREEN per task).
> Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm vitest run --no-file-parallelism`; live-PG UP (docker `io_pg`, postgres:18.4).
> Status: SLICE 5 COMPLETE — `pnpm check` GREEN (exit 0). **1346 passed, 6 skipped.**

## Summary

Closed the change with the capstone evidence and the deferred production wiring:
(1) the R6 dispatch test is REFRAMED to the reframed "Crash-Recovery Non-Guarantee"
requirement (scenario "Normal dispatch never auto-resumes an orphan"; supervisor
recovery is a SEPARATE path — assertion body byte-for-byte unchanged, no
production change); (2) the W2 dead-end flip and (4) the durable sandbox restart
are CONFIRMED green against the slice-3/slice-1 changes; (3) the FULL supervisor
recovery E2E now runs against live PostgreSQL — designate orphaned `in_progress`
Work → pump the production composition `onRecovery` → W2 journal reconcile
(token-matched `markRetryable`, NO undo) → `dispatchRecovery` resume →
effect→verify→finalize → `completed` with EXACTLY ONE receipt and a `completed`
journal; (5) the live-PG designation roundtrip proves `setRecoveryRequest` CAS +
partial-index discovery + marker clear, with EXPLAIN proving
`idx_work_recovery_requested` IS used; and the SLICE-4 DEFERRED daemon wiring is
done — `runDaemon` now threads the composition `onRecovery` into
`startSupervisor(options)` so recovery actually runs in production. This is
PR 5 (final) of the stacked chain; no commits made (orchestrator runs review).

## Tasks done

- [x] 5.1 REFRAME — `dispatch.test.ts` R6 test: renamed to "Normal dispatch never auto-resumes an orphan — R6 "Crash-Recovery Non-Guarantee" (supervisor recovery is a separate path)"; framing comment updated; assertion body UNCHANGED (behavior preserved). GREEN with NO production change (12/12 in file).
- [x] 5.2 CONFIRMATION — `worker-restart.test.ts` W2 dead-end flip (slice 3.2): already GREEN. NOTE: task cites lines 171–206, but slice 3 inserted the W1 resume test there — the W2 test now lives at :208–251 and asserts `cas-lost-retryable` + durable `aborted_retryable` marker + NO undo. No gap found.
- [x] 5.3 E2E 🏭 — `packages/app/test/e2e/recovery-e2e.integration.test.ts` (NEW): live-PG full recovery flow. RED: `column "recovery_requested" does not exist` (harness applied 001–010 only) → GREEN: added `011_recovery_designation.sql` to the harness `MIGRATIONS` array. 1 test, passes.
- [x] 5.4 CONFIRMATION — `sandbox-durable-restart.integration.test.ts` (slice 1.5): already GREEN (live filesystem restart; undo log + counter restored). No gap found.
- [x] 5.5 Roundtrip 🏭 — `business-pg-roundtrip.integration.test.ts` +4 live-PG tests (designation→discovery→clear CAS; stale-version CAS fenced; EXPLAIN proves `idx_work_recovery_requested` used with `SET LOCAL enable_seqscan=off` in a tx; designated TERMINAL Work invisible to the partial index) + `SCHEMA_011` applied in beforeAll. 53/53 stable across 5 consecutive runs.
- [x] 5.6 Full gate — `pnpm vitest run --no-file-parallelism`: **98 files passed | 3 skipped (101); Tests 1346 passed | 6 skipped (1352)**. `pnpm check` → **GREEN (exit 0)**.

## Files changed

### Production (daemon wiring ONLY — no recovery logic touched)

| File | Change |
|------|--------|
| `packages/app/src/daemon/daemon.ts` | `runDaemon` destructures `{ deps, onActivate, onRecovery }` from `buildDispatch` and passes `onRecovery` into `start(deps, { intervalMs, onActivate, onRecovery, schedule })`. The slice-4 deferred production wiring — recovery now runs in the daemon. daemon.ts is byte-identity DE-PINNED (byte-identity.test.ts pins this explicitly), so no pin drift. Boot fail-fast (R2 probe) unchanged. |

### Test infra (additive)

| File | Change |
|------|--------|
| `packages/app/test/e2e/harness.ts` | `MIGRATIONS` array gains `011_recovery_designation.sql` (additive; the scratch DB needs the column for `setRecoveryRequest`). |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | `SCHEMA_011` const + beforeAll apply; +4 designation tests; pre-existing connection-string isolation test given `{ timeout: 30_000 }` (see deviations). |

### Tests (ship with code, strict TDD)

| File | Tests | Covers |
|------|-------|--------|
| `packages/app/test/dispatch/dispatch.test.ts` | reframed | R6 "Crash-Recovery Non-Guarantee" — normal dispatch excludes in_progress, zero LLM, zero journal, Work untouched; supervisor recovery is a separate path. |
| `packages/app/test/e2e/recovery-e2e.integration.test.ts` | 1 (NEW) | Full recovery E2E vs live PG: designate → onRecovery → W2 markRetryable → dispatchRecovery resume → completed, EXACTLY ONE receipt, journal completed, marker cleared, token retained (v5, token 1), exactly one LLM request. |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | +4 | CAS designation roundtrip; stale-version fenced; partial index USED (EXPLAIN); terminal Work invisible to discovery. |
| `packages/app/test/daemon/daemon.test.ts` | +1 | The REAL startSupervisor receives the composition `onRecovery` in its options (captured via a wrapping hook; fake schedule keeps the tick dormant — the WIRING is what's pinned). |

## TDD Cycle Evidence

| Task | RED | GREEN | Test counts |
|------|-----|-------|-------------|
| 5.1 | reframed name + comment (behavior preserved — no failing assertion by design) | 12 passed (file) | — |
| 5.2 | — (confirmation, already green) | 5 passed (worker-restart file) | — |
| 5.3 | `column "recovery_requested" of relation "work" does not exist` | harness +011 → 1 passed | +1 E2E |
| 5.4 | — (confirmation, already green) | 1 passed | — |
| 5.5 | new tests written; they ran green against io_dev (011 already live-applied in slice 2) → made the suite self-sufficient by adding SCHEMA_011 to beforeAll | 53 passed (file, 5× consecutive) | +4 |
| daemon | `capturedOptions.onRecovery` undefined — 1 failed | daemon.ts wired → 7 passed (file) | +1 |
| 5.6 | — | **1346 passed \| 6 skipped; pnpm check EXIT 0** | +6 net |

## Test evidence (exact counts)

- Baseline full suite (PG UP, pre-slice-5, `267cebd`): **97 files passed | 3 skipped (100); Tests 1340 passed | 6 skipped (1346)** — the slice-4 gate state.
- After slice 5: **98 files passed | 3 skipped (101); Tests 1346 passed | 6 skipped (1352)**. Net **+6 passing** (1 E2E + 4 PG roundtrip + 1 daemon wiring), 6 new test cases, 0 failures, live-PG suites ran (6 skipped — identical to slice-4 baseline).
- Focused: e2e+composition 28 passed | 3 skipped; daemon+dispatch+restart+sandbox+wiring 115 passed; daemon file 7 passed; business-pg-roundtrip 53 passed (5 consecutive runs).
- New tests are +6 (5.3×1, 5.5×4, daemon×1); the R6 reframe and the two confirmations add no count.

## Gate verdict

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN (exit 0)**:
- `format-check` ✅ (207 files; 1 auto-fixed once by `pnpm format`)
- `typecheck` ✅ (`tsc -p tsconfig.json`, exit 0 — after fixing the E2E's `OnRecovery` return-type annotation)
- `build` ✅
- `lint` ✅ (9 warnings — IDENTICAL set to slice-4 baseline: 6× parity noNonNullAssertion, 1× unused import worker-reconcile, 2× unused param business-pg-roundtrip; zero in slice-5 authored code — one `useImportType` in the E2E was fixed)
- `test` ✅ **1346 passed, 6 skipped** (live-PG suites ran)

## Deviations / notes

1. **5.2 line numbers are stale** (task cites `worker-restart.test.ts:171-206`): slice 3 inserted the W1 resume test at that range; the W2 dead-end-flip test now lives at :208–251. Same test, same assertions (`cas-lost-retryable` + durable `aborted_retryable` + NO undo).
2. **5.5 RED never materialized on the column**: slice 2 live-applied migration 011 to `io_dev` during its runtime-harness evidence, so the new tests ran green immediately. The suite was still made self-sufficient (SCHEMA_011 in consts + beforeAll) so a fresh database passes too — this is the GREEN step.
3. **Pre-existing flaky test found + minimally fixed**: the connection-string isolation test (CREATE/DROP DATABASE on the shared docker PG) intermittently exceeds vitest's 5000ms default timeout — reproduced on the PRISTINE baseline (1/6 fails). Given a deterministic 5.6 gate, its `it(...)` now carries `{ timeout: 30_000 }` (repo convention: boot-smoke uses 30s for live-PG integration). Behavior/assertions untouched.
4. **E2E sandbox**: the test builds `buildSupervisorDispatch` over the harness's conn/llm/sandboxRoot — a second `FileDocumentSandbox` instance over the same root. Harmless (only the composition's sandbox executes effects; no concurrency); mirrors the wiring test's shape.
5. **E2E version arithmetic**: seed in_progress v2 → designation 3 → terminal CAS 4 → marker clear 5 (asserted `version 5`, `fencingToken 1` retained — D6 never re-mints).
6. **daemon wiring test observes via a wrapping hook**: `startSupervisor` is wrapped in the test to capture `StartSupervisorOptions` (the fake schedule never fires a tick); asserts the composition's exact `onRecovery` fn reaches the REAL `startSupervisor` options. The other lifecycle tests keep `startSupervisor` uninjected.

## Risks for reviewer

- **E2E harness correctness**: the recovery E2E shares the harness's sandbox root with a second composition-built sandbox instance (deviation 4) — verify no interleaving is possible (it isn't: sequential test, one writer). The W2 seed replicates the crash window by writing the in_flight row directly with the deterministic identity — confirm the requestHash derivation matches recovery's (it does: `dispatchRequestHashFor` excludes stateful fields, so the version-2 seed hash == the version-3 recovery derivation).
- **Daemon wiring**: `onRecovery` is now threaded unconditionally (the composition always returns it — a `void` no-op for non-recovery builds). Verify the daemon boot fail-fast (R2 probe) still precedes any composition construction (it does — probe → buildDispatch → start). `requestRecovery` remains un-exposed at the daemon CLI level (admin surface out of scope) — flagged for the reviewer.
- **Partial-index EXPLAIN**: the plan proof uses `SET LOCAL enable_seqscan = off` inside a transaction — it proves the index COVERS the discovery predicate and is chosen when a scan must be index-based. A tiny table would otherwise seq-scan. The roundtrip tests independently prove the predicate correctness.
- **Pre-existing flake fix** (deviation 3): the 30s timeout on the isolation test is a test-infra change outside slice scope — verify the reviewer is comfortable with it (without it the 5.6 gate is non-deterministic on loaded hosts).
- **Reframe discipline**: 5.1's assertion body is byte-identical to the pre-slice version — only the scenario name + framing comment changed. Confirm no behavioral assertion was weakened (none was: dispatched:false, zero LLM, zero journal rows, Work untouched).

---

# Remediation (verify CRITICALs) — attempt-correlated undo evidence + typed stale-token contract

> Phase: APPLY — REMEDIATION of the two CRITICAL findings in `verify-report.md`
> (verdict FAIL: 4/8 requirements, 37/44 scenarios). Strict TDD (RED→GREEN per
> fix). Runner: `PATH=/data/node24/bin:$PATH pnpm test` / `pnpm check`.
> Status: REMEDIATION COMPLETE — `pnpm check` GREEN (1349 passed, 6 skipped),
> live-PG sequential GREEN (same counts). Slices 1–5 above are untouched.

## CRITICAL 1 — Undo evidence MUST be attempt-correlated (data corruption)

**The bug**: `recoverInFlightWork` picked `snapshotUndoLog().filter(applied)[last]` —
the last GLOBAL applied entry. A prior UNRELATED applied effect (normal
multi-attempt history in the same sandbox root) made W2 misidentify as W3 and
recovery undid the UNRELATED effect; with multiple applied entries W3 could undo
the wrong one.

**The fix (stamped-correlation approach)**: `EffectRecord` gains a read-only
`idempotencyKey: string` (attempt correlation). The worker cycle stamps it at
the execute call site (`runClaimedWork` passes `cmd.idempotencyKey` through
`executeEffect` → `sandbox.execute(action, { idempotencyKey })`; the three
sandbox impls record it on the durable entry; `''` is the "no correlation"
sentinel for test/legacy executes). `recoverInFlightWork` now filters the durable
log BY the designated attempt's key:

- empty attempt-correlated result → **W2** (markRetryable WITHOUT undo) — a prior
  unrelated keyed effect is filtered out and NEVER undone;
- one attempt-correlated result → **W3** (undo THAT specific effect only);
- any applied entry WITHOUT a correlation (pre-fix legacy record) or MORE THAN
  ONE entry claiming this attempt's key (contradictory) → **escalate**
  `UNRESOLVED_REQUIRES_HUMAN` (row sealed with the typed sentinel via
  `journal.complete`) — NEVER guess.

**RED proof (the exact gap)**: 3 new matrix tests failed against the pre-fix
source — `W2 with a PRIOR UNRELATED applied effect` (pre-fix undid the unrelated
effect), `W3 with a PRIOR UNRELATED applied effect` (pre-fix undid the
globally-last unrelated entry instead of this attempt's), and `legacy applied
evidence WITHOUT a correlation key` (pre-fix undid the un-attributable entry).
The existing W3 / missing-evidence / re-tick matrix tests and the durable restart
test now stamp the key at execute (required: an unkeyed record is legacy and
escalates by contract). Parity 5 now proves ALL THREE sandbox impls stamp the
SAME correlation onto the snapshot shape.

## CRITICAL 2 — Stale-token MUST return a typed failure (contract violation)

**The bug**: `markRetryable(attemptId, fencingToken): Promise<void>` threw on a
stale token / zero-row update; tests asserted `rejects.toThrow(/fencing token
mismatch/i)`.

**The fix**: the port now returns a typed result —
`markRetryable(attemptId, fencingToken): Promise<MarkRetryableResult>` where
`MarkRetryableResult = { ok: true } | { ok: false; reason: 'stale-token';
current?: JournalEntry }` (mirrors the `CasResult`/`JournalClaimResult` typed
idiom; exported from `@io/business-domain/src/index.js`). ALL implementations
return the typed value on a mismatch/zero-row (row NEVER mutated) and `{ok:true}`
on success — NO throw: `InMemoryIdempotencyJournalRepository`, `DurableJournalFake`
(persists only on success), `PgIdempotencyJournalRepository` (0-row → follow-up
`SELECT ... WHERE attempt_id = $1` reporting `current`). `journal.complete`
semantics are UNCHANGED (token-free, status-guarded; abort never seals via
complete). Callers propagate the refusal as the typed
`UNRESOLVED_REQUIRES_HUMAN` escalation with the row UNCHANGED:
`reconcilePostEffectFailure` (finalize.ts — both the W3 undo-then-mark and the
W2 no-undo branches) and therefore the finalize CAS-loss T2, the verify-fail
path, and `recoverInFlightWork`. The supervisor composition's defensive catch is
now documented as unexpected-throws-only.

**RED proof**: 11 stale-token tests updated to the typed contract failed against
the pre-fix source (matrix stale, parity 4 + 7 stale, worker-finalize STALE close
+ no-effect stale, worker-reconcile stale, business-domain idempotency matching
+ stale, fakes missing/completed/retryable, adapter missing/completed/stale).

## Compliance re-derivation (target 8/8 requirements + 44/44 scenarios)

| Verify-report result | Scenario(s) | Now |
|---|---|---|
| FAILING | `idempotency-journal/retryable-marker/stale-token-typed-failure` | COMPLIANT — typed `{ok:false, reason:'stale-token'}` at the journal layer (fake ≡ PG) |
| FAILING | `worker-cycle/journal-reconciliation/stale-token-typed-rejection` | COMPLIANT — typed `UNRESOLVED_REQUIRES_HUMAN` at the recovery layer, row unchanged |
| PARTIAL | `sandbox-port/universal-reversibility/undo-log-reflects-applied-state` | COMPLIANT — truthful snapshots now attempt-correlated |
| PARTIAL | `worker-cycle/journal-reconciliation/w2-no-undo` | COMPLIANT — prior unrelated applied effect is NOT undone |
| PARTIAL | `worker-cycle/journal-reconciliation/w3-undo-before-retry` | COMPLIANT — undoes ONLY the designated attempt's effect |
| PARTIAL | `io-persistence-recovery/recovery-matrix/w2-retryable` | COMPLIANT |
| PARTIAL | `io-persistence-recovery/recovery-matrix/w3-compensate` | COMPLIANT |

Requirements 4/8 → 8/8 (Universal Reversibility, Retryable Marker on Finalize
CAS Loss, Journal-Anchored Reconciliation, Recovery Matrix all now PASS).
Scenarios 37/44 → 44/44.

## Test evidence

- RED phase (focused): 15 failures across the 10 remediation-affected suites
  (14 runtime + 1 parse error fixed immediately) — every failure is in the two
  contract areas.
- GREEN phase (focused): matrix 13/13, parity 24/24 (parity 5 now includes the
  stamped correlation), finalize, reconcile, effect, restart, verify,
  idempotency, fakes, adapter — all green.
- Full gate: `PATH=/data/node24/bin:$PATH pnpm check` → format 207 files no
  fixes; typecheck PASS; build PASS; lint PASS (same 9 pre-existing warnings);
  **tests: 98 files passed, 3 skipped; 1349 passed, 6 skipped, 0 failed**
  (baseline 1346 → +3 new correlation tests).
- Live-PG sequential: `PATH=/data/node24/bin:$PATH pnpm vitest run
  --no-file-parallelism` → **98 files passed, 3 skipped; 1349 passed, 6
  skipped, 0 failed** (docker `io_pg` up).
- Byte-identity: `worker/worker.ts` pin updated to
  `8fc1bc48…`; the normalization proofs strip the remediation's single
  execute-call-site drift (`executeEffect(deps.sandbox, intent.action,
  idempotencyKey)` → `…intent.action)`) and restore the committed SLICE3 and PR1
  baselines byte-for-byte — 11/11 byte-identity tests green.

## Files changed (remediation)

### Production

| File | Change |
|------|--------|
| `packages/app/src/sandbox/sandbox-port.ts` | `EffectRecord.idempotencyKey: string` (attempt correlation); `SandboxPort.execute(action, correlation?: { idempotencyKey })`. |
| `packages/app/src/sandbox/in-memory-sandbox.ts` / `file-document-sandbox.ts` | `execute` stamps the correlation onto the record (`makeRecord` gains the key; `''` = no correlation). |
| `packages/app/src/sandbox/durable-sandbox-fake.ts` | `execute` forwards the correlation to the delegate. |
| `packages/app/src/worker/effect.ts` | `executeEffect(sandbox, action, idempotencyKey)` — the effect seam stamps the correlation. |
| `packages/app/src/worker/worker.ts` | execute call site passes `idempotencyKey` (ONLY byte-identity-pinned drift; comment verbatim). |
| `packages/app/src/worker/recover.ts` | attempt-correlated selection; unattributable/contradictory → typed escalation; `noAppliedEffect(input.idempotencyKey)`. |
| `packages/app/src/worker/finalize.ts` | `reconcilePostEffectFailure` propagates the typed `markRetryable` refusal as `UNRESOLVED_REQUIRES_HUMAN` (both branches). |
| `packages/business-domain/src/ports/idempotency.ts` | `MarkRetryableResult` type; port signature + docs (typed, never throws). |
| `packages/business-domain/src/ports/fakes.ts` | fake + `DurableJournalFake` return the typed result (persist only on success). |
| `packages/database/src/idempotency-adapter.ts` | PG returns the typed result; 0-row → follow-up read for `current`. |
| `packages/business-domain/src/index.ts` | exports `MarkRetryableResult`. |
| `packages/app/src/composition/supervisor-dispatch.ts` | comment-only: defensive catch is unexpected-throws-only (stale-token is typed now). |

### Tests

`worker-recovery-matrix` (+3 correlation tests, stale→typed, stamping),
`worker-helpers` (RecordingSandbox forwards correlation; RecordingJournal typed),
`parity` (4 stale + 5 stamping/shape + 7 stale typed + notApplied key),
`worker-finalize` (STALE close typed, no-effect stale typed, notApplied key),
`worker-reconcile` (stale typed + 4 typed stubs), `worker-verify` (notApplied
key), `worker-effect` (stamps the correlation), `worker-restart` (crash helper
stamps the key), `sandbox-port` (UndoLog record helper key), `e2e/live-retry`
(effect literal key), `business-domain idempotency` (typed matching + stale,
LostClaimJournal stub), `business-domain fakes` (typed missing/completed/
retryable), `database adapter` (typed missing/completed/stale),
`business-pg-roundtrip` (live-PG stale typed), `daemon/byte-identity` (worker pin
+ normalization strips), `composition/supervisor-recovery-wiring` (comment).

## Risks for reviewer

- **Correlation mechanism**: recovery trusts the key stamped at the execute call
  site (`runClaimedWork` → `executeEffect`); a code path that executed an effect
  WITHOUT stamping produces a `''` record that escalates (fail-safe, never a
  wrong undo). Verify the production call graph stamps in every path
  (normal dispatch + designated recovery share `runClaimedWork`; the sandbox
  execute correlation is optional ONLY for tests that never recover).
- **Legacy upgrade path**: pre-fix durable undo-log entries have no key → recovery
  escalates `UNRESOLVED_REQUIRES_HUMAN` instead of guessing — intended, but a
  human must clear legacy applied entries (or re-run under the new code) before
  W2/W3 recovery can proceed on a live system with legacy logs.
- **Typed-result propagation**: the stale-token refusal returns
  `UNRESOLVED_REQUIRES_HUMAN` with the journal row UNCHANGED (not sealed) —
  re-tick re-escalates idempotently; verify this matches the intended
  human-intervention loop (the composition clears the marker; re-designation is
  a fresh operator action).
- **Byte-identity**: `worker/worker.ts` gained exactly one line (the execute call
  site) — the pin hash and both normalization proofs were updated; a reviewer
  should confirm the strip string matches the formatted bytes.
- **Line budget**: the remediation diff is 512 insertions + 173 deletions across
  29 files (focused-suite RED→GREEN + typed-contract test updates) — within the
  auto-chain remediation authorization; no commit made (orchestrator reviews).

---

## Correction (R4-002) — recovery escalations must NOT seal the key via the token-free `complete`

Native review finding `review-adc046b19e4f9246` R4-002 (CRITICAL). Strict TDD
(RED→GREEN), single scoped correction — nothing beyond `recover.ts` +
`worker-recovery-matrix.test.ts` touched. Status: COMPLETE — `pnpm check` GREEN
(1350 passed, 6 skipped, 0 failed; 98 files passed / 3 skipped). Baseline 1349 →
+1 net (1 test updated + 1 added).

### The bug
The remediation added TWO escalation branches in `recoverInFlightWork`
(`packages/app/src/worker/recover.ts`) — the unattributable-evidence branch
(legacy applied entries with empty/non-string `idempotencyKey`) and the
contradictory-evidence branch (>1 applied entry claiming the attempt's key) —
that called `deps.journal.complete(input.attemptId, UNRESOLVED_RESULT)`.
`journal.complete` is TOKEN-FREE by design (the honest T2(ii) stale-holder
close). A STALE recovery holder (Work retains token 3, journal row advanced to
token 5) reaching either branch executed the ungated completion → permanently
sealed the token-5 row as `completed`, preventing its legitimate owner from
finishing or retrying. Production-reachable: after deploying the correlation
fix, existing durable undo logs (pre-fix) contain empty-key entries.

### The fix (minimal, scoped)
Both escalation branches now return the typed
`UNRESOLVED_REQUIRES_HUMAN` disposition WITHOUT calling `journal.complete` —
the journal row STAYS `in_flight` under the real claim owner. The composition's
`onRecovery` closure (supervisor-dispatch.ts) already handles an
`UNRESOLVED_REQUIRES_HUMAN` outcome by clearing the recovery marker
(re-designation is a fresh operator action) — so NOT completing is stable (no
hot-retry loop). Comments in both branches document WHY (`complete` is
token-free; a stale holder must not seal a row owned by a newer fencing token).
The now-unused `UNRESOLVED_RESULT` import was removed from recover.ts
(verified — no remaining references; `deps.journal` still used for `lookup` and
the shared `reconcilePostEffectFailure` deps).

### Tests (TDD evidence)
- **RED (2 failed, 12 passed)**: updated "legacy applied evidence WITHOUT a
  correlation key … → UNRESOLVED_REQUIRES_HUMAN, no undo, no marker" — asserts
  the row STAYS `in_flight` (was `completed`), `resultJson` undefined, and NO
  `complete:` in the journal log; added "stale-holder recovery with
  unattributable evidence does NOT seal a newer-token journal row" — Work token
  3, journal row token 5, legacy unattributable applied entry → UNRESOLVED, row
  stays `in_flight` with token 5, no undo, no complete call.
- **GREEN (14/14)**: both fixes land, matrix file 14/14.
- **Full gate**: `PATH=/data/node24/bin:$PATH pnpm check` → format 207 files no
  fixes; typecheck/build/lint PASS (same 9 pre-existing warnings); **98 files
  passed, 3 skipped; 1350 passed, 6 skipped, 0 failed**.

### Files changed (Correction R4-002)
Production: `packages/app/src/worker/recover.ts` — removed the 2 ungated
`journal.complete(input.attemptId, UNRESOLVED_RESULT)` calls in the
unattributable + contradictory escalation branches, replaced both comments,
dropped the unused `UNRESOLVED_RESULT` import. Tests:
`packages/app/test/worker-recovery-matrix.test.ts` — updated the legacy-evidence
test (no-seal assertions) + added the stale-holder no-seal fencing test.

### Out of scope (untouched)
The stale-token `markRetryable` typed-result fix, the attempt-correlation
filtering logic, `finalize.ts` (undo-failure escalation still seals via
`journal.complete` — that path is claim-scoped by a token-gated mark first),
and every other file. No commits made (orchestrator runs review finalize +
commit).

### Risks for reviewer
No-seal stability confirmed: `onRecovery` clears the marker on
`UNRESOLVED_REQUIRES_HUMAN` (supervisor-dispatch.ts) — the escalation does not
hot-retry; re-designation is a fresh operator action. The row stays
`in_flight`, so a re-tick WITHOUT re-designation never re-reaches recovery
(marker cleared). `complete` is no longer called from the recovery escalation
branches; the token-free gap is closed.
