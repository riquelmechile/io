# Proposal: supervisor-timer — workless heartbeat wake-ups

**Change:** `supervisor-timer` · **Phase:** propose · **Store:** hybrid (Engram + OpenSpec)

## Intent

The §13.2 heartbeat filter is built but unreachable: its only material input, `work.completed`, is emitted by the worker's own finalize, so gating a work-bearing cycle deadlocks the first job. `no-llm-heartbeat` only makes sense for workless wake-ups — periodic evaluations consuming no work — which nothing produces today (no scheduler/dispatcher/queue exists in `packages/`). This supervisor wakes the gate per company on a timer, making the §2 LLM-cost savings reachable. The loop is the enabler; dispatch wiring lands next slice.

## Scope

### In Scope
- Polling supervisor in `@io/app`: `startSupervisor(deps, { intervalMs, now?, onActivate? })` → `{ stop }`; injectable clock
- Pure `tailCursor(events)` helper in business-domain
- `HeartbeatCursorStore` port + fake + PG adapter; new `heartbeat_cursor` table (migration 008), written only by the supervisor
- Additive read-only `listCompanyIds()` on events port/adapter/fake
- Unit (fakes) + sequential PG integration tests

### Out of Scope
- Triggering real work cycles from `activate` (needs work-dispatch port + key policy)
- Heartbeat-decision BusinessEvents (new emitter = spec change)
- Pro escalation/risk tiers, Memory OS, learning/promotion
- Daemon/process wiring, outbox table/consumer, cursor fencing tokens

## Capabilities

### New Capabilities
- `supervisor-timer`: periodic workless heartbeat evaluation per company with durable cursor recovery

### Modified Capabilities
- `heartbeat`: adds pure `tailCursor` + `HeartbeatCursorStore` port; gate/seam stay byte-identical
- `business-event`: additive read-only `listCompanyIds()`

## Approach

Exploration Approach A. Each tick: `listCompanyIds()` → per company, sequentially: read stored cursor → `evaluateHeartbeatGate` → advance cursor (atomic upsert) → on `activate`, call injectable `onActivate(companyId)`. The cursor row IS the checkpoint; ticks are stateless, so restart re-evaluates from persisted cursors (at-least-once, §9.8, no new infra).

**Key decision:** `onActivate` is a recorded no-op this slice. The cursor advances on both paths, but only after the activation callback returns, giving at-least-once delivery (a crash during the callback re-fires on the next tick); a new `work.completed` re-activates on the next tick.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/app/src/supervisor/` | New | Timer loop, per-company tick, `onActivate` seam |
| `packages/business-domain` (heartbeat, ports, fakes) | Modified | `tailCursor`, `HeartbeatCursorStore`, `listCompanyIds()` |
| `packages/database` (sql/008, adapters) | New/Modified | `heartbeat_cursor` table + adapter; additive `listCompanyIds()` |
| `packages/app/src/composition/` | Modified | Wire cursor store + supervisor deps |

Untouched: `runWorker`, `cycle.ts`, `evaluate.ts`, context, llm-client. No new runtime deps; cohort rule preserved.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicate activation under multi-instance | Low (single instance this slice) | Atomic upsert; fencing tokens deferred |
| No §2 savings yet (`onActivate` no-op) | Certain, by design | Explicit: savings land with dispatch next slice |
| PG concurrency flake | Low | Sequential per-company evaluation |

## Rollback Plan

Drop migration 008, delete `supervisor/`, revert additive port/adapter lines. All existing code stays byte-identical, so rollback is purely subtractive — zero data migration.

## Dependencies

None new. No capital, secrets, or constitutional limits are touched (doc principle 1).

## Success Criteria

- [ ] Cursor advances on both decision paths only after the activation callback returns (at-least-once); new `work.completed` re-activates next tick
- [ ] Restart resumes from persisted cursors (at-least-once)
- [ ] `runWorker`/`cycle.ts`/`evaluate.ts` byte-identical; business-domain keeps zero `@io/*` imports
- [ ] Unit + sequential PG integration tests green (`pnpm test`)
