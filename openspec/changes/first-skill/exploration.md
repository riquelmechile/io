# Exploration: first-skill — "un skill" (Paso 3, fourth slice)

**Change:** `first-skill` · Project: io · Hybrid artifact store
**Baseline:** `main @ de154e5` (clean tree, businessevent archived) · ~868 passed / 3 skipped (sequential) · live PG 18.4 integration green
**Sources:** architecture doc `docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md` §3.10/§4.8/§7.2/§9.1/§9.10/§10.3/§13.1/§13.2/§14/§15, roadmap `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` Paso 3 (Rev 3), `openspec/specs/` (`context-compiler`, `worker-cycle`, `business-event`, `io-domain-contract`, `delegation-lifecycle`, `work-lifecycle`, `business-receipt`), archived `context-compiler`/`deepseek-live-e2e`/`businessevent` explorations + archive reports, live code in `packages/`.

---

## 1. What "a skill" IS in this architecture (concept discovery)

The roadmap labels the slice **"un skill"** (`PASOS_SIGUIENTES_INCREMENTO_4.md` line 224: `Context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap`). The **concept** is defined by the foundational doc:

- **§3.10 (Capítulo 20 — Contexto, memoria y skills)**: skills are one of the continuity-building blocks the model API cannot provide itself — *"estado de trabajo; memoria persistente; recuperación; compactación; skills; contexto selectivo; herramientas; políticas."* They are **external, declarative procedural knowledge** injected into the stateless model.
- **§7.2 canonical context order — segment 7 "Skills activadas" (activated skills)**: skills occupy position 7 of the 13 canonical segments, **inside the stable prefix (1–9)**. They are therefore **cohort-stable content**: a pure function of the cohort's discriminator set, never per-request dynamic data (§7.2/§7.3; enforced by `context-compiler` R2/R6).
- **§9.1 Procedural memory**: *"Cómo realizar trabajo: procesos, SOP, skills, checklists, plantillas, criterios de aceptación."* Skills are **durable procedural knowledge** ("how to perform work"), one of the memory types.
- **§9.10 Aprendizaje metrics**: includes *"skills promovidas"* — skills have a **promotion lifecycle** (candidate → active), driven by verified outcomes, not model self-report (§10.3: a training must produce at least one of *"nueva skill"*, *"procedimiento actualizado"*, *"evaluación reproducible"*, …; Increment 8 lists **"skill promotion"**).
- **§13.1 worker cycle**: the worker's steps include *"recuperar memoria → compilar contexto → seleccionar Flash/Pro → razonar → producir plan estructurado"* — activated skills enter via **compiled context** (segment 7) and shape the **plan** the worker then executes. **A skill is not executed directly; it is declared knowledge that conditions the worker's reasoned plan.**
- **§13.2 heartbeats**: *"evento o timer → filtro determinístico → ¿existe novedad material? no → heartbeat sin LLM; sí → activar Flash."* — the next roadmap slice filters **BusinessEvents** for material novelty; **skill outcomes must therefore be recorded as deterministic business facts (BusinessEvents)**, or heartbeats cannot see them.
- **§14 repository layout**: top-level `skills/` directory (content home), not a package. The **domain ownership** is `competency/` per the approved domain contract: *"`competency` — owns skill/capability/certification criteria (§4.7, §10)"* (`io-domain-contract-v2` exploration §3.5). `packages/context`'s segment table already reserves `active-skills` at position 7 (`packages/context/src/segments.ts` line 190), rendered ABSENT today.

**Synthesis.** A skill in IO is a **versioned, declarative procedural-knowledge artifact** — the "how to perform work" for a scope (process/role) — that is:

```text
DECLARED (definition: id, name, version, body, scope, state)      [§9.1, §10.3]
→ SELECTED (activation: deterministic, cohort-stable, §7.2 seg 7) [§7.2/§7.3]
→ COMPILED into the stable context prefix (segment 7)             [§13.1]
→ EXECUTED by the worker as knowledge that shapes the plan        [§13.1]
→ RECORDED as deterministic business facts (BusinessEvent)        [§8.2.2, §13.2]
→ PROMOTED/retired from verified outcomes (learning, Increment 8) [§9.10, §10.3]
```

It is NOT a tool, NOT a plugin, NOT an agent, NOT a free-text prompt string dropped anywhere in the prompt. It is **declarative procedural memory with explicit valid states** (config rule: "Work, contracts, approvals, memory, and results MUST declare explicit valid states", §3.5), **versioned** (promotion/retirement need versions), **tenant-scoped** (`companyId`, ADR-0002), and **activation-safe for the KV cache** (only cohort-discriminated content may ever reach segment 7 — the R2 cache-poisoning CRITICAL in the context-compiler archive is the standing warning).

