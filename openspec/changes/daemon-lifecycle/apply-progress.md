# Apply Progress: Daemon Lifecycle — Slices 1a + 1b (config, schedule, runDaemon)

Slice 1a section below is preserved verbatim (history); slice 1b is appended.

Status: `ready` — slice 1a implemented, focused tests + full gate GREEN. Commit
pending orchestrator review (`feat(daemon): add fail-fast boot config and non-overlapping schedule`).
Delivery: `auto-chain`, `stacked-to-main`, work-unit `slice-1a-config-schedule`.

## Completed Tasks (slice 1a)

- [x] 1.1 RED `packages/app/test/daemon/config.test.ts` — 23 tests (R1 both scenarios).
- [x] 1.2 GREEN `packages/app/src/daemon/config.ts` — `DaemonConfig` + `loadConfig(env?)`, no `pgConnectionString()` defaulting.
- [x] 1.3 RED `packages/app/test/daemon/schedule.test.ts` — 6 tests, manual-pump fake timers only (R3 both; R7).
- [x] 1.4 GREEN `packages/app/src/daemon/schedule.ts` — `createProductionSchedule(timers?)` → `DrainableSchedule` over unchanged `Schedule` seam.
- [x] 1.5 Gate `pnpm check` GREEN (commit step left to orchestrator — no commit made by apply).

## Files Added

| File | Purpose |
|---|---|
| `packages/app/src/daemon/config.ts` | Env schema + `loadConfig` (fail-fast, names offending setting) |
| `packages/app/src/daemon/schedule.ts` | `createProductionSchedule` no-overlap + drain schedule |
| `packages/app/test/daemon/config.test.ts` | R1 RED suite |
| `packages/app/test/daemon/schedule.test.ts` | R3/R7 RED suite |

Protected cores (`supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`,
`cycle.ts`, `evaluate.ts`, `dispatch/**`) byte-identical — verified via `git status`/diff (untouched).

## TDD Cycle Evidence (Strict TDD)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `test/daemon/config.test.ts` | Unit | N/A (new) | ✅ Written — `Cannot find module '../../src/daemon/config.js'` | ✅ 23/23 | ✅ 23 cases (valid + every bad setting) | ➖ None needed |
| 1.2 | `src/daemon/config.ts` | Unit | N/A (new) | ✅ | ✅ 23/23 | ✅ (see 1.1) | ✅ Clean |
| 1.3 | `test/daemon/schedule.test.ts` | Unit | N/A (new) | ✅ Written — module not found | ✅ 6/6 | ✅ 6 cases | ✅ Clean |
| 1.4 | `src/daemon/schedule.ts` | Unit | N/A (new) | ✅ | ✅ 6/6 | ✅ (see 1.3) | ✅ Clean |

