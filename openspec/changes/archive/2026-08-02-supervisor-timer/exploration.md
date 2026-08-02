# Exploration: supervisor-timer — workless heartbeat wake-ups, cursor persistence, durable recovery

**Change:** `supervisor-timer` · **Phase:** explore · **Store:** hybrid (Engram + OpenSpec)

## 1. Current State

### 1.1 The heartbeat filter (§13.2) is complete but UNREACHABLE

- `packages/business-domain/src/heartbeat.ts` — pure `evaluateHeartbeat(events, cursor)` → `no-llm-heartbeat | activate flash`; novelty is cursor-defined (insertion index into the supplied stream), never clock-defined. `MATERIAL_EVENT_TYPES = ['work.completed']`.
- `packages/app/src/heartbeat/evaluate.ts` — `evaluateHeartbeatForCompany`: strictly read-only seam, exactly ONE `listByCompany` call, zero writes, requires non-empty `companyId`.
- `packages/app/src/heartbeat/cycle.ts` — `evaluateHeartbeatGate(deps:{events}, companyId, cursor?)`: companyId-only boundary gate (workId exclusion is compile-time proven by `@ts-expect-error` + `Function#length === 3` test), thin delegate over the seam.
- **Key finding that shapes this slice:** `work.completed` — the ONLY material event type — is emitted by the worker's OWN finalize (T1). Gating a work-bearing cycle would deadlock the first job: new company → empty event stream → `no-llm-heartbeat` → never claims work → never emits → stuck forever. The `no-llm-heartbeat` output therefore ONLY makes sense for **workless wake-ups** — a periodic supervisor evaluation that consumes NO work. Nothing produces such wake-ups today: `runWorker` is only ever invoked with a `workId` (tests/E2E call it directly; no dispatcher, queue, or scheduler exists anywhere in `packages/`).

### 1.2 No scheduler, no dispatcher, no company enumeration

- No `setInterval`/cron/scheduler code exists (grep confirms; the only "cycle" hit is the heartbeat gate file).
- `CompanyRepository` exposes only `save`/`get` — no list. `WorkRepository` exposes only `save`/`get`/`updateIfVersion` — no "actionable work" listing. The universe of companies the timer could evaluate is derivable today only via `business_event.company_id` (indexed: `idx_business_event_company_id`).

### 1.3 Cursor is an orphan

- `HeartbeatCursor = { lastEventId }`; the gate accepts an optional cursor but NOTHING persists it. `evaluateHeartbeatForCompany` is a zero-write seam by spec (heartbeat R6) — the cursor MUST be persisted by the supervisor, never by the gate/evaluator.
- `idempotency_journal` is keyed per-operation `(companyId, idempotencyKey)` — the WRONG shape for a per-company last-seen marker.

### 1.4 Durable recovery anchors that exist

- Worker mid-cycle recovery is journal-anchored (durable in-flight rows; worker-cycle spec "Durable Restart Recovery").
- §9.8 outbox is a DESIGN CONTRACT (write outbox with the business change; at-least-once delivery; leases with monotonic fencing tokens) — NO outbox table/consumer exists yet, and none is needed for a stateless workless loop whose only durable state is the cursor.
- Migrations are plain `sql/NNN_*.sql` files applied idempotently via `PgDbConnection.execute()` (no migration runner); a new `008_*.sql` follows the pattern.

### 1.5 Invariants verified

- `business-domain` imports zero `@io/*` (heartbeat.ts imports only `./types.js`); `packages/context` runtime deps === `@io/business-domain` only; cohort is `io:{companyId}:{process}:v{schemaVersion}` (`packages/context/src/index.ts`). `openai` confined to `packages/llm-client/src/deepseek-client.ts`. `runWorker` is byte-identical and MUST stay so.

## 2. Affected Areas

