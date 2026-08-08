# Apply Progress: heartbeat-decision-events (PR 1 + PR 2 + remediation)

**Change**: heartbeat-decision-events | **Project**: io | **Mode**: Strict TDD (RED→GREEN per task) | **Artifact store**: hybrid (openspec + engram)
**Date**: 2026-08-08

## Status

ALL tasks COMPLETE: PR 1 tasks 1.1–1.10 (committed `a673db5`) + PR 2 tasks 2.1–2.5 (committed `8f165d5`). Verify phase returned **FAIL** with CRITICAL finding #1: the live-PG test performed two SEQUENTIAL `appendIfAbsent` calls, never executing the spec-required CONCURRENT race ("PostgreSQL conditional append is single-issuance"). REMEDIATION (this run, work-unit `remediation-concurrent-race-test`): added the missing concurrent race test — staged in the working tree, commit deferred to orchestrator (planned message `test(database): add concurrent appendIfAbsent race test (verify remediation)`).

## PR 1 — TDD Cycle Evidence (completed, committed a673db5)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/business-domain/test/heartbeat-decision-event.test.ts` | Unit | N/A (new) | ✅ 10/10 fail (module absent) | ✅ 10/10 pass | ✅ 7 cases | ✅ Clean |
| 1.2 | `src/heartbeat-decision-event.ts` + index export | Unit | N/A (new) | (covered by 1.1) | ✅ 10/10 pass | ➖ Same | ✅ Clean |
| 1.3 | `packages/business-domain/test/fakes.test.ts` | Unit | ✅ 61/61 | ✅ 6/6 fail | ✅ 67/67 pass | ✅ 4 cases | ✅ Clean |
| 1.4 | `src/ports/repositories.ts` + `src/ports/fakes.ts` | Unit | (covered by 1.3) | (covered by 1.3) | ✅ 67/67 pass | ➖ Same | ✅ Clean |
| 1.5 | `supervisor.test.ts` (TracingEvents) + `worker-helpers.ts` (RecordingEvents) | Compile | ✅ 152/152 | (interface change) | ✅ typecheck green | ➖ Structural | ✅ Clean |
| 1.6 | `packages/database/test/business-adapters.test.ts` | Unit | ✅ 38/38 | ✅ 4/4 fail | ✅ 42/42 pass | ✅ 4 cases | ✅ Clean |
| 1.7 | `src/business-event-adapter.ts` | Unit | (covered by 1.6) | (covered by 1.6) | ✅ 42/42 pass | ➖ Same | ✅ Clean |
| 1.8 | `business-event-roundtrip.integration.test.ts` | Live PG (sequential) | ✅ 11/11 | (unit-cycle RED) | ✅ 13/13 live PG | ✅ 2 cases | ✅ Clean |
| 1.9 | `packages/business-domain/test/heartbeat.test.ts` | Unit (approval pin) | ✅ 28/28 | (behavior satisfied, documented) | ✅ 29/29 pass | ✅ 2 cases | ✅ Clean |
| 1.10 | Gate | Full | — | — | ✅ see PR 1 gates | — | — |

## PR 2 — TDD Cycle Evidence (completed, committed 8f165d5)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/app/test/supervisor/supervisor.test.ts` | Unit | ✅ 22/22 (supervisor+deps+dispatch files) | ✅ 8 failed on the new/updated decision-event assertions (tick.ts not wired) | ✅ 25/25 pass | ✅ 7 scenarios (no-llm append+pre-append tail; both branches payload; retry no-dup; append fail→retry; callback-throw retry; sequential per-company appends; consumed/renewed sequence) | ✅ Clean (assertion corrections from real pre-append-tail semantics) |
| 2.2 | `packages/app/src/supervisor/tick.ts` | Unit | (covered by 2.1) | (covered by 2.1) | ✅ 25/25 pass | ➖ Same | ✅ Clean (doc comment renumbered 5→7) |
| 2.3 | seam: recorded no-op test (`supervisor.test.ts`) | Unit | (covered by 2.1) | ✅ RED: stream-length assertion failed (no decision event yet) | ✅ GREEN: seeded event + exactly one supervisor `heartbeat.decision`, no Work started | ✅ 2 assertions | ✅ Clean |
| 2.4 | `daemon/byte-identity.test.ts` (approval pin) | Unit | ✅ 3/3 | ✅ RED: `tick.ts` hash drift caught by full suite | ✅ 3/3 pass (pin updated to wired bytes; 8 other cores unchanged) | ✅ 9 hashes verified | ✅ Clean (pin + doc comment) |
| 2.5 | Gate | Full | — | — | ✅ see PR 2 gates | — | — |

## Work Unit Evidence (PR 2)

