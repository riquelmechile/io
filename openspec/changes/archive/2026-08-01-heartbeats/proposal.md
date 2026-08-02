# Proposal: Heartbeats — deterministic novelty filter (§13.2)

## Intent

§13.2 gates every model activation behind a deterministic filter that decides `no-llm-heartbeat | activate flash` from facts, never model judgment (§8.2 item 2). Today the worker always calls Flash (`intent.ts:65`); nothing decides *whether* activation is justified. This slice ships that pre-gate as a pure business rule over the existing BusinessEvent stream (§2: cost as part of reasoning).

## Scope

### In Scope
- Pure `heartbeat` module in `packages/business-domain`: `HeartbeatDecision` (`{kind:'activate',model:'flash'} | {kind:'no-llm-heartbeat'}`), `MATERIAL_EVENT_TYPES` (`['work.completed']`), pure `hasMaterialNovelty(events, cursor)` / `evaluateHeartbeat(events, cursor)`.
- Read-only evaluator seam in `packages/app` computing the decision via the EXISTING `BusinessEventRepository.listByCompany` (composition-root wired; reuses pool-bound, read-only `PgBusinessEventRepository`).
- Live-PG proof (sequential): post-cycle stream ⇒ `activate flash`; fresh company ⇒ `no-llm-heartbeat`.

### Out of Scope (next slice)
- ACTING on the decision (worker skip/run branching, Flash gate, Pro escalation §13.2/§13.3).
- Timer/scheduler/cadence; cursor PERSISTENCE.
- Compiler/context (heartbeat content is §7.2-forbidden leading content).
- Events beyond `work.completed`; learning/promotion; Memory OS. No new table, migration, model call, or worker-cycle change.

## Capabilities

### New Capabilities
- `heartbeat`: deterministic, no-LLM filter deciding `no-llm-heartbeat | activate flash` from a company's BusinessEvent stream via a caller-supplied cursor.

### Modified Capabilities
- None (verified `business-event`, `worker-cycle`, `context-compiler`, `skill` need no change — read path, worker contract, compiler, and skill segment all untouched).

## Approach

Option B (exploration recommendation): the pure domain filter PLUS a thin read-only seam computing the decision from real events. Materiality = function of event type; novelty = cursor-defined (not-yet-seen), never clock-defined — the deferred timer triggers WHEN, never WHETHER. Follows the `first-skill`→`skill-segment7` precedent: ship rule + seam now, act next slice.

## Constraints / Invariants
- **Deterministic, NO LLM in the decision** (§8.2 item 2): signature admits only `(events, cursor)` — no llm, now, randomness, or generated ids. Proven by determinism + inverse + no-clock tests.
- Materiality = declared, extensible constant. Novelty = cursor-defined, never clock-defined.
- Append-only read, ZERO writes; tenant-scoped (ADR-0002).
- `business-domain` ZERO `@io/*`; no new runtime deps; `openai` confined to `llm-client`; `packages/context` deps stay `@io/business-domain`. Does NOT touch `compileContext`. NO agentic/business frameworks.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/business-domain/src/heartbeat.ts` | New | Decision type, `MATERIAL_EVENT_TYPES`, pure filter; exported via `index.ts` |
| `packages/app/src/heartbeat/` | New | Read-only evaluator over `listByCompany` |
| `packages/app/src/composition/worker-deps.ts` | Modified | Wire read-only `events` seam (additive) |
| `packages/app/test/` | New | Seam + live-PG integration (sequential) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope drift into acting on the decision | High | Filter + read seam only; activation is next slice |
| "Novelty" misread as "recent" | Med | Cursor-defined by signature; no-clock test |
| Materiality is new ground (doc gives shape, not content) | Med | Declared extensible constant, documented as a rule |
| PG concurrency flake | Med | Run PG tests sequentially (`--no-file-parallelism`) |

## Rollback Plan

Additive only: revert the two stacked PRs (domain, app). No migration, table, schema, or worker-path change — zero data/state impact. Read-only; human constitutional authority over capital, secrets, and limits untouched.

## Dependencies

- Existing `BusinessEventRepository.listByCompany` (PG-proven) and worker-emitted `work.completed` events; live PG `io_dev`.

## Success Criteria

- [ ] `evaluateHeartbeat(events, cursor)` pure: same inputs ⇒ same decision (determinism + inverse + no-clock green).
- [ ] `work.completed` ⇒ activate; unknown type ⇒ not; empty/seen/ahead cursor semantics proven.
- [ ] Live-PG (sequential): post-cycle ⇒ `activate flash`; fresh ⇒ `no-llm-heartbeat`.
- [ ] `pnpm check` green; baseline ~936 tests pass; `business-domain` stays `@io/*`-free.
- [ ] ~250–330 changed lines; ≤2 stacked PRs (domain, app) within the 400-line budget.
