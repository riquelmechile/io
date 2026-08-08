# Archive Report: daemon-lifecycle

## Change Summary

Added a production daemon adapter for the io monorepo that wraps the existing verified supervisor cores in a boot-configurable, signal-handling lifecycle. The change introduced fail-fast configuration validation, a no-overlap+drain production schedule, an ordered graceful shutdown with second-signal force-exit, and a zero-dependency TypeScript entrypoint using Node's native module resolution hook. Fully verified PASS against live PostgreSQL with 7/7 requirements and 12/12 scenarios compliant.

**Change name**: `daemon-lifecycle`
**Date archived**: 2026-08-08
**Branch**: main
**Verify verdict**: **PASS** — 7/7 requirements, 12/12 scenarios, 0 critical, 0 blockers

## Intent & Scope

Ship a thin hexagonal daemon adapter (`packages/app/src/daemon/`) that runs the verified supervisor cores as a production process. Covers boot config validation, database readiness probe (no auto-migration), non-overlapping tick schedule with drain, SIGTERM/SIGINT handling with exactly-once graceful shutdown and second-signal force-exit, a zero-dep Node launcher using `--experimental-transform-types` plus a first-party `.js→.ts` resolve hook, and deployment-posture documentation (external supervision via systemd/Docker).

### In Scope
- `packages/app/src/daemon/config.ts` — env schema + `loadConfig()` fail-fast
- `packages/app/src/daemon/schedule.ts` — `createProductionSchedule()` with overlap suppression + drain
- `packages/app/src/daemon/daemon.ts` — `runDaemon()` lifecycle with ordered shutdown
- `packages/app/src/daemon/main.ts` — entrypoint
- `packages/app/src/daemon/ts-launcher/` — zero-dep Node module register hook
- `packages/app/test/daemon/` — full test suite (46 tests across 6 files)
- `packages/app/package.json` — start script
- `docs/` — external supervision note

### Out of Scope
Fencing tokens, heartbeat-decision events, Pro escalation, learning/promotion, Memory OS, in-process crash restart, HTTP health endpoint, structured logging library, auto-migration at boot.

## Slices & Commits

| Slice | Commit | Description |
|-------|--------|-------------|
| 1a | `5b6aec6` | feat(daemon): add fail-fast boot config and non-overlapping schedule |
| 1b | `9fb11b0` | feat(daemon): add runDaemon lifecycle with ordered graceful shutdown |
| 2 | `090a14c` | feat(daemon): add zero-dep TypeScript entrypoint and start script |

Scope-change review (task 4.1): committed `47cefa9`.

## Capabilities Added

### New Capability: `daemon-lifecycle`
- **R1 Fail-Fast Boot Configuration** — validates DATABASE_URL, DEEPSEEK_API_KEY, IO_SANDBOX_ROOT, positive IO_INTERVAL_MS, four principal identifiers; names offending setting on failure; exits 1
- **R2 Database Readiness and Migration Prerequisite** — SELECT 1 probe before scheduling; migrations 001–009 remain operator prerequisite
- **R3 Non-Overlapping Production Schedule** — one tick in flight suppresses next interval fire; stop blocks future ticks; drain awaits active work
- **R4 Process Signal Handling** — first SIGTERM/SIGINT → exactly-once graceful shutdown; second during shutdown → immediate exit(1)
- **R5 Ordered Graceful Shutdown** — stop → drain → database close → LLM close → exit(0); resources close even without active tick
- **R6 Non-Invasive Runtime Boundary** — zero new runtime deps; nine protected core sources byte-identical
- **R7 Deterministic Lifecycle Verification** — injectable fake schedule + hooks enable timer-free verification

## Verify Result

| Metric | Result |
|--------|--------|
| Requirements compliant | 7/7 |
| Scenarios compliant | 12/12 |
| Blockers | 0 |
| Critical | 0 |
| Warning | 0 |
| Full suite | **1117 passed / 6 skipped** (1123 total) |
| Focused daemon suite | **46/46 passed** |
| Live-PG boot smoke | **Passed** — entrypoint booted, received SIGTERM, drained, exited 0 in 1122 ms |
| Invalid-config harness | **Passed** — real process exited 1, named DEEPSEEK_API_KEY |

Build gate: `pnpm check` green (typecheck, build, lint all passed).

## Specs Synced

One NEW delta spec promoted to canonical capability spec:

| Domain | Action | Requirements | Scenarios |
|--------|--------|--------------|-----------|
| `daemon-lifecycle` | Created | 7 | 12 |

Synced path: `openspec/specs/daemon-lifecycle/spec.md`

## Key Decisions

1. **Zero-dep Node launcher over tsx** — First-party `node:module` register hook + `--experimental-transform-types` adds zero runtime dependencies. tsx documented as fallback only.
2. **Fail-fast missing API key** — Missing `DEEPSEEK_API_KEY` exits 1 with clear message rather than degrading to warning (warn = silent LlmError infinite retry loop).
3. **External supervision posture** — No in-process restart or cluster; correct exit codes delegated to systemd/Docker.
4. **Deep-import PgDbConnection** — Direct import from `@io/database/src/pg-connection.js` (E2E pattern); daemon still requires `DATABASE_URL` env, no silent defaulting.
5. **Second-signal force-exit code 1** — Locked to exit code 1 (not 0) for ungraceful termination.

## Risks & Deferred Items

### Deferred Follow-Ups
1. **Production composition root** — Daemon wiring needs explicit PG adapter injection when the app runs for real (currently wired via deep-import in the daemon itself).
2. **Engine pinning surface** — `--experimental-transform-types` is experimental; Node version pinned ^24.18.1 with engineStrict. Monitor flag stability.

### Observations to Monitor
3. **Shutdown hang risk** — Unclosed pool could block shutdown. Mitigated by shutdown-order test (stop → drain → close) and live-PG smoke evidence showing clean exit in ~1.1s.
4. **Slice budget exceeded originally** — Slice 1 was split into 1a/1b (config+schedule vs daemon) to stay within the 400-line review budget.

## Purity & Invariants Preserved

- All nine protected core sources byte-identical (SHA-256 verified).
- Zero new runtime dependencies in `packages/app`.
- Launcher imports only Node builtins + local hook.
- `openai` ownership boundary unchanged (confined to `deepseek-client.ts`).
- Business-domain isolation intact (zero `@io/*` imports).
- Context dependency boundary intact.
- Conventional commits used throughout, no AI attribution.

---

*Archive report written: 2026-08-08. The SDD cycle for `daemon-lifecycle` is complete.*
