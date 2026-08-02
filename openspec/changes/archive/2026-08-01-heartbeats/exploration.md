# Exploration: heartbeats — the deterministic novelty filter (Paso 3, §13.2)

**Change:** `heartbeats` · Project: io · Hybrid artifact store
**Baseline:** `main @ 2f25358` (clean tree, skill-segment7 archived) · ~936 passed / 6 skipped (sequential) · live PG 18.4 integration green
**Sources:** architecture doc `docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md` §2/§3.2/§7.2/§8.2/§9.3/§9.8/§13.1/§13.2, roadmap `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` Paso 3 (Rev 3), `openspec/specs/` (`business-event`, `worker-cycle`, `skill`, `context-compiler`, `llm-client-port`), archived `businessevent` / `first-skill` / `skill-segment7` explorations + `skill-segment7` archive-report, live code in `packages/`.

---

## 1. What a heartbeat IS in this architecture (precise definition)

The architecture doc defines the heartbeat in **§13.2** (line 1273–1284), verbatim:

```text
evento o timer
→ filtro determinístico
→ ¿existe novedad material?
   no → heartbeat sin LLM
   sí → activar Flash
         → escalar a Pro solo por complejidad/riesgo
```

A heartbeat is **NOT a model call, NOT a timer, and NOT a "ping"**. It is the **deterministic decision point** that gates every model activation: given a *signal* (a BusinessEvent arriving, or a timer firing), a **deterministic filter** decides whether there is **material novelty**. If there is NOT → the system emits a **no-LLM heartbeat** (cheap, no model invocation). If there IS → it **activates Flash** (the model), and only escalates to Pro on complexity/risk — which is a *separate* decision (§13.3 risk tiers).

The architectural intent is stated above the diagram (§13.2, line 1275): *"Los agentes estarán disponibles 24/7, pero no llamarán al modelo sin una señal útil."* — agents are available 24/7 but **never call the model without a useful signal**. The heartbeat is the guard that enforces the §2 principle *"Costo como parte del razonamiento"* (each activation has a budget and expected utility) — the model is the expensive resource; the filter decides whether an activation is justified.

Supporting doc anchors that pin the heartbeat's shape:

- **§8.2 (item 2)** — *"En IO, ciertas memorias deben producirse obligatoriamente desde eventos determinísticos."* Certain decisions MUST be produced from **deterministic events**, never model judgment. The material-novelty decision is one of them: the model must NEVER be asked "is there anything new?" — that would burn a token per poll and reintroduce the very judgment the architecture forbids. The filter decides from **facts** (BusinessEvents), not model self-report.
- **§9.3 (deterministic mandatory writes)** — terminal facts (contrato creado/modificado, acción ejecutada, resultado verificado, …) are written **without depending on the model**. The filter consumes exactly this deterministic fact substrate.
- **§9.8 (multi-agent consistency, line 1043)** — business commands write their technical records **in the same transaction** (outbox pattern). This is why BusinessEvent exists as an append-only fact stream: the heartbeat filter reads a *complete, durable, ordered* stream of facts, never a model narrative.
- **§13.1 (worker cycle)** — the cycle starts with *despertar* (wake) and only later reaches *seleccionar Flash/Pro → razonar*. The heartbeat is the **pre-gate** that decides *whether* the cycle wakes into a model call. §13.2 sits *before* §13.1's model-consuming steps; it is not a step inside the cycle, it decides whether the cycle's model step runs at all.
- **§7.2 (line 561)** — the canonical prefix MUST NOT begin with *"fecha actual; IDs aleatorios; nonce; **heartbeat**; snapshot reciente; mensaje variable; tool result."* A heartbeat (and its decision) is **dynamic tail content by nature** — it can NEVER enter the stable context prefix. The filter's output is a decision, not context; this slice MUST NOT touch the compiler (hard constraint below).
- **§2 (items 4 & 8)** — memory is not operational truth; cost is part of reasoning. The no-LLM heartbeat is the operational embodiment of both.

**Synthesis — the precise definition:** a heartbeat is a **deterministic, pure decision** `events (signal) → { no-LLM heartbeat | activate Flash }`, computed from the BusinessEvent fact stream (and/or a timer trigger), with ZERO model involvement in the decision. The timer is only a *trigger* (when to evaluate); it is not part of the decision itself — determinism holds because the decision is a pure function of observed events plus a deterministic novelty rule.