| File | Why affected |
|---|---|
| `packages/business-domain/src/heartbeat.ts` | ADD pure `tailCursor(events)` helper (still zero `@io/*` imports) |
| `packages/business-domain/src/ports/repositories.ts` or new `ports/cursors.ts` | NEW `HeartbeatCursorStore` port (pure interface) + additive `listCompanyIds()` on `BusinessEventRepository` |
| `packages/business-domain/src/ports/fakes.ts` | In-memory fakes for the cursor store + company-id enumeration |
| `packages/business-domain/src/index.ts` | Export the new surface |
| `packages/database/sql/008_heartbeat_cursor.sql` | NEW table `heartbeat_cursor (company_id PK, last_event_id, updated_at)` |
| `packages/database/src/heartbeat-cursor-adapter.ts` (+ `index.ts`) | `PgHeartbeatCursorRepository` (get + atomic upsert) |
| `packages/database/src/business-event-adapter.ts` | ADD `listCompanyIds()` (`SELECT DISTINCT company_id`) — additive, read-only |
| `packages/app/src/supervisor/{supervisor,timer,types}.ts` (NEW) | Timer loop, per-company tick (cursor read → gate → advance), `onActivate` seam |
| `packages/app/src/composition/worker-deps.ts` | Wire the cursor store + supervisor deps (or a sibling composition module) |
| `packages/app/test/supervisor/*` (NEW) | Unit (fakes) + PG integration tests (sequential — no-file-parallelism) |
| Specs: `heartbeat` (tailCursor/port), `business-event` (listCompanyIds), NEW `supervisor-timer` | OpenSpec deltas |

**NOT touched:** `worker.ts`, `intent.ts`, `finalize.ts`, `cycle.ts`, `evaluate.ts`, `context/*`, `llm-client/*`.

## 3. Approaches

### Approach A — Polling supervisor + dedicated cursor table + gate-first decision (RECOMMENDED)

A `@io/app` supervisor module runs a loop: discover companies → per company: read stored cursor → `evaluateHeartbeatGate` → advance cursor (upsert to `heartbeat_cursor`) → on `activate`, invoke an injectable `onActivate(companyId)` seam.