**Canonical naming note:** the change identifier `first-skill` is fine; the **capability/spec name should be `skill`** (roadmap term, matches `business-event` naming) and the canonical package home is **`competency/`** per the domain contract — recorded as the extraction target, exactly like `trust-kernel`'s documented transitional extraction.

## 2. Why it follows BusinessEvent, and what it unlocks

BusinessEvent was built **write-side only** — its exploration explicitly deferred skills: *"Skills / outcomes — the 'un skill' slice … need verified outcome records; BusinessEvent carries the deterministic terminal facts."* The ordering is causal:

1. **BusinessEvent is the deterministic fact substrate.** The architecture forbids model-judged records (§8.2.2) and mandates append-only business facts (§9.8). A skill's *activation*, *execution*, and *outcome* must be observable as **facts** — and only BusinessEvent (append-only, atomic-with-change, tenant-scoped) exists to carry them.
2. **Heartbeats (§13.2) consume events.** The next roadmap slice's deterministic filter ("¿existe novedad material?") needs a fact stream. Skill outcomes feed that stream; without BusinessEvent first, heartbeats would have nothing deterministic to filter on.
3. **Learning/Increment 8 promotes skills from outcomes** (§9.10 "skills promovidas", §10.3) — those outcomes are BusinessEvents.

**What this slice unlocks:** the ability to **declare and durably persist a skill** with explicit state and version, and to **select it deterministically per cohort** — the exact content segment 7 will render (the following slice), which the worker will then compile (§13.1) and whose execution records heartbeats will filter (§13.2). Each later slice consumes a seam this slice exposes; none is built here.

## 3. Current state (verified from the live repo)

- **No Skill concept exists anywhere**: zero `Skill` matches in `packages/` source (only `active-skills` as the segment-7 id in `packages/context/src/segments.ts` + its test). No `competency/` package, no `skills/` top-level dir.
- **Segment 7 already reserved**: `SEGMENTS[6] = { id: 'active-skills', position: 7, kind: 'stable', render: () => ({ present: false }) }` — ABSENT rendering, fixed position, byte-stable. `CONTEXT_SCHEMA_VERSION = 1`; adding content would require a cohort bump (R6) — **this slice does NOT touch the compiler** (hard constraint).
- **`packages/business-domain`** (`src/types.ts`, `src/ports/repositories.ts`, `src/ports/fakes.ts`, `src/index.ts`): 5 aggregates (Company, Delegation, Work, BusinessReceipt, BusinessEvent) + ports + fakes; zero `@io/*` imports; no runtime deps. The natural transitional home for the `Skill` type + registry port + fake (precedent: BusinessEvent).
- **`packages/database`**: adapters (`business-event-adapter.ts` INSERT-only + `parseBusinessEventRow` guard), migrations `001–006` (`sql/`), boundary guard forbidding UPDATE/DELETE in adapter source. A `PgSkillRepository` + `007_skills.sql` mirrors the event adapter exactly.
- **`packages/app`**: worker cycle (`worker.ts` → `intent.ts` compileContext → effect → `finalize.ts` T1) + composition root `buildWorkerDeps` (`packages/app/src/composition/worker-deps.ts`) with the `repositories(conn)` factory returning `{ work, receipts, journal, events }`. **Seam**: the worker is PG-agnostic; adapters are constructed at the composition root. Wiring a `skills` repo into `buildWorkerDeps` is composition-root-only.
- **Hard constraints verified**: `business-domain` zero `@io/*`; `packages/context` deps === `@io/business-domain` only (`packages/context/package.json`); `openai` confined to `llm-client/src/deepseek-client.ts`; no agentic frameworks; no new runtime deps (a `Skill` is plain data — no dep needed).
- **Archived precedent** (`context-compiler`, `deepseek-live-e2e`, `businessevent`): each was a single bounded slice (200–450 changed lines) delivered as stacked PRs under `auto-chain`; each explicitly deferred the NEXT roadmap item. `context-compiler/archive-report.md` "Next Steps" lists **"One-skill heartbeats (segment 7)"** as the *follow-up after* BusinessEvent — confirming the roadmap intends skills THEN heartbeats, with segment 7 wiring as the immediate next step after the skill definition slice.

## 4. Affected areas (for the recommended Option A)

- `packages/business-domain/src/types.ts` — ADD `Skill` type (versioned, explicit state, tenant-scoped; zero `@io/*`).
- `packages/business-domain/src/ports/repositories.ts` — ADD `SkillRepository` port (versioned save + tenant-scoped reads).
- `packages/business-domain/src/ports/fakes.ts` — ADD `InMemorySkillRepository`.
- `packages/business-domain/src/index.ts` — export type + port + fake.
- `packages/business-domain/test/skill.test.ts` (NEW) — shape, valid states, versioning, tenant scope, activation determinism/cohort-safety.
- `packages/database/sql/007_skills.sql` (NEW) — `skill` table (versioned rows, UNIQUE(company_id, skill_id, version), tenant index).
- `packages/database/src/skill-adapter.ts` (NEW) — `PgSkillRepository` (INSERT-only versioned writes; no UPDATE/DELETE).
- `packages/database/src/row-guards.ts` — ADD `parseSkillRow`.
- `packages/database/src/index.ts` — export adapter + guard.
- `packages/database/test/skill-roundtrip.integration.test.ts` (NEW, sequential) + boundary/sql-migrations test updates.
- New spec capability `skill` (proposal/spec phases, later).

