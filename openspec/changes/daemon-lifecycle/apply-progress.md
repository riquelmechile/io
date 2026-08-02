# Apply Progress: Daemon Lifecycle — Slice 1a (config + schedule)

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

## Next

Slice 1b (runDaemon + byte-identity, PR 2) — awaiting orchestrator commit + review of 1a.
