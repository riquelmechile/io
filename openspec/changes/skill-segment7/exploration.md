# Exploration: skill-segment7 — wiring active skills into context segment 7

**Change:** `skill-segment7` · Project: io · Hybrid artifact store
**Baseline:** `main @ f9bd5d9` (clean tree, first-skill archived) · ~922 tests passing sequentially · live PG 18.4 integration green
**Sources:** architecture doc `docs/IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md` §7.2/§7.3/§13.1, roadmap `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` (line 224, Paso 3 sequence), `openspec/specs/context-compiler/spec.md`, `openspec/specs/skill/spec.md`, archived `context-compiler` (exploration/design/archive-report) + `first-skill` exploration, live code in `packages/`.

---

## 1. What "wiring segment 7" means (precise definition)

§7.2 reserves **segment 7 "Skills activadas"** inside the stable prefix (1–9) of the canonical context order; §13.1 compiles that context per worker cycle ("compilar contexto"); §7.3 requires cohort peers to share "política, privacidad y prefijo exacto". The `context-compiler` capability shipped the 13-slot segment table with `active-skills` at position 7 **reserved but ABSENT** (`packages/context/src/segments.ts` line 190: `render: () => ({ present: false })`), and its archive-report "Next Steps" names **"One-skill heartbeats (segment 7)"** as the follow-up. The `first-skill` slice delivered the other half: the `Skill` type, an append-only versioned registry, and — critically — **`activeSkillsFor(cohort, skills)`**, a pure, cohort-safe selection function exported from `packages/business-domain` (R5), with a `SkillCohort = {companyId, process, schemaVersion}` that matches the context cohort discriminator inputs **exactly**.

**Wiring segment 7 =** making the `active-skills` segment render cohort-selected active skill content into the stable prefix:

