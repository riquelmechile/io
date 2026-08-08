# Tasks: Daemon Lifecycle

Locked: second-signal force-exit code **1** (R4 mandates force-termination, not a code). Slice 1 split 1a/1b (unsplit 450–550 > budget). Threat matrix: VCS/shell/doc rows N/A; signal/exit cases RED-tested in 2.1. Commands: `PATH=/data/node24/bin:$PATH`, repo root.

## Review Workload Forecast

Estimated changed lines: ~550–750 total (1a ~250–330; 1b ~280–360; 2 ~100–180)
400-line budget risk: High
Chained PRs recommended: Yes
Suggested split: 1a → 1b → 2 (stacked-to-main, delivery auto-chain)
Chain strategy: stacked-to-main
Decision needed before apply: No

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1a | config + schedule + tests | PR 1 | `pnpm vitest run test/daemon/config test/daemon/schedule` | N/A — pure unit, fake timers | Delete `config.ts`, `schedule.ts` + tests |
| 1b | runDaemon + byte-identity | PR 2 | `pnpm vitest run test/daemon/daemon test/daemon/byte-identity` | N/A — injected hooks, no live PG | Delete `daemon.ts` + tests |
| 2 | entrypoint + start script | PR 3 | `pnpm vitest run test/daemon --no-file-parallelism` | `pnpm --filter @io/app start` vs live PG; SIGTERM → exit 0 | Delete `main.ts`, `ts-launcher/`, start script, docs note |

## Slice 1a — config + schedule (PR 1)

- [x] 1.1 RED `packages/app/test/daemon/config.test.ts`: valid env parses; each bad setting (DATABASE_URL, DEEPSEEK_API_KEY, IO_SANDBOX_ROOT, IO_INTERVAL_MS ≤0/non-finite, four empty principals) throws naming it; schedule never starts (R1 both scenarios).
- [x] 1.2 GREEN `packages/app/src/daemon/config.ts`: `DaemonConfig` + `loadConfig(env?)`; no `pgConnectionString()` defaulting.
- [x] 1.3 RED `packages/app/test/daemon/schedule.test.ts` (fake timers only): in-flight tick suppresses next fire; stop blocks fires; drain awaits active tick; idle drain no-op (R3 both; R7).
- [x] 1.4 GREEN `packages/app/src/daemon/schedule.ts`: `createProductionSchedule(timers?)` → `DrainableSchedule` over unchanged `Schedule` seam (`../supervisor/types.js`).
- [x] 1.5 Gate `pnpm check` green; commit `feat(daemon): add fail-fast boot config and non-overlapping schedule`.

## Slice 1b — runDaemon (PR 2)

- [x] 2.1 RED `packages/app/test/daemon/daemon.test.ts` (injected hooks + fake schedule; no real timers/live PG): probe fail → exit(1) before schedule, probe ok → starts (R2 both); first signal graceful once, second → immediate exit(1) (R4 both); order stop→drain→conn.close→llm.close→exit(0), closes idle too, db before llm (R5 both; R7).
- [x] 2.2 GREEN `packages/app/src/daemon/daemon.ts`: `runDaemon(config, hooks?)`; defaults `process.on`/`process.exit`, `SELECT 1`, `PgDbConnection` deep import `@io/database/src/pg-connection.js`, `DeepSeekClient`, `buildSupervisorDispatch`→`startSupervisor`; no migrate; force-exit 1.
- [x] 2.3 `packages/app/test/daemon/byte-identity.test.ts` (R6): pin SHA-256 of `supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`, `dispatch/**`; assert zero new runtime deps; RED proof: mutate one protected byte → fails → restore.
- [x] 2.4 Gate green; commit `feat(daemon): add runDaemon lifecycle with ordered graceful shutdown` (commit step left to orchestrator — no commit made by apply).

## Slice 2 — entrypoint (PR 3)

- [x] 3.1 RED `packages/app/test/daemon/launcher.test.ts`: resolve seam maps `.js`→sibling `.ts`, `@io/<pkg>/…`→`packages/<pkg>` source (R7).
- [x] 3.2 GREEN `packages/app/src/daemon/ts-launcher/ts-hook.mjs` + `register.mjs` (`node:module` builtins only).
- [x] 3.3 Create `packages/app/src/daemon/main.ts`: `await runDaemon(loadConfig())`; catch → `console.error` → exit 1.
- [x] 3.4 Modify `packages/app/package.json`: add `scripts.start` = `node --experimental-transform-types --import ./src/daemon/ts-launcher/register.mjs ./src/daemon/main.ts`; cwd pinned: pnpm package scripts run in `packages/app`; root invocation `pnpm --filter @io/app start`.
- [x] 3.5 `packages/app/test/daemon/boot-smoke.integration.test.ts`: live PG only, sequential (`pnpm vitest run --no-file-parallelism`), skip if unreachable; boot → SIGTERM drains in-flight tick → exit 0 (R2/R5).
- [x] 3.6 `docs/` note: external supervision (systemd/docker); migrations 001–009 operator prerequisite; never auto-migrates.
- [x] 3.7 Gate green; commit `feat(daemon): add zero-dep TypeScript entrypoint and start script` (commit step left to orchestrator — no commit made by apply).

## Invariants (all slices)

- [ ] 4.1 Cores byte-identical (2.3); zero new runtime deps; boundary tests green (`openai` only in `packages/llm-client/src/deepseek-client.ts`; `business-domain` zero `@io/*` imports; `packages/context` deps === `@io/business-domain`); conventional commits, no AI attribution, English messages.
