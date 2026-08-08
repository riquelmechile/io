# Design: Daemon Lifecycle

## Technical Approach

Thin hexagonal adapter `packages/app/src/daemon/` composing `buildSupervisorDispatch` → `startSupervisor` with a production no-overlap+drain `Schedule`. Cores stay byte-identical via existing seams. Covers all 7 ADDED requirements.

## Architecture Decisions

| Decision | Options | Choice |
|---|---|---|
| Launch | resolve hook + `--experimental-transform-types` \| tsx | **Zero-dep hook**; tsx = documented fallback only |
| Missing API key | fail-fast \| warn | **Fail-fast exit 1** (warn = silent LlmError loop) |
| `pgConnectionString` | deep-import \| index export | **Deep-import** `@io/database/src/pg-connection.js` (E2E pattern); daemon still **requires** `DATABASE_URL` (no silent default) |
| Drain surface | extend `SupervisorHandle` \| external | **External** `DrainableSchedule` — keeps `types.ts` identical |
| Restart | cluster \| external | **External** (systemd/docker); correct exit codes only |
| Delivery | one PR \| chained | **Stacked-to-main**: slice1 core+tests, slice2 entry+launcher |

## Data Flow

```
main → loadConfig ──fail→ exit 1
    → runDaemon
         probe SELECT 1 ──fail→ exit 1
         PgDbConnection + DeepSeekClient
         buildSupervisorDispatch → startSupervisor(prod.schedule)
         SIGTERM/SIGINT #1: stop → drain → conn.close → llm.close → exit 0
                      #2: force exit (no await)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/app/src/daemon/config.ts` | Create | Env schema + `loadConfig` |
| `packages/app/src/daemon/schedule.ts` | Create | `createProductionSchedule` |
| `packages/app/src/daemon/daemon.ts` | Create | `runDaemon` + hooks |
| `packages/app/src/daemon/main.ts` | Create | Entrypoint |
| `packages/app/src/daemon/ts-launcher/register.mjs` | Create | `module.register` bootstrap |
| `packages/app/src/daemon/ts-launcher/ts-hook.mjs` | Create | `.js→.ts` + `@io/*`→source |
| `packages/app/test/daemon/{config,schedule,daemon,byte-identity}.test.ts` | Create | Unit suite |
| `packages/app/package.json` | Modify | `start` script |
| `docs/` (optional) | Modify | External supervision + mig 001–009 |

**Protected (byte-identical):** `supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`, `dispatch/**`.

## Interfaces / Contracts

### config.ts
```ts
export type DaemonConfig = {
  databaseUrl: string; deepseekApiKey: string; sandboxRoot: string;
  intervalMs: number;
  principals: { proposer: string; approver: string; executor: string; verifier: string };
};
/** Throws Error naming offending setting. */
export function loadConfig(env?: NodeJS.ProcessEnv): DaemonConfig;
```
Required: `DATABASE_URL`, `DEEPSEEK_API_KEY`, `IO_SANDBOX_ROOT`, `IO_INTERVAL_MS` (finite > 0), `IO_PROPOSER|APPROVER|EXECUTOR|VERIFIER` (non-empty). No `pgConnectionString()` defaulting.

### schedule.ts
```ts
import type { Schedule } from '../supervisor/types.js';
export type DrainableSchedule = { readonly schedule: Schedule; drain(): Promise<void> };
export type TimerFns = { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
export function createProductionSchedule(timers?: TimerFns): DrainableSchedule;
```
On fire: if `inFlight` → skip; else track `Promise.resolve(tick()).finally(...)`. `stop` clears timer + blocks further fires. `drain` awaits active `inFlight` (no-op if idle).

### daemon.ts
```ts
export type DaemonHooks = {
  registerSignal?: (s: 'SIGTERM'|'SIGINT', h: () => void) => void;
  exit?: (code: number) => void;
  probe?: (c: { execute(sql: string, p: readonly unknown[]): Promise<unknown> }) => Promise<void>;
  createConnection?: (url: string) => { execute(...): Promise<unknown>; close(): Promise<void> };
  createLlm?: (key: string) => { close(): Promise<void> };
  createSchedule?: () => DrainableSchedule;
  buildDispatch?: typeof buildSupervisorDispatch;
  startSupervisor?: typeof startSupervisor;
};
export async function runDaemon(config: DaemonConfig, hooks?: DaemonHooks): Promise<void>;
```
Defaults: `process.on` / `process.exit` / `execute('SELECT 1')` / real `PgDbConnection(config.databaseUrl)` / `DeepSeekClient({apiKey})` / `createProductionSchedule` / real composition. Shutdown (once): `sup.stop()` → `await drain()` → `await conn.close()` → `await llm.close()` → `exit(0)`. Second signal → `exit(1)` immediately. Boot fail → `exit(1)` before schedule. **No migrate.**

### main.ts + launcher
```ts
try { await runDaemon(loadConfig()); } catch (e) { console.error(e); process.exit(1); }
```
Hook: relative `.js`→sibling `.ts`; bare `@io/<pkg>/…` → `packages/<pkg>/…` source.  
`start`: `node --experimental-transform-types --import ./src/daemon/ts-launcher/register.mjs ./src/daemon/main.ts`  
Zero new runtime deps.

## Testing Strategy

Manual-pump pattern (`supervisor.test.ts`) — **zero real timers**. Daemon suite is pure-unit (parallel-safe). Live PG only if optional slice-2 smoke; then sequential.

| File | Proves |
|---|---|
| `config.test.ts` | R1 valid; R1 each bad setting named |
| `schedule.test.ts` | R3 no-overlap; R3 drain; stop blocks |
| `daemon.test.ts` | R2 probe fail/ok; R4 1st/2nd signal; R5 order + idle close; R7 hooks |
| `byte-identity.test.ts` | R6 SHA-256 protected sources + no new runtime deps |

| Req | Test |
|---|---|
| Fail-Fast Boot Config | config.test |
| DB Readiness / No Migrate | daemon probe paths |
| Non-Overlapping Schedule | schedule.test |
| Signal Handling | daemon signal fakes |
| Ordered Shutdown | daemon ordered spies |
| Non-Invasive Boundary | byte-identity |
| Deterministic Verification | all use fake schedule+hooks |

## Threat Matrix

VCS/shell/doc rows: all **N/A** (no git/PR/shell/exec-classification). Signal/exit covered by R4/R5 tests above.

## Migration / Rollout

No schema change. Operator: mig 001–009 + env + external restart. Rollback: revert additive commits; stop process.

## Open Questions

- [ ] Second-signal exit code locked to **1** (recommended) — confirm in tasks.
- [ ] Slice1 may exceed 400 lines → tasks split 1a config+schedule / 1b daemon if needed.