1. `CompileContextInput` gains `skills?: readonly Skill[]` (the raw tenant skill store — all persisted versions).
2. Segment 7's render calls `activeSkillsFor({companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}, input.skills ?? [])` and serializes the selection deterministically; empty selection ⇒ ABSENT (zero bytes, backward compatible with every no-skills caller).
3. `CONTEXT_SCHEMA_VERSION` bumps 1 → 2 (R6: adding a stable segment's content requires a cohort bump) and the golden pin is regenerated as `prefix.v2.golden.txt`.
4. Worker seam: `WorkerDeps` gains `skills: SkillRepository`; `runWorker` fetches `deps.skills.listByCompany(companyId)` and passes it through `prepareIntent` → `compileContext`. This is what makes skills **actually enter the worker's compiled context** (§13.1).

The result: a company with active, cohort-matching skills gets skill content in the byte-stable prefix (KV-cache friendly); a company with none renders segment 7 ABSENT exactly as today.

## 2. Why it is the next slice (bridge to heartbeats)

The roadmap sequence is `context compiler → DeepSeek live E2E → BusinessEvent → un skill → heartbeats → roadmap`. Four slices are done and archived. The `context-compiler` archive explicitly names the follow-up: **"One-skill heartbeats (segment 7)"** — and `first-skill`'s exploration documented the exact next step: *"Segment-7 compiler wiring + CONTEXT_SCHEMA_VERSION bump + golden regen (the NEXT slice)"*. This slice is the **prerequisite** for heartbeats (§13.2): a heartbeat filter decides "¿existe novedad material?" and only activates the model on material novelty; for skills to be *material*, they must first exist in the worker's compiled context. Without segment 7, heartbeats would filter events over a context that never carries skill knowledge — the bridge would be missing. This slice completes the vertical's §13.1 story: skills are DECLARED (`skill`) → SELECTED (`activeSkillsFor`) → COMPILED (this slice) → later EXECUTED and recorded (heartbeats/outcome slices).

## 3. Current state (verified from the live repo)

- **Segment 7 reserved + ABSENT**: `packages/context/src/segments.ts` — `SEGMENTS[6] = { id: 'active-skills', position: 7, kind: 'stable', render: () => ({present:false}) }`. The stable prefix today renders `{seg 1 protocol, seg 8 business-process}` only; `CompileContextInput = {companyId, process, delegation?, work}`.
- **Compiler**: `packages/context/src/index.ts` — `CONTEXT_SCHEMA_VERSION = 1`, `deriveCohort({companyId, process, schemaVersion})` → `io:{companyId}:{process}:v{schemaVersion}`, `compileContext` is PURE (no I/O, no client). `buildStablePrefix` (segs 1–9) → `messages[0]`; `buildDynamicSuffix` (10–13) → `messages[1]`.
- **Golden pin**: `packages/context/test/fixtures/prefix.v1.golden.txt` = seg1+seg8 bytes; `prefix-stability.test.ts` reads `prefix.v{CONTEXT_SCHEMA_VERSION}.golden.txt` and asserts `buildStablePrefix(seed)` equals it (R6 silent-prefix-change detection). Regeneration = deliberately write the new file for the new version after bumping the constant.
- **Selection function**: `packages/business-domain/src/skill-activation.ts` — `activeSkillsFor(cohort, skills)` filters `state==='active'`, `companyId`, `scope.process`, `scope.schemaVersion`; collapses to max `version` per `skillId`; sorts `skillId` ASC. `SkillCohort` shape === `deriveCohort` inputs. Exported from `business-domain/src/index.ts` (lines 37–40).
- **Skill store**: `SkillRepository` port (`save`/`get`/`listByCompany` — all tenant-scoped, append-only), `PgSkillRepository` + `007_skills.sql` (INSERT-only), `InMemorySkillRepository` fake. `listByCompany` returns **all persisted versions** ordered by insertion — the correct raw input for `activeSkillsFor`.
- **Worker seam**: `packages/app/src/worker/intent.ts` `prepareIntent` calls `compileContext({companyId, process: processTokenFor(delegation), delegation, work})` and forwards `compiled.user` to `llm.complete`. `runWorker` (worker.ts) already surfaces the delegation via `checkAuthority` — the D5 pattern (surface fetch, pass data). `WorkerDeps` (worker/types.ts) has optional `connection`/`repositories`; a `skills` port slots in at the same level. `buildWorkerDeps` (composition/worker-deps.ts) constructs PG adapters — `PgSkillRepository(connection)` wires with one line.
- **Boundary (CRITICAL finding)**: `packages/context/test/boundary.test.ts` line 122–136 requires **every business-domain import in `packages/context/src` to be `import type`** (type-only). `activeSkillsFor` is a **VALUE** — calling it from the compiler requires relaxing this rule to allow business-domain **value** imports while keeping every other prohibition (no SDKs, no fs, no other `@io/*`). This is legitimate: `packages/context/package.json` already declares `@io/business-domain` as a **runtime** dependency (`"dependencies": {"@io/business-domain": "workspace:*"}`), so the manifest already permits runtime use — the type-only assertion was stricter than the manifest. Relaxation is a documented, deliberate boundary evolution; business-domain stays the single allowed dep.
- **Existing tests that pin the old contract** (must change):
  - `packages/business-domain/test/skill.test.ts` line 407: the skill-spec R7 "Stable-Prefix Isolation" test asserts segment 7 stays ABSENT and prefix contains no 'skill'. **Spec R7 is MODIFIED by this slice** → this test is rewritten to the new contract (renders when cohort-matching skills supplied; ABSENT otherwise).
  - `packages/context/test/cohort.test.ts` line 42: asserts `CONTEXT_SCHEMA_VERSION` is 1 → 2.
  - `packages/app/test/worker-intent.test.ts`: hard-coded `'io:acme:low-risk-documents:v1'` and `'io:acme:onboarding:v1'` → v2 (2 assertions). (e2e deepseek-live derives the cohort dynamically — unaffected.)
  - `packages/context/test/prefix-stability.test.ts`: golden seed gains a cohort-matching active skill so the pin locks segment-7 bytes too; every existing inverse test then **also** proves "different work/delegation does not change segment-7 bytes" (the spread `{...seed}` inherits the skills).
  - `packages/app/test/worker-helpers.ts` `harness()` + `worker-deps.test.ts`: gain `skills` (fake / PG-wired assertion).

## 4. Affected areas (recommended Option B)

- `packages/context/src/segments.ts` — `CompileContextInput.skills?: readonly Skill[]`; `renderActiveSkills` via `activeSkillsFor`; deterministic serialization; move `CONTEXT_SCHEMA_VERSION` here (or a shared module) to avoid an import cycle with `index.ts`, re-exporting from index.
- `packages/context/src/index.ts` — bump `CONTEXT_SCHEMA_VERSION` 1→2; re-export unchanged public API.
- `packages/context/test/boundary.test.ts` — allow business-domain value imports (manifest already declares the runtime dep); all other prohibitions unchanged.
- `packages/context/test/prefix-stability.test.ts` + `fixtures/prefix.v2.golden.txt` — golden regeneration with a skills-bearing seed; **inverse cohort tests** (below).
- `packages/context/test/context-compiler.test.ts` — segment-7 present-rendering tests (ordering, version collapse, filter); existing no-skills fixtures keep segment 7 ABSENT (unchanged).
- `packages/context/test/cohort.test.ts` — v1 → v2 assertions.
- `packages/app/src/worker/types.ts` — `WorkerDeps.skills: SkillRepository` (+ optional slot in `WorkerRepositories`? No — skills reads are cycle-level, not terminal-tx; top-level port only).
- `packages/app/src/composition/worker-deps.ts` — `skills: new PgSkillRepository(connection)`.
- `packages/app/src/worker/intent.ts` — `IntentInput.skills?: readonly Skill[]`; pass into `compileContext`.
- `packages/app/src/worker/worker.ts` — fetch `deps.skills.listByCompany(cmd.companyId)` before `prepareIntent`; pass through (D5 pattern).
- `packages/app/test/worker-intent.test.ts`, `worker-helpers.ts`, `composition/worker-deps.test.ts` — seam assertions + v2.
- `packages/business-domain/test/skill.test.ts` — R7 isolation test → new contract.
- Specs: `skill` R7 MODIFIED; `context-compiler` R2/R6 new scenarios (skill inverse; segment-7 golden).

## 5. Approaches

### A. Compiler rendering only — segment 7 given skills-as-input + golden regen + cohort tests (worker seam deferred)
Compiler wires `activeSkillsFor` into segment 7, bumps the schema, regenerates the golden, adds the inverse cohort tests. No worker change — skills are exercised in unit tests only.

- Pros: smallest slice; the compiler (the risky half — cohort rule) lands and is proven first; worker seam is then a trivial pass-through.
- Cons: **production behavior does not change** — nothing passes skills to `compileContext`, so segment 7 stays ABSENT at runtime; the slice's purpose ("skills actually enter the worker's compiled context") is not met end-to-end; heartbeats (next) would still find no skill content in real cycles; the golden would be regenerated for content nothing emits.
- Effort: Low–Medium.

### B. A + worker seam — worker fetches active skills and passes them to the compiler (recommended)
Everything in A, plus `WorkerDeps.skills` port, `runWorker` fetches `listByCompany(companyId)`, `prepareIntent` forwards `skills` into `compileContext`. Skills genuinely enter the compiled context (§13.1).

- Pros: matches the slice's stated goal ("making skills actually enter the worker's compiled context"); follows the D5 surface-fetch precedent exactly (delegation already flows this way); the worker stays PG-agnostic (port injected at composition root); unlocks heartbeats meaningfully; ~200–260 changed lines fits the 400 budget (2 stacked PRs: compiler, worker) under `auto-chain`.
- Cons: touches the composition root + intent tests (mechanical, additive); one PG read per cycle (acceptable for the vertical; `activeSkillsFor` collapses to ≤1 row per skillId).
- Effort: Medium.

### C. B + heartbeats (§13.2)
Also implement the deterministic material-novelty filter and heartbeat path.

- Pros: completes the roadmap item in one go.
- Cons: **blows the 400-line budget**; heartbeats need BusinessEvent replay/filter semantics that are a distinct architectural concern (the archive already sequences them after segment 7); conflating the cohort-critical prefix change with a new execution path triples review risk; the standing review-budget guard (400 lines) is violated.
- Effort: High (wrongly sequenced).

**Recommendation: Option B.** It is the honest bounded slice: the cohort-critical compiler change (the risky half, with the inverse tests and golden regen) AND the minimal seam that makes skills real in the worker's context — without heartbeats, execution, or outcome events. Precedent: `context-compiler` itself shipped compiler + worker wiring in one change (3 stacked PRs, ~250–400 lines).

## 6. Scope boundaries (first bounded slice)

**IN**
- `packages/context`: `skills` input on `CompileContextInput`; segment 7 render via `activeSkillsFor` (cohort = `{companyId, process, CONTEXT_SCHEMA_VERSION}`); deterministic serialization; `CONTEXT_SCHEMA_VERSION` 1→2; golden regen `prefix.v2.golden.txt`; boundary-test relaxation (business-domain value imports only); cohort/inverse/rendering tests.
- `packages/app`: `WorkerDeps.skills` port; composition-root wiring `PgSkillRepository`; `runWorker` fetch + `prepareIntent` pass-through; tests.
- Specs: `skill` R7 MODIFIED (Stable-Prefix Isolation → cohort-safe segment-7 rendering; dependency constraint preserved); `context-compiler` R2/R6 scenario additions.

**OUT (explicitly deferred — later Paso 3 slices / increments)**
- Heartbeats (§13.2 deterministic filter) — next slice.
- Worker execution of skills / skills-as-executed logic, skill outcome BusinessEvents.
- Learning/promotion from outcomes, certification, Memory OS ingestion.
- Seed skill CONTENT (none exists; a company with no skills renders ABSENT — the common case today).
- Process-domain package replacing `processTokenFor` (existing transitional stand-in, untouched).
- Extraction of `Skill` to the canonical `competency/` package (recorded target from first-skill).

## 7. The cohort-rule proof (the heart of the slice)

**Invariant**: segment 7's rendered bytes MUST be a pure function of the cohort `io:{companyId}:{process}:v{schemaVersion}` plus the tenant's persisted skill store — and NEVER of per-request dynamic input (work, delegation, clocks, generated ids, dynamic tail).

The proof has three layers, all testable:

1. **Selection is cohort-pure (structural)**: segment 7's render passes ONLY `{companyId: input.companyId, process: input.process, schemaVersion: CONTEXT_SCHEMA_VERSION}` into `activeSkillsFor`. That is exactly the tuple `deriveCohort` uses — the skill discriminator and the cache-cohort discriminator are the SAME three values (the alignment the task demands). `activeSkillsFor` cannot read work/delegation/clock (its signature admits only `(cohort, skills)`). A skill not matching companyId/process/schemaVersion/active-state is filtered out **before** any byte is emitted.
2. **Rendering is deterministic**: serialize the selection sorted by `skillId` ASC (activeSkillsFor's own order), fixed field set (`skillId`, `name`, `version`, `body` — NOT timestamps/ids), fixed template. Same selection ⇒ same bytes. No clocks, no generated ids, no Map iteration order leaks.
3. **The inverse (cache-poisoning) tests, mandatory in this slice**:
   - same cohort + same skills + **different work** ⇒ byte-identical prefix (work cannot touch segment 7);
   - same cohort + same skills + **different delegation** ⇒ byte-identical prefix (extends the existing R2 inverse test, now with segment 7 present);
   - same cohort + a skills array containing **non-matching entries** (other company, other process, other schemaVersion, `draft`/`retired`, older duplicate versions) ⇒ byte-identical to the matching-only array (selection filters them — the *dynamic input cannot change the rendered bytes* requirement);
   - same skills array in **different insertion order** ⇒ byte-identical (deterministic collapse+sort);
   - same input twice ⇒ byte-identical (determinism).
   - **Golden pin**: `prefix.v2.golden.txt` locks the exact bytes for the new schema version; a silent prefix change fails the pin until the golden is deliberately regenerated AND the version bumped (R6).

**Why this is not the R2 poisoning**: the R2 CRITICAL was *per-request* delegation detail entering the stable prefix while the cohort discriminated only companyId/process/version — two requests in the SAME cohort rendered different bytes CONCURRENTLY. Skills are *persisted, cohort-scoped content*: every request in the cohort at a given store state renders the same selection. A skill promotion changes the store — that is a content event (prefix changes → cache **miss**, never a stale serve; DeepSeek's prefix-token cache only serves byte-identical prefixes). And `skill.scope.schemaVersion` gates skills to a cohort generation: after the v1→v2 bump, only skills scoped to `schemaVersion 2` render — old-generation skills cannot leak into the new cohort.

**Cohort discriminator**: the discriminator SHAPE does NOT change (`io:{companyId}:{process}:v{schemaVersion}`). Only `CONTEXT_SCHEMA_VERSION` bumps 1→2, which re-derives ALL cohorts (`user` becomes `:v2` everywhere) — the safe mechanism to introduce new prefix content: no request under an old cohort string can ever be served new-format bytes.

## 8. Verdict — clean bounded slice?

**Yes.** "Wire active skills into context segment 7" is a precise, precedent-anchored change: compiler rendering of segment 7 via `activeSkillsFor` (with the standing cohort invariant proven by inverse tests + golden regen) + the minimal worker seam that makes skills actually enter the compiled context. It follows `context-compiler` and `first-skill` exactly as their archives pre-announced, and it is the precondition for the heartbeats slice.

**Recommended slice**: Option B. Compiler + golden + cohort tests + worker seam; heartbeats/execution/outcomes excluded.

**Expected changed lines**: ~200–260 authored (compiler ~60, context tests + golden ~100, worker seam ~40, spec deltas) — within the 400-line review budget; generated golden excluded from authored risk per the review-workload guard. `auto-chain` supports 2 stacked PRs: (1) `@io/context` segment-7 rendering + v2 bump + golden + cohort tests, (2) worker seam + spec deltas.

**Risks**
- **Boundary-test relaxation** (type-only → business-domain values): must be deliberate and documented; justified by the manifest already declaring business-domain as the runtime dep; the "only business-domain, no SDKs/fs" rules stay.
- **Schema bump churn**: hard-coded `:v1` assertions in worker-intent + cohort tests must move to `:v2`; the golden MUST be regenerated (not edited by hand) or the pin fails; `CONTEXT_SCHEMA_VERSION` must be relocated to avoid a segments↔index import cycle.
- **Skill-store evolution within a cohort** (promotion changes prefix bytes without a bump): safe (cache miss, not stale serve) and gated by `scope.schemaVersion`, but must be stated in the design so reviewers don't misread it as an R2 violation.
- **Scope drift into heartbeats** — HIGH; the roadmap invites it. Keep Option B boundaries.
- **Test churn**: R7 isolation test rewrite + `:v1→:v2` + harness `skills` additions are mechanical but must be enumerated in tasks.

## 9. Ready for Proposal

**Yes.** The orchestrator should tell the user: this slice makes skills actually enter the worker's compiled context — segment 7 (`active-skills`) renders the `activeSkillsFor` cohort selection into the stable prefix, `CONTEXT_SCHEMA_VERSION` bumps to 2 with the golden regenerated, inverse cache-poisoning tests prove the cohort rule, and the worker gains a `skills` read seam (`WorkerDeps.skills` → `listByCompany` → `compileContext`). Scope excludes heartbeats, skill execution, outcome events, and learning. Expected ~200–260 changed lines (2 stacked PRs). The `skill` spec R7 (Stable-Prefix Isolation) is MODIFIED by this slice.
