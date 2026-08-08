# Exploration — heartbeat-decision BusinessEvents

> Change: `heartbeat-decision-events` · Project: `io` · Type: SPEC CHANGE (modifies existing supervisor/heartbeat/business-event capabilities — NOT purely additive).
> Roadmap anchor: `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` Rev 5, "Próximos pasos (después de work-dispatch)" → "heartbeat-decision BusinessEvents (registrar la decisión del pre-gate como hecho de negocio)".

## 1. Current State

### 1.1 Heartbeat decision path (what we are recording)

The supervisor decides the heartbeat gate per company and per interval:

- `startSupervisor(deps, options)` — `packages/app/src/supervisor/supervisor.ts:37`. Periodic lifecycle; every interval `tickAll()` discovers companies via `deps.events.listCompanyIds()` and evaluates each **sequentially** (no `Promise.all`). Failures are logged and swallowed; the next interval re-evaluates from the un-advanced cursor (at-least-once).
- `tickCompany(deps, companyId, onActivate)` — `packages/app/src/supervisor/tick.ts:26`. The single sequential, checkpointed company tick, in the verified **R4-001 crash-safety order**:
  1. require a non-empty `companyId` (ADR-0002) before any store read;
  2. `cursor = deps.cursors.get(companyId)` (first contact → `undefined`);
  3. `decision = evaluateHeartbeatGate({ events: deps.events }, companyId, cursor)` — read #1;
  4. `stream = deps.events.listByCompany(companyId)` — read #2; `tail = tailCursor(stream)`;
  5. `activate` → `await onActivate?.(companyId)` — **side effect FIRST**;
  6. `tail !== undefined` → `deps.cursors.upsert(companyId, tail)` — **checkpoint LAST**, never before the callback returns.
- `evaluateHeartbeatGate` — `packages/app/src/heartbeat/cycle.ts:21`. A **thin read-only delegate** over `evaluateHeartbeatForCompany` (`packages/app/src/heartbeat/evaluate.ts:20`) which does exactly one tenant-scoped `listByCompany` and delegates to the pure `evaluateHeartbeat` (`packages/business-domain/src/heartbeat.ts:63`).
- `HeartbeatDecision` — `packages/business-domain/src/heartbeat.ts:9`: `{ kind: 'activate', model: 'flash' } | { kind: 'no-llm-heartbeat' }`. Pure function of `(events, cursor)`; never clock/LLM/randomness-defined (inverse-poison guarantee).
- `HeartbeatCursor = { lastEventId }`; `tailCursor(events)` = last event's `eventId` in insertion order (`heartbeat.ts:80`).
- Materiality: `MATERIAL_EVENT_TYPES = ['work.completed']` (`heartbeat.ts:25`). Novelty = a material event **follows** the cursor by insertion index. A `heartbeat.decision` event is NOT material → it can never renew novelty (no self-activation loop).

### 1.2 BusinessEvent infrastructure (where the decision fact goes)

- `BusinessEvent` — `packages/business-domain/src/types.ts:98`: `{ eventId, companyId, aggregateKind, aggregateId, eventType, occurredAt, payload, source }`. Pure domain type; `business-domain` has zero `@io/*` imports / no runtime deps.
- `BusinessEventRepository` — `packages/business-domain/src/ports/repositories.ts:79`: **append-only** surface `append` + `listByCompany` + read-only `listCompanyIds`. No update/delete/overwrite/get-by-id.
- `PgBusinessEventRepository` — `packages/database/src/business-event-adapter.ts:28`: `INSERT` into `business_event` (migration `packages/database/sql/006_business_events.sql`); single issuance enforced by `uq_business_event_event_id` (UNIQUE `event_id`); tenant-scoped reads `WHERE company_id = $1 ORDER BY id ASC`; rows validated by `parseBusinessEventRow` (row-guards). **No migration needed for the decision event — it fits the existing table shape.**
- The canonical emitter to mirror: `buildWorkCompletedEvent` — `packages/app/src/worker/finalize.ts:323`. Deterministic `eventId = evt:{attemptId}`, `aggregateKind: 'work'`, `eventType: 'work.completed'`, `source: 'worker'`, appended **inside the T1 transaction** (atomic with Work CAS + receipt + journal.complete — a CAS loss rolls the event back with the close).
- Heartbeat cursor store: `HeartbeatCursorStore` — `packages/business-domain/src/ports/cursors.ts:19` (`get`/`upsert`); `PgHeartbeatCursorRepository` — `packages/database/src/heartbeat-cursor-adapter.ts:18` (atomic `INSERT … ON CONFLICT (company_id) DO UPDATE`); migration `008_heartbeat_cursor.sql`. **Only the supervisor writes cursors.**
- Composition: `buildSupervisorDeps(connection)` — `packages/app/src/composition/supervisor-deps.ts:16` → `{ events: PgBusinessEventRepository, cursors: PgHeartbeatCursorRepository }` (pool-bound). `buildSupervisorDispatch` — `packages/app/src/composition/supervisor-dispatch.ts:26` wires `onActivate → dispatchCompanyActivation` (`packages/app/src/dispatch/dispatch.ts:24`).

