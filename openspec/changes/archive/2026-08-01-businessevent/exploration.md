# Exploration: BusinessEvent (Paso 3 — deterministic business fact log)

**Change:** `businessevent` · Project: io · Hybrid artifact store
**Baseline:** `main @ b1662e5` (clean tree) · ~829 passed / 3 skipped · live PG 18.4 integration green
**Sources:** architecture doc `IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md` §8.2.2/§9.1/§9.2/§9.3/§9.8/§12.1/§13.1/§13.2/§15, roadmap `PASOS_SIGUIENTES_INCREMENTO_4.md` Paso 3, archived `context-compiler` + `deepseek-live-e2e` explorations (BusinessEvent explicitly deferred in both), live code in `packages/`.

## 1. What "BusinessEvent" is in this architecture (concept discovery)

The literal term **"BusinessEvent" appears ONLY in the roadmap** (`PASOS_SIGUIENTES_INCREMENTO_4.md` line 224: `Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap`, and line 238). It is NOT defined verbatim anywhere in the codebase, specs, or the architecture doc. The **concept** it refers to is defined by the foundational doc's event/memory semantics:

- **§8.2.2** (Engram limitation 2): *"En IO, ciertas memorias deben producirse obligatoriamente desde eventos determinísticos."* — Some IO memories MUST be produced from **deterministic events**, never from agent judgment.
- **§9.1 Business-object memory**: *"Cada objeto mantiene su evolución temporal, eventos, estado vigente y evidencia."* — every business object keeps its temporal evolution, events, current state, and evidence.
- **§9.2 Memory Object** `source.kind: event | artifact | human | agent | tool | external_source` — a memory may be sourced from an event.
- **§9.3 Writing process** (line 880): *"señal o evento → perception gate → clasificación → sanitización → … → persistencia append-only"* — the memory write pipeline starts from a **signal or event**. Deterministic mandatory writes (line 893): *contrato creado o modificado; presupuesto aprobado; acción ejecutada; artefacto publicado; decisión del directorio; incidente; resultado verificado; permiso concedido o revocado.*
- **§9.8 Multi-agent consistency** (line 1031): *"append-only para eventos"*; (line 1043): *"Cada comando empresarial modifica como máximo un agregado autoritativo y, en la misma transacción, sus registros técnicos necesarios: snapshot inmutable de autorización, riesgo, separación de funciones, política, aprobación y evidencia; auditoría; resultado terminal de idempotencia; y mensajes de outbox cuando correspondan."* — the **outbox message is written in the SAME transaction** as the business change; delivery is at-least-once; a consumer never marks an inbox processed before durably applying its effects.
- **§13.1 Worker cycle** (line 1268): *"… verificar → registrar episodio → actualizar scorecard → reposo"* — the worker cycle has an explicit **"registrar episodio"** (record episode) step after verification.
- **§13.2 Heartbeats** (line 1278): *"evento o timer → filtro determinístico → ¿existe novedad material? no → heartbeat sin LLM; sí → activar Flash"* — **events are the deterministic input** that distinguishes a no-LLM heartbeat from a real activation.
- **§15 Increment 5** (line 1417): *"episodios y business objects append-only"*.

**Synthesis.** BusinessEvent is the **deterministic, append-only business-fact record** ("what happened" in the business) that sits between the operational aggregates (Work/Delegation/Receipt) and every downstream consumer that must act or learn from facts without trusting model judgment:

```text
deterministic business change (worker terminal close, receipt, …)
  → append-only BusinessEvent (same transaction, §9.8 outbox pattern)
  → consumers: episodic memory (§9.1/§9.3, Increment 5),
    heartbeats novelty filter (§13.2), skills/outcomes, context segment 12
```

It is NOT the model's narrative, NOT an audit log of reads, and NOT an event-sourced aggregate store. It is the durable, immutable, deterministic record of **business facts that happened**, append-only, written atomically with the change that produced them — the substrate the roadmap's later slices (skill, heartbeats) and Increment 5 (memory) all consume.

## 2. Why it is the NEXT slice and what it unlocks

The worker cycle (`packages/app/src/worker/`) today ends at the atomic finalize: `claim → authority → intent → reconcile → effect → verify → finalize T1` where T1 atomically does `CAS → receipt → journal.complete`. That is a **technical** terminal record (receipt + idempotency journal). What is MISSING: a **business-fact record** — the append-only "what happened" that the architecture mandates must be produced deterministically (§8.2.2, §9.3) and that later slices depend on.

**Why now:** the two prior Paso 3 slices (context compiler + DeepSeek live E2E) made the cycle run end-to-end with compiled context + real model. The next roadmap items consume BusinessEvent:

1. **Heartbeats (§13.2)** — the deterministic filter "¿existe novedad material?" needs an event source. Without BusinessEvent, heartbeats have nothing deterministic to filter on. **BusinessEvent is the heartbeat filter's input.**
2. **Skills / outcomes** — the "un skill" slice and Increment 5 learning need verified outcome records; BusinessEvent carries the deterministic terminal facts.
3. **Episodic memory (Increment 5, §9.1/§9.3)** — "episodios append-only" memories MUST be derived from deterministic events; BusinessEvent is that derivation source.
4. **Context segment 12 "recent evidence"** — the compiler's segment 12 currently renders ABSENT (`packages/context/src/segments.ts`); BusinessEvent is the future source. (Feeding it is a LATER slice — this slice only creates the log.)

**Value unlocked:** the first deterministic, append-only business fact stream; the §9.8 outbox pattern proven in the same transaction as a business change; the prerequisite that unblocks heartbeats/skills/memory without building any of them.

## 3. Current state (verified from the live repo)

- **No event concept exists**: no `BusinessEvent` type/port/adapter/table/spec anywhere. The closest neighbors are the **BusinessReceipt** (immutable, `terminalEventId` = the attempt that closed the work, `UNIQUE(work_id, terminal_event_id)`) and the **idempotency journal** (technical attempt bookkeeping, `aborted_retryable` marker).
- **`packages/business-domain`** (`src/types.ts`, `ports/repositories.ts`, `ports/fakes.ts`, `index.ts`): 4 aggregates (Company, Delegation, Work, BusinessReceipt), zero `@io/*` imports, ports are driver-free. This is the natural home for the `BusinessEvent` type + append-only port + in-memory fake.
- **`packages/database`**: PG adapters (`business-receipt-adapter.ts`, `work-adapter.ts`, `idempotency-adapter.ts`), row guards (`row-guards.ts`), migrations `001–005` (`sql/`), `completeWorkAtomically` (atomic terminal close: journal → in_flight → CAS → receipt → journal.complete). A `006_business_events.sql` + `PgBusinessEventRepository` would mirror the receipt adapter (INSERT-only, no UPDATE/DELETE).
- **`packages/app`**: worker cycle `src/worker/worker.ts` → `finalize.ts` T1 (`finalizeInFlightWorkAtomically`): `CAS → receipt → journal.complete` in ONE `connection.transaction`. `src/composition/worker-deps.ts` (`buildWorkerDeps`) assembles the `repositories(conn)` factory returning `{ work, receipts, journal }` — the seam where an `events` repo joins. The worker is PG-agnostic; adapters are constructed at the composition root.
- **`packages/context`**: segment 12 `recent-evidence` renders ABSENT (future consumer, NOT this slice).
- **Hard constraints verified**: `openai` confined to `llm-client/src/deepseek-client.ts`; `business-domain` has zero `@io/*` imports; `packages/context` deps = `@io/business-domain` only; no agentic frameworks; cohort prefix is a pure function of `{companyId, process, schemaVersion}` — the event log must NEVER leak into stable segments (events are suffix/dynamic content by nature; this slice does not touch the compiler, so the cohort rule is structurally safe).
- **Archived precedent**: `context-compiler` (new pure package) and `deepseek-live-e2e` (composition root + live E2E) both explicitly listed BusinessEvent as OUT; both were single-bounded slices sized 200–400 changed lines, delivered via stacked PRs (auto-chain).

## 4. Affected areas