One test-sequencing fix during 1.3→1.4: the first pass of the "latch resets"
test flushed a single microtask; the `.finally` latch reset sits one microtask
turn behind the settled tick, so the flush was under-powered (the supervisor
suite's own 20-turn flush pattern covers this). Fixed the TEST flush
(`flushMicrotasks`), not the implementation. Production wiring is unaffected —
real interval fires are macrotasks, so the latch always resets before the next fire.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run test/daemon/config test/daemon/schedule` → 2 files passed, 29/29 tests, exit 0 |
| Runtime harness command/scenario and exact result | N/A — pure unit layer (config + schedule), manual-pump fake timers, no runtime boundary in slice 1a |
| Rollback boundary | Delete `packages/app/src/daemon/config.ts`, `packages/app/src/daemon/schedule.ts`, and `packages/app/test/daemon/` — no other source touched |

## Gate Result (task 1.5)

- Command: `PATH=/data/node24/bin:$PATH pnpm check` — **exit 0**
- format-check: 188 files checked, no fixes applied
- typecheck (`tsc -p tsconfig.json`): pass
- build (`tsc -p tsconfig.build.json`): pass
- lint (`biome lint .`): 188 files, no fixes
- tests (`vitest run`): 84 files passed | 3 skipped; **1100 passed | 6 skipped (1106)** — baseline was 1071 passed | 6 skipped (1077); +29 new tests all passing

## Changed-Line Estimate

394 authored lines (4 new files: config.ts 53, schedule.ts 70, config.test.ts 101,
schedule.test.ts 170). No deletions. + apply-progress.md ~40 → ≈ 434 total,
within the 450 work-unit cap and under the 400 review budget.

## Deviations

None — implementation matches `design.md` interfaces (config schema, `DrainableSchedule`
shape, `TimerFns` seam). Minor note: schedule fire is expressed as
`Promise.resolve().then(() => tick()).finally(...)` — semantically equivalent to the
design's `Promise.resolve(tick()).finally(...)` but converts a synchronous tick throw
into a rejection (fire-and-forget contract, consistent with the supervisor's default schedule).

## Slice 1b — runDaemon + byte-identity (PR 2)

Status: `ready` — slice 1b implemented, focused tests + full gate GREEN. Commit
pending orchestrator review (`feat(daemon): add runDaemon lifecycle with ordered graceful shutdown`).
Delivery: `auto-chain`, `stacked-to-main`, work-unit `slice-1b-rundaemon-byte-identity`.

### Completed Tasks (slice 1b)

- [x] 2.1 RED `packages/app/test/daemon/daemon.test.ts` — 5 tests, injected hooks + fake schedule, real `startSupervisor` over in-memory deps (R2/R4/R5/R7).
- [x] 2.2 GREEN `packages/app/src/daemon/daemon.ts` — `runDaemon(config, hooks?)`, defaults `process.on`/`process.exit`, `SELECT 1` probe, `PgDbConnection` deep import, `DeepSeekClient`, `buildSupervisorDispatch`→`startSupervisor`, no migrate, second-signal force-exit 1.
- [x] 2.3 `packages/app/test/daemon/byte-identity.test.ts` — 3 tests: 9 protected-core SHA-256s pinned + zero-new-runtime-deps pin; RED proof (mutate → FAIL → restore) executed.
- [x] 2.4 Gate `pnpm check` GREEN (commit step left to orchestrator — no commit made by apply).

### Files Added (slice 1b)

| File | Purpose |
|---|---|
| `packages/app/src/daemon/daemon.ts` | `runDaemon` lifecycle orchestrator (R2/R4/R5) |
| `packages/app/test/daemon/daemon.test.ts` | R2/R4/R5/R7 hermetic suite |
| `packages/app/test/daemon/byte-identity.test.ts` | R6 SHA-256 boundary + runtime-deps pin |

Protected cores byte-identical — verified via RED proof + `git status` (only the 3 new files untracked).

### TDD Cycle Evidence (Strict TDD)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `test/daemon/daemon.test.ts` | Unit (lifecycle seams) | N/A (new) | ✅ Written — module not found | ✅ 5/5 | ✅ 5 cases (R2×2, R4×2, R5×1) | ✅ `getSignal`/`holdDrain` extracted |
| 2.2 | `src/daemon/daemon.ts` | Unit | N/A (new) | ✅ | ✅ 5/5 | ✅ (see 2.1) | ✅ Clean |
| 2.3 | `test/daemon/byte-identity.test.ts` | Unit | N/A (new) | ✅ hashes pinned to baseline | ✅ 3/3 | ✅ RED proof: mutate → fail → restore | ➖ None needed |
| 2.4 | Gate | — | ✅ 29/29 (1a suite) | — | ✅ exit 0 | — | — |

Test-layer note: the daemon suite is a lifecycle-orchestration harness — 8 observed
seam spies are the DESIGNED injection surface (R7), not over-mocking; query/
transaction/complete are shape-only fakes that are never exercised.

### Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run test/daemon/daemon test/daemon/byte-identity` → 2 files passed, 8/8 tests, exit 0 |
| Runtime harness command/scenario and exact result | N/A — pure unit layer (injected hooks, manual-pump schedule, in-memory repos); live-PG boot smoke is slice 2 (3.5) |
| Rollback boundary | Delete `packages/app/src/daemon/daemon.ts`, `packages/app/test/daemon/daemon.test.ts`, `packages/app/test/daemon/byte-identity.test.ts` — no other source touched |

### Gate Result (task 2.4)

- Command: `PATH=/data/node24/bin:$PATH pnpm check` — **exit 0**
- format-check: 191 files checked, no fixes applied
- typecheck (`tsc -p tsconfig.json`): pass; build (`tsc -p tsconfig.build.json`): pass
- lint (`biome lint .`): 191 files, no fixes
- tests (`vitest run`): 86 files passed | 3 skipped; **1108 passed | 6 skipped (1114)** — slice-1a baseline 1100 passed | 6 skipped (1106); +8 new tests all passing
- Note: one run hit a flaky live-PG scratch-DB integration timeout (`business-pg-roundtrip` conn-string isolation, 5s default test timeout); it passes in isolation and on re-run with clean PG state — environmental, unrelated to slice 1b (no database code touched).

### Changed-Line Estimate

481 authored lines (3 new files: daemon.ts 137, daemon.test.ts 272, byte-identity.test.ts 72).
No deletions. + apply-progress.md 1b section ~45 + tasks.md 4 checkboxes (~8) → ≈ 534 total,
slightly above the 500 work-unit cap — reported for the native review ledger.

### Deviations

Two type-level refinements of the `design.md` hook sketch, zero behavioral change:
`createConnection` returns `DbConnection & { close(): Promise<void> }` and `createLlm`
returns `LlmClient & { close(): Promise<void> }` (design sketched `{ execute; close }` /
`{ close }`) — REQUIRED because the same connection/llm instances are passed into
`buildSupervisorDispatch` (which demands full `DbConnection`/`LlmClient`), and
`runDaemon` never calls `migrate` (R2: migrations remain an operator prerequisite).
`startSupervisor` is deliberately left uninjected in tests so the REAL supervisor
runs over the injected schedule + in-memory deps (composition wiring is observed).

## Next

Slice 2 (entrypoint + ts-launcher + start script, PR 3) — awaiting orchestrator
commit + review of 1b.

---

