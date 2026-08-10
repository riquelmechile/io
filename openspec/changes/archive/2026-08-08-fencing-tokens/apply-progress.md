# Apply Progress: Fencing Tokens (Slices 1 + 2 — Work-Level + Journal Fencing, PR 1 + PR 2)

**Change**: fencing-tokens | **Slices**: 1 (Phase 1 tasks 1.1–1.9) + 2 (Phase 2 tasks 2.1–2.7) | **Mode**: STRICT TDD (RED→GREEN per task)
**Delivery**: auto-chain, stacked-to-main. NO COMMIT (orchestrator runs RDD review + commit flow).
**Artifact store**: HYBRID — this file + Engram `sdd/fencing-tokens/apply-progress` (topic_key, project 'io').
**Work-unit contract (Slice 2)**: focused `PATH=/data/node24/bin:$PATH pnpm test packages/database/test/idempotency-adapter.test.ts` → **1 file, 29 passed**; runtime harness: live-PG stale-rollback + marker-restart + journal fencing e2e with `--no-file-parallelism` → **2 files, 50 passed**; race hammer **45/45 consecutive passes** (25 full-suite + 20 focused), zero throws.

## Summary

Slice 1 shipped work-level fencing (zombie-writer protection): migration 010 (both columns), `Work.fencingToken` (+ required-field ripple), `FencingDirective` + `'fencing-conflict'` CasResult, fake + PG work-adapter mint/check, use-case threading, worker claim-capture + finalize terminal directive, byte-identity re-pin, parity, live-PG claim→close e2e.

Slice 2 shipped journal fencing: `fencingToken` on `NewJournalEntry`/`JournalEntry`, token-gated `markRetryable(attemptId, token)` (fake + PG `AND fencing_token=$5`), status-guarded token-free `complete` (`AND status='in_flight'`), token stored pre-effect in `insertInFlight`, worker cycle threading (claim token → pre-effect insert → markRetryable), byte-identity re-pin #2, journal fake↔PG parity, and live-PG journal e2e. **CRITICAL: the pre-existing live-PG race flake is FIXED** — `insertInFlight` now uses no-target `ON CONFLICT DO NOTHING`, which arbitrates BOTH unique indexes (`company_id, idempotency_key` AND `attempt_id`); proven by a deterministic unit-level double + a 25-iteration live-PG hammer + 45 consecutive suite passes.

## Tasks Completed (RED→GREEN evidence) — Slice 1

| Task | Test File (RED) | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------------|------------|-----|-------|-------------|---------|
| 1.1 Migration 010 | `database/test/sql-migrations.test.ts` | ✅ 24/24 | ✅ 4 failed (file missing) | ✅ 28/28 | ✅ 4 cases (2 tables, IF NOT EXISTS) | ➖ None needed |
| 1.2 Work.fencingToken | `business-domain/test/types.test.ts` + `database/test/row-guards.test.ts` | ✅ 1169 suite | ✅ tsc TS2353/TS2339 (field missing) | ✅ tsc 0 + 153/153 focused | ✅ 3 cases (epoch 0, monotonic, valid proposed) | ✅ field doc + ripple fixed |
| 1.3 FencingDirective + fake | `business-domain/test/fakes.test.ts` | ✅ 66/66 | ✅ 5 failed (no mint/check) | ✅ 71/71 | ✅ 6 cases (mint, 2nd claim, stale, matching, race, stale-version) | ➖ None needed |
| 1.4 Use cases | `business-domain/test/use-cases.test.ts` | ✅ 20/20 | ✅ tsc + 4 failed | ✅ 24/24 | ✅ 4 cases (mint, per-work epoch, stale token, version-only) | ✅ invalid 2nd-claim test replaced with per-work epoch |
| 1.5 PG work-adapter SQL | `database/test/business-adapters.test.ts` + `row-guards.test.ts` | ✅ 58/61 | ✅ 3 failed (no RETURNING/terminal SQL) | ✅ 93/93 + tsc 0 | ✅ 4 cases (claim RETURNING, stale version, terminal pin, stale token) | ✅ connection-fake extended for UPDATE…RETURNING |
| 1.6 Worker claim capture | `app/test/worker-claim.test.ts` | ✅ 3/3 | ✅ (new behavior pinned; mint already enabled by 1.4) | ✅ 5/5 | ✅ 3 cases (winner mints, loser no-mint, no-effect) | ➖ None needed |
| 1.7 Finalize terminal directive | `app/test/worker-finalize.test.ts` | ✅ 9/10 | ✅ tsc + 1 failed (stale-token) | ✅ 23/23 focused + byte-identity 7/7 | ✅ 3 cases (stale rollback, matching success, CAS-loss T2) | ✅ recover.ts threads retained token |
| 1.8 Parity | `app/test/parity.test.ts` | ✅ 5/5 | ✅ 3 failed (no PgWorkRepository import/parity block) | ✅ 8/8 | ✅ 3 cases (claim, stale-close, matching-close) | ➖ None needed |
| 1.9 Live-PG e2e | `database/test/business-pg-roundtrip.integration.test.ts` | ✅ 40/40 | ✅ (010 not applied in live setup → suite failed) | ✅ 43/43 + full gate | ✅ 3 cases (claim→close, stale, token-0 inert) | ✅ 010 applied in harness.ts + roundtrip setup |

