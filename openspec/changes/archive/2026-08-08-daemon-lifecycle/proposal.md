# Proposal: Daemon Lifecycle

## Intent
Nothing boots `startSupervisor` as a production process: no entrypoint, signal handling, graceful shutdown, boot configuration, or restart posture. The tested cost-saving chain (heartbeat → supervisor-timer → work-dispatch) is not deployable. Ship a thin daemon adapter that runs the verified cores unmodified.

## Decisions
| # | Decision | Choice & Rationale |
|---|---|---|
| a | Launch mechanics | Zero-dep Node-native launcher: first-party `node:module` `.js→.ts` resolve hook + `--experimental-transform-types`. Proven in a spike on pinned Node ^24.18.1; adds zero dependencies; first-party, auditable. Fallback: `tsx` devDependency (never enters any runtime graph). |
| b | Missing `DEEPSEEK_API_KEY` | Fail-fast: clear message + exit 1. Warn-and-continue = today's failure: LlmError swallowed → cursor stuck → silent infinite retry, no crash, no progress. Fail-fast = diagnosable boot failure; secrets stay operator-provided env (doc principle 1). |
| c | Delivery split | Two chained slices, stacked-to-main (direct commits to main, in order). ~550–750 lines > 400-line review budget; each slice reviewable. |

## Scope
### In Scope
- `packages/app/src/daemon/`: `config.ts` (env schema, fail-fast), `schedule.ts` (production `Schedule`: no-overlap + `drain()`), `daemon.ts` (`runDaemon`), `main.ts` (entrypoint)
- Signals: SIGTERM/SIGINT → stop → drain → `conn.close()` → `llm.close()` → exit 0; second signal force-exits; boot failure exits 1
- Boot probe (`SELECT 1`) + config validation before the timer starts
- Tests: fake schedule + injected hooks, no real timers
- `package.json` start script + launcher hook; deployment-posture note (external supervision; migrations 001–009 operator prerequisite)

### Out of Scope
Fencing tokens (§9.8); heartbeat-decision and skill-outcome BusinessEvents; Pro escalation (§13.2/§13.3); learning/promotion (Increment 8); Memory OS; competency extraction; supervisor-driven recovery (Scope B); in-process crash restart (cluster); auto-migrate at boot; HTTP health endpoint; structured-logging library.

## Capabilities
### New Capabilities
- `daemon-lifecycle`: boot config validation, production schedule (no-overlap + drain), signal handling, graceful shutdown, exit-code contract.
### Modified Capabilities
None — verified cores stay byte-identical; the daemon wires via the existing `Schedule`/`onActivate` seams.

## Approach
Bare Node daemon (hexagonal adapter) composing existing roots: `buildSupervisorDispatch` → `startSupervisor(prodSchedule)`. Restart delegated to external supervision (systemd/docker); no cluster/worker_threads. Invariants: no new runtime deps; `openai`/`business-domain`/`context` coupling boundaries unchanged; no auto-migration; conventional commits, no AI attribution.

## Slices (stacked-to-main)
| Slice | Content | Est. lines |
|---|---|---|
| 1 `daemon-core` | config + schedule + daemon + tests | 450–550 |
| 2 `daemon-entrypoint` | main.ts + launcher + package.json + smoke test + docs | 100–180 |
Slice 1 may exceed 400; sdd-tasks forecasts `Decision needed before apply`; may split 1a (config+schedule) / 1b (daemon).

## Affected Areas
| Area | Impact |
|---|---|
| `packages/app/src/daemon/`, `packages/app/test/daemon/` | New |
| `packages/app/package.json`, `docs/` | Modified |

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Experimental Node flag surface changes | Low | Engine pinned ^24.18.1 (engineStrict); tsx devDep fallback |
| Slice 1 exceeds 400 lines | Medium | sdd-tasks forecast; split 1a/1b |
| Unclosed pool hangs shutdown | Low | Shutdown-order test (stop → drain → close) |

## Rollback Plan
Revert the slice commits (additive only; cores untouched); stop the daemon process. No schema or data changes.

## Dependencies
Operator: migrations 001–009 applied; `DATABASE_URL`, `DEEPSEEK_API_KEY`, four principal IDs in env.

## Success Criteria
- [ ] Start script boots the daemon against live PG; SIGTERM drains the in-flight tick, exits 0
- [ ] Missing/invalid config exits 1 with a clear message before the timer starts
- [ ] Verified cores byte-identical; `pnpm check` green; zero new runtime deps
