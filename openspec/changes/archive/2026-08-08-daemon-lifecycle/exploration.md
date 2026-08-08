# Exploration: Daemon / Process Lifecycle Wiring

**Change:** `daemon-lifecycle` — make the supervisor actually RUN in production.
The full cost-saving chain (heartbeat-activation → supervisor-timer → work-dispatch)
is testable but not deployable: nothing boots `startSupervisor` as a long-running process.

---

## Current State

### Supervisor core (`packages/app/src/supervisor/`)
- **`startSupervisor(deps, options): SupervisorHandle`** (`supervisor.ts:37`) — periodic
  discoverable lifecycle. `tickAll()` lists company IDs (`deps.events.listCompanyIds()`) and
  ticks each company SEQUENTIALLY via `tickCompany`. Tick failures are logged + swallowed
  (fire-and-forget; the process never crashes). The docblock states it is "not auto-started
  from any runner/CLI".
- **Default schedule** (`supervisor.ts:9-20`) wraps `setInterval` with fire-and-forget
  `void tick()` — **no re-entrancy guard**: if a tick outlives `intervalMs`, the next
  interval fires a CONCURRENT tick.
- **`SupervisorHandle`** (`types.ts:54`) is `{ stop(): void }` — sync, sets `stopped`,
  clears the schedule, and aborts remaining companies mid-tick. **No drain**: an in-flight
  `onActivate`/dispatch promise is not observable by the caller.
- **`tickCompany`** (`tick.ts:26`) — side effect FIRST (`await onActivate`), cursor
  checkpoint LAST (at-least-once, crash-safe order R4-001).
- **Types** (`types.ts`): `SupervisorDeps { events, cursors }`, `OnActivate = (companyId) => void | Promise<void>`,
  `Schedule` (injectable timer seam), `StartSupervisorOptions { intervalMs, now?, onActivate?, schedule? }`.

### Composition roots (`packages/app/src/composition/`)
- **`buildWorkerDeps(input)`** (`worker-deps.ts:45`) — full `WorkerDeps` (PG adapters +
  `FileDocumentSandbox` + llm + principals + `repositories` tx factory).
- **`buildSupervisorDeps(connection)`** (`supervisor-deps.ts:16`) — `SupervisorDeps`
  (`PgBusinessEventRepository` + `PgHeartbeatCursorRepository` over one pool connection).
- **`buildSupervisorDispatch(input)`** (`supervisor-dispatch.ts:26`) — the ready-made full
  wiring: returns `{ deps: SupervisorDeps, onActivate: OnActivate }`, the exact shape
  `startSupervisor` consumes. `onActivate` = `dispatchCompanyActivation(companyId, dispatchDeps)`.
  Input: `{ connection, llm, sandboxRoot, principals, now? }`.

### Dispatch (`packages/app/src/dispatch/`)
- **`dispatchCompanyActivation`** (`dispatch.ts:24`) — oldest accepted Work →
  exactly ONE `runWorker` cycle; typed-failure settlement (`dispatched: true` on business
  outcomes, no LLM hot loop); only THROWN errors propagate (cursor stays un-advanced →
  at-least-once re-activation); durable idempotency journal replay (`wk:` key + SHA-256
  hash, R1/R4) makes duplicates safe.

### Infra adapters (the daemon's building blocks)
- **`PgDbConnection(connectionString)`** (`packages/database/src/pg-connection.ts:19`) —
  lazy `pg.Pool`; `close()` is NOT on the `DbConnection` port (call it on the concrete
  class to end the pool); idle-client `'error'` already no-op'd (no crash).
  `pgConnectionString()` = `DATABASE_URL` ?? local `io/io_dev` default. NOT exported from
  `@io/database` index — deep-import pattern (`@io/database/src/pg-connection.js`, as the
  E2E harness does).
- **`DeepSeekClient({ apiKey? })`** (`packages/llm-client/src/deepseek-client.ts:35`) —
  lazy OpenAI client; `close()` NOT on the `LlmClient` port; `deepseekApiKey()` reads
  `DEEPSEEK_API_KEY`.
- **`FileDocumentSandbox(rootDir)`** (`packages/app/src/sandbox/file-document-sandbox.ts:17`) —
  `resolve()`s the root, `mkdirSync` recursive on execute — no pre-existing directory needed
  at boot.

### Configuration surface today
- Env vars in use: `DATABASE_URL`, `DEEPSEEK_API_KEY`, `IO_REQUIRE_PG` (test-only).
  **No dotenv, no config module, no boot-time validation anywhere.**