| Evidence | Required value |
|---|---|
| Focused test command + result | `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/supervisor/supervisor.test.ts packages/app/test/composition/supervisor-dispatch.test.ts packages/app/test/composition/supervisor-deps.integration.test.ts` → exit 0; 3 files, **25 tests passed** (baseline 22 → +3 new: both-branches payload, retry no-dup, append-failure) |
| Runtime harness + result | Declared `N/A` by tasks.md (wiring runs over the port seam proven in PR 1; no new I/O boundary). Live-PG integration suite re-run anyway (sequential): `supervisor-deps.integration.test.ts` 4/4 — the supervisor flow now writes decision events through the REAL `PgBusinessEventRepository.appendIfAbsent` into `io_dev` (asserted: 2 decision rows after two ticks, cursor = decision event id) |
| Rollback boundary | Revert PR 2 commit: `tick.ts` back to byte-identical baseline (restore pre-PR2 `b8e81aab...` pin), drop the 3 new tests + revert the 4 updated/extended tests, restore `byte-identity.test.ts` tick.ts pin; PR 1 port stays inert and committed |

## PR 2 Gate results (task 2.5)

- `pnpm run format-check` → exit 0 (196 files)
- `pnpm run typecheck` (tsc strict) → exit 0
- `pnpm run build` (tsc no-emit) → exit 0
- `pnpm run lint` (biome) → exit 0
- Full suite SEQUENTIAL (`pnpm vitest run --no-file-parallelism`) → exit 0; **1139 passed / 6 skipped / 0 failed** (89 files)
- `pnpm test` (parallel, for the record) → exit 0 THIS run; 1139 passed / 6 skipped / 0 failed — the pre-existing live-PG parallel flake did not trigger (PR 1 documented it as intermittent; sequential remains the project's documented live-PG mode)
- Byte-identity: `cycle.ts`, `evaluate.ts`, `supervisor.ts`, `types.ts`, `worker.ts`, dispatch cores byte-identical (pinned hashes unchanged); ONLY `tick.ts` deliberately changed
- `heartbeat.decision` ∉ `MATERIAL_EVENT_TYPES` — pinned by `heartbeat.test.ts` (passed in full run); context segment 12 absent
- No new runtime deps (`packages/app` deps pin passed) and no migration (`business_event` + `uq_business_event_event_id` untouched — no SQL diff)

## Measured changed-line count (candidate `pr2-tick-wiring`)

- `git diff HEAD --numstat`: **205 insertions + 15 deletions = 220 changed lines** (vs work-unit budget max_changed_lines=300) ✓
- Per-file: `tick.ts` 9+4 (production wiring is ~13 lines incl. doc comment); `supervisor.test.ts` 173+9; `supervisor-deps.integration.test.ts` 16+1; `byte-identity.test.ts` 7+1

## Files changed (PR 2, this run)

| File | Action | What |
|------|--------|------|
| `packages/app/src/supervisor/tick.ts` | Modified | `buildHeartbeatDecisionEvent` import; `await deps.events.appendIfAbsent(buildHeartbeatDecisionEvent(companyId, decision, cursor))` after gate + tail read, before `onActivate`/upsert; never catches append errors; doc comment renumbered (append step 5, callback 6, checkpoint 7) |
| `packages/app/test/supervisor/supervisor.test.ts` | Modified | `decisionEvents` helper; extended no-llm test (one decision appended before pre-append-tail checkpoint); NEW both-branches payload test; NEW retry-no-dup test; NEW append-failure test; extended sequential test (per-company decision appends); extended consumed/renewed test (decision kind sequence); updated fresh-resume + recorded-no-op + throwing-callback cursor assertions to pre-append-tail semantics |
| `packages/app/test/composition/supervisor-deps.integration.test.ts` | Modified | Live-PG two-tick test: cursor = decision event id; asserts 2 `heartbeat.decision` rows in real PG |
| `packages/app/test/daemon/byte-identity.test.ts` | Modified | `tick.ts` pin updated to wired bytes (deliberate approval update; 8 other cores unchanged) |

## Deviations from design (PR 1 + PR 2)

None — implementation matches design.md exactly: PRE-append tail checkpoint (decision event is the log of the evaluation, never the checkpoint), `appendIfAbsent` before `onActivate`/upsert, append errors never caught, both branches emit, `!companyId` guard preserved.

## Issues found (PR 1 + PR 2)

1. **Pre-append tail semantics discovered during GREEN**: after a tick that appended a decision event, the NEXT tick's pre-append tail is that decision event, so the cursor checkpoints to it (correct — this consumes novelty after a successful retry and matches design's "~1 row/tick/company (by design)"). Three initial test assertions assumed the cursor stayed at the seeded event; corrected to the decision-event id. The implementation was right; the tests were wrong.
2. `daemon/byte-identity.test.ts` pins `tick.ts` in its protected set — PR 2's point is to change exactly that file, so its pin was updated deliberately (approval-pin protocol); the other 8 cores stayed byte-identical, satisfying "Existing paths remain unchanged".
3. Parallel `pnpm test` flake (live-PG TRUNCATE races) did not trigger this run; sequential `--no-file-parallelism` remains the documented live-PG gate mode.

---

# REMEDIATION — verify CRITICAL #1: concurrent appendIfAbsent race test

**Binding**: verify-report evidence_revision `sha256:c33bd29792a1191c5657c9197fb8564cac4bd5c347ce7cd481f278de21c24ef2` | work-unit `remediation-concurrent-race-test` | max_changed_lines=120, max_attempts=3 (attempt 1)

