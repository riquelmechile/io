# Apply Progress: Cold-Start Discovery — Phases 1–4 (tasks 1.1–1.3, 2.1–2.3, 3.1–3.3, 4.1–4.2)
- **Change**: `cold-start-discovery`
- **Batch (Phase 4)**: tasks 4.1–4.2 (composition `acceptWork` seam + real-path e2e)
- **Work unit (Phase 4)**: `phase-4-production-composition-e2e`
- **Attempt (Phase 4)**: native acquire returned state `proceed`, max attempts 1, max changed lines **400**; opaque token parent-held (no acquire/settle/reset performed by executor); complete candidate vs `a5315ea` = **313 changed lines ≤ 400** at the prior gate (73 tracked + 240 untracked; recomputed post-correction in Exact Accounting below)
- **Delivery**: auto-chain (no chained PR required per forecast); work-unit slice `phase-4-production-composition-e2e`; rollback boundary = composition seam + e2e + necessary Phase 4 artifact updates; 4.3 commit + 5.1–5.3 stay pending (parent owns commit/review)
- **Mode**: Strict TDD (active; `openspec/config.yaml` strict_tdd + tdd true; runner `PATH=/data/node24/bin:$PATH pnpm test`)

## Phase 4 Record (2026-08-13, work unit phase-4-production-composition-e2e)

- **RED (4.1)**: created `packages/app/test/e2e/cold-start-e2e.integration.test.ts` FIRST — references `composed.acceptWork(...)` (D10 seam) which did NOT exist → genuine RED `TypeError: composed.acceptWork is not a function`, `Test Files 1 failed (1); Tests 2 failed (2)` (raw: `evidence/phase-4-focused-red.log`). No `seedAcceptedWork`, no direct `onActivate`/`onRecovery` invocation.
- **GREEN (4.2)**: added `acceptWork: (cmd) => acceptWorkAtomically(input.connection, cmd)` + return-type member to `buildSupervisorDispatch` (`supervisor-dispatch.ts`) → focused `Test Files 1 passed (1); Tests 2 passed (2)` (raw: `evidence/phase-4-focused-green.log`). Safety net + regression: daemon/supervisor/composition suites `12 passed (12); 103 passed (103)` (includes daemon mock surface-growth pin `acceptWork: vi.fn()`); full app e2e dir `10 passed | 1 skipped (11); 22 passed | 3 skipped (25)`.
- **TRIANGULATE**: second e2e case — a re-pump after completion does NOT re-run the worker (completed Work no longer actionable; empty queue settles; exactly one `work.completed` + one receipt + one LLM request preserved).
- **REFACTOR**: biome format normalized 1 file pre-freeze; `format-check` converged (211 files, no fixes applied); `typecheck` clean; `lint` 0 errors (9 pre-existing warnings, identical set, none in changed files).
- **Runtime harness (dedicated isolated Phase 4)**: preserved Phase 3 harness `io-phase3-iso-pg-ca93986d` could NOT be restarted — its bound port 127.0.0.1:5433 is occupied by unrelated `medusa-build-pg` (untouched). Created DEDICATED isolated harness: container `io-phase4-iso-pg-3cdff5d7` (`9a28320f4a6e`, postgres:18.4) + volume `io-phase4-iso-pg-vol-3cdff5d7`, `127.0.0.1:5434` loopback-only; role/db non-sensitive dev credentials env-injected, never printed. All Phase 4 runs targeted this harness via `DATABASE_URL`; shared `io_pg`/`io_dev` (5432) never used.
- **4.3 stays PENDING** (commit `feat(app): surface atomic accept in supervisor dispatch and prove cold-start e2e` — parent owns commit/review). Phase 5 (5.1–5.3) untouched.

## Fresh-Context Gate Correction Record (2026-08-13, phase-4-evidence-correction)

- Work unit `phase-4-evidence-correction`: native acquire state `proceed`, max attempts 1, max changed lines **400**; opaque token parent-held (no acquire/settle/reset performed). Evidence/documentation normalization ONLY — no source/test/spec/design/task-state changes, no test reruns, no Docker start/mutation, no commit/stage/push, no review launched; task 4.3 and Phase 5 untouched.
- **Accounting corrected**: complete Phase 4 candidate vs `a5315ea` at the prior gate = **313 changed lines (73 tracked + 240 untracked) ≤ 400 ✓**, replacing the stale **255** (which counted only the 15 source/test tracked lines + 240 untracked, omitting the 58 artifact-delta lines) and the false "artifact deltas add ~0" statement.
- **`phase-4-focused-green.log` made self-contained**: exact command incl. `PATH=/data/node24/bin:$PATH` and isolated credential-free `DATABASE_URL` target → `127.0.0.1:5434`; harness identity `io-phase4-iso-pg-3cdff5d7` (postgres:18.4, loopback 127.0.0.1:5434); exact result 1 file / 2 tests passing; exit code 0. Metadata clearly labeled vs captured runner output; raw bytes untouched, no rerun.
- `phase-4-focused-red.log` byte-unchanged (raw capture, task 4.1).

