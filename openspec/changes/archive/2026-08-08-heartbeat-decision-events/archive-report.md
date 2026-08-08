# Archive Report: heartbeat-decision-events

## Change Summary

Added durable business-fact emission for every supervisor heartbeat gate evaluation — including idle `no-llm-heartbeat` — as an audit trail of cost-savings evidence. The change introduced a pure `buildHeartbeatDecisionEvent` factory, an `appendIfAbsent` at-most-once port extension (fake + PG adapter), wiring in `tick.ts` to emit one decision event per evaluation before callback/checkpoint, and defensive scenarios proving `heartbeat.decision` never renews novelty or feeds context segment 12. Fully verified PASS against live PostgreSQL with 6/6 requirements and 21/21 scenarios compliant. Deterministic sequential `pnpm check` green: **1140 passed, 0 failed**.

**Change name**: `heartbeat-decision-events`
**Date archived**: 2026-08-08
**Branch**: main
**Verify verdict**: **PASS WITH WARNINGS** — 6/6 requirements, 21/21 scenarios, 0 critical, 0 blockers

## Intent & Scope

Ship a thin hexagonal heartbeat-decision emission layer that records every pre-gate decision as a deterministic business fact. Covers a pure domain factory (`buildHeartbeatDecisionEvent`), an at-most-once append port (`appendIfAbsent`) across fake and PG adapter, supervisor tick wiring (both branches, before `onActivate`/checkpoint), and delta specs across three existing capabilities. No migration, no new runtime dependencies.

### In Scope
- `packages/business-domain/src/heartbeat-decision-event.ts` — pure factory + `evt:hb:{sha256 digest}` identity
- `BusinessEventRepository.appendIfAbsent` — port extension + in-memory fake + PG adapter (`ON CONFLICT DO NOTHING`)
- `tick.ts` emit wiring — both branches, after gate, before `onActivate`/upsert
- Tests: domain unit (180 tests), integration (18 tests), live-PG roundtrip, concurrent race test
- Delta specs: `supervisor-timer`, `business-event`, `heartbeat`

### Out of Scope
Context-compiler/cohort prefix; gate/evaluator; worker-cycle/work-lifecycle/work-dispatch; idempotency journal; daemon-lifecycle; fencing tokens; Pro escalation; skill-outcome events; learning/promotion; Memory OS.

## Slices & Commits

| Slice | Commit | Description |
|-------|--------|-------------|
| PR 1 | `a673db5` | Domain factory + `appendIfAbsent` port/fake/PG adapter + index export + 21 tests |
| PR 2 | `8f165d5` | `tickCompany` emits ONE `heartbeat.decision` per gate evaluation via `appendIfAbsent` (both branches, at-most-once, before `onActivate`/checkpoint, append errors propagate) |
| Remediation | `f3f9197` | Concurrent `appendIfAbsent` race test against live PostgreSQL |
| Gate fix | `152768d` | `vitest.config.ts` `fileParallelism: false` (fixes pre-existing parallel live-PG TRUNCATE flake) |

## Capabilities Modified

### `supervisor-timer` — MODIFIED
- **Sequential Checkpointed Tick** — tick order gains decision-event step: gate → derive tail → `appendIfAbsent(heartbeat.decision)` → `onActivate` → cursor upsert. Both branches MUST append before any callback or checkpoint. Append/callback failure fails the tick and leaves cursor unadvanced. Seven scenarios (was 4).
- **Non-Invasive Activation Seam** — decision-event appends explicitly supervisor-owned alongside cursor writes. Two scenarios unchanged.

### `business-event` — MODIFIED
- **Append-Only Repository Port** — port surface extends from `append + listByCompany + listCompanyIds` to include `appendIfAbsent`. Duplicate conditional append preserves original; PG single-issuance proven. Three scenarios (was 1).
- **Model-Independent Event Facts** — extends model independence from worker-only to supervisor decision events. Defines exact shape: `eventType: 'heartbeat.decision'`, `aggregateKind: 'heartbeat'`, payload `{decision, model?, cursor}`. Two scenarios (was 1).
- **Idempotent Single Emission** — adds `evt:hb:{sha256 digest}` identity scheme disjoint from worker `evt:{attemptId}`. Four scenarios (was 2).

### `heartbeat` — MODIFIED
- **Declared Material Event Types** — explicitly names `heartbeat.decision` as undeclared, non-material, novelty-neutral, and non-context-feeding. Three scenarios (was 2).