### 1.3 Cohort rule (§7.2/§7.3) applicability

The cohort rule governs the **context-compiler stable prefix** (`io:{companyId}:{process}:v{schemaVersion}`, segments 1–9) — a KV-cache identity. Business events are **not** prefix content: `business-event` spec R9 and `heartbeat` spec R9 both require "MUST NOT feed `compileContext`; segment 12 MUST remain absent", and `packages/context` runtime deps MUST remain exactly `@io/business-domain`. The decision event follows the same isolation rule: it is a **tenant-scoped fact-log row** (keyed by `companyId` via `listByCompany`, ADR-0002/R8), never a prefix segment — no cache-poisoning surface exists because the event log is not a shared prefix cache at all. The proposal MUST restate this invariant: `context-compiler` stays byte-identical; the decision event never enters `compileContext`.

## 2. What a heartbeat-decision BusinessEvent is (proposed)

One fact per gate evaluation, on **BOTH** decision paths (an idle `no-llm-heartbeat` IS a decision — it is the cost-savings evidence of §2/§13.2):

| Field | Value | Notes |
|---|---|---|
| `eventType` | `'heartbeat.decision'` | single type, discriminated by `payload.decision`; extensible (future branches: escalate-pro etc.) |
| `aggregateKind` | `'heartbeat'` | per-company gate; backed by `idx_business_event_aggregate` |
| `aggregateId` | `companyId` | the heartbeat gate is companyId-only |
| `source` | `'supervisor'` | distinct from the worker's `'worker'` |
| `eventId` | `evt:hb:{sha256(companyId \0 cursor?.lastEventId ?? ∅ \0 decision.kind).hex.slice(0,16)}` | **digest, not raw ids** — avoids the CRITICAL-1 colon-ambiguity class (`dispatchIdempotencyKeyFor`, work-dispatch remediation `4be8d9b`); deterministic ⇒ stable under at-least-once retry; `evt:hb:` cannot collide with worker `evt:{attemptId}` (`att:` scheme, `packages/app/src/worker/intent.ts:25`) |
| `occurredAt` | `now?.() ?? Date.now()` | injectable clock in the factory (worker parity); NOT part of the identity |
| `payload` | `{ decision: 'activate' \| 'no-llm-heartbeat', model?: 'flash', cursor: cursor?.lastEventId ?? null }` | minimal; strictly the gate inputs + outcome. No invented `reason` field (the decision is binary); never LLM output |

**When emitted**: immediately after the gate decision, **before** `onActivate` and **before** the cursor checkpoint (see placement, §3). The fact records the DECISION, which is independent of whether the activation callback later succeeds.

**Idempotency / replay semantics**: the eventId is a pure function of `(companyId, cursor, decision.kind)`. At-least-once retries repeat the SAME un-advanced cursor ⇒ same decision ⇒ same eventId ⇒ the append is a **no-op**. Single-issuance lives at the storage boundary via a new **at-most-once append** (recommended) or a tick-level check-then-append (fallback). No journal interaction: the decision event is a supervisor-side fact on the same append-only log, outside the worker's idempotency-journal/T1 path.

## 3. Emitter placement — options

| # | Approach | Pros | Cons | Effort |
|---|---|---|---|---|
| **1 (recommended)** | **Emit in `tickCompany`** between the gate decision and `onActivate`, using a pure `buildHeartbeatDecisionEvent(companyId, decision, cursor, now?)` factory in `business-domain` + a new port-level **`appendIfAbsent(event)`** (PG: `INSERT … ON CONFLICT (event_id) DO NOTHING`). Both branches emit. | Correct semantics; factory is unit-testable and stays in the zero-`@io/*` package; gate/`cycle.ts`/`evaluate.ts` stay byte-identical (supervisor-timer R4); at-least-once-safe (retry = same eventId = no-op); idempotency enforced at the storage boundary; zero migration | New port method ripples to fake + adapter + boundary/parity tests; one event per tick ⇒ log grows linearly with cadence (flagged, §5) | Medium |
| 2 | Same placement, **check-then-append** in `tickCompany` (membership test on the already-read `stream`, then plain `append`) | Zero port change — smallest diff | TOCTOU race: a concurrent append between check and insert throws a unique violation → that tick fails → retried next interval (benign but noisy); idempotency contract lives in app code, not at the storage boundary | Low |
| 3 | Emit inside `evaluateHeartbeatGate` / `evaluateHeartbeatForCompany` | — (none that justify the risk) | **REJECTED**: violates the verified read-only gate invariant (heartbeat R6 "Evaluation performs zero writes"; supervisor-timer R4 "Existing paths remain unchanged — cycle.ts/evaluate.ts byte-identical") | — |
| 4 | Emit inside `onActivate` / dispatch wrapper | Keeps `tick.ts` unchanged | Only fires on `activate` — loses `no-llm-heartbeat` decisions (the cost-savings facts); ties the fact to activation outcome instead of the gate decision; **REJECTED** | — |

