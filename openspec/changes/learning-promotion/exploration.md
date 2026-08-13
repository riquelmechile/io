# Exploration: Learning/promotion — Increment 8 (verified-outcome learning cycle)

> Phase: EXPLORE — corrected once per gatekeeper review. Change: `learning-promotion` (roadmap Rev 9 next item, phrased "ciclo de Skill `candidate → active`"). State verified at HEAD `bb8a8d0` (clean detached worktree at `origin/main`).
>
> **Corrected framing:** the roadmap phrase is documentation shorthand introduced in docs commit `f5d3448` (Rev 9 reconciliation) and is semantically incomplete relative to the foundational architecture. The canonical model (architecture doc §9.2/§9.3/§9.5/§9.6) defines `candidate` as a **Memory Object validity state**, NOT a `SkillState`. `SkillState = draft | active | retired` stays canonically pinned; the learning cycle operates on a **LearningCandidate** (learning-memory) entity whose promotion is deterministic policy + evidence, autonomous inside delegated authority and typed-escalated to human outside it.

## TL;DR

`work.skill-outcome` facts are **evidence inputs from verified work** — the substrate for creating, evaluating, and promoting a *learning candidate* (a §9.2 memory-object concept), never for executing a candidate Skill. The correct cycle has four separable stages: (1) outcome attribution — DONE; (2) learning candidate creation; (3) candidate promotion (append-only, autonomous within delegated policy, typed escalation outside); (4) eventual creation/promotion of a versioned Skill — follow-up. **Recommended bounded first slice: stages 2+3** — a minimal `LearningCandidate` entity + deterministic evidence aggregation + append-only promotion state + autonomous evaluation with escalation. Zero `SkillState` changes, zero worker/T1 changes, zero `MATERIAL_EVENT_TYPES` changes. The roadmap wording mismatch is a documentation ambiguity to reconcile, not product authority.

## Current State (verified against code and docs)

1. **Canonical candidate semantics (Memory Object, not Skill):** §9.2 `validity.state: candidate | active | needs_review | superseded | disputed | retracted | deleted`; `feedback.linked_outcomes: [outcome_id]`; memory `type` includes `learning`. §9.1 "Learning memory" lists *aprendizaje candidato* and *estado de promoción* as first-class items. §9.3: agentic candidate writes (descubrimiento, patrón, inferencia, oportunidad, aprendizaje, mejora de proceso) persist as `candidate` **until promotion rules are met**. §9.5: validity is determined by scope, permissions, temporal range, source authority, evidence, current policy, review state, and supersession. §9.6: consolidation is episodes → grouping → pattern/contradiction detection → semantic proposal → evaluation → promotion, preserving originals, provenance, uncertainty, and minority opinions — no "pretty summary" overwrite. §9.7: `review_after` for changing knowledge. **Memory OS itself is a separate roadmap item (not built)** — this increment needs only a minimal learning-candidate subset, not the full §9 model.

2. **Skill lifecycle stays canonical:** `SkillState = 'draft' | 'active' | 'retired'` (skill spec R4; `types.ts:132`; `isSkillState` `skill-activation.ts:10`; `parseSkillRow` `row-guards.ts:250`), only `active` selectable (`activeSkillsFor`), append-only versioned registry (INSERT-only `PgSkillRepository`, `uq_skill_company_skill_version`). **Do NOT widen this enum absent stronger canonical evidence.** §10 Increment 8 "Capacitación" outputs include *competencia certificada, mejora medible, reducción de errores, nueva skill, procedimiento actualizado, investigación aceptada, caso de entrenamiento, evaluación reproducible* — "skill promotion" is ONE Increment-8 output, not proof that the executable Skill has a candidate runtime state.

3. **Outcome attribution (Stage 1 — DONE):** `work.skill-outcome` composite non-material event, atomic in T1 with `work.completed`, intent-time `activatedSkills: [{skillId, version}]`, identity `evt:sk:att:{companyId}:{idempotencyKey}`, `aggregateKind:'work'`, `aggregateId: workId`, `source:'worker'` (`skill-outcome-event.ts`; business-event spec R1/R5/R6; worker-cycle spec). Success-only: `invalid-plan`, `denied`, `recovery-required`, replay, and CAS-loss emit nothing. No per-skill fan-out; no backfill. These facts are the **verified evidence** (principle 5: learn from verified results, not model verbal confidence) that feed §9.2 `linked_outcomes` and §9.10 "memorias vinculadas a outcomes positivos".