## Tasks Completed (RED→GREEN evidence) — Slice 2

| Task | Test File (RED) | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------------|------------|-----|-------|-------------|---------|
| 2.1 Port: token on NewJournalEntry/JournalEntry | `business-domain/test/idempotency.test.ts` | ✅ 67 suite | ✅ 13 tsc errors + 2 runtime failures (complete guard, token threading) | ✅ 20/20 + 178/178 affected | ✅ 7 cases (token store pre-effect, token-free lookup, tenant scope, token-0 valid, complete rejects completed+marker, token-free UNRESOLVED, completeWork threads cmd.fencingToken) | ✅ worker terminal branch: aborted_retryable marker rows are NOT completed (status guard) — test updated to honest semantics |
| 2.2 markRetryable gate (fake) | `business-domain/test/idempotency.test.ts` | ✅ 20/20 | ✅ 1 failed (stale-token accepted) | ✅ 24/24 | ✅ 4 cases (matching marks+retains N, stale rejected unchanged, marker distinct, retry retains N) | ✅ worker-finalize STALE-close test updated: zombie cannot mark → fail loud (fencing mismatch), row stays in_flight under real claim |
| 2.3 PG adapter SQL + RACE FIX | `database/test/idempotency-adapter.test.ts` | ✅ 19/19 | ✅ 10 failed (6 SQL/behavior pins + 2 race + re-read) | ✅ 29/29 + 44/44 live-PG ×25 | ✅ 11 cases (token column, no-target ON CONFLICT, markRetryable AND fencing_token, stale reject, matching mark, complete status guard, complete rejects completed, lookup SELECT token, UNRESOLVED lands, 2 race-arbitration, re-read classifies) | ✅ deterministic RaceArbitratingConnection double (faithful PG index-arbitration model); pinned-SQL tests updated |
| 2.4 Worker reconcile threading | `app/test/worker-reconcile.test.ts` | ✅ 26/26 | ✅ 1 failed (marker token was 0 — racing double dropped the claim directive → claim never minted) | ✅ 30/30 | ✅ 4 cases (pre-effect insert carries token 1, CAS-loss marker persists WITH token N + retry retains N, stale reconcile fails loud, matching reconcile marks) | ✅ **fixed test-infra bug**: RacingWorkRepository.updateIfVersion in worker-reconcile AND parity dropped the `fencing` directive — forwarding it makes the claim mint (token stuck at 0 was masked before) |
| 2.5 Restart + byte-identity re-pin | `app/test/worker-restart.test.ts` + `daemon/byte-identity.test.ts` | ✅ 3/3 | ✅ 2 byte-identity failures (worker.ts SHA + normalization proof stale) | ✅ 7/7 byte-identity + 4/4 restart | ✅ 1 case (token N survives restart with marker; controlled retry uses N) | ✅ byte-identity proof extended to strip S2 threading (reconcile arg + terminal-branch in_flight guard); SHA re-pinned 32f55a40… |
| 2.6 Journal parity | `app/test/parity.test.ts` | ✅ 8/8 | ✅ vacuous RED (adapter parity landed at 2.3 — see note) | ✅ 13/13 | ✅ 5 cases (token store, matching mark, stale reject, token-0, reopen retains N — fake ≡ PG adapter each) | ➖ None needed |
| 2.7 Live-PG journal e2e | `database/test/business-pg-roundtrip.integration.test.ts` | ✅ 44/44 | ✅ vacuous RED (adapter gates landed at 2.3); the GENUINE RED was the live-PG race flake fixed at 2.3 + hammered here | ✅ 49/49 live-PG + 6/6 app e2e suites | ✅ 5 cases (token store live, matching mark + fresh-read restart durability, stale reject live, complete status-guard + UNRESOLVED live, stale-token atomic rollback e2e) | ✅ fixed test payload (completed with a well-formed Work — the D7 row guard rejects non-Work payloads) |