**Recommendation: Option 1.** Order inside the tick becomes: gate decision → `appendIfAbsent(buildHeartbeatDecisionEvent(...))` → `onActivate` → cursor upsert. This preserves the verified at-least-once / cursor-checkpoint semantics exactly:
- crash before checkpoint ⇒ cursor un-advanced ⇒ same decision ⇒ same eventId ⇒ no-op re-append; activation re-runs (R4-001 preserved);
- crash inside `onActivate` after the emit ⇒ decision fact already recorded (honest — the decision happened), cursor un-advanced, retry re-invokes `onActivate`; the event is NOT duplicated;
- append failure (DB down) ⇒ the tick throws like a throwing `onActivate` ⇒ swallowed/logged by the schedule ⇒ retried next interval. **Never swallow an append failure** — that would silently lose decision facts. This is consistent with the existing failure contract (`supervisor.ts:55`).

`tickCompany`'s signature stays `(deps, companyId, onActivate?)` — `SupervisorDeps` already carries `events`; no composition change. `buildSupervisorDeps` / `buildSupervisorDispatch` need no changes (the supervisor already owns the event repo). `StartSupervisorOptions.now` remains reserved for the decision logic; the event's `occurredAt` uses the factory's default `Date.now()` (injectable in factory unit tests) — no signature threading.

## 4. Delta-spec impact — MODIFIED vs NEW

**No NEW capability.** The emitter is an extension of the supervisor's existing duty; the roadmap's own framing is "nuevo emisor = spec change".

- **MODIFY `supervisor-timer`** (`openspec/specs/supervisor-timer/spec.md`):
  - `Requirement: Sequential Checkpointed Tick` (R2): add the decision-event step to the tick order (emit after gate, before callback/checkpoint) + scenario "decision event is recorded once per evaluation" and "at-least-once retry does not duplicate the decision event";
  - `Requirement: Non-Invasive Activation Seam` (R4): extend "cursor writes MUST belong only to the supervisor" → "cursor writes AND decision-event appends MUST belong only to the supervisor" (the byte-identity commitment for `runWorker`/`cycle.ts`/`evaluate.ts` is unchanged).
- **MODIFY `business-event`** (`openspec/specs/business-event/spec.md`):
  - `Requirement: Idempotent Single Emission` (R8): generalize `eventId = evt:{attemptId}` to a per-emitter scheme — worker `evt:{attemptId}` unchanged; supervisor decision `evt:hb:{digest}` (deterministic, digest-based, collision-free);
  - `Requirement: Append-Only Repository Port` (R4/R7) or a new requirement: add the **at-most-once append** operation (`appendIfAbsent`) with its single-issuance semantics (no-op on duplicate, preserves the original row);
  - `Requirement: Model-Independent Event Facts` (R6): extend "terminal-close facts ONLY" to cover the supervisor emitter (decision facts ONLY — never LLM output, never clock-derived identity).
- **MODIFY `heartbeat`** (`openspec/specs/heartbeat/spec.md`) — minimal/defensive: add a scenario asserting `heartbeat.decision` events never renew novelty (they are undeclared in `MATERIAL_EVENT_TYPES`; already implied by `Requirement: Declared Material Event Types` R2, but this slice introduces the new event type).
- **UNCHANGED (explicitly out of scope):** `context-compiler` (segment 12 absent; cohort/prefix rule untouched), `work-lifecycle`, `work-dispatch`, `worker-cycle`, the gate (`cycle.ts`), the evaluator (`evaluate.ts`), `idempotency-journal`.

## 5. Edge cases, risks, scope boundary