4. **Read seams:** `BusinessEventRepository.listByCompany` (ORDER BY id, tenant-scoped), `listCompanyIds`; `SkillRepository.listByCompany`/`get`/`save`. **No eventType-filtered or payload-query seam exists**; `idx_business_event_aggregate` is Work-keyed, not skill/candidate-keyed.

5. **Authority model (autonomy boundary):** ADR-0003 — deterministic risk classification before authority; the five source-reserved human categories are ALWAYS critical (company purpose, capital, critical limits, irreversible actions, constitutional modification) and cannot be downgraded for autonomous execution; other tiers assigned by deterministic policy; humans may elevate. §11: human approval for money/secrets/critical-production roles, budget increases, approval authority, constitutional modification, audit removal, legal contracts, irreversible movements. **Within delegated policy and risk tier, promotion is AUTONOMOUS; outside it, typed escalation to human** (e.g., `needs_review`/`disputed` per §9.2, `UNRESOLVED_REQUIRES_HUMAN`-style typed outcomes). Nothing in the current system auto-promotes.

6. **No existing code/spec:** grep for `candidate|promot|learning` across `packages/*/src`, `packages/*/test`, `openspec/specs/` returns zero product hits. Change is genuinely new.

## The learning cycle — four stages, kept separate

| Stage | What | Autonomy | Status |
|-------|------|----------|--------|
| 1. Outcome attribution | Verified Work closes emit `work.skill-outcome` with the intent-time selection | deterministic (worker) | **DONE** (`skill-outcome-events`) |
| 2. Learning candidate creation | Deterministic aggregation of verified outcome facts (and/or §9.3 agent proposals) creates an append-only `LearningCandidate` with provenance + `linked_outcomes` refs, `state: candidate` | deterministic | **THIS SLICE** |
| 3. Candidate promotion | Deterministic evaluation (policy + evidence, §9.5 factors) transitions candidate → `active` autonomously inside the delegated risk tier; typed escalation (`needs_review`/`disputed`) to human outside it; append-only with `supersedes`, never silent overwrite | autonomous in-policy / typed escalation out | **THIS SLICE** |
| 4. Versioned Skill creation/promotion | A promoted candidate MAY produce a new versioned Skill (append-only v+1, `state: active`), updated procedure, or certification record — `SkillState` lifecycle untouched | governed by risk class (ADR-0003) | **FOLLOW-UP** |

## Ambiguities (genuine product decisions — surfaced, not guessed)

| # | Question | Options | Why it matters |
|---|----------|---------|----------------|
| A1 | **LearningCandidate entity shape** | Minimal §9.2 subset (`id, companyId, namespace/type, title, content, source, provenance, validity.state, lifecycle.supersedes, feedback.linked_outcomes`, optional `epistemics.confidence`) vs richer; which states for the first slice (`candidate | active | needs_review | superseded` minimum vs full §9.2 set) | Must advance learning WITHOUT building Memory OS (separate roadmap item). The entity shape IS the scope boundary. |
| A2 | **Creation source** | Deterministic aggregation of verified `work.skill-outcome` facts first (evidence-backed, principle 5); §9.3 agent-authored proposals later; or both | "Leer documentos o gastar tokens no constituye aprendizaje" (§10.3) — only verified-outcome-derived candidates have evidence from day one. |
| A3 | **Promotion criteria (policy)** | Exact deterministic thresholds (verified-success count, success rate, process/cohort scope, time windows, `authority_weight`); where policy lives (constants vs policy module); autonomy boundary mapped to ADR-0003 risk tiers | "La promoción requiere política y evidencia" (§8.2.8). Criteria ARE the policy; inventing them is inventing policy. |
| A4 | **Append-only promotion state mechanics** | New table/records keyed `(company_id, candidate_id, revision)` with `supersedes` lineage; idempotent single-winner transitions (promote-vs-supersede race); how `needs_review`/`disputed` escalate | §9.2 "No se sobrescribe la historia" — promotion MUST be append-only; concurrency needs duplicate suppression mirroring `uq_*` constraints. |
| A5 | **Evidence aggregation for candidates** | (i) In-app: `listByCompany` + filter `eventType` + parse `payload.activatedSkills` (zero adapter change); (ii) new read seam (eventType filter / JSONB path — new SQL + fake parity); (iii) per-skill fan-out `skill.outcome` events (the `skill-outcome-events` archive named this "the natural Increment-8 follow-up when promotion actually needs per-skill aggregates") | Determines DB surface, parity work, and whether the worker's T1 emission contract changes (avoid in first slice). |
| A6 | **Stage-4 relationship** | What a promoted candidate produces (new Skill version vs procedure update vs certification record) and which human gates apply per risk class | Keeps Stage 4 a named follow-up, not accidental scope. |