- **Tick:** `listByCompany` (supervisor's own read, to compute the tail) + `evaluateHeartbeatGate` (authoritative decision; its own read). Two tenant-scoped SELECTs per company per tick — negligible at a 30–60s cadence.
- **Cursor advance:** `tailCursor(stream)` = last event id in the stream; upsert `INSERT … ON CONFLICT (company_id) DO UPDATE SET last_event_id, updated_at`. Advancing on BOTH paths (activate and no-llm) means an activation is consumed exactly once; a NEW `work.completed` after the cursor re-activates on the next tick (correct).
- **Company discovery:** additive read-only `listCompanyIds()` on `BusinessEventRepository` (`SELECT DISTINCT company_id FROM business_event`). Companies with zero events evaluate `no-llm` anyway, so the event universe is the right universe.
- **Durable recovery (§9.8):** the cursor row IS the checkpoint; ticks are stateless otherwise → restart = re-run from persisted cursors; any unpersisted decision is re-evaluated (at-least-once, §9.8-compliant). Worker-side recovery stays journal-anchored and untouched.
- **Lifecycle:** `startSupervisor(deps, { intervalMs, now?, onActivate? })` returns `{ stop }`; injectable clock/timer for tests. No daemon exists yet — the runner is a composable module; process wiring is deferred.
- **Pros:** matches §13.2 "evento o timer → filtro determinístico → decisión" literally; gate/seam/worker stay byte-identical; cursor is explicit, queryable, testable; port changes are additive-only; a sequential loop avoids the documented PG concurrency flake; at-least-once semantics fit §9.8 without new infra.
- **Cons:** two reads per tick (cheap); a new table + port + adapter; `activate` has no consumer yet (see §4).

### Approach B — Event-driven evaluation (LISTEN/NOTIFY or outbox consumer)

Evaluate on append rather than on a timer: the supervisor subscribes to new `business_event` rows and runs the filter when a `work.completed` lands.

- **Pros:** no polling; aligned with the future §9.8 outbox direction.
- **Cons:** §13.2 explicitly allows "evento o timer" — event-only misses the "no news is still a heartbeat" cadence (the periodic loop is what makes 24/7 cheap); requires NOTIFY wiring (connection-scoped, fragile) or a first outbox table+consumer that does not exist; strictly more infrastructure for strictly less. Rejected for this slice; revisit when cross-context coordination (§9.8 outbox) is built.

### Approach C — Cursor stored in existing state (idempotency journal / in-memory)

- **Journal:** per-operation keyed `(companyId, idempotencyKey)` — a per-company marker is a shape mismatch; would abuse an operation key and pollute the replay/DENY semantics. Rejected.
- **In-memory only:** cursor lost on restart → re-evaluation from scratch → repeated activation of already-seen completed work; violates the durable-recovery intent. Rejected.
- **Takeaway:** a dedicated per-company cursor row is the minimal honest home for the marker.

## 4. Decision consumption (open question resolved for this slice)

When the workless tick returns `activate flash`, the supervisor:

1. Advances the cursor (decision consumed — no repeated re-activation);
2. Calls the injectable `onActivate(companyId)` seam.

**THIS slice: `onActivate` is a recorded no-op** (log/observation). Triggering a REAL work cycle is DEFERRED: it requires an "actionable work" read port on `WorkRepository` (does not exist), an idempotency-key policy for supervisor-initiated cycles, and dispatch wiring — a natural NEXT slice, not this one. Recording a heartbeat decision as a BusinessEvent is ALSO deferred: the event store is spec'd as terminal-close facts emitted by the worker only (business-event R6 "Terminal-close facts ONLY"), so a new emitter is a spec change, not this slice. `runWorker` remains byte-identical; the supervisor is a NEW caller of the gate, never a mutation of the worker.

## 5. Scope Boundary

**IN:** timer/supervisor loop (`@io/app`), `tailCursor` pure helper (business-domain), `HeartbeatCursorStore` port + fake + PG adapter + `008_heartbeat_cursor.sql`, additive `listCompanyIds()` on the events port/adapter/fake, supervisor unit + PG integration tests (sequential), OpenSpec deltas (NEW `supervisor-timer` spec; additive `heartbeat` / `business-event`).

**OUT (deferred):** triggering real work cycles from `activate` (needs work-dispatch port + key policy), heartbeat decision BusinessEvents (new emitter — spec change), Pro escalation / risk tiers (§13.2/§13.3), Memory OS, learning/promotion, daemon/process lifecycle wiring, outbox table/consumer, fencing tokens on the cursor (single-instance assumption this slice).

## 6. Risks

- **Duplicate activation under multi-instance deployment:** two supervisors evaluate the same company → double `onActivate`. Mitigated: single-instance assumption this slice; the cursor upsert is atomic so the marker never corrupts; §9.8 fencing tokens deferred to a hardening slice.
- **Two reads per tick per company:** trivial at timer cadence; a seam-extension (evaluator returning the tail) is a possible later optimization but changes the gate contract and the `Function#length === 3` proof — do NOT do it this slice.
- **Discovery skips zero-event companies:** acceptable — an empty stream evaluates `no-llm` anyway.
- **Cadence is a config decision:** default interval is a proposal/design concern; per-company evaluation must stay sequential (documented PG concurrency flake).
- **`onActivate` no-op delivers no §2 cost savings yet:** the loop is the enabler; the savings land when dispatch wiring lands next slice. The scope expectation must be explicit.

## 7. Ready for Proposal

**Yes** — the deadlock constraint, the workless-wake-up framing, the cursor home, the decision-consumption seam, and the scope boundary are nailed; `propose` can now write intent/scope/approach with confidence.