- **No `bin`/scripts/`exports`/`main` in ANY workspace package.json.** Root build
  (`tsc -p tsconfig.build.json`) is `noEmit` type-check only — **no compiled JS exists**.

### Launch mechanics (verified empirically on Node v24.18.1)
- Node native type stripping runs `.ts` files, but does NOT rewrite `.js`-extension
  imports (repo convention, NodeNext) → `ERR_MODULE_NOT_FOUND`.
- Parameter properties exist in the daemon's runtime graph (`pg-connection.ts:22`
  `constructor(private readonly connectionString: string)`), which plain strip-types
  REJECTS → requires `--experimental-transform-types`.
- A first-party `node:module` resolve hook that maps relative `.js` → `.ts` makes the
  graph runnable: `node --experimental-transform-types --import <hook> main.ts` (PROVEN
  in a spike). Bare `@io/*` subpaths (`@io/database/src/index.js`) additionally need the
  hook to map workspace packages → their `.ts` sources (packages have no exports map).
- Alternative: `tsx` as a devDependency (industry standard; transparent resolution) —
  but that is a NEW dependency, in tension with a strict zero-new-deps reading.

### Explicitly deferred by prior slices (this slice IS the deferred work)
- `supervisor.ts` docblock: "not auto-started from any runner/CLI".
- `supervisor-timer` design: "**Do not** auto-start from any runner/CLI";
  "process/daemon wiring is out of scope"; deferred list includes "process lifecycle".
- `docs/PASOS_SIGUIENTES_INCREMENTO_4.md`: next item = "Daemon / process lifecycle wiring
  (cómo se levanta y supervisa el proceso del supervisor en producción)".
- Architecture doc §: "la CLI y el daemon son adaptadores reemplazables" — the daemon is
  a hexagonal ADAPTER, consistent with Clean Architecture.

---

## The Gap

Nothing boots the supervisor as a production process. Missing, in order of importance:

1. **Process entrypoint** — no `bin`, no scripts, no runnable artifact.
2. **Signal handling** — no SIGTERM/SIGINT handling anywhere in src.
3. **Graceful shutdown** — `stop()` doesn't await the in-flight tick; the `pg.Pool`
   keeps sockets open so the process never exits naturally without `PgDbConnection.close()`.
4. **Boot configuration** — `principals` (4 IDs), `sandboxRoot`, `intervalMs` must come
   from somewhere; no validation, no fail-fast.
5. **Restart semantics** — no external supervision posture defined/documented; the
   process must exit with correct codes so systemd/docker restart works.
6. **Single-instance guard** — absent (correctly: fencing tokens §9.8 are a LATER
   hardening slice; see Edge Cases for why duplicate instances are already safe).
7. **Observability** — only `console.error` in the supervisor; no boot/ready markers,
   no structured logs, no health signal.

---

## Affected Areas

| Path | Why |
|------|-----|
| `packages/app/src/daemon/config.ts` (NEW) | Env schema + validation, fail-fast at boot (`DATABASE_URL`, `DEEPSEEK_API_KEY`, `IO_SANDBOX_ROOT`, `IO_INTERVAL_MS`, `IO_PROPOSER/APPROVER/EXECUTOR/VERIFIER`). |
| `packages/app/src/daemon/schedule.ts` (NEW) | Production `Schedule` via the injectable seam: no-overlap guard + in-flight tick tracking (`drain()`). Keeps verified supervisor core byte-identical. |
| `packages/app/src/daemon/daemon.ts` (NEW) | `runDaemon(config)`: boot probe → `PgDbConnection` + `DeepSeekClient` → `buildSupervisorDispatch` → `startSupervisor(prodSchedule)` → signal wiring → graceful shutdown (stop → drain → `conn.close()` → `llm.close()` → exit 0). |
| `packages/app/src/daemon/main.ts` (NEW) | Process entrypoint: load config, `runDaemon`, exit 1 on boot failure. |
| `packages/app/src/daemon/ts-launcher/` (NEW, only if zero-dep launch chosen) | First-party `.js`→`.ts` + `@io/*` resolve hook (`register.mjs` + `ts-hook.mjs`, `node:module` builtins only). |
| `packages/app/package.json` | `start` script (+ optional `bin`), launcher wiring. |
| `packages/app/test/daemon/*.test.ts` (NEW) | Config validation, boot failure, signal/drain order — fake schedule + injected hooks, no real timers (mirrors `supervisor.test.ts` manual-pump pattern). |
| `packages/database/src/index.ts` (optional) | Export `pgConnectionString()` to avoid a deep import (or keep the established deep-import pattern). |
| `docs/` (optional) | Deployment posture note: external supervision (systemd/docker restart) + migration prerequisite 001–009. |