**Context**: verify flagged scenario "PostgreSQL conditional append is single-issuance" as ⚠️ PARTIAL — the live-PG test did two SEQUENTIAL `appendIfAbsent` calls and never executed the spec's concurrent race. The spec GIVEN is "concurrent conditional appends with one event ID"; `ON CONFLICT (event_id) DO NOTHING` is correct static evidence but Strict TDD requires a passing covering runtime test. THIS RUN: test-only remediation, ZERO production code changes, no new runtime deps, no migration.

## TDD Cycle Evidence (remediation)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| R.1 | `packages/database/test/business-event-roundtrip.integration.test.ts` — NEW `it('two CONCURRENT appendIfAbsent calls with the SAME event_id leave EXACTLY ONE original row (ON CONFLICT resolves the race)')` | Live PG (sequential gate) | ✅ 13/13 baseline (pre-change run of the same file) | ✅ Test written first for the spec's concurrent GIVEN (would FAIL if ON CONFLICT race handling were absent: unique-violation reject, 2 rows, or divergent resolves); no production change possible/needed — behavior already correct | ✅ 14/14 pass, exit 0 | ✅ 2 cases: sequential duplicate (existing) + concurrent race (new) with a DIFFERENT tampered payload/occurredAt racing the original — convergence assertion (`first` toEqual `second`) is race-winner-independent | ➖ None needed (test-only change; no production code touched) |

## Work Unit Evidence (remediation)

| Evidence | Required value |
|---|---|
| Focused test command + exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run business-event-roundtrip.integration.test.ts --no-file-parallelism` → **exit 0**; **14 passed / 0 failed / 0 skipped** (13 baseline + 1 new concurrent race test) |
| Runtime harness + exact result | Real PostgreSQL (`io_dev`, docker-compose): the race test fires TWO `appendIfAbsent` INSERTs concurrently via `Promise.all` over a `pg.Pool` (distinct pool clients) — one INSERT wins the 006 UNIQUE index, the loser's `ON CONFLICT DO NOTHING` no-ops and SELECTs the stored original. Asserted: both resolves converge (`first` toEqual `second`), exactly 1 row, stored row equals the converged fact. Re-run 5× with `-t "CONCURRENT"` → 5/5 pass (both race outcomes deterministic) |
| Rollback boundary | `git restore --staged --worktree packages/database/test/business-event-roundtrip.integration.test.ts` (or revert the single staged file) — zero production impact; PR 1 + PR 2 committed history untouched |

## Remediation gate results

- `PATH=/data/node24/bin:$PATH pnpm vitest run business-event-roundtrip.integration.test.ts --no-file-parallelism` → exit 0; 1 file, **14 passed / 0 failed / 0 skipped** (was 13/13)
- Flake probe: same concurrent test re-run 5× (`-t "CONCURRENT"`) → 5/5 passed — race-winner-independent assertions are deterministic
- `pnpm exec tsc -p tsconfig.json --noEmit` → exit 0
- `pnpm exec biome format` (file) → exit 0 (no fixes needed)
- `pnpm exec biome lint` (file) → exit 0 (no errors)
- NOTE: `biome check` (assist/organizeImports) flags a PRE-EXISTING import-order assist on this file at HEAD — unenforced: `pnpm check` runs `biome format` + `biome lint`, not `biome check`; verify phase already confirmed exit 0 on 196 files. Not introduced by this change.

## Measured changed-line count (candidate `remediation-concurrent-race-test`)

- `git diff HEAD --numstat` on `packages/database/test/business-event-roundtrip.integration.test.ts`: **29 insertions + 0 deletions = 29 changed lines** (vs work-unit budget max_changed_lines=120) ✓
- Single file, single added test (~29 lines incl. spec-binding comments); NO production files touched

## Files changed (remediation, this run)

| File | Action | What |
|------|--------|------|
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Modified (staged, NOT committed) | NEW test in `appendIfAbsent — at-most-once conditional append (live PG, sequential)` describe: `Promise.all` of two `appendIfAbsent` calls with SAME eventId, DIFFERENT payload/occurredAt; asserts both resolves converge on the same fact, exactly ONE original row, stored row equals the converged fact — directly covering spec scenario "PostgreSQL conditional append is single-issuance" (GIVEN concurrent conditional appends) |

## Deviations from design (remediation)

None — test-only addition. No production code, no runtime deps, no migration.

## Issues found (remediation)

1. Pre-existing, unenforced `assist/organizeImports` assist flag on this file at HEAD (imports at lines 1–9) — verified identical on `git show HEAD:...`; `pnpm check` does not run biome assists, so the project gate stays green. Left untouched (out of scope, test-only remediation).
2. Verify SUGGESTION #2 (update the leading `PgBusinessEventRepository` class comment describing the surface as exactly `append + listByCompany`) is deliberately NOT applied: it is a production-code change and this remediation run forbids production edits. Should be a follow-up chore.

## Next recommended

Re-run `sdd-verify` (the concurrent race test now covers the 21/21 scenario; expect the Append-Only Repository Port requirement to close 3/3) → orchestrator native review + work-unit commit (`test(database): add concurrent appendIfAbsent race test (verify remediation)`) → archive.