**NOT touched in any option this slice:** `packages/context/**`, `packages/app/src/worker/**`, `packages/app/src/composition/worker-deps.ts` (unless Option B), `complete-work-flow.ts`, llm-client, domain use cases, `006_business_events.sql`.

## 5. Approaches

### A. Skill definition + versioned registry + deterministic activation — domain + PG persistence, NO compiler/worker wiring (recommended)
`Skill` type (skillId, companyId, name, version, body, scope, state `draft|active|retired`, timestamps), `SkillRepository` port (versioned `save` inserting a new version row, `get` latest, `listByCompany`), `InMemorySkillRepository`, and a **pure activation function** `activeSkillsFor({companyId, process, schemaVersion}, skills)` (or a port read `listActiveByScope`) that deterministically selects cohort-stable skills. `PgSkillRepository` + `007_skills.sql` (versioned INSERT, UNIQUE(company_id, skill_id, version)). Tests: unit (state machine, versioning, tenant scope, activation is a pure function of cohort inputs — dynamic input cannot change the selection), live-PG round-trip (sequential), boundary (no UPDATE/DELETE).

- Pros: smallest honest slice; mirrors the `businessevent` write-side precedent exactly; every hard invariant safe (compiler untouched → cohort rule structurally safe; business-domain stays pure; no new deps); proves the DECLARED + SELECTED verbs with durability; gives the following slice (segment-7 wiring) its exact input; ~250–400 lines fits the 400-line budget.
- Cons: no observable runtime behavior yet (nothing consumes the registry); the activation function is a seam until segment 7 lands; extraction to `competency/` is deferred (documented).
- Effort: Medium.

### B. A + worker activation seam (worker selects/executes an active skill this slice)
Also wire a `skills` repo into `buildWorkerDeps` and have the worker select the active skill during the cycle (e.g. loading it into `prepareIntent`).

- Pros: shows the skill being "used" by the worker end-to-end.
- Cons: **incoherent without segment 7** — a skill is knowledge that enters via compiled context; executing it before the compiler renders it means bypassing §7.2 (cache-poisoning risk) or inventing a non-architectural execution path; touches the worker + composition root + intent tests; blows the budget; duplicates the deepseek-live-e2e "wiring" churn.
- Effort: Medium–High.

### C. A + segment-7 compiler wiring (render active skills into the stable prefix)
Bump `CONTEXT_SCHEMA_VERSION`, wire `activeSkillsFor` into `SEGMENTS[7]`, regenerate the golden pin, re-derive cohorts.

- Pros: the full §7.2 meaning lands immediately; KV-cache economics real.
- Cons: **explicitly forbidden by the task's hard constraint** ("a first slice may NOT touch the compiler"); requires a cohort bump + golden regeneration + cohort tests; it is the *next* roadmap step ("One-skill heartbeats (segment 7)") and deserves its own slice.
- Effort: Medium (on its own) but wrongly sequenced.