- `packages/business-domain/src/types.ts` — ADD `BusinessEvent` domain type (append-only fact: `eventId`, `companyId`, `aggregateKind`, `aggregateId`, `eventType`, `occurredAt`, `payload`, `source`). Zero `@io/*`.
- `packages/business-domain/src/ports/repositories.ts` (or new `ports/events.ts`) — ADD `BusinessEventRepository` port: append-only surface (`append` + scoped `listByCompany` read for consumers). NO update/delete/overwrite.
- `packages/business-domain/src/ports/fakes.ts` — ADD `InMemoryBusinessEventRepository` (append-only, retains order).
- `packages/business-domain/src/index.ts` — export the type + port + fake.
- `packages/business-domain/test/` — new `business-event.test.ts`: append-only contract, field shape, tenant scope, deterministic construction.
- `packages/database/src/business-event-adapter.ts` (NEW) — `PgBusinessEventRepository` mirroring the receipt adapter: INSERT-only, scoped reads.
- `packages/database/src/row-guards.ts` — ADD `parseBusinessEventRow` runtime guard.
- `packages/database/src/index.ts` — export the adapter.
- `packages/database/sql/006_business_events.sql` (NEW) — `CREATE TABLE IF NOT EXISTS business_event` (id, event_id UNIQUE, company_id, aggregate_kind, aggregate_id, event_type, occurred_at, payload JSONB, source, created_at), indexes on (company_id), (aggregate_kind, aggregate_id), append-only (no UPDATE/DELETE anywhere in the slice).
- `packages/database/test/business-event-roundtrip.integration.test.ts` (NEW) — round-trip vs live PG (sequential, like existing PG tests) + `boundary.test.ts` guard that the adapter never emits UPDATE/DELETE.
- `packages/app/src/worker/finalize.ts` — inside T1, append ONE BusinessEvent (`work.completed`) in the SAME transaction as CAS + receipt + journal.complete (§9.8 outbox pattern). Event built from deterministic facts (work terminal state, receipt, evidenceId, attemptId).
- `packages/app/src/worker/types.ts` — `WorkerRepositories`/`FinalizeRepositories` gain `events`.
- `packages/app/src/composition/worker-deps.ts` — `repositories(conn)` factory adds `events: new PgBusinessEventRepository(conn)`; `buildWorkerDeps` wires it.
- `packages/database/src/complete-work-flow.ts` — `completeWorkAtomically` gains the events repo (parity with the worker twin) — IF the slice decides to emit from the domain use case too (see Option B below).
- `packages/app/test/` — `worker-helpers.ts` + `worker-finalize.test.ts` gain the event fake in every deps construction; new assertions: exactly one event per terminal close, event committed atomically with the receipt, CAS-loss rolls the event back.
- `packages/app/test/e2e/` — harness/`worker-e2e` gain "one business_event row in the live DB after terminal close" (structure-not-output).

## 5. Approaches

### A. Deterministic append-only log written at the WORKER terminal close only (recommended core)
Define `BusinessEvent` in business-domain (type + append-only port + fake); `PgBusinessEventRepository` + `006` migration in database; wire `events` into the worker's T1 finalize (`finalizeInFlightWorkAtomically` appends `work.completed` in the same transaction) and into `buildWorkerDeps`. Domain use case (`completeWork`) untouched.

- Pros: smallest footprint; the worker twin is the runtime path that actually runs; proves the §9.8 outbox pattern (event written atomically with the change); leaves the pure domain use cases untouched; event semantics live in business-domain so they survive model/DB changes; ~fits the 400-line budget with focused tests.
- Cons: the domain `completeWork` path (used by `completeWorkAtomically` integration) does not emit — a documented parity gap; consumers (heartbeats/skills/memory) must read via the port's scoped read.
- Effort: Medium.

### B. A + parity emission from the domain use case (`completeWork`)
Also emit the event inside `completeWork` (or a small `recordEvent` step in `completeWorkIdempotent`), so BOTH terminal-close paths (domain use case AND worker twin) write the same fact.

- Pros: full parity — every terminal close writes the event regardless of path; matches the receipt pattern (receipt is written in both `completeWork` and the worker twin today).
- Cons: touches the pure domain use case + `CompleteWorkDeps` + `completeWorkAtomically` + idempotency tests — larger surface, higher budget risk; the receipt/event pairing becomes duplicated logic that must stay in sync.
- Effort: Medium–High.

### C. Event log + read-side consumers (heartbeats filter or segment 12) in the same slice
Write the log AND wire the first consumer (e.g. render recent events into context segment 12, or the heartbeat novelty filter).

- Pros: demonstrates end-to-end value immediately.
- Cons: violates the bounded-slice rule (heartbeats and segment-12 sourcing are later roadmap items, explicitly deferred by prior archives); consumers are separate decisions with their own risk; blows the 400-line budget.
- Effort: High.

**Recommendation: Approach A, with a one-line note in the design that the domain-use-case parity (B) is a candidate follow-up if a second terminal-close path ever ships.** It is the only option that is a clean, single bounded slice: the deterministic append-only fact log, written atomically with the worker's terminal close, with a scoped read seam for future consumers — without building any consumer.

Design rules for the slice:

1. **Append-only by construction**: the port exposes `append(event)` and a scoped read (`listByCompany`), NEVER update/delete/overwrite. The PG adapter is INSERT-only; a boundary guard asserts no UPDATE/DELETE statement exists in the adapter source.
2. **Deterministic, not model-judged** (§8.2.2/§9.3): the event is built from the terminal-close facts (work terminal state, receipt fields, `evidenceId`, `attemptId`, actor) — never from LLM output.
3. **Written atomically with the change** (§9.8): the append happens inside the SAME `connection.transaction` as CAS + receipt + journal.complete. A CAS loss rolls back the event too (no orphan event).
4. **Tenant scoped** (ADR-0002): every event carries `companyId`; the read is scoped by company.
5. **Exactly one event per terminal close**: event `eventId` derived deterministically (e.g. `evt:{attemptId}`), mirroring the receipt's single-issuance discipline — a replay never appends twice.
6. **Never enters the stable prefix**: the event log is dynamic-suffix content by nature; this slice does NOT wire it into `compileContext` (segment 12 stays ABSENT — later slice).
7. **Tests**: (a) business-domain unit — append-only contract, shape, tenant scope, deterministic id; (b) database round-trip vs live PG + boundary (no UPDATE/DELETE in adapter); (c) worker integration — one event per terminal close, atomic with receipt, rolled back on CAS loss; (d) E2E — one `business_event` row in the live DB after a full cycle.

## 6. Scope boundaries (first bounded slice)

**IN**
- `packages/business-domain`: `BusinessEvent` type, append-only `BusinessEventRepository` port, `InMemoryBusinessEventRepository` fake, exports, unit tests.
- `packages/database`: `PgBusinessEventRepository` (INSERT-only), `parseBusinessEventRow` guard, `006_business_events.sql` migration, index/export, round-trip integration test + boundary guard.
- `packages/app`: `events` in `WorkerRepositories`/`FinalizeRepositories`, worker T1 appends `work.completed` atomically, `buildWorkerDeps` wires the PG adapter, worker/E2E tests.
- New spec: `business-event` capability (proposal/spec phases, later).

**OUT (explicitly deferred — later Paso 3 slices / future increments)**
- Heartbeats (§13.2 filter) — needs the log, consumes it LATER.
- Skills, learning, outcomes consumption — later slices.
- Memory OS / episodic ingestion (§9.1/§9.3 pipeline) — Increment 5.
- Context segment 12 "recent evidence" sourcing — later slice (segment stays ABSENT).
- Domain-use-case parity emission (Option B) — candidate follow-up, not this slice.
- Outbox consumers / delivery semantics beyond the atomic in-transaction append (§9.8 consumer half).
- Event-sourced aggregate reads / projections / replay.
- Crypto receipts, CEO, minions, workflows.

## 7. Risks

- **Scope drift into heartbeats/skills/memory** — HIGH; the roadmap sequence invites it. The slice is the write side ONLY (Approach A).
- **Atomicity slip**: appending the event outside the T1 transaction would create orphans on CAS loss — must be inside `connection.transaction`; tested.
- **Append-only violation**: a naive adapter exposing UPDATE/DELETE, or an overwrite path in the fake — port shape + boundary guard + unit tests enforce it.
- **Budget pressure**: Approach A with the database round-trip + E2E assertion may push toward ~350–450 changed lines; keep tests focused (structure-not-output), reuse the harness. Delivery strategy `auto-chain` already supports 2 stacked PRs if needed.
- **Duplicate events on replay**: eventId must be derived from the attempt/key so a replay never appends twice — mirror the receipt's `UNIQUE(work_id, terminal_event_id)` discipline.
- **Cohort/cache poisoning** (invariant): this slice does NOT touch `compileContext`, so the stable prefix is structurally safe; a later segment-12 wiring MUST re-verify the cohort rule before landing.
- **Churn in existing tests**: `worker-finalize.test.ts` (4 `repositories` constructions), `worker-helpers.ts`, `parity.test.ts`, `app-boundary.test.ts`, harness — all gain the event fake (additive, mechanical).

## 8. Ready for Proposal

**Yes — this is a clean, bounded slice.** BusinessEvent is the **deterministic append-only business-fact log** (architecture §8.2.2/§9.1/§9.3/§9.8/§13.1/§13.2): a `work.completed` fact appended in the SAME transaction as the worker's terminal close (CAS + receipt + journal.complete), defined as a pure domain type + append-only port in `packages/business-domain`, persisted by a new `PgBusinessEventRepository` + `006` migration, wired through `buildWorkerDeps`, with a scoped read seam for future consumers (heartbeats/skills/memory/segment 12) — none of which are built in this slice.

The orchestrator should tell the user: this slice delivers the deterministic fact stream the roadmap's heartbeats/skills and Increment 5 memory consume, proven by "one event row per terminal close, atomic with the receipt" in unit, integration, and live-PG E2E tests; scope excludes all consumers and the domain-use-case parity path; expected ~350–450 changed lines (auto-chain supports 2 PRs if the budget trips).

**Verdict: clean bounded slice.** Recommended proposal: new capability `business-event` (no modified specs expected — verified `worker-cycle`/`business-receipt`/`context-compiler` capabilities need no change since the worker's terminal-close contract already exists and the log is a NEW capability).