### Test Summary (Slice 2)
- **Total tests written**: ~39 new (1243 suite total at gate, up from 1204 at Slice 1)
- **Total tests passing**: 1243 (full gate, exit 0) | **Layers**: Unit + Integration (live PG) + E2E (live PG worker stack)
- **Approval tests**: None needed (no refactor of existing behavior; behavior CHANGED per spec where tests were updated — see Deviations)
- **Pure functions created**: `RaceArbitratingConnection` (deterministic PG ON CONFLICT arbitration double), `coveredByTarget` logic

## Work Unit Evidence (Slice 2 / PR 2)

| Evidence | Required value |
|---|---|
| **Focused test command + exact result** | `PATH=/data/node24/bin:$PATH pnpm test packages/database/test/idempotency-adapter.test.ts` → **Test Files 1 passed, Tests 29 passed** (exit 0). Task-level RED→GREEN above. |
| **Runtime harness command/scenario + exact result** | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/app/test/e2e/marker-restart.integration.test.ts --no-file-parallelism` → **2 files passed, 50 tests passed** (live PG: journal token store / stale markRetryable reject / matching mark + fresh-read restart durability / complete status guard + token-free UNRESOLVED / stale-token atomic rollback e2e / marker survives a fresh-connection restart). Full app e2e stack (worker-e2e, marker-restart, replay-deny, single-receipt, live-retry, harness): **6 files, 12 tests passed**. RACE HAMMER: 25× full-suite + 20× focused consecutive live-PG runs, **0 failures** (45/45). |
| **Rollback boundary** | Revert PR 2 (the 15 Phase-2 files + the 4 journal call-site files touched only mechanically); the journal `fencing_token` column stays inert at DEFAULT 0 (epoch = legacy, no backfill). Reverting PR 2 restores the pre-fencing journal behavior exactly (insert without token, unguarded markRetryable/complete). |

## Files Changed (Slice 2)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/ports/idempotency.ts` | Modified | `NewJournalEntry`/`JournalEntry` += required `fencingToken`; `markRetryable(attemptId, fencingToken)`; docs |
| `packages/business-domain/src/ports/fakes.ts` | Modified | token stored pre-effect; `complete` status guard (in_flight only, token-free); `markRetryable` token gate (stale → reject); DurableJournalFake signature |
| `packages/business-domain/src/use-cases/complete-work.ts` | Modified | idempotent `insertInFlight` passes `fencingToken: cmd.fencingToken ?? 0` |
| `packages/database/src/idempotency-adapter.ts` | Modified | INSERT += fencing_token column + **`ON CONFLICT DO NOTHING` (no target — race fix)**; markRetryable `AND fencing_token=$5`; complete `AND status='in_flight'` + throw on 0 rows; lookup SELECT += `fencing_token AS "fencingToken"` |
| `packages/app/src/worker/reconcile.ts` | Modified | `reconcilePreEffect` += `fencingToken` param → pre-effect insert |
| `packages/app/src/worker/worker.ts` | Modified | threads claim token into reconcilePreEffect; terminal branch completes ONLY in_flight rows (marker rows stay; honest UNRESOLVED returned every retry) |
| `packages/app/src/worker/finalize.ts` | Modified | T2(i) `markRetryable(input.attemptId, input.fencingToken)` — claim-gated |
| `packages/app/test/daemon/byte-identity.test.ts` | Modified | re-pinned worker.ts SHA (32f55a40…) + normalization proof extended for S2 threading |
| Tests | Modified | idempotency (+7+4), idempotency-adapter (+11 new + pins), worker-reconcile (+4, WARNING test honest semantics), worker-restart (+1), parity (+5 journal parity + double directive fix), worker-finalize (STALE-close honest semantics + token-consistent setup), fakes/worker-verify/dispatch/replay-deny/marker-restart (mechanical token ripple), business-pg-roundtrip (+5 journal e2e + 25× race hammer) |
| `openspec/changes/fencing-tokens/tasks.md` | Modified | Phase 2 tasks 2.1–2.7 marked `[x]` |