NOT affected: `business-domain`, `context`, `trust-kernel`, worker/dispatch/heartbeat cores,
`llm-client` core, and — if the Schedule seam is used — the verified `supervisor.ts`/`types.ts`.

---

## Approaches

### 1. Bare Node entrypoint + in-process signal handling + graceful drain (no new runtime deps) — RECOMMENDED
A first-party daemon module inside `@io/app` (an adapter, per the architecture doc), launched
with Node 24 native TypeScript via a tiny resolve hook (+ `--experimental-transform-types`).
SIGTERM/SIGINT → stop schedule → drain in-flight tick → close pool → exit 0. External
supervision (approach 3) provides restart-after-crash.

- Pros: zero new dependencies; full control; fully testable (fake schedule, injected
  shutdown hooks, no real timers — the existing manual-pump pattern); fits hexagonal
  "daemon = adapter"; aligns with "minimal company must run" incremental principle.
- Cons: requires the resolve-hook + experimental-flag launch mechanics (Node pinned
  ^24.18.1 via engineStrict, so stable within the pinned line; still "experimental"
  surface); no in-process crash restart (the OS/container must provide it).
- Effort: Medium.

### 2. `node:cluster` / `worker_threads` for in-process restart
A supervisor process would spawn a worker that runs the supervisor; a crash respawns it.

- Pros: in-process restart without an external supervisor; no new deps (builtins).
- Cons: significant process-topology complexity for a single supervisor; restart is the
  OS's job (systemd/docker do it better, with crash-policy control); IPC/messaging surface
  adds untested moving parts; violates the "thin daemon" spirit.
- Effort: High.

### 3. External process supervision (systemd / PM2 / container restart policy) + thin in-process shutdown handler
COMPLEMENTARY to approach 1, not an alternative: the external supervisor owns restart and
startup policy; the process must only (a) exit 0 on graceful shutdown, (b) exit non-zero on
boot failure, (c) handle SIGTERM cleanly. This slice documents the posture (and MAY ship a
minimal systemd unit as an example).

- Pros: battle-tested restart semantics, crash-policy config, log capture — zero in-process code.
- Cons: none on its own; it is the deployment half of approach 1.
- Effort: Low (docs + optional unit file).

---

## Recommendation

**Approach 1 for the in-process daemon, with approach 3 as the documented deployment
posture.** Concretely:

- New `packages/app/src/daemon/` module: `config.ts` (env-first schema, fail-fast
  validation), `schedule.ts` (production `Schedule` via the injectable seam — **no-overlap
  guard + `drain()`**, so the verified supervisor core stays byte-identical), `daemon.ts`
  (`runDaemon`), `main.ts` (entry).
- Graceful shutdown contract: SIGTERM/SIGINT (first signal) → `sup.stop()` → await
  `drain()` (in-flight dispatch completes + checkpoints) → `conn.close()` → `llm.close()`
  → exit 0. Second signal → force exit. Boot failure (bad config, unreachable PG) →
  clear message + exit 1.
- Boot probe (`SELECT 1` over `DATABASE_URL`, mirroring the E2E `pgReachable` guard) and
  required-config validation before starting the timer.