## Final Evidence Correction Record (2026-08-13, phase-3-raw-gate-lineage-correction)

- Work unit `phase-3-raw-gate-lineage-correction` (orchestrator-held proceed token `sha256:64f6937a15cf8a2636c3470bc2326f7f96eb86535493951ba7d71dbe4d02037e`; complete-candidate max **520** per Engram #6526). Evidence-only: no source/test/spec/design/task-state changes; 3.4 stays pending; no commit/stage/push.
- **Removed every unsupported shared no-write/untouched assertion** (all phase-3 evidence + this file). Allowed truth only: one accidental pre-fix shared `localhost:5432` connection/read attempt occurred (failed, `database io_dev_iso does not exist`); no write conclusion is claimed because none is proven. Current recovery operations (this correction) targeted the isolated container by identity; no historical generalization is made.
- **`phase-3-check-gate.log` replaced** with genuinely raw bounded full-gate bytes: full `pnpm check` rerun EXACTLY once against the isolated DB (container `io-phase3-iso-pg-ca93986d`, `DATABASE_URL` → `127.0.0.1:5433`; shared server not targeted) → exit 0; all five steps raw; all 9 lint warnings present (biome raw github-reporter lines, complete, nothing elided); no inaccessible digest dependency; no elision statement.
- **`phase-3-scratch-lineage.log` created** (supersedes and replaces `phase-3-schema-readback.log`, deleted): fresh scratch DB `io_scratch_lin_20260813a` on the SAME preserved isolated server/volume, verbatim psql markers for pre-absence → CREATE → `current_database()` identity → baseline-0 → migration manifest 001–011 (OK + sha256) → final readback (10 tables, 9 design indexes, `total_public_indexes=31`, CHECK, 010/011 columns, absence 0) → DROP → post-absence. No secrets.
- **Harness state**: container `io-phase3-iso-pg-ca93986d` + volume `io-phase3-iso-pg-vol-ca93986d` preserved; started for this correction's evidence runs, stopped after (container preserved, NOT deleted). No tests other than the required full gate; all DB test env targeted the isolated DB.
- Prior records below are superseded by this one for gate/lineage evidence; their material Phase 1/2/3 facts (counts, harness identity, defect/fix, task state) remain true.

## Evidence Correction Record (2026-08-11, phase-3-isolated-evidence-correction) — superseded above

- Work unit `phase-3-isolated-evidence-correction` (orchestrator-held proceed token `sha256:5cdc1f84…7168a`; max changed lines **450** for the COMPLETE Phase 3 candidate). Evidence-only: self-contained bounded evidence, corrected shared-DB truth, exact accounting. Source/tests conformant, unchanged.
- **Prior shared-DB Phase 3 evidence INVALID/superseded** (#6474 concurrent mutation; truncated digest `sha256:65f2825e…4013e` not current proof). The RED conn-string test made ONE accidental read/connection attempt to shared `localhost:5432` pre-fix (failed, `database io_dev_iso does not exist`); no write claim — none proven.
- **Self-contained evidence (raw bytes in-repo; no `/tmp` dependency, no digest-only)**: `evidence/phase-3-isolated-harness.md` (harness identity + defect/fix), `evidence/phase-3-focused-live-pg.log` (raw 60/60), `evidence/phase-3-check-gate.log` (raw gate, exit 0). Full hashes for provenance only.
- **Harness + reruns**: container `io-phase3-iso-pg-ca93986d` (`1eff346e8a1f`, postgres:18.4) + volume `io-phase3-iso-pg-vol-ca93986d` on `127.0.0.1:5433`; started for read-only extraction + focused/gate reruns (once each), stopped after; volume/container preserved. Focused (GREEN, once, sequential): `pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts` w/ `DATABASE_URL` → isolated → `1 passed (1); 60 passed (60); exit 0`. Full gate (once, post-normalization): `pnpm check` → exit 0; format 210 files; typecheck/build clean; lint 0 errors (9 pre-existing warnings, identical set); `99 passed | 3 skipped (102); 1378 passed | 6 skipped (1384)`.
- **Defect (Strict TDD, isolated proof)**: RED `1 failed | 59 passed (60)` — pre-existing conn-string test hardcoded shared `localhost:5432` (coupling class #6474); production sound (7 new cases passed in the 59). GREEN fix (test-only): derive scratch URL from `pgConnectionString()` + `.toString()`. Rollback = revert that block.

## Native Budget Reset Record (authorized 2026-08-11)

- Native ledger measured **283 changed lines** against the original 250-line cap → `decision_required: true`, `next_action: reset`. Maintainer authorized **corrected max changed lines: 320** — budget accounting only; no scope expansion, no review bypass (Engram `sdd/cold-start-discovery/phase2-budget-reset` #6457; runtime revision `sha256:a2f26bfb256f9973eac805860d4cc3d7f57e9ed5b932561d3c57831527fd0b82`).
- Revalidation (work unit `phase-2-accept-work-materiality-budget-reset`, state `proceed`, orchestrator-held token `sha256:465f14191250631efb51576bc4390dc587f99741282fa0575021abe326cdcbd6`): the pre-audit candidate measured **283 changed lines** (git numstat vs `18cddf0` = +200/−83; 152 authored src/test [131 ins + 21 del] + 131 SDD artifact edits); the 7-line audit reset-record appended in this artifact brings the intermediate total to **290 changed lines** (+207/−83), and the final total — **308 changed lines** (+225/−83) — includes the 10-line evidence artifact and subsequent evidence-record lines: **283 pre-audit → 290 after the 7-line reset record → 308 final**. All totals fit the authorized 320-line cap — **283 ≤ 320 ✓, 290 ≤ 320 ✓, 308 ≤ 320 ✓**. The append is budget accounting only; no scope change. Focused GREEN reproduced `Test Files 2 passed (2) / Tests 73 passed (73)`; prior RED/GREEN evidence and gate digest `sha256:5d9d61d24ca5f09168ba8751ff4c57aecd27fc7bed97efb50b6cba3f889a66fa` remain bound and truthful (raw log preserved byte-for-byte, see Check Gate section).
- Precise deltas (live vs `18cddf0`): `accept-work.ts` +17/−4, `heartbeat.ts` +8/−2, `use-cases.test.ts` +77/−13, `heartbeat.test.ts` +29/−2, `tasks.md` +4/−4, `apply-progress.md` +80/−58 (the 7-line audit reset-record accounts for +7 of the delta over the pre-audit +65/−58; the evidence-correction record adds the remaining +8; supersedes the approximate per-file splits in the Files Changed table below; the 152-authored total there is exact).
- State at that time: tasks 1.4 + 2.1–2.3 complete, 2.4 pending commit; Phase 3 untouched; no commit/stage/push performed.

## Evidence Correction Record (2026-08-11, phase-2-evidence-gate-correction)

- Work unit `phase-2-evidence-gate-correction` (orchestrator-held token `sha256:f959449007fcd0acf5ad988735d5bf667e2866fe094b88b01288b5afe16ebf68`): evidence-only corrective rerun, no source/test/spec/design changes.
- Corrected accounting language above (**283 pre-audit → 290 after the 7-line audit append → 308 final** including the 10-line evidence artifact and subsequent evidence-record lines; all totals ≤ 320), pinned task 1.4 to the exact `18cddf0` subject `feat(business-domain): add work accepted event builder`, and bound the full-gate evidence to the in-repo artifact `evidence/phase-2-check-gate.log` (digest `a294f5c3…e005d`; raw full log digest `5d9d61d2…a66fa`).
- Recomputed changed lines including the new evidence artifact: **308 final** — tracked diff vs `18cddf0` = 298 plus the 10-line evidence artifact = 308; chain **283 pre-audit → 290 after the 7-line reset record → 308 final**, still ≤ authorized 320. Tasks 2.4 pending; Phase 3+ untouched.

## Completed Tasks

### Phase 1 (preserved — prior batch)

- [x] 1.1 [RED] Created `packages/business-domain/test/work-accepted-event.test.ts` (11 tests).
- [x] 1.2 [GREEN] Created `packages/business-domain/src/work-accepted-event.ts` — pure `buildWorkAcceptedEvent(work, now?)`, zero `@io/*`, per design §Interfaces (D3, D4).
- [x] 1.3 Exported `buildWorkAcceptedEvent` from `packages/business-domain/src/index.ts`.
- [x] 1.4 Commit `feat(business-domain): add work accepted event builder` — committed as `18cddf0` (exact subject verified in `git log`).

### Phase 2 (this batch)

- [x] 2.1 [RED] Extended `packages/business-domain/test/use-cases.test.ts` (all 6 `acceptWork` callers updated to `{ work, events }`) + `heartbeat.test.ts` materiality scenarios: success appends exactly one `work.accepted` (`evt:acc:{workId}`, `source:'acceptor'`); each typed failure (`version-conflict`/`invalid-transition`/`not-found`/`invalid-command`) returns `{ok:false}` appending nothing; two novel accepts + one tick ⇒ one `activate`; `work.completed` remains material and `heartbeat.decision` remains undeclared/non-material.
- [x] 2.2 [GREEN] Modified `packages/business-domain/src/use-cases/accept-work.ts`: deps widened to `{ work, events, now? }`; builds via `buildWorkAcceptedEvent` and appends only on `ok:true`; typed failures resolve pre-write inside `applyWorkTransition` — `{ok:false}` values, no thrown control flow; zero `@io/*` (D1, D6).
- [x] 2.3 [GREEN] Modified `packages/business-domain/src/heartbeat.ts`: `MATERIAL_EVENT_TYPES` → readonly `['work.accepted', 'work.completed']`; `isMaterialEvent`/`hasMaterialNovelty`/`resolveCursorIndex`/`escalationModelFor`/`evaluateHeartbeat`/`tailCursor` byte-unchanged (D5, D9).
- [x] 2.4 Commit `feat(business-domain): emit work accepted event` — committed as `9fada4b` (exact subject verified in `git log`); native review/receipt preceded the commit.

### Phase 3 (this batch)

- [x] 3.1 [RED] Extended `business-pg-roundtrip.integration.test.ts` (7 live-PG cases + `business_event` in TRUNCATE): success COMMITS Work@vN+1 + one `work.accepted` in SAME tx; typed failures COMMIT empty tx (NEITHER persists); post-CAS duplicate-`append` THROWS ⇒ ROLLBACK ⇒ NEITHER persists; duplicate accept ⇒ `invalid-transition`. `ports/fakes.ts` (`appendIfAbsent` NEW throws on duplicate `source:'acceptor'`) + 3 fakes scenarios.
- [x] 3.2 [GREEN] Created `packages/database/src/accept-work-flow.ts`: `acceptWorkAtomically(conn, cmd)` mirrors `completeWorkAtomically`; work + event repos bound to ONE `conn.transaction`; commit-on-resolved, rollback-on-throw (D2).
- [x] 3.3 Exported `acceptWorkAtomically` from `packages/database/src/index.ts` (+1); `boundary.test.ts` pin (+3).
- [x] 3.4 Commit `feat(database): add atomic acceptance transaction` — committed (exact subject; no hash preclaimed); candidate-scoped decline `declined_this_candidate`; RDD not disabled; delivery unmanaged under ordinary repository policy.

### Phase 4 (this batch)

- [x] 4.1 [RED] Created `packages/app/test/e2e/cold-start-e2e.integration.test.ts`: propose → accept via the composition `acceptWork` seam → assert `listCompanyIds()` contains the company → pump `startSupervisor(deps, { intervalMs, schedule: oneShot, onActivate, onRecovery })` then `handle.stop()` → assert discovery → `activate` → dispatch → `runWorker` → finalize → `work.completed` + Work `completed`. MUST NOT use `seedAcceptedWork`; MUST NOT call `onActivate`/`onRecovery` directly (D10). Genuine RED: `TypeError: composed.acceptWork is not a function`, `1 failed (1); 2 failed (2)` (raw `evidence/phase-4-focused-red.log`).
- [x] 4.2 [GREEN] Modified `packages/app/src/composition/supervisor-dispatch.ts`: added `acceptWork: (cmd) => acceptWorkAtomically(input.connection, cmd)` to the return + typed member `(cmd: TransitionWorkCommand) => Promise<UseCaseResult<Work>>` (D10). Focused GREEN `1 passed (1); 2 passed (2)` (raw `evidence/phase-4-focused-green.log`); daemon mock surface pin (`acceptWork: vi.fn()`); no production behavior change to supervision/recovery paths.

## TDD Cycle Evidence (Phase 4)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 | `packages/app/test/e2e/cold-start-e2e.integration.test.ts` | E2E (live PG) | ✅ daemon/supervisor/composition 12 files / 103 tests passing pre-edit | ✅ `TypeError: composed.acceptWork is not a function`, `1 failed (1); 2 failed (2)` — seam referenced before existence | ✅ `1 passed (1); 2 passed (2)` after 4.2 | ✅ 2 cases: full cold-start chain + re-pump after completion settles (no second worker run) | ✅ Biome normalized pre-freeze; tsc clean; 0 lint findings in changed files |
| 4.2 | (same) | E2E (live PG) | ✅ 103/103 baseline | N/A (RED from 4.1 — missing member) | ✅ `1 passed (1); 2 passed (2)` | ➖ covered by 4.1 cases | ✅ Clean |

## Work Unit Evidence (Phase 4)

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result | RED (raw `evidence/phase-4-focused-red.log`): `DATABASE_URL='postgresql://io:io_dev@127.0.0.1:5434/io_dev' pnpm vitest run --no-file-parallelism packages/app/test/e2e/cold-start-e2e.integration.test.ts` → `Test Files 1 failed (1); Tests 2 failed (2)` — `composed.acceptWork is not a function`. GREEN (self-contained `evidence/phase-4-focused-green.log`): `DATABASE_URL='postgresql://127.0.0.1:5434/io_dev' PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/e2e/cold-start-e2e.integration.test.ts` → `Test Files 1 passed (1); Tests 2 passed (2)`, exit 0; regression suites `12 passed (12); 103 passed (103)`; full app e2e `10 passed | 1 skipped (11); 22 passed | 3 skipped (25)`. |
| Runtime harness command/scenario and exact result | **LIVE PostgreSQL (dedicated isolated Phase 4 harness)**: container `io-phase4-iso-pg-3cdff5d7` (`9a28320f4a6e`, postgres:18.4) + volume `io-phase4-iso-pg-vol-3cdff5d7`, `127.0.0.1:5434` loopback-only. Scenario: zero-history company → real `proposeWork` (live PG) → composition `acceptWork` seam (atomic tx) → `listCompanyIds()` discovers → `startSupervisor` one-shot pump (injected schedule, `onActivate`/`onRecovery` from composition) → gate `activate` → `dispatchCompanyActivation` → `runWorker` → finalize → Work `completed`@v4 + exactly one `work.completed` (worker) + one `work.accepted` (acceptor) + one `heartbeat.decision` (supervisor) + one receipt + journal `completed` + exactly one LLM request. The preserved Phase 3 harness could NOT be restarted (its 127.0.0.1:5433 binding is occupied by unrelated `medusa-build-pg` — untouched), so a dedicated isolated Phase 4 harness was created per instructions; shared `io_pg`/`io_dev` never used. |
| Rollback boundary | Revert Phase 4 files together: `supervisor-dispatch.ts` `acceptWork` seam (+ return member + import), `cold-start-e2e.integration.test.ts` (delete), `daemon.test.ts` mock surface pin, plus tasks.md/apply-progress.md check-mark + evidence log updates. D10: nothing else consumes the seam yet (no daemon/CLI caller); the supervision/recovery paths are byte-unchanged. Reverting 4.1–4.2 never removes Phase 1–3 work. |

## TDD Cycle Evidence (Phase 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/business-domain/test/use-cases.test.ts` + `test/heartbeat.test.ts` | Unit | ✅ 14 files / 341 tests passing (baseline before edits) | ✅ 5 failed / 68 passed (73) — genuine failures: `appends EXACTLY ONE work.accepted` (deps.events undefined), `two novel accepts + one tick` (work.accepted not material), heartbeat `declares exactly the material set`, `declared work.accepted is material`, `sole novelty guard` | ✅ 73/73 passed after 2.2+2.3 | ✅ success + 4 typed failures (distinct pre-write paths) + 2 materiality scenarios + `heartbeat.decision`/`work.completed` legality invariants (typed-failure "appends nothing" tests held in RED — they guard pre-existing invariants) | ✅ Format normalized pre-freeze (1 file fixed) then converged; tsc clean; 0 lint findings in changed files |
| 2.2 | (same test files) | Unit | ✅ 341/341 baseline | N/A (RED from 2.1) | ✅ 73/73 passed (deps widened + conditional append) | ➖ covered by 2.1 cases | ✅ Clean |
| 2.3 | (same test files) | Unit | ✅ 341/341 baseline | N/A (RED from 2.1) | ✅ 73/73 passed (materiality declared) | ✅ 3 heartbeat scenarios: declared material, at-or-before-cursor, sole novelty guard | ✅ Clean |

## Work Unit Evidence (Phase 2)

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result | RED: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/use-cases.test.ts packages/business-domain/test/heartbeat.test.ts` → `Test Files 2 failed (2); Tests 5 failed | 68 passed (73)`. GREEN: same command → `Test Files 2 passed (2); Tests 73 passed (73)`. |
| Runtime harness command/scenario and exact result | `N/A` — source-true: this work unit is domain behavior exercised entirely through in-memory fakes (`InMemoryWorkRepository`, `InMemoryBusinessEventRepository`); there is no DB, process, network, or daemon boundary anywhere in the changed code. The focused Vitest commands above are the bounded proof. (Live-PG atomicity is Phase 3's runtime-boundary harness.) |
| Rollback boundary | Revert the 4 Phase 2 files together: `use-cases/accept-work.ts` (deps widening + append), `heartbeat.ts` (materiality constant), `use-cases.test.ts` caller updates + new tests, `heartbeat.test.ts` materiality scenarios; plus the two tasks.md/apply-progress.md check-mark updates. Nothing outside business-domain depends on the widened signature (D10: no production caller yet; Phase 3/4 seams not implemented). Reverting 2.1–2.3 never removes Phase 1 work (`work-accepted-event.ts` + test + index export remain valid standalone). |

## Check Gate (Phase 2) — `PATH=/data/node24/bin:$PATH pnpm check`

```
exit code: 0
$ pnpm run format-check && pnpm run typecheck && pnpm run build && pnpm run lint && pnpm run test
format-check → biome format .: Checked 209 files in 38ms. No fixes applied. (converged pre-freeze: 1 file fixed by `pnpm format` BEFORE the gate, then re-verified non-mutating)
typecheck    → tsc -p tsconfig.json: clean
build        → tsc -p tsconfig.build.json: clean
lint         → biome lint .: 0 errors (9 pre-existing warnings only in untouched files: parity.test.ts ×6, worker-reconcile.test.ts ×1, business-pg-roundtrip.integration.test.ts ×2)
test         → vitest run: Test Files 99 passed | 3 skipped (102); Tests 1366 passed | 6 skipped (1372); Duration 23.64s (per bound raw log)
full log sha256: 5d9d61d24ca5f09168ba8751ff4c57aecd27fc7bed97efb50b6cba3f889a66fa (157 lines)
evidence artifact: `evidence/phase-2-check-gate.log` (10 lines, sha256 a294f5c395ffc9a270e8e03be4c7f0f0b3e8fa0cfa28ce2187475261937e005d) — bounded, privacy-scrubbed, in-repo inspectable transcript of this run; counts bound: 209 files checked, 0 lint errors (9 pre-existing warnings), Test Files 99 passed | 3 skipped, Tests 1366 passed | 6 skipped.
```

## Verification Evidence (Phase 2)

### RED (2.1) — focused command
```
Test Files  2 failed (2)
     Tests  5 failed | 68 passed (73)
  × declares exactly the material set from the design
  × treats a declared work.accepted event as material
  × cursor remains the sole novelty guard: two novel accepts, one tick, exactly one activate
  × appends EXACTLY ONE work.accepted event (evt:acc:{workId}, source acceptor) after the successful CAS
  × two novel accepts + one tick ⇒ exactly one activate (use-cases)
```
Proven before any production change: `acceptWork` still had the old signature (no `events` dep) and `work.accepted` was still undeclared.

### GREEN (2.2 + 2.3) — same focused command
```
Test Files  2 passed (2)
     Tests  73 passed (73)
```

### Relevant business-domain suite — `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test`
```
Test Files  14 passed (14)
     Tests  346 passed (346)   # baseline 341 + 5 new; zero regressions
```

### Gates (Phase 2)
- `pnpm run format-check` — converged (checked 209 files, no fixes applied; one `pnpm format` fix applied to the test file BEFORE freeze, then re-verified convergent)
- `pnpm run typecheck` — clean (tsc, no errors)
- `pnpm run lint` — 0 findings in changed files (9 pre-existing warnings in untouched files, unchanged from Phase 1)
- `pnpm check` — exit 0 (exactly once, after normalization)

## Contract Proof (Phase 2 — spec work-lifecycle Atomic Acceptance Fact + heartbeat Declared Material Event Types)

- Success appends EXACTLY ONE `work.accepted` event: `eventId = evt:acc:{workId}`, `eventType:'work.accepted'`, `aggregateKind:'work'`, `aggregateId: workId`, `source:'acceptor'`, `payload = { workId, state:'accepted', actor: proposer }` — built from the CAS-winning Work via the Phase 1 pure builder (D3/D4).
- Every typed failure (`version-conflict`, `invalid-transition`, `not-found`, `invalid-command`) resolves PRE-WRITE inside `applyWorkTransition` — `{ok:false}` values, never throws — and the event log stays empty (verified per-failure).
- `now?` is threaded into the builder; `occurredAt` stays excluded from identity (no identity change — the Phase 1 determinism tests still pass).
- Zero `@io/*` imports: `accept-work.ts` imports only `../ports/repositories.js`, `../types.js`, `../work-accepted-event.js`, `./result.js`; the recursive src-wide `@io/` boundary test in heartbeat.test.ts still passes.
- Materiality: `MATERIAL_EVENT_TYPES` is exactly `['work.accepted', 'work.completed']`; `heartbeat.decision` stays undeclared → non-material → never renews novelty (test holds); cursor functions unchanged — `resolveCursorIndex`, `hasMaterialNovelty`, `escalationModelFor`, `evaluateHeartbeat`, `tailCursor` are byte-unchanged (D5/D9: cursor stays the SOLE novelty guard; no second guard, no clock trigger).
- One tick with two novel accepts → exactly one `activate` (binary gate); accepted events at/before the cursor → `no-llm-heartbeat` (test holds).
- Non-accept transitions untouched: `proposeWork`/`startWork`/`completeWork`/`verifyWork`/`rejectWork` signatures and results unchanged (only `acceptWork` gained the `events` dep — "Only the accept transition emits work.accepted", D1/D7).

## Files Changed (Phase 2)

| File | Action | Lines | What |
|------|--------|-------|------|
| `packages/business-domain/src/use-cases/accept-work.ts` | Modified | +15/−6 | Deps widened to `{ work, events, now? }`; append `buildWorkAcceptedEvent` only on `ok:true`; typed failures resolve pre-write (D1, D6) |
| `packages/business-domain/src/heartbeat.ts` | Modified | +7/−2 | `MATERIAL_EVENT_TYPES` → readonly `['work.accepted','work.completed']` + doc note; filter/cursor untouched (D5, D9) |
| `packages/business-domain/test/use-cases.test.ts` | Modified | +56/−8 | All 6 `acceptWork` callers updated; success-append + 4 typed-failure no-append + two-accepts-one-tick tests; `evaluateHeartbeat` import |
| `packages/business-domain/test/heartbeat.test.ts` | Modified | +28/−3 | Material-set declaration updated; declared-accepted-is-material, at-or-before-cursor, sole-novelty-guard scenarios |
| `openspec/changes/cold-start-discovery/tasks.md` | Modified | — | Checked 1.4 (commit `18cddf0`), 2.1–2.3; 2.4 stays unchecked |
| `openspec/changes/cold-start-discovery/evidence/phase-2-check-gate.log` | Created | +10 | Bounded, privacy-scrubbed transcript of the Phase 2 `pnpm check` gate run; sha256 `a294f5c3…e005d`, raw full-log digest `5d9d61d2…a66fa` bound |

## TDD Cycle Evidence (Phase 3)

| Task | Test File | Layer | RED | GREEN | REFACTOR |
|------|-----------|-------|-----|-------|----------|
| 3.1 | `business-pg-roundtrip.integration.test.ts` + `fakes.test.ts` | Integration (live PG) + Unit | ✅ collect fail `Cannot find module '../src/accept-work-flow.js'`; fakes `1 failed | 73 passed (74)` | ✅ live-PG `60 passed (60)` (7 new); fakes `74 passed (74)`; boundary pin updated | ✅ Biome normalized pre-freeze; tsc clean; 0 lint findings in changed files |
| 3.2 | (same) | Integration (live PG) | N/A (RED from 3.1 — missing module) | ✅ `60/60` (flow created, mirrors complete-work-flow.ts:28) | ✅ Clean |
| 3.3 | `boundary.test.ts` | Unit (pin) | ⚠️ pin failed with new export (expected surface growth) | ✅ database suite `352 passed | 1 skipped (353)` | ✅ Clean |

## Work Unit Evidence (Phase 3)

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result | RED: `pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts` → `Failed Suites 1` (`Cannot find module '../src/accept-work-flow.js'`); fakes → `1 failed | 73 passed (74)`. GREEN: same live-PG command → `1 passed (1); 60 passed (60)`; fakes → `74 passed (74)`. Isolated GREEN rerun (exactly once, 2026-08-11): 60/60, raw in `phase-3-focused-live-pg.log`. |
| Runtime harness command/scenario and exact result | **LIVE PostgreSQL (isolated)** (real boundary): `DATABASE_URL` → exclusive harness `io-phase3-iso-pg-ca93986d` on `127.0.0.1:5433`; `pgReachable()` true → suite executes, NOT skipped. 7 atomic cases on real PG 18.4 (success commit, 4 empty-tx typed failures, post-CAS rollback via `uq_business_event_event_id`, duplicate-accept invalid-transition). Sequential. Full gate rerun (2026-08-13, once, same isolated target, raw in `phase-3-check-gate.log`): exit 0, `99 passed | 3 skipped (102); 1378 passed | 6 skipped (1384)`. |
| Rollback boundary | Revert Phase 3 files together: `accept-work-flow.ts` (delete), `database/src/index.ts` export, `ports/fakes.ts` acceptor branch, 7 integration cases + TRUNCATE + imports, 3 fakes scenarios, boundary pin; plus SDD artifact updates. D10: nothing outside database/business-domain consumes the seam yet (Phase 4 untouched). Reverting 3.1–3.3 never removes Phase 1/2 work. |

## Exact Accounting (complete Phase 3 candidate vs `9fada4b`, after this correction)

- Measured from disk: `git diff --numstat 9fada4b` (tracked) = **338 changed lines (318 ins / 20 del)**; untracked candidate files = **177 lines**; committed candidate = **515 changed lines ≤ 520 ✓** (505 at review + 10 final-disposition artifact lines). Excludes machine-local `.pi/` tooling state (pre-existing, not a candidate file) and the tracked `phase-2-check-gate.log` (baseline in `9fada4b`).
- Per-file: `business-pg-roundtrip.integration.test.ts` +175/−5; `apply-progress.md` +73/−9; `phase-3-scratch-lineage.log` +64; `fakes.test.ts` +48; `accept-work-flow.ts` +39; `phase-3-check-gate.log` +32; `phase-3-isolated-harness.md` +29; `fakes.ts` +13/−1; `phase-3-focused-live-pg.log` +13; `tasks.md` +5/−5; `boundary.test.ts` +3; `index.ts` +1. (Untracked files count as full additions from disk.)

## Raw Proof Inventory (all in-repo, self-contained; no `/tmp` dependency, no digest-only)

| File | Lines | Content |
|------|-------|---------|
| `packages/database/src/accept-work-flow.ts` | 39 | Atomic acceptance seam (frozen implementation) |
| `evidence/phase-3-check-gate.log` | 32 | Raw bounded full-gate bytes: `pnpm check` run exactly once vs isolated harness, exit 0, 99/3 skipped, 1378/6 skipped, all 9 lint warnings raw |
| `evidence/phase-3-scratch-lineage.log` | 64 | Fresh scratch DB `io_scratch_lin_20260813a` verbatim lineage: pre-absence→CREATE→identity→baseline-0→001–011 manifest→readback→DROP→post-absence |
| `evidence/phase-3-isolated-harness.md` | 29 | Harness identity, corrected shared-DB truth, isolation proof, defect/fix |
| `evidence/phase-3-focused-live-pg.log` | 13 | Raw focused run: 60 passed (60), exit 0 |
| `evidence/phase-4-focused-red.log` | 16 | Raw RED: `composed.acceptWork is not a function`, 1 file / 2 tests failed (captured before any production change) |
| `evidence/phase-4-focused-green.log` | 18 | Self-contained GREEN: exact command (`PATH=/data/node24/bin:$PATH`, credential-free isolated `DATABASE_URL` → 127.0.0.1:5434), harness `io-phase4-iso-pg-3cdff5d7` (postgres:18.4), 1 passed (1), 2 passed (2), exit 0 — metadata labeled, captured runner output preserved |

## Exact Accounting (complete Phase 4 candidate vs `a5315ea`, work unit phase-4-production-composition-e2e)

- **Prior gate (before this correction)**: complete candidate = **313 changed lines ≤ 400 ✓** = **73 tracked + 240 untracked**. Tracked `git diff --numstat a5315ea` = 73 changed lines (63 ins / 10 del): `supervisor-dispatch.ts` +11, `daemon.test.ts` +4, `tasks.md` +2/−2, `apply-progress.md` +46/−8. Untracked candidate files = 240 lines: `cold-start-e2e.integration.test.ts` 215, `phase-4-focused-red.log` 16, `phase-4-focused-green.log` 9. (The stale 255 counted only source/test 15 + untracked 240, omitting the 58 artifact-delta lines.)
- **Final (after this evidence-only correction)**: complete candidate = **329 changed lines ≤ 400 ✓** = **80 tracked + 249 untracked**. Tracked `git diff --numstat a5315ea` = 80 changed lines (70 ins / 10 del): `supervisor-dispatch.ts` +11, `daemon.test.ts` +4, `tasks.md` +2/−2, `apply-progress.md` +53/−8 (Fresh-Context Gate Correction Record + accounting rewrite). Untracked candidate files = 249 lines: `cold-start-e2e.integration.test.ts` 215, `phase-4-focused-red.log` 16, `phase-4-focused-green.log` 18 (self-contained header added; raw bytes untouched).
- Excludes machine-local `.pi/` tooling state (pre-existing, not a candidate file) and all Phase 1–3 files (baseline in `a5315ea`).

## Final Review & Delivery Disposition (2026-08-13)

- **Candidate target**: `sha256:9588732033091379de97bf3e5a8b0ef4766a8524f3be6f08ab3274faee13b3cf` (Phase 3 complete candidate; 505 ≤ 520 ✓).
- **Review (lineage `review-9588732033091379`)**: 4 reviewer artifacts admitted — risk/resilience CLEAN; readability SUGGESTION; reliability WARNING (fake `appendIfAbsent` parity); no BLOCKER/CRITICAL.
- **Native gate**: Gentle AI 2.4.0-rc.6 returned terminal `native_stop_required`, no receipt; occurrence at https://github.com/Gentleman-Programming/gentle-ai/issues/3115#issuecomment-5276050719.
- **User decision**: report-and-continue — provider-owned decline executed once (action declined, consent `declined_this_candidate`, exact target matched); RDD NOT disabled; delivery for this exact candidate proceeds unmanaged under ordinary repository policy.
- **Terminal artifact gate**: PASS — raw full gate exit 0 (`1378 passed | 6 skipped`); focused isolated live-PG `60/60`; reviewed candidate `505`, committed candidate `515`, both ≤ 520. Proceed token (orchestrator-held) `sha256:e519faf4835e8e0e8fcb5544000b9cbed9dd3fffbafc809a6a5ad44050734299`; max artifact changes 30.
- **Task 3.4**: committed `feat(database): add atomic acceptance transaction` (exact subject; no receipt/native approval claimed).

## Remaining Tasks

- [x] Phase 4: 4.1–4.2 (composition surface + real-path e2e) — 4.3 commit PENDING (parent-owned)
- [ ] Phase 4: 4.3 Commit `feat(app): surface atomic accept in supervisor dispatch and prove cold-start e2e`
- [ ] Phase 5: 5.1–5.3 (spec alignment, check-only gates, archive readiness)

## Deviations from Design

None — implementation matches design D1 (`{ work, events, now? }`, append on `ok:true`, local to `acceptWork`), D4 (builder unchanged), D5 (`['work.accepted','work.completed']`), D6 (typed failures resolve pre-write; post-CAS duplicate `append` propagates for the Phase 3 rollback), D7 (no other transition touched), D9 (cursor untouched).
- **Phase 3**: None — matches D2 (one `conn.transaction` binding work+event repos; commit-on-resolved, rollback-on-throw), D4 (acceptor one-shot `evt:acc:{workId}`), D6 (typed failures pre-write `{ok:false}`; only a throw rolls back), spec seam extension. `acceptWorkAtomically` exactly `(conn, cmd)` (D2); `occurredAt` excluded from identity. Evidence corrections added no source/test/spec/design change.
- **Phase 4**: None — matches D10 exactly (`acceptWork: (cmd) => acceptWorkAtomically(connection, cmd)` on `buildSupervisorDispatch`'s return; supervision/recovery paths byte-unchanged). The daemon test mock gained an `acceptWork: vi.fn()` surface pin (return type grew); the e2e drives `startSupervisor` with the injectable one-shot schedule and never invokes `onActivate`/`onRecovery` directly (no `seedAcceptedWork`, no hardcoded company callbacks).

## Rollback Boundary (work units)

- **Phase 2**: Revert the 4 Phase 2 source/test files together; nothing else depends on the widened `acceptWork` signature (D10). Phase 1 files remain valid standalone — not part of this unit's rollback.
- **Phase 3**: Revert the 6 Phase 3 source/test files together (see Work Unit Evidence, rollback row). Reverting 3.1–3.3 never removes Phase 1/2 work and never touches Phase 4+.
- **Phase 4**: Revert the 4 Phase 4 files together (see Work Unit Evidence, rollback row). Reverting 4.1–4.2 never removes Phase 1–3 work and never touches Phase 5 (5.1–5.3 untouched).