## Affected Areas (recommended first slice — stages 2+3)

- `packages/business-domain/src/learning-candidate.ts` (NEW) — pure `LearningCandidate` entity + state guard (minimal §9.2 subset), zero `@io/*` (precedent: `skill.ts`/`skill-activation.ts`).
- `packages/business-domain/src/promotion-evaluation.ts` (NEW) — pure deterministic eligibility/transition rule consuming (candidate, aggregated outcomes, policy), zero `@io/*` (precedent: `heartbeat.ts`).
- `packages/business-domain/src/ports/repositories.ts` — append-only `LearningCandidateRepository` (`save` new revision, tenant-scoped reads; no update/delete) + `InMemory*` fake in `ports/fakes.ts`.
- `packages/database/src/learning-candidate-adapter.ts` (NEW) + `packages/database/sql/012_learning_candidates.sql` (NEW) — INSERT-only, `UNIQUE(company_id, candidate_id, revision)`, tenant index; `parseLearningCandidateRow` in `row-guards.ts`.
- `packages/app/src/learning/evaluate.ts` (NEW) — read-only tenant-scoped seam: aggregate `work.skill-outcome` facts + run pure evaluation (precedent: `app/src/heartbeat/evaluate.ts`); zero writes.
- Specs (delta): `learning` (NEW capability — canonical home per `io-domain-contract` `learning/`), `business-event` (only if a read seam changes the event contract — NOT required for Approach B with in-app aggregation), `skill` (only to keep "learning/promotion outside this capability" wording accurate — no state change).
- Tests: `business-domain` (entity determinism, aggregation, promotion rule, tenant isolation, purity boundary), `app` (seam read-only + boundary, `parity.test.ts` PG≡in-memory), `database` (live-PG round-trip, duplicate rejection, no-mutation guard).

## Approaches

| # | Approach | Pros | Cons | Effort |
|---|----------|------|------|--------|
| **A** | **Stage 2 only** — LearningCandidate entity + deterministic outcome aggregation + append-only candidate store | Smallest; establishes the append-only candidate substrate; zero promotion semantics | Ships no promotion — the roadmap's cycle stays unproven | Low–Medium |
| **B** | **Stages 2+3 (recommended)** — + promotion evaluation + append-only promotion state + typed escalation (`needs_review`/`disputed`), autonomous inside delegated policy | Advances autonomous learning end-to-end (candidate → active) while keeping Stage 4 out; zero Skill/worker/T1 changes; matches ADR-0003 autonomy boundary | Larger diff (new entity + store + rule + seam + tests) → likely needs chained PRs under the 400-line repo contract | Medium |
| **C** | **Stages 2–4** — + versioned Skill creation from promoted candidates | Completes the full Increment-8 arc | Stage 4 introduces governed Skill creation (risk-classed, possibly human-gated per ADR-0003), migration surface, and the largest diff; Skill lifecycle semantics must be argued | High |

## Recommendation