**Canonical naming note:** the roadmap term is "heartbeats" (plural, the mechanism family). The change name `heartbeats` is canonical. The **capability/spec name should be `heartbeat`** (singular — matching `business-event`, `skill`, `worker-cycle` naming) and the domain primitive a `heartbeat` module in `packages/business-domain` (a pure novelty filter function + decision type).

## 2. Why it follows BusinessEvent + skills (the ordering is causal)

The roadmap (`PASOS_SIGUIENTES_INCREMENTO_4.md` line 224): `Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap`. Five slices are done and archived; the `skill-segment7` archive-report (follow-up #5) names the next slice explicitly: **"Heartbeats (§13.2) — next roadmap slice; consumes BusinessEvents + skill-aware context."**

The ordering is causal, not arbitrary:

1. **Heartbeats consume the deterministic fact stream — BusinessEvent came first.** The filter decides "¿existe novedad material?" from **facts**. Before the `businessevent` slice there was no deterministic, append-only, tenant-scoped event stream — the technical records (receipt + idempotency journal) are *attempt bookkeeping*, not *business facts*. `business-event/spec.md` Purpose states this directly: the fact record exists *"that later slices consume (heartbeats, skills, Increment-5 memory, segment 12)"* and `businessevent/exploration.md` §1 named the consumers: *"Heartbeats (§13.2) — the deterministic filter '¿existe novedad material?' needs an event source. Without BusinessEvent, heartbeats have nothing deterministic to filter on."*
2. **BusinessEvent is written atomically with its change (§9.8).** Each `work.completed` event is INSERTed in the same transaction as the Work CAS + receipt + journal.complete (`finalize.ts` T1). The filter reads a stream that is *complete by construction* — no partial/rolled-back events, no orphans (CAS loss rolls the event back). This is the integrity the no-LLM decision needs: the filter must never decide "nothing new" while a fact exists unprocessed.
3. **Skills preceded heartbeats because the activation path is context-rich.** When the filter says "activate Flash", the model runs against the **compiled context** (worker cycle §13.1: *recuperar memoria → compilar contexto → seleccionar Flash/Pro*). The `skill-segment7` slice made skills actually enter that context (segment 7). The heartbeat therefore filters over a world where an activation is *worth it*: the model is invoked only when there is material novelty, and when it IS invoked it runs with the full skill-aware context. The archive-report names the dependency exactly: heartbeats *"consumes BusinessEvents + skill-aware context."*
4. **Business-domain discipline (survives model/API/DB changes).** The novelty filter is a **business rule** (§3.2: business rules must survive model, API, interface, DB, and tool changes). Like `BusinessEvent` (R1), `Skill` (R1), and `activeSkillsFor` (R5), the filter belongs in `packages/business-domain` — pure, zero `@io/*`, zero runtime deps — so a future model swap, table rename, or API change cannot change what counts as "material novelty."

## 3. Current state (verified from the live repo)

- **No heartbeat concept exists anywhere** — zero matches in `packages/` source for "heartbeat" except the compiler's *forbidden-leading-content* note (`packages/context/src/segments.ts` line 148 and its spec R1). No `heartbeat` module, no timer/scheduler/cron anywhere (`setInterval`/`cron`/`scheduler` zero matches in `packages/*/src`). The §13.2 filter, the timer side, and the Flash-activation side are all greenfield.
- **The fact stream exists and is read-ready**: `packages/business-domain/src/types.ts` defines `BusinessEvent` (8 fields: `eventId`, `companyId`, `aggregateKind`, `aggregateId`, `eventType`, `occurredAt`, `payload`, `source`); the port `BusinessEventRepository` (`ports/repositories.ts`) exposes exactly `append` + `listByCompany(companyId)`; `InMemoryBusinessEventRepository` (`ports/fakes.ts`) appends without replacement and lists in insertion order. Today only ONE event type is emitted: `work.completed` (`packages/app/src/worker/finalize.ts` `buildWorkCompletedEvent`, T1 atomic append, `source: 'worker'`, payload carries `workId`, `state`, `receiptId`, `terminalState`, `evidenceId`, `attemptId`, `actor`).
- **The read path is PG-proven**: `packages/database/src/business-event-adapter.ts` `PgBusinessEventRepository.listByCompany` is `WHERE company_id = $1 ORDER BY id ASC` with `parseBusinessEventRow` guards — tenant-scoped, insertion-ordered, exactly the input a deterministic filter needs.
- **Model selection is hard-coded**: `packages/app/src/worker/intent.ts` line 65: `model: 'deepseek-v4-flash'` — the worker always asks for Flash today. `LlmModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'` (`packages/llm-client/src/llm-client.ts`), mapping to the API model verbatim. Flash activation is therefore *already the default path*; the heartbeat slice's contribution is the **gate** that decides whether to take it.
- **Seams**: `WorkerDeps` (`packages/app/src/worker/types.ts`) has `work`, `delegation`, `skills`, `receipts`, `journal`, `sandbox`, `llm`, `principals`, optional `connection`/`repositories`. The `repositories(conn)` factory returns `{ work, receipts, journal, events }` — the `events` repo is currently bound **only inside the terminal transaction** (T1). There is **no top-level `events` read port on `WorkerDeps`** — a heartbeat evaluator would need its own `events: BusinessEventRepository` read seam (pool-bound read is fine for a filter; the filter never writes).
- **Composition root**: `buildWorkerDeps` (`packages/app/src/composition/worker-deps.ts`) constructs PG adapters + `repositories(conn)` factory; wiring a read-only `events` port or a `heartbeat` evaluator is composition-root-only.
- **Archived precedent** (`businessevent`, `first-skill`, `skill-segment7`): every Paso 3 slice was a single bounded slice (200–450 changed lines) delivered as stacked PRs under `auto-chain`; each explicitly deferred the NEXT roadmap item; each was *domain-first* (pure business-domain type/rule) with durability/read seams in `database`/`app` only when the next slice needed them. `first-skill` shipped `activeSkillsFor` as a **pure selection rule with no consumer yet** — the exact precedent for shipping a deterministic rule as a seam. `skill-segment7` then added the consumer. The `skill-segment7` archive-report follow-up #5 is the pre-announcement of this slice.

## 4. What "material novelty" is — the deterministic rule the slice must define

The doc defines the *shape* (§13.2 diagram) but NOT the content of "novedad material" — it appears exactly once in the doc (line 1280). This slice must therefore **codify the deterministic rule** for what counts as material novelty, from the existing fact substrate. The minimal, honest first rule:

- **Materiality is a function of event type.** An event is *material* iff its `eventType` is in a declared material set. Today the only emitted type is `work.completed` — a terminal business fact (work closed with a single receipt + evidence). It is material: a completed work is a fact the company must observe/react to (skill outcomes, memory, future segments). The material set is a **domain constant** in `packages/business-domain` (like `WORKER_POLICY_HASH` lives in the worker), e.g. `MATERIAL_EVENT_TYPES: readonly string[] = ['work.completed']`. Future non-material types (technical bookkeeping, audit pings, heartbeat echoes) are excluded by the set — extensible without changing the rule's shape.
- **Novelty is a function of a deterministic cursor, not the clock.** The filter must not consult `Date.now()` — "novel" cannot mean "recent". It means **not yet processed**: the filter takes the observed events plus a **last-seen cursor** (e.g. the last `eventId` the caller has already acted on, or an empty cursor) and returns *material* iff there exists at least one material event the cursor has not seen. In the minimal form: material novelty = `events.some(e => isMaterial(e) && (cursor === undefined || !seen(e, cursor)))`. Since `listByCompany` is insertion-ordered and events are append-only with deterministic `eventId` (`evt:{attemptId}`), the cursor is a stable, deterministic input.
- **The decision is a pure function**: `(events, cursor) → { activate: 'flash' } | { activate: 'none' }`. No clock, no LLM, no randomness, no generated ids, no I/O inside the function. Same events + same cursor ⇒ same decision, provable by test. (The *timer* merely decides WHEN to call the function — cadence never changes the decision itself, so determinism is not compromised by a timer trigger.)
- **Tenant-scoped** (ADR-0002): the filter operates on one `companyId`'s events; the cursor is per-company.

This is the heart of the slice: **the deterministic novelty filter** — `hasMaterialNovelty(events, cursor)` / a `heartbeat` domain module — with the materiality rule, the cursor semantics, and the no-LLM-in-the-decision guarantee (§8.2 item 2) all proven by tests.

## 5. Approaches

### A. Pure deterministic novelty filter in `packages/business-domain` only
Define the `heartbeat` module: a `HeartbeatDecision` type (`{ kind: 'activate', model: 'flash' } | { kind: 'no-llm-heartbeat' }`), the material-event-type constant, and a pure function `hasMaterialNovelty(events: readonly BusinessEvent[], cursor?: HeartbeatCursor): boolean` (or a slightly richer `evaluateHeartbeat(events, cursor): HeartbeatDecision`). Zero `@io/*`, zero runtime deps, no I/O, no LLM. Unit tests: determinism (same events+cursor ⇒ same decision), materiality (work.completed material; unknown types not), cursor semantics (empty cursor ⇒ novel; seen cursor ⇒ not), tenant discipline, no-clock (the function signature admits no `now`), boundary tests (business-domain stays pure — inherited from the existing `business-event.test.ts` boundary suite). No `database`/`app`/worker/compiler changes.

- Pros: smallest honest slice; the business rule lands where it must survive model/DB/API changes (§3.2); mirrors the `first-skill` "pure rule shipped before its consumer" precedent exactly; every hard invariant structurally safe (compiler untouched, business-domain pure, no new deps); ~120–200 lines fits the 400-line budget with room.
- Cons: **no observable runtime behavior** — nothing reads real events through the filter; the "activates Flash vs no-LLM heartbeat" decision is not yet computed anywhere; the rule is a seam until the next slice wires the read side. (This was the accepted trade-off for `first-skill`; the follow-up slice then made it real.)
- Effort: Low–Medium.

### B. A + a read-only evaluator seam that computes the decision from real events (recommended)
Everything in A, PLUS a thin read seam: a `heartbeat` evaluator (e.g. `evaluateHeartbeatForCompany({ events: BusinessEventRepository }, companyId, cursor)` in `@io/app` — or a `HeartbeatPort`-style helper) that calls the EXISTING `listByCompany(companyId)` and runs the pure filter, returning the `HeartbeatDecision`. Composition root wires the existing `PgBusinessEventRepository(connection)` (pool-bound, read-only) for the evaluator. Tests: unit (filter, as A) + app-level seam test (fake events repo → decision) + a live-PG integration/E2E assertion (after a full worker cycle, the company's event stream yields `activate: flash`; an untouched company yields `no-llm-heartbeat`). The `work.completed` events already emitted by the worker's T1 become the filter's first real input — no new table, no migration, no runWorker change, no model call anywhere in the slice.

- Pros: matches the slice's stated goal ("decide whether to activate the model from the fact stream") with a real observable outcome — the deterministic decision computed against the actual BusinessEvent log; reuses the proven `listByCompany` read path (no new persistence); composition-root-only wiring (precedent: `buildWorkerDeps` is the single assembly point); still NO model invocation, NO timer, NO worker-cycle change, NO compiler change; ~250–330 lines fits the budget.
- Cons: touches `@io/app` + composition root (mechanical, additive); the decision is computed but **not yet acted on** (nothing yet branches the worker to skip/run the LLM — that is the NEXT slice, per the roadmap's causal chain); cursor persistence (where the last-seen marker lives — journal? a new table? in-memory?) is explicitly deferred, so the evaluator takes the cursor as a parameter.
- Effort: Medium.

### C. B + worker/timer integration that ACTS on the decision (Flash activation path)
Also wire the decision into the worker cycle or a timer/scheduler: when `no-llm-heartbeat`, skip `prepareIntent`/`llm.complete`; when `activate`, run the existing Flash path; add timer scheduling (interval/cron) and cursor persistence.

- Pros: the full §13.2 semantics land end-to-end; no-LLM cost savings become real.
- Cons: **blows the 400-line budget**; introduces three new subsystems at once (activation branching in the worker, timer scheduling, durable cursor state) — each a distinct architectural concern; a timer is a *new runtime component* with its own failure/restart semantics (durable recovery §9.8); the §13.2 "escalar a Pro por complejidad/riesgo" is a separate decision that also lands here if taken; the standing review-budget guard (400 lines, `auto-chain`) is violated. The roadmap sequence (and every archive) orders the gate *before* the integration; this is the follow-up slice.
- Effort: High (rightly sequenced later).

**Recommendation: Option B** — the deterministic novelty filter (the heart, Approach A) PLUS the minimal read-only seam that computes the decision from the real BusinessEvent stream, with NO model call, NO timer, NO worker-cycle change, and NO compiler change. It follows the `first-skill` → `skill-segment7` precedent exactly: ship the pure rule with a thin seam this slice; let the NEXT slice act on it (worker/timer integration + cursor persistence). The `skill-segment7` archive-report's own naming ("consumes BusinessEvents + skill-aware context") is the pre-announcement of B, not C.

Design rules for the slice:

1. **Deterministic, no LLM in the decision** (§8.2 item 2): the filter's signature admits only `(events, cursor)` — no `llm`, no `now`, no randomness, no generated ids. A test asserts equal inputs ⇒ equal decision; a boundary/structural test can assert the module never imports `@io/llm-client` or reads a clock.
2. **Materiality is a declared domain rule**: `MATERIAL_EVENT_TYPES` (today: `['work.completed']`) lives in business-domain, extensible without changing the rule's shape.
3. **Novelty = not-yet-seen, not "recent"**: the cursor is a per-company last-seen `eventId` (or seen-set), caller-supplied; persistence of the cursor is a later-slice concern.
4. **Append-only read, zero writes**: the evaluator only calls the existing `listByCompany`; it NEVER writes events, never mutates anything.
5. **Tenant-scoped** (ADR-0002): every evaluation is per `companyId`; cross-tenant events never leak (inherited from the repo).
6. **Never enters the stable prefix** (§7.2 line 561): heartbeat content is forbidden leading content; the compiler is untouched this slice.
7. **Tests**: (a) business-domain unit — determinism, materiality, cursor semantics, no-clock, purity boundary; (b) app seam — fake-events-repo decision table (empty stream → no-LLM; work.completed → activate; seen cursor → no-LLM); (c) live-PG integration (sequential) — after a full worker cycle via the harness, `listByCompany` + filter ⇒ `activate`; a fresh company ⇒ `no-llm-heartbeat`.

## 6. Scope boundaries (first bounded slice)

**IN (Option B)**
- `packages/business-domain`: `heartbeat` module — `HeartbeatDecision` type, `MATERIAL_EVENT_TYPES` constant, pure `hasMaterialNovelty(events, cursor)` (and/or `evaluateHeartbeat`), exports from `src/index.ts`, unit tests (determinism, materiality, cursor, no-clock, purity). Zero `@io/*`, zero runtime deps.
- `packages/app`: read-only heartbeat evaluator over the existing `BusinessEventRepository` port (e.g. `src/heartbeat/evaluate.ts` or a `HeartbeatPort`-style helper), composition-root wiring in `buildWorkerDeps` (reuses `PgBusinessEventRepository(connection)` pool-bound, read-only), seam + integration tests.
- Live-PG integration test (sequential, per the PG flake rule) — decision computed from real `work.completed` events after a full cycle.
- New spec capability `heartbeat` (proposal/spec phases, later).

**OUT (explicitly deferred — next slices / future increments)**
- **Acting on the decision** — worker-cycle branching (skip `prepareIntent`/`llm.complete` on `no-llm-heartbeat`), the actual Flash-activation gate, Pro escalation (§13.2/§13.3) — the NEXT slice.
- **Timer/scheduler/cadence** — no cron/interval/scheduler component anywhere; a timer is a new runtime component with durable-recovery implications.
- **Cursor persistence** — where the last-seen marker lives (journal? new table? in-memory?) is a design decision for the integration slice.
- **Compiler/context** — the heartbeat decision and content MUST NOT enter the stable prefix (§7.2); `compileContext` untouched; `packages/context` deps stay `@io/business-domain` only.
- Skill outcome/activation BusinessEvents beyond `work.completed`, learning/promotion, Memory OS ingestion, segment-12 event sourcing.
- No new migrations, no new tables (the event read path already exists).

## 7. Determinism — definition and proof

**Definition:** the filter is deterministic iff the same `(events, cursor)` inputs always produce the same decision, in every environment and every run. It reads no clock, calls no model, samples no randomness, and generates no identifiers — the decision depends ONLY on the passed events and cursor.

**Structural guarantees (why it holds):**
- **Signature isolation**: `hasMaterialNovelty(events, cursor)` admits nothing else — no `now`, no `llm`, no `random`. There is no ambient state to read.
- **Materiality is a closed set**: `MATERIAL_EVENT_TYPES` is a compile-time constant; an event's materiality is a pure predicate on `eventType`.
- **Novelty is cursor-defined, not time-defined**: "novel" = a material event the cursor has not seen. The cursor is caller-supplied state, not a clock read. A timer may trigger the evaluation, but the trigger never enters the function — cadence cannot change a decision (same events, same cursor ⇒ same answer).
- **Event identity is deterministic**: `eventId = evt:{attemptId}` (R7) is derived from the attempt; append-only means the set of events is fixed for a fixed log; `listByCompany` order is insertion order.

**Proof by test:**
- *Same input ⇒ same output*: two calls with identical (events, cursor) return identical decisions (the determinism test).
- *No clock dependence*: the function signature carries no `now`; a structural test (mirroring the `business-event` boundary suite) asserts the heartbeat module imports nothing from `@io/llm-client` and that a boundary/fixture pattern (like `context-compiler`'s dynamic-tail inverse) cannot vary the outcome — plus a *cache-poisoning inverse*: two evaluations with identical events+cursor but different surrounding "world" produce identical decisions.
- *Materiality table proven*: `work.completed` ⇒ material; an unknown/other type ⇒ not material.
- *Cursor semantics proven*: empty cursor + material event ⇒ activate; cursor at last event ⇒ no-LLM heartbeat; cursor ahead of stream ⇒ no-LLM heartbeat.
- *Tenant isolation proven* (inherited from the repo + a direct test): company A's events never change company B's decision.

## 8. Verdict — clean bounded slice?

**Yes.** "Heartbeats (§13.2)" is a precise, precedent-anchored change: the **deterministic novelty filter** — a pure business-domain rule (`MATERIAL_EVENT_TYPES` + `hasMaterialNovelty(events, cursor)` returning `no-llm-heartbeat | activate flash`) that consumes the BusinessEvent fact stream — plus the minimal read-only evaluator seam that computes the decision from real events via the existing `listByCompany` path. It follows `businessevent` (the fact substrate it consumes) and `first-skill`/`skill-segment7` (the skill-aware context the activation path uses) exactly as the roadmap and the `skill-segment7` archive-report pre-announced. The no-LLM decision (§8.2 item 2) is the heart; the compiler, timer, cursor persistence, and Flash-activation integration are explicitly deferred to the next slice.

**Recommended slice**: Option B — domain filter + read-only evaluator seam + live-PG proof; no model calls, no timer, no worker-cycle change.

**Expected changed lines**: ~250–330 authored (business-domain filter + tests ~120–160, app evaluator seam + composition wiring + tests ~100–130, live-PG integration ~30–40) — within the 400-line review budget; `auto-chain` supports 2 stacked PRs (domain, app) if needed.

**Risks**
- **Scope drift into worker/timer/cursor integration (Acting on the decision)** — HIGH; §13.2's diagram invites it. The slice is the filter + read seam only (Option B); activation branching, scheduling, and cursor persistence are the next slice.
- **Materiality rule is new ground** — "novedad material" appears once in the doc (line 1280) with no content definition; the slice codifies it as event-type-based (`work.completed`) and MUST state the rule is a declarative, extensible constant, so a reviewer doesn't misread it as an R6-style silent behavior change.
- **"Novelty" misread as "recent"** — must be cursor-defined, never clock-defined; the design must state that the timer triggers *when* to evaluate, never *whether* something is novel, or determinism is quietly broken.
- **Never in the prefix** — heartbeat content is §7.2-forbidden leading content; the compiler must stay untouched this slice (cohort rule structurally safe, as in `businessevent`/`first-skill`).
- **Existing-test churn** — the app seam adds an `events` read to the composition root/test harness (additive, mechanical; the `RecordingEvents` fake already exists in `worker-helpers.ts`); no existing worker/context test changes.
- **PG flake discipline** — the live-PG heartbeat assertion must run SEQUENTIALLY (`pnpm vitest run --no-file-parallelism`), per the pre-existing `business-pg-roundtrip` concurrency flake.

## 9. Ready for Proposal

**Yes.** The orchestrator should tell the user: this slice ships the §13.2 **deterministic novelty filter** — a pure business-domain rule consuming BusinessEvents (`MATERIAL_EVENT_TYPES = ['work.completed']`, cursor-based novelty, decision `no-llm-heartbeat | activate flash`, zero LLM/clock/randomness in the decision, proven by determinism + inverse + materiality tests) — plus a read-only evaluator seam that computes the decision from the real append-only event stream via the existing `listByCompany` path (composition-root wired, live-PG proven). Scope excludes acting on the decision (worker/timer integration + cursor persistence + Flash activation) — the next slice. Expected ~250–330 changed lines (2 stacked PRs). New capability `heartbeat`; no modified specs expected (verified `business-event`/`worker-cycle`/`context-compiler`/`skill` capabilities need no change — the event read path, worker contract, compiler, and skill segment are all untouched).