**Recommendation: Approach A.** The first skill slice delivers the **declared + selected** verbs as a pure, durable domain artifact — `Skill` + versioned registry port + fake + PG persistence + deterministic cohort-safe activation — and nothing else. It is the write-side twin of BusinessEvent: build the definition store and selection rule; let the following slices (segment-7 rendering, worker execution, heartbeats) consume the seams. Seed skill CONTENT is also deferred (the vertical's only procedure today lives in the protocol/process segments; there is no content source yet).

Design rules for the slice:

1. **Versioned, no-overwrite history** (§9.2 "no se sobrescribe la historia", §10.3/Increment 8 promotion): a new version is a NEW row; the registry never mutates a persisted version. UNIQUE(company_id, skill_id, version).
2. **Explicit valid states** (§3.5/config rule): `draft | active | retired` with a guard; only `active` skills are selectable — activation is promotion-ready.
3. **Tenant scoped** (ADR-0002): every skill carries non-empty `companyId`; all reads scoped by company.
4. **Activation is a pure function of the cohort** (§7.2/§7.3, context-compiler R2/R6): `activeSkillsFor` selects ONLY on cohort inputs (companyId, process, schemaVersion, skill state) — never on work, clock, ids, or dynamic tail. A test asserts dynamic input cannot change the selection (the cache-poisoning inverse test pattern from the context-compiler R2 fix).
5. **INSERT-only adapter** (mirror BusinessEvent): `PgSkillRepository` writes versions via INSERT only; boundary guard asserts no UPDATE/DELETE in adapter source.
6. **Never enters the prefix this slice**: compileContext untouched; segment 7 stays ABSENT; the activation function is exported from business-domain for the next slice to consume.
7. **Tests**: (a) business-domain unit — shape, states, versioning, tenant scope, activation determinism (same cohort ⇒ same set; dynamic input ignored); (b) database — round-trip vs live PG (sequential), boundary no-UPDATE/DELETE, sql-migrations `007` DDL shape; (c) purity — zero `@io/*` imports in business-domain.

## 6. Scope boundaries (first bounded slice)

**IN**
- `packages/business-domain`: `Skill` type, `SkillRepository` port, `InMemorySkillRepository`, `activeSkillsFor` activation (pure, cohort-safe), exports, unit tests.
- `packages/database`: `PgSkillRepository` (INSERT-only versioned), `parseSkillRow` guard, `007_skills.sql`, index/export, round-trip integration + boundary + sql-migrations tests.
- New spec capability `skill` (proposal/spec phases, later).

**OUT (explicitly deferred — later Paso 3 slices / future increments)**
- Segment-7 compiler wiring + `CONTEXT_SCHEMA_VERSION` bump + golden regen (the NEXT slice — context-compiler archive names "One-skill heartbeats (segment 7)").
- Worker activation/execution + `buildWorkerDeps` wiring (Approach B).
- Skill outcome/activation BusinessEvents (facts emitted when skills execute — needs the worker seam first).
- Heartbeats (§13.2) — the slice AFTER skills per the roadmap.
- Learning / promotion from outcomes / certification (§10, Increment 8), Memory OS ingestion, curricula.
- Seed skill content (no content source yet; create-document procedure lives in protocol/process segments).
- Extraction of the type to the canonical `competency/` package (recorded target, change-pressure validated).

## 7. Risks

- **Scope drift into segment 7 / worker / heartbeats** — HIGH; the roadmap sequence invites it. The slice is DECLARE + SELECT only (Approach A).
- **Cohort/cache poisoning if activation ever feeds segment 7** — the R2 CRITICAL precedent (delegation content leaked into the stable prefix). Mitigated: compiler untouched this slice; the activation test enforces "dynamic input cannot change selection" NOW so the next slice inherits the guarantee.
- **Versioning ambiguity** (upsert vs append): must be append-new-version from the start, or promotion/retirement breaks the no-overwrite-history rule. Enforced by UNIQUE + INSERT-only adapter.
- **Budget pressure**: the slice mirrors businessevent's three-layer shape; keep tests focused (structure-not-output), run PG sequentially (`pnpm vitest run --no-file-parallelism` — the pre-existing parallelism flake). Auto-chain supports 2 stacked PRs (domain, database) if needed.
- **Premature abstraction**: an activation function with no consumer could be seen as speculative — but segment 7 exists in the SEGMENTS table today, the archive names the follow-up, and the cohort-safety test is exactly what the next slice needs; it is a seam, not speculation.
- **Churn**: `sql-migrations.test.ts` and `boundary.test.ts` gain `007` assertions (additive, mechanical). No existing worker/context tests change.

## 8. Ready for Proposal

**Yes — this is a clean, bounded slice.** A skill is **versioned declarative procedural knowledge with explicit states** (architecture §3.10/§4.8/§7.2/§9.1/§9.10/§10.3/§13.1/§13.2; owned by `competency/` per the domain contract) that is declared, deterministically selected per cohort, compiled into context segment 7, executed via the worker's plan, and recorded as deterministic business facts that heartbeats consume. It follows BusinessEvent because the event log is the deterministic fact substrate its outcomes require, and it unlocks the next roadmap slices (segment-7 rendering → worker activation → heartbeats). The recommended first slice delivers the **declared + selected** verbs: `Skill` type + versioned registry port + fake + cohort-safe activation in `packages/business-domain` (zero `@io/*`), persisted by a new `PgSkillRepository` + `007_skills.sql` (INSERT-only), with segment 7, the worker, and heartbeats explicitly deferred.

The orchestrator should tell the user: this slice ships the durable skill definition store + deterministic cohort-safe activation selection (the exact input segment 7 will render next), proven by unit + live-PG round-trip + boundary tests; scope excludes the compiler, worker wiring, skill events, and heartbeats; expected ~250–400 changed lines (auto-chain supports 2 stacked PRs if the budget trips); capability name `skill`, extraction target `competency/`.

**Verdict: clean bounded slice.** Recommended proposal: new capability `skill` (no modified specs expected — verified `context-compiler`/`worker-cycle`/`business-event` capabilities need no change: the compiler stays untouched, the worker contract is untouched, and the skill registry is a NEW capability).