## Verify Result

| Metric | Result |
|--------|--------|
| Requirements compliant | 6/6 |
| Scenarios compliant | 21/21 |
| Blockers | 0 |
| Critical | 0 |
| Full suite | **1140 passed / 6 skipped** (1146 total) |
| Focused requirement suite | **228 passed / 0 skipped** (12 files) |
| Live PostgreSQL proof | **Passed** — concurrent `appendIfAbsent` race converged on exactly one stored row |
| Byte-identity (protected cores) | **Verified** — `cycle.ts`, `evaluate.ts`, `supervisor.ts`, worker path byte-identical to baseline |

Build gate: `pnpm check` green (format: 196 files, typecheck, build, lint all passed).

## Specs Synced

Three MODIFIED delta specs merged into canonical capability specs:

| Domain | Action | Requirements Added | Requirements Modified | Scenarios Added |
|--------|--------|-------------------|----------------------|-----------------|
| `supervisor-timer` | Updated | 0 | 2 | 7 → 3 net new |
| `business-event` | Updated | 0 | 3 | 10 → 7 net new |
| `heartbeat` | Updated | 0 | 1 | 3 → 1 net new |

Synced paths:
- `openspec/specs/supervisor-timer/spec.md`
- `openspec/specs/business-event/spec.md`
- `openspec/specs/heartbeat/spec.md`

## Key Decisions

1. **Digest eventId over attempt-id** — `evt:hb:{sha256(companyId \0 cursor \0 decision.kind).hex.slice(0,16)}` avoids CRITICAL-1 colon-ambiguity; `evt:hb:` cannot collide with worker `evt:att:*`. Cursor is included so retry with same state produces identical ID.

2. **`appendIfAbsent` over throwing `append` for decisions** — At-least-once retry must be a no-op on duplicate. PG uses `ON CONFLICT (event_id) DO NOTHING`; fake returns stored original. Worker path still throws on duplicate.

3. **Emit only in `tick.ts`** — Supervisor-owned emission preserves read-only gate and evaluator. `tick.ts` is the sole protected-core exception; byte-identity tests pin `cycle.ts`, `evaluate.ts`, `supervisor.ts`, worker path unchanged.

4. **Pre-append tail derivation** — `tickCompany` derives the stream tail *before* appending the decision event, so the appended event is not visible to its own tail computation.

5. **No migration** — Reuses existing `business_event` table and `uq_business_event_event_id` unique constraint. Additive-only: new rows coexist with existing worker events.

## Risks & Deferred Items

### Deferred Follow-Ups
1. **Class comment stale** — `PgBusinessEventRepository` class comment still describes the adapter surface as `append + listByCompany`; should reflect `appendIfAbsent + listCompanyIds`. (Noted in verify-report suggestion.)
2. **Log growth by design** — One row per tick per company. Bounded by cadence; acceptable trade-off for audit-trail value.

### Observations to Monitor
3. **Two append semantics confusion** — Port documents both `append` (throws on duplicate) and `appendIfAbsent` (no-ops on duplicate). Future consumers may need clear guidance on which to use.
4. **Experimental Node flag dependency** — Not directly in scope, but the repo's daemon-lifecycle slice depends on `--experimental-transform-types`; monitor Node version stability.

## Purity & Invariants Preserved

- All nine protected core sources byte-identical to baseline (`git diff 07eea12..HEAD`).
- Zero new runtime dependencies in any package manifest.
- `node:crypto` used only in factory (built-in).
- No migration added; `packages/database/sql` unchanged.
- `MATERIAL_EVENT_TYPES` remains exactly `['work.completed']`.
- `openai` ownership boundary unchanged (confined to `deepseek-client.ts`).
- Business-domain isolation intact (zero `@io/*` imports).
- Context dependency boundary intact (`packages/context` deps = `@io/business-domain` only).
- Conventional commits used throughout, no AI attribution.

## Verification Metadata Warning

The launch metadata referenced Engram observation `#6009` for this change, but `#6009` resolves to the unrelated `daemon-lifecycle` spec. The correct active heartbeat spec topic is `sdd/heartbeat-decision-events/spec`, observation `#6022`. This metadata mismatch did not affect compliance results.

---

*Archive report written: 2026-08-08. The SDD cycle for `heartbeat-decision-events` is complete.*