**Approach B (stages 2+3) as the bounded first slice**, with the four stages kept clearly separated in design: Stage 1 is already delivered; Stage 4 (versioned Skill creation/promotion from promoted candidates) is an explicitly named follow-up, NOT part of this change. `LearningCandidate` is a minimal §9.2 memory-object subset in `packages/business-domain` (zero `@io/*`), created by deterministic aggregation of verified `work.skill-outcome` facts; promotion is a pure policy+evidence rule that is **autonomous within the delegated risk tier** and **typed-escalates to human only outside delegated policy or for source-reserved/irreversible categories** (ADR-0003, §11). No universal human gate; no probationary Skill selection; `SkillState` stays `draft|active|retired`; `MATERIAL_EVENT_TYPES` unchanged; append-only history with `supersedes`, never silent overwrite.

**Mandatory proposal questions:** A1 (candidate entity shape/states), A2 (creation source: deterministic aggregation first), A3 (exact promotion criteria + policy home + risk-tier autonomy boundary), A4 (append-only transition mechanics + concurrency), A5 (aggregation: in-app scan default), A6 (Stage-4 relationship documented as follow-up).

**Non-goals (keep out):** Memory OS (full §9 model); `SkillState.candidate`; probationary/executable candidate Skills; `expectedOutcome` comparison (delegation-lifecycle concern); failure-outcome events (separate decision); curricula/exams/simulations/certifications/mentoring (arch §15 Increment 8 "Capacitación" full scope); riskClass producer; Skill extraction to `competency/`; backfill.

## Risks

- **R1 — Scope creep into Memory OS (HIGH):** the §9 memory model is a separate roadmap item; the slice must ship a minimal learning-candidate subset only. The entity shape (A1) is the scope boundary.
- **R2 — Autonomy boundary mis-specified (HIGH, invariant):** promotion must be autonomous ONLY within delegated policy/risk tier; source-reserved human categories and unresolved conflicts/risk must typed-escalate (ADR-0003, §11, §8.2.8). No universal human gate — but no unbounded autonomy either.
- **R3 — Append-only/provenance violation (HIGH, invariant):** promotion must never silently overwrite — new revisions with `supersedes` lineage, single-winner transitions, `uq_*`-mirrored duplicate suppression (§9.2 "No se sobrescribe la historia").
- **R4 — Evidence semantics:** `work.skill-outcome` is success-only — harmful skills/patterns yield no negative evidence until failure events exist (pre-existing, documented limitation); aggregation must not over-claim.
- **R5 — PG/in-memory parity:** new candidate store and any aggregation seam need `InMemory*` fakes + parity tests (precedent: `parity.test.ts`).
- **R6 — Delivery budget:** session preflight target is `800` lines, but the repo canonical delivery contract (`openspec/config.yaml` + `io-delivery-quality-contract`) enforces `400` and therefore **governs delivery slices unless explicitly changed by a separate approved policy change** — `sdd-tasks` must forecast chained PRs accordingly.
- **R7 — Non-materiality:** any new learning/promotion facts must stay out of `MATERIAL_EVENT_TYPES` or heartbeat novelty/activation economy changes.
- **R8 — Documentation ambiguity (accepted):** the roadmap "Skill candidate → active" phrase (introduced `f5d3448`) should be reconciled in a separate docs change; it is not authority to widen `SkillState`.

## Ready for Proposal

**Yes — with proposal questions A1–A6 mandatory.** The orchestrator should tell the user: the roadmap phrase "ciclo de Skill `candidate → active`" is Rev-9 documentation shorthand (introduced in `f5d3448`); per the canonical architecture, `candidate` is a **Memory Object / learning-candidate state**, not a `SkillState` — `SkillState = draft|active|retired` stays pinned. Recommended first slice: Approach B — append-only `LearningCandidate` creation from verified `work.skill-outcome` aggregation + deterministic promotion (autonomous inside delegated policy, typed escalation outside), with Stage 4 (versioned Skill creation from promoted candidates) explicitly deferred. Estimated ~350–500 changed lines; under the 400-line repo contract this likely means chained PRs via `auto-chain`/stacked-to-main. Roadmap wording reconciliation is a separate docs change.
