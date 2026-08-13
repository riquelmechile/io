# Exploration: Skill Outcome BusinessEvents

> Phase: EXPLORE — maps current state + decision options. Does NOT decide. Change: `skill-outcome-events` (roadmap Rev 8, next item after `cold-start-discovery`: *"Skill outcome BusinessEvents (más allá de `work.completed`)"*).
> State verified at HEAD `533a9b2` (archive of `cold-start-discovery`); clean tree (`.pi/` untracked).

## Problem

The worker emits terminal facts (`work.completed`) that carry **no skill information**. Skills are declarative procedural knowledge that condition the plan via context segment 7 — they are never executed directly — so the only observable trace of a skill's use is the outcome of the Work whose context selected it. That trace is **not recorded today**: `work.completed`'s payload (`workId, state, receiptId, terminalState, evidenceId, attemptId, actor`) has zero reference to the activated `skillId`/`version` set.

Consequences (all documented in the architecture):
- §9.10 "skills promovidas" + Increment 8 "skill promotion" need a **candidate → active** loop driven by *verified outcomes* ("La empresa aprende de resultados comprobados, no de la seguridad verbal del modelo" — principle 5, §1). Without outcome facts attributed to skill versions, promotion has no evidence substrate (§17 risk 8: "Autonomía promovida sin outcomes suficientes"; §10.3: training must produce *nueva skill / procedimiento actualizado / evaluación reproducible*).
- Memory Object `feedback.linked_outcomes: [outcome_id]` (§9.2) has no outcome IDs to link.
- §13.2 heartbeats consume only BusinessEvents; skill outcomes that are not events are invisible to every future consumer (learning, segment 12, memory).

## Current State (verified)

1. **Event universe (3 emitters, 3 types):**
   | type | source | identity | material |
   |------|--------|----------|----------|
   | `work.accepted` | acceptor (`accept-work.ts` + `accept-work-flow.ts` tx) | `evt:acc:{workId}` | ✅ (`MATERIAL_EVENT_TYPES = ['work.accepted','work.completed']`, `heartbeat.ts:30`) |
   | `work.completed` | worker (`finalize.ts:366` `buildWorkCompletedEvent`, appended inside T1) | `evt:att:{companyId}:{idempotencyKey}` | ✅ |
   | `heartbeat.decision` | supervisor (`tick.ts`, `appendIfAbsent`) | `evt:hb:{digest}` | ❌ (undeclared) |

2. **Skills flow**: `runClaimedWork` fetches `deps.skills.listByCompany` ONCE (worker.ts:177) → `prepareIntent` → `compileContext` → `renderActiveSkills` (segments.ts:131) calls pure `activeSkillsFor({companyId, process, schemaVersion}, skills)` and renders `id=… name=… v=…` into segment 7. **The selected set is computed but never returned** — `CompiledContext = {messages, user}` only (context/src/index.ts:39). Neither `prepareIntent` nor finalize knows which skills were actually in the context.

3. **Terminal close (finalize T1)**: `FinalizeRepositories` (finalize.ts:76) already includes `events: BusinessEventRepository`; T1 appends exactly ONE `work.completed` atomically with CAS + receipt + `journal.complete`. Appending a second row in the same transaction is mechanically trivial (same repository, same `uq_business_event_event_id` backstop). The `acceptWorkAtomically` flow (database/src/accept-work-flow.ts) is the fresh precedent for a pure builder + transaction-scoped emission.

4. **Pure builders live in business-domain** (zero `@io/*`): `work-accepted-event.ts`, `heartbeat-decision-event.ts` — new builder follows the same home.

5. **No `skill.outcome`/`skillOutcome` code or spec exists** (grep across `packages/*/src`, `packages/*/test`, `openspec/specs/`). Change is genuinely new.

6. **Failure paths emit nothing**: `invalid-plan`, `denied`, `recovery-required`, `UNRESOLVED_REQUIRES_HUMAN` produce zero events. Only verified successes reach T1. "Outcome = efecto verificado" (§12.1) — consistent, but means a skill that repeatedly causes failed plans yields no facts (see Risks).

## Affected Areas

- `packages/business-domain/src/skill-outcome-event.ts` (NEW) — pure deterministic builder, zero `@io/*` (precedent: `work-accepted-event.ts`).
- `packages/business-domain/src/heartbeat.ts` — unchanged if the new type stays undeclared (recommended).
- `packages/context/src/index.ts` + `segments.ts` — surface the intent-time selection from `compileContext` output (pure; `messages`/`user` bytes unchanged — no golden churn).
- `packages/app/src/worker/intent.ts` — return `activatedSkills: {skillId, version}[]` from `prepareIntent`.
- `packages/app/src/worker/finalize.ts` — `FinalizeInput` gains the activated-skill refs; T1 appends the skill-outcome event after `work.completed` (same transaction).
- `packages/app/src/worker/worker.ts` — thread `skills` selection from intent to finalize (no deps widening: `skills` already in `WorkerDeps`).
- `packages/database/src/` — no adapter change (events repo reused); possibly nothing.
- Specs (delta): `business-event` (new `sk:` namespace + type + builder/source ownership + atomic-with-terminal-close), `worker-cycle` (intent returns selection; T1 appends the fact), `context-compiler` (output surfaces selection, bytes stable), `skill` (document that usage outcomes are now emitted; "outcome events deferred" wording updated).