### Edge cases
1. `no-llm-heartbeat` still emits (both branches — cost-savings evidence).
2. Emission failure ⇒ tick fails ⇒ swallowed/logged ⇒ retried; cursor never advanced. Never swallow the append.
3. Crash after append, before checkpoint ⇒ no-op re-append (same eventId), activation re-runs.
4. Crash inside `onActivate` after emit ⇒ fact recorded, no duplicate, retry re-invokes.
5. No journal/replay interaction: decision event is outside the worker's idempotency path and outside any transaction (single committed `appendIfAbsent` insert); T1 atomicity untouched.
6. Ordering vs checkpoint: event appended after the tail read, before the checkpoint ⇒ the FIRST decision event sits after the first checkpoint; subsequent cursors advance past prior decision events. Net effect: **one decision event per gate evaluation** (see risk R1).
7. Multi-company: `tickAll` is sequential; events are tenant-scoped (`companyId` on every row); no cross-company interference.
8. Empty stream / absent cursor: discovered companies have ≥1 event by construction; a `undefined` cursor is encoded as `∅` in the digest and `cursor: null` in the payload.
9. Self-feed: `heartbeat.decision` is not material ⇒ no novelty ⇒ no activation loop (must be pinned by a scenario).
10. `evt:hb:` prefix cannot collide with worker `evt:att:*`; digest slice collision would surface as a benign no-op append.

### Risks
- **R1 (key semantic decision — must be settled in proposal):** per-evaluation emission ⇒ the append-only log grows one row per tick per company, bounded by cadence (e.g. ~1440 rows/company/day idling). This is the honest "evaluation log" reading of the roadmap ("registrar la decisión del pre-gate"). The alternative (emit only on material-novelty transitions, eventId keyed on the material-relevant cursor) is quieter but loses evaluation fidelity and complicates the eventId derivation. Recommendation: keep per-evaluation; note compaction/stream-pagination/filtering as future work (the whole-stream re-read per tick is a pre-existing, out-of-scope concern).
- **R2:** new `appendIfAbsent` port method ripples to fake, PG adapter, and parity/boundary tests; two append methods with different duplicate semantics must be documented explicitly (worker `append` throws on duplicate; supervisor `appendIfAbsent` no-ops).
- **R3:** 400-line review budget — Medium risk. Domain factory (~50), port+docs (~15), fake+adapter (~45), tick wiring (~20), index exports (~10), tests (factory ~70, tick emission ~80, PG roundtrip ~50, boundary touch-ups) ≈ 340–430 authored lines. Fits under 400 if tests stay tight; if it exceeds, split into chained slices (A: domain factory + `appendIfAbsent` port/adapter; B: tick wiring + supervisor scenarios) per the stacked-to-main strategy.
- **R4:** `occurredAt` uses `Date.now()` in production — non-deterministic field, but NOT part of the identity (same tradeoff the worker already accepts); factory tests inject a fixed clock.
- **R5:** must not touch `cycle.ts`/`evaluate.ts` (byte-identity scenarios in supervisor-timer R4 and heartbeat R6) — the emit call lives in supervisor-owned `tick.ts` only.

### Scope boundary for the proposal phase
**In:** pure decision-event factory in `business-domain` (+index exports); `appendIfAbsent` port method + in-memory fake + PG adapter (`ON CONFLICT (event_id) DO NOTHING`); emit wiring in `tick.ts` (both branches); tests (domain unit, tick unit, live-PG roundtrip); delta specs for `supervisor-timer`, `business-event`, `heartbeat` (defensive).
**Out (unchanged):** `context-compiler`/cohort prefix (decision event must NOT enter `compileContext`; segment 12 stays absent); gate and evaluator (`cycle.ts`, `evaluate.ts`); `worker-cycle`/`work-lifecycle`/`work-dispatch`; idempotency journal; daemon-lifecycle (blocked); fencing tokens, Pro escalation, skill-outcome events, learning/promotion, Memory OS (roadmap follow-ups, not this slice). No new migration (the existing `business_event` table + `uq_business_event_event_id` are sufficient).

## 6. Recommendation

Option 1: **supervisor-owned emission in `tickCompany`** (gate → `appendIfAbsent(buildHeartbeatDecisionEvent(...))` → `onActivate` → cursor upsert), with a pure digest-keyed factory in `business-domain` and an at-most-once `appendIfAbsent` at the storage boundary. This records every pre-gate decision as a durable, deterministic, at-most-once business fact without weakening the verified at-least-once cursor semantics, without touching the read-only gate, and without a schema migration.

**Size estimate: Medium** — likely under 400 changed lines if tests stay tight (see R3); the proposal should confirm the per-evaluation emission semantics (R1) before spec work.

## 7. Ready for Proposal

**Yes.** The change is well-understood, the placement decision is made (Option 1), and the one open semantic choice (per-evaluation vs per-transition emission, R1) is a proposal-phase decision with a clear recommended default. The orchestrator should tell the user: this slice modifies `supervisor-timer` + `business-event` (+ defensive `heartbeat` scenario), adds one port method (`appendIfAbsent`), touches `tick.ts` only on the supervisor path, and introduces no migration; expected size Medium, close to the 400-line budget with the option to chain if needed.
