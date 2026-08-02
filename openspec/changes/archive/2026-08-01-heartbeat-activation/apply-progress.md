# Apply Progress: Heartbeat Activation — Worker-Boundary Gate

Change: `heartbeat-activation` · Project: io · Baseline: main@24153c7
Mode: Strict TDD (RED → GREEN per task) · Artifact store: hybrid (OpenSpec + Engram)
Batch: **1 (only)** — single PR, tasks 1.1–5.1 (5.2 commit is the orchestrator's step, NOT done here)

## Status

**COMPLETE — awaiting review-gated commit by orchestrator.** All tasks 1.1–5.1 implemented, tested, and green. Working tree left uncommitted as instructed.

## Tasks done

- [x] **1.1 RED** — `packages/app/test/heartbeat/cycle.test.ts` created (decision table: empty stream → no-llm; unseen `work.completed` → activate flash; seen cursor → no-llm). Observed RED: `Cannot find module '../../src/heartbeat/cycle.js'`.
- [x] **1.2 GREEN** — `packages/app/src/heartbeat/cycle.ts` created: `evaluateHeartbeatGate(deps:{readonly events:BusinessEventRepository}, companyId:string, cursor?:HeartbeatCursor):Promise<HeartbeatDecision>` — thin delegate over `evaluateHeartbeatForCompany` (no duplicated list/filter).
- [x] **2.1** workId excluded — `@ts-expect-error` on a 4-arg work-scoped call (consumed by tsc: `pnpm check`/`typecheck` green proves it IS a compile error) + runtime `evaluateHeartbeatGate.length === 3` (no workId slot).
- [x] **2.2** Tenant isolation — company A unseen material events, company B none → B `no-llm-heartbeat`; `listCalls` shows only A then B; zero leaks.
- [x] **2.3** Empty `companyId` rejected BEFORE read — rejects `'a non-empty companyId is required'`, `events.listCalls === []`.
- [x] **3.1** Zero-mutation BOTH paths — snapshots of `InMemoryWorkRepository` (via `get`), `RecordingJournal.snapshot()`/`.log`, `RecordingReceipts.saves`, `RecordingEvents.appends` all unchanged across activate AND no-llm evaluations.
- [x] **3.2** Never invokes the LLM — `FakeLlmClient.requests.length === 0` on both paths; gate built with only `{events}`.
- [x] **3.3** No self-activation — after `no-llm-heartbeat`, re-`listByCompany` stream identical, `appends.length === 0` (empty-stream) and no gate-emitted `work.completed` (seeded-cursor variant).
- [x] **4.1** Integration — `heartbeat.integration.test.ts` switched to `evaluateHeartbeatGate({events: harness.deps.events}, E2E_COMPANY)` → `{kind:'activate',model:'flash'}` after the full `runWorker` cycle; live event count still 1; work still `completed`. Ran against live PG (Docker `io_pg`, postgres:18.4), sequential.
- [x] **4.2** Proof — `worker.ts` has NO import of `cycle.js`/`evaluateHeartbeatGate` (grep: no matches); `git diff --stat packages/app/src/worker/worker.ts` empty — byte-identical, untouched.
- [x] **4.3** Proof — untouched `worker-finalize.test.ts` (8 tests) covers terminal close (CAS, one receipt, journal completion, one `work.completed`) + idempotent replay: GREEN.
- [x] **5.1** Full gate — `pnpm check` green (format + typecheck + build + lint + test). Full suite sequential: **978 passed | 6 skipped (984)** — +10 vs ~968 baseline (the 10 new unit tests).

## Files created / modified

| File | Action | Notes |
|------|--------|-------|
| `packages/app/src/heartbeat/cycle.ts` | Created | `evaluateHeartbeatGate` thin delegate (~26 lines incl. docs) |
| `packages/app/test/heartbeat/cycle.test.ts` | Created | 10 unit tests: R1 decision table + contract proofs + R2 read-only/non-self-activating proofs |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Modified | Post-cycle gate check (replaces seam call); import + doc comment + describe title updated |
| `openspec/changes/heartbeat-activation/tasks.md` | Modified | Tasks 1.1–5.1 checked; 5.2 (commit) left for orchestrator |
| `openspec/changes/heartbeat-activation/apply-progress.md` | Created | This file |
| `packages/app/src/worker/worker.ts` | **Untouched** | Byte-identical (proven: empty `git diff --stat`) |

## Verification results (exact)

- Focused unit: `pnpm vitest run packages/app/test/heartbeat/cycle.test.ts` → **1 file, 10 tests passed**
- Integration (sequential, live PG): `pnpm vitest run --no-file-parallelism packages/app/test/heartbeat/heartbeat.integration.test.ts` → **1 file, 1 test passed** (ran, not skipped)
- Worker-finalize (4.3 proof): `pnpm vitest run packages/app/test/worker-finalize.test.ts` → **1 file, 8 tests passed**
- Full suite (sequential): **75 files passed | 3 skipped; 978 tests passed | 6 skipped (984)**
- Full gate: `PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check ✓ typecheck ✓ build ✓ lint ✓ test ✓)
- runWorker byte-identical: `git diff --stat packages/app/src/worker/worker.ts` → **empty (0 lines)**; grep for `evaluateHeartbeatGate`/`heartbeat/cycle` in worker.ts → **no matches**

## Gotchas / notes for next phase

- `evaluateHeartbeatGate.length === 3` is a valid runtime arity proof because TS optional params (`cursor?`) are erased at compile time — the function still declares 3 JS parameters, so `Function#length` is 3. A 4th slot (workId) would make it 4.
- The `@ts-expect-error` directive is bidirectional: `pnpm check` fails if the work-scoped call stops being a compile error (stale directive), so the workId exclusion is continuously compiler-proven.
- `InMemoryWorkRepository` has NO `snapshot()` — captured Work state via `get(companyId, workId)` before/after instead.
- Biome `organizeImports` (an assist, not part of `pnpm check`) wants `../../src/...` before `../...`; the committed precedent (`evaluate.test.ts`) has the opposite, and `pnpm check` (format + lint only) is green either way. Left matching repo precedent.
- Integration scratch DB is dropped by `harness.close()` in `afterAll` — no residue in the live PG container.
- `pnpm check` re-runs the full test suite (its own `vitest run`) — expected, gate green.

## Rollback boundary

Delete `cycle.ts` + `cycle.test.ts`, revert integration delta. `worker.ts` untouched — side-effect-free.