## Approaches

1. **A — Composite per-work outcome event** (`eventType: 'work.skill-outcome'`, `aggregateKind: 'work'`, `aggregateId: workId`, `source: 'worker'`)
   - Identity `evt:sk:att:{companyId}:{idempotencyKey}` — deterministic, retry-stable, new disjoint `sk:` namespace after `evt:`.
   - Payload: `skills: [{skillId, version}]` (the intent-time selection), `workId`, `receiptId`, `terminalState`, `evidenceId`, `attemptId`, `process`.
   - Emitted in T1 atomically with `work.completed`. Non-material (undeclared) → heartbeat activation economy byte-identical.
   - Pros: one extra row per close; selection captured at intent → byte-consistent with segment 7; minimal surface; direct precedent (acceptor flow); no fan-out.
   - Cons: per-skill querying needs payload scan (fine at current scale); attribution is array-parse, not aggregate-keyed.
   - Effort: **Low-Medium**.

2. **B — Per-skill fan-out outcome events** (`eventType: 'skill.outcome'`, `aggregateKind: 'skill'`, `aggregateId: skillId`, `source: 'worker'`)
   - Identity `evt:sk:{workId}:{skillId}`; one event per (Work, selected skill); N rows per close, all in T1.
   - Pros: native per-skill attribution — Increment-8 promotion and `linked_outcomes` consume directly by `skillId`; outcome_id granularity matches the Memory model.
   - Cons: N-row fan-out per close (bigger rollback surface, more rows); identity must pin the intent-time version per skill (payload carries `version`); more spec/test surface.
   - Effort: **Medium**.

3. **C — Extend `work.completed` payload with `skills`** (no new type/namespace)
   - Pros: zero new identity grammar; existing material event already activates; smallest diff.
   - Cons: changes a pinned deterministic contract; conflates activation signal with learning attribution; "beyond `work.completed`" implies a distinct record; learning facts would be material by inheritance.
   - Effort: **Low**. Semantically weakest — dominated by A.

## Recommendation

**Approach A** — composite `work.skill-outcome` event, non-material, `sk:` namespace, emitted in T1 atomically with `work.completed`. The intent-time selection is surfaced by `compileContext` (pure field addition, bytes unchanged) so the fact is provably the set that shaped the plan. This is the minimal coherent slice: one new builder, one new type, one atomic append, zero heartbeat/materiality change, zero adapter change. Per-skill fan-out (B) is the natural Increment-8 follow-up when promotion actually needs per-skill aggregates — keep it out of this slice.

## Risks

- **Version drift**: the selection MUST be captured at intent time (what was in segment 7), never re-derived at finalize — a new skill version landing mid-cycle would change the fact. Mitigated by surfacing the selection from `compileContext` (single source of truth).
- **Spec churn**: `business-event` spec pins "three identities… disjoint namespaces `att:`/`hb:`/`acc:`" — delta must widen to four with exclusive `sk:` builder + `source: 'worker'` ownership. The heartbeat material-set wording is NOT touched (type stays undeclared) — verify.
- **Success-only universe**: failure paths emit no facts, so harmful skills are invisible until this is extended. Decision: out of scope for the first slice (needs per-failure emission points outside T1 with their own atomicity) — MUST be a proposal question.
- **`expectedOutcome` (Delegation) vs actual outcome** comparison is a delegation-lifecycle concern, not this slice — document, don't build.
- **No backfill**: pre-change `work.completed` rows get no skill facts (append-only, no migration) — document as limitation.

## Ready for Proposal

**Yes.** The orchestrator should tell the user: the roadmap item is confirmed against code — skills condition the plan via segment 7 but their usage is unrecorded; `work.completed` carries no skill attribution and the selected set is discarded inside `compileContext`. Recommended: Approach A (composite non-material `work.skill-outcome` fact, atomic with terminal close, `evt:sk:` identity, intent-time selection surfaced by the compiler). In scope: builder + compiler output field + intent/finalize threading + T1 atomic append + spec deltas (`business-event`, `worker-cycle`, `context-compiler`, `skill`) + determinism/atomicity/no-backfill tests + live-PG round-trip. Explicitly out: failure-outcome events, per-skill fan-out, promotion/learning engine (Increment 8), `expectedOutcome` comparison, Memory OS, backfill. Two proposal questions: (1) new composite type vs extended `work.completed` payload; (2) success-only vs failure-outcome events.
