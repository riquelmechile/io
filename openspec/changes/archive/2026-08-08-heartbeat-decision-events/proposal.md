# Proposal: heartbeat-decision BusinessEvents

## Intent

The supervisor evaluates the heartbeat gate per company per tick, but the decision leaves no durable record. The roadmap requires every pre-gate decision — including idle `no-llm-heartbeat` — as a deterministic business fact: an audit trail that the gate ran and evidence of its cost savings. SPEC CHANGE; no new capability.

## Decisions

**(a) Per-evaluation emission.** One event per gate evaluation, both branches. Honest "evaluation log" reading; keeps `eventId` a pure digest of `(companyId, cursor, decision.kind)` so at-least-once retry is a no-op; `no-llm-heartbeat` is the cost-savings evidence, so transition-only emission would erase idle periods.

**(b) Digest eventId + at-most-once append.** `eventId = evt:hb:{sha256(companyId \0 cursor \0 decision.kind).hex.slice(0,16)}`. Digest avoids the CRITICAL-1 colon-ambiguity; `evt:hb:` cannot collide with worker `evt:att:*`. New port `appendIfAbsent` no-ops on duplicate (`ON CONFLICT DO NOTHING`); worker `append` still throws. Document both.

**(c) Chained — 2 stacked PRs.** Estimate 340–430 lines straddles the 400 budget; under `auto-chain` split now. Slices land independently.

## Scope

### In Scope
- Pure `buildHeartbeatDecisionEvent` factory in `business-domain` (+ exports).
- `appendIfAbsent` port + in-memory fake + PG adapter.
- Emit wiring in supervisor `tick.ts` (both branches, after gate, before `onActivate`/checkpoint).
- Tests: domain unit, tick unit, live-PG roundtrip (sequential).
- Delta specs: `supervisor-timer`, `business-event`, `heartbeat`.

### Out of Scope
context-compiler/cohort prefix; gate/evaluator; worker-cycle/work-lifecycle/work-dispatch; idempotency journal; daemon-lifecycle; fencing tokens; Pro escalation; skill-outcome events; learning/promotion; Memory OS. No migration, no new runtime deps.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `supervisor-timer`: tick order gains decision-event step; supervisor-only writes extend to decision-event appends.
- `business-event`: per-emitter eventId schemes; port gains `appendIfAbsent`; model-independent facts extend to supervisor.
- `heartbeat`: defensive scenario — `heartbeat.decision` never renews novelty.

## Approach

Supervisor-owned emission in `tickCompany` (Option 1): gate decision → `appendIfAbsent(buildHeartbeatDecisionEvent(...))` → `onActivate` → cursor upsert. Preserves at-least-once/checkpoint semantics; gate stays read-only.

## Invariants (unchanged)

`cycle.ts`/`evaluate.ts` byte-identical; emit only in supervisor `tick.ts`; `heartbeat.decision` excluded from `MATERIAL_EVENT_TYPES` and `compileContext` (segment 12 absent); `openai` confined to `llm-client`; `business-domain` zero `@io/*`; `packages/context` deps = `@io/business-domain` only.

## Slice Plan (stacked-to-main)

| PR | Boundary | Contents | ~Lines |
|----|----------|----------|--------|
| 1 📍 | Domain + storage | factory, `appendIfAbsent` port/fake/adapter, exports, factory + PG tests | ~240 |
| 2 | Supervisor wiring | `tick.ts` emit (both branches), tick tests, supervisor scenarios | ~150 |

PR 2 stacks on PR 1; each ≤400.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/business-domain/src/` | New/Modified | factory + port + exports |
| `packages/database/src/business-event-adapter.ts` | Modified | `ON CONFLICT DO NOTHING` |
| `packages/app/src/supervisor/tick.ts` | Modified | emit wiring |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Log grows ~1 row/tick/company | High (by design) | Bounded by cadence |
| Two append semantics confuse readers | Med | Document both in port + spec |
| Touches byte-identical gate | Low | Emit only in `tick.ts`; byte-identity scenarios pin it |

## Rollback Plan

Revert PR 2 then PR 1. No migration to unwind; `business_event` table unchanged; additive-only.

## Success Criteria

- [ ] Both branches emit one `heartbeat.decision` per evaluation.
- [ ] At-least-once retry does not duplicate the event.
- [ ] `cycle.ts`/`evaluate.ts` byte-identical; context-compiler unchanged.
- [ ] `pnpm check` green; live-PG roundtrip passes sequentially.

**Ready for spec phase.**