## Deviations from Design

1. **Line count exceeds forecast**: authored diff ≈1309/91 lines (vs tasks.md "PR2 ≈260"). Same pattern as Slice 1: the port-signature ripple (required `fencingToken` on NewJournalEntry/JournalEntry) touched every journal call site in 14 files, plus the byte-identity proof extension and the deterministic race double. Auto-chain was pre-approved; orchestrator may re-slice if desired.
2. **aborted_retryable rows are never completed by the worker terminal branch** (worker.ts): the spec's `complete` MUST reject any non-in_flight status (spec "Completion rejects non-in-flight status"), which forbids the pre-fencing behavior of completing a marker row with the UNRESOLVED sentinel. The worker now returns the typed `UNRESOLVED_REQUIRES_HUMAN` on every retry of a terminal-work key while leaving the marker row untouched (the terminal branch precedes any reopen, so no retry loop, no second effect, no second receipt). The WARNING worker-reconcile test was updated to this honest semantics.
3. **STALE-token close now fails loud instead of typed `cas-lost-retryable`** (worker-finalize STALE test): a zombie (wrong token) that loses the T1 CAS cannot mark the row retryable — the claim-ownership gate rejects the marker write (R4-001 fail-loud), the zombie's effect is undone, and the row stays in_flight under the REAL claim (self-healing clean-replay on a later recovery pass). Matches the design's "stale token → reject".
4. **2.4/2.6/2.7 RED was partially vacuous**: the port-signature change (2.1 GREEN) compile-forced the worker/adapter threading, so several worker-level and parity/live-PG contract tests were GREEN on first run. The GENUINE REDs were: 2.3 (10 failing SQL/race pins — the flake), 2.4 (marker token was 0 — the racing double dropped the claim directive), 2.5 (byte-identity pin). Noted for verify: the RED→GREEN table above distinguishes real vs contract-pinning RED.
5. **`completeWorkAtomically` cmd.fencingToken `?? 0`**: unclaimed admin idempotent closes store epoch token 0 (valid per spec "Pre-fencing row remains valid").

## Issues Found

- **FIXED (critical, pre-existing live-PG flake)**: "two concurrent terminal closes on the same key" failed ~10-25% on pristine main because `insertInFlight`'s `ON CONFLICT (company_id, idempotency_key) DO NOTHING` does NOT arbitrate the separate `UNIQUE(attempt_id)` index — PG checks unique indexes independently, so a same-attempt race threw a duplicate-key error. Fix: no-target `ON CONFLICT DO NOTHING` (arbitrates ANY unique constraint per PG docs). Proven: deterministic unit double (old SQL → throw; new SQL → typed 0-row), 25× live-PG hammer (25 keys × 2 concurrent same-attempt claims, zero throws), 45/45 consecutive suite passes.
- **FIXED (test-infra bug, exposed by 2.4)**: both `RacingWorkRepository` doubles (worker-reconcile + parity) dropped the third `fencing` directive in `updateIfVersion` — the claim never minted (token stuck at 0), masking the real minting path. Forwarded the directive.
- **worker-finalize closeReady + STALE tests updated**: journal seed tokens now match the minted claim token (the gate exposed token-0 seeds as inconsistent with a token-1 claim).

## Invariants Verified (task 3.2, Slice 2)

- business-domain: zero real `@io/*` imports (0 grep hits in src) ✓
- dispatch.ts / tick.ts / supervisor.ts / intent.ts: byte-identical, untouched (git diff empty; byte-identity suite pins them) ✓
- compiled context bytes: no `fencingToken`/`fencing_token` anywhere in `packages/context/src` ✓
- no new runtime dependencies; `openai` still confined to deepseek-client.ts ✓
- `complete` token-free (status guard only); honest T2(ii) UNRESOLVED close reachable (fake + PG + live-PG pinned) ✓
- replay path token-free ✓; token 0 valid epoch ✓

## Status

**7/7 Phase-2 tasks complete (16/16 across both slices). `pnpm check` GREEN (exit 0; format-check + tsc + build + biome lint + 1243 tests | 6 skipped). Live-PG runtime harness GREEN. Race flake FIXED and hammered (45/45). Ready for RDD review of PR 2 / verify gate (Phase 3).**