- **No cluster/worker_threads** — restart is delegated to systemd/docker/PM2.
- Launch mechanics decision for the proposal: (i) zero-dep Node-native path (resolve hook
  + `--experimental-transform-types`) vs (ii) `tsx` devDependency (pragmatic, transparent,
  but a new dependency — needs explicit approval against the "no new runtime deps" invariant;
  a devDependency does not enter any package's runtime graph, so it is defensible).
- The daemon MUST NOT auto-migrate in this slice; migrations 001–009 (incl. 008
  `heartbeat_cursor`, 009 `CONCURRENTLY` index) are a documented operator prerequisite.

---

## Edge Cases

1. **In-flight dispatch during shutdown** — `tickCompany` checkpoints the cursor LAST, so a
   kill before checkpoint leaves the activation un-advanced → next boot re-dispatches
   (at-least-once). Draining first is cleanliness, not safety.
2. **SIGKILL mid-cycle** — fully recoverable by existing semantics: durable idempotency
   journal + resume-aware claim (`worker.ts` B1: in_flight attempt resumes, same key+hash
   replays, no double effect/receipt).
3. **Timer/pool cleanup** — a never-closed `pg.Pool` keeps sockets open → process hangs on
   shutdown. Closing the pool is MANDATORY in the shutdown path.
4. **Journal replay on restart** — durable `wk:` key + SHA-256 hash; same key replays,
   different hash DENIES (`idempotency-conflict`). Restart is cheap and idempotent.
5. **Config validation at boot** — fail fast with clear messages + exit 1: bad/unreachable
   `DATABASE_URL` (probe), empty `IO_SANDBOX_ROOT`, non-positive `IO_INTERVAL_MS`, missing
   principal IDs. Missing `DEEPSEEK_API_KEY` is the sharpest one: today a missing key makes
   the first dispatch throw `LlmError` → tick swallows → cursor un-advanced → retried
   forever (no crash, no progress). Fail-fast at boot is strongly recommended.
6. **PG down at runtime** — tick throws → logged + swallowed → next interval retries;
   pool `'error'` no-op already prevents crash. No daemon-level change needed.
7. **Overlapping ticks** — `intervalMs` < tick duration spawns concurrent ticks (default
   schedule is fire-and-forget). Duplicates are SAFE (CAS claim + journal replay; the loser
   fails the claim before any LLM spend) but wasteful — the production schedule's no-overlap
   guard removes the hazard at the daemon layer.
8. **Double signal** — second SIGTERM/SIGINT force-exits (standard drain-timeout pattern).
9. **Multi-instance / fencing (§9.8, out of scope)** — with no single-instance guard, two
   daemons may tick the same company: the CAS claim + idempotency journal make this CORRECT
   (one winner, loser settles typed; duplicate-safe) but wasteful. Fencing tokens later
   add exclusivity; correctness never depends on them.
10. **`--experimental-transform-types`** — required because `pg-connection.ts:22` uses a
    parameter property (in the daemon's runtime graph). Pinned engine (^24.18.1, engineStrict)
    fixes the flag's availability; still, this is a risk to record for the proposal.

---

## Scope Boundary (for the proposal phase)

**IN:**
- `packages/app/src/daemon/` module: `config.ts`, `schedule.ts` (no-overlap + drain via the
  injectable seam), `daemon.ts` (`runDaemon`), `main.ts` (entry).
- Signal handling (SIGTERM/SIGINT), graceful drain, pool/LLM close, exit-code contract.
- Boot probe + config validation (fail fast, clear messages).
- Tests: config validation, boot failure, shutdown order (fake schedule + injected hooks,
  zero real timers).
- `packages/app/package.json` `start` script (+ launcher hook if zero-dep path chosen).
- Optional: export `pgConnectionString()` from `@io/database` index (or keep deep import).
- Deployment-posture note (external supervision + migration prerequisite).

**OUT (explicit non-goals for this slice):**
- Multi-instance fencing tokens (§9.8) — later hardening slice (interaction documented above).
- heartbeat-decision BusinessEvents, Pro escalation (§13.2/§13.3), skill-outcome
  BusinessEvents, learning/promotion (Increment 8), Memory OS, competency extraction,
  supervisor-driven recovery (Scope B).
- In-process crash restart (cluster/worker_threads).
- Auto-migration at boot; HTTP health endpoint; structured-logging library (all future).

---

## Size Estimate

Rough authored total: **~550–750 changed lines** (src ~260–350, tests ~280–350, packaging/
launcher ~40–80). This is MEDIUM-HIGH risk against the 400-line review budget.

Recommended split for `sdd-tasks` (chained slices):
- **Slice 1 — daemon core:** `config.ts` + `schedule.ts` + `daemon.ts` + their tests
  (~450–550 lines) — the testable substance.
- **Slice 2 — entrypoint + packaging:** `main.ts`, launch hook (or tsx decision), package.json
  script, boot smoke test, deployment-posture note (~100–180 lines).

Both slices fit under the budget; `sdd-tasks` must forecast `Decision needed before apply`
accordingly.

---

## Ready for Proposal

**Yes.** The gap is precisely bounded (deferred "process lifecycle" work), the composition
roots already exist (`buildSupervisorDispatch` + `startSupervisor`), the seam for a
production schedule exists (`StartSupervisorOptions.schedule`), and the launch mechanics
were verified empirically. The proposal must decide: (a) zero-dep Node-native launcher vs
`tsx` devDependency, (b) fail-fast on missing `DEEPSEEK_API_KEY` vs warn, (c) the two-slice
split. Tell the user: the daemon slice is well-scoped, Medium effort, and does NOT require
changing any verified core (supervisor/worker/dispatch) if the Schedule seam is used.
