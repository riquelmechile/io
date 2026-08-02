# Design: Wire Active Skills into Context Segment 7

## Technical Approach

Option B: pure compiler rendering of segment 7 via `activeSkillsFor`, `CONTEXT_SCHEMA_VERSION` 1→2, golden regen, inverse cohort proofs, plus the D5-style worker seam (`listByCompany` → `prepareIntent` → `compileContext`). Skills are passed IN; the compiler stays I/O-free. Maps to proposal scope and all four MODIFIED requirements (context-compiler R1/R2/R6 + skill R7).

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| `skills` input shape | required vs optional | `skills?: readonly Skill[]` on `CompileContextInput` | Optional keeps every no-skills caller backward-compatible; empty/`undefined` ⇒ ABSENT |
| Where selection runs | compiler vs worker pre-filter | Compiler calls `activeSkillsFor` | Cohort purity lives next to other stable renders; worker only supplies the raw tenant store |
| Version const location | stay in `index.ts` / new module / `segments.ts` | **Define in `segments.ts`, re-export from `index.ts`** | Segment 7 render needs the const; avoids segments↔index cycle |
| Serialization | JSON vs fixed template | Fixed multi-line template, fields only `{skillId,name,version,body}`, order = `activeSkillsFor` (skillId ASC) | Matches seg 1/8 prose style; no timestamps/ids/Map order |
| Golden seed | empty skills (v2==v1 bytes) vs skills-bearing | **Skills-bearing seed** (one active skill, scope `planning`/`schemaVersion:2`) | Pins PRESENT segment-7 bytes; empty⇒ABSENT covered by unit tests |
| Worker port placement | `WorkerRepositories` vs top-level | **Top-level `WorkerDeps.skills: SkillRepository`** | Cycle-level read (like `delegation`), not terminal-tx |
| Fetch placement | claim / authority / intent | **Once after authority OK, before `prepareIntent`** | Mirrors D5 delegation surface; one `listByCompany(companyId)` per cycle |
| Boundary rule | keep type-only / relax BD values | **Relax type-only; keep all other bans** | Manifest already declares `@io/business-domain` runtime dep |

## Data Flow

```
runWorker
  → checkAuthority → delegation
  → deps.skills.listByCompany(companyId)     // once
  → prepareIntent({ …, skills })
       → compileContext({ companyId, process, delegation, work, skills })
            → buildStablePrefix
                 → seg7 renderActiveSkills
                      → activeSkillsFor({companyId, process, CONTEXT_SCHEMA_VERSION}, skills ?? [])
                      → empty ⇒ {present:false} | else fixed template
            → deriveCohort(…, CONTEXT_SCHEMA_VERSION=2) → user :v2
  → llm.complete({ messages, user })
```

Composition root: `buildWorkerDeps` → `skills: new PgSkillRepository(connection)`. Worker source stays PG-agnostic.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/context/src/segments.ts` | Modify | `CONTEXT_SCHEMA_VERSION=2`; `skills?` on input; value-import `activeSkillsFor` + type `Skill`; `renderActiveSkills`; wire seg 7 |
| `packages/context/src/index.ts` | Modify | Re-export version from segments; drop local const |
| `packages/context/test/boundary.test.ts` | Modify | Allow BD value imports; keep SDK/fs/`@io/*` bans |
| `packages/context/test/fixtures/prefix.v2.golden.txt` | Create | Regenerated pin for skills-bearing seed |
| `packages/context/test/prefix-stability.test.ts` | Modify | Skills seed; inverse poison cases; golden path auto-picks v2 |
| `packages/context/test/cohort.test.ts` | Modify | Assert version `=== 2` |
| `packages/context/test/context-compiler.test.ts` | Modify | Seg-7 present/order/empty cases |
| `packages/app/src/worker/types.ts` | Modify | `skills: SkillRepository` on `WorkerDeps` |
| `packages/app/src/worker/intent.ts` | Modify | `IntentInput.skills?`; pass into `compileContext` |
| `packages/app/src/worker/worker.ts` | Modify | Fetch + pass skills |
| `packages/app/src/composition/worker-deps.ts` | Modify | Wire `PgSkillRepository` |
| `packages/app/test/worker-helpers.ts` | Modify | `InMemorySkillRepository` in harness |
| `packages/app/test/worker-intent.test.ts` | Modify | `:v1`→`:v2`; skills pass-through assertion |
| `packages/app/test/composition/worker-deps.test.ts` | Modify | Assert `deps.skills` is `PgSkillRepository` |
| `packages/business-domain/test/skill.test.ts` | Modify | R7 rewrite to new contract |
| Spec deltas | Already written | No further edit in design |

No new packages/deps. `package.json` of `@io/context` unchanged (`@io/business-domain` only).

## Interfaces / Contracts

```ts
// CompileContextInput (+ existing fields)
skills?: readonly Skill[];

// Segment 7 render (pure)
function renderActiveSkills(input: CompileContextInput): SegmentRender {
  const selected = activeSkillsFor(
    { companyId: input.companyId, process: input.process, schemaVersion: CONTEXT_SCHEMA_VERSION },
    input.skills ?? [],
  );
  if (selected.length === 0) return { present: false };
  // text: header + one block per skill, skillId ASC, fields skillId/name/version/body only
}

// WorkerDeps (+ existing ports)
skills: SkillRepository; // top-level, required
```

**Serialize template** (exact bytes locked by golden):

```
Active skills:
- id=<skillId> name=<name> v=<version>
<body>
```

(repeated per skill, `\n` between entries; no trailing junk fields).

**Cohort rule (CRITICAL):** render passes ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}` — the exact `deriveCohort` tuple. Never work/delegation/clocks/ids/dynamic tail.

## Testing Strategy

| Req | Spec scenarios | Tests (pure unless noted) |
|-----|----------------|---------------------------|
| context R1 Canonical Ordering | order; seg7 deterministic; empty ABSENT | `context-compiler.test.ts` |
| context R2 Prefix Stability | work invariant; dynamic leak; **seg7 inverse poison** | `prefix-stability.test.ts` |
| context R6 Schema Bump | bump; silent-change ban; **v2 golden** | `cohort.test.ts`, golden pin, `compile-context.test.ts` |
| skill R7 Isolation | render selection; inverse; empty ABSENT + dep bounds | `skill.test.ts` R7 rewrite; boundary.test.ts |
| Worker seam | skills fetched + passed | `worker-intent.test.ts`, `worker-deps.test.ts` (unit fakes); live PG only if composition/e2e already touch PG |

**Inverse poison matrix (mandatory, same cohort + skills store):** different work; different delegation; non-matching skill entries (other company/process/schemaVersion/draft/retired/older versions); different insertion order; double compile — all ⇒ byte-identical prefix including seg 7.

**Golden regen procedure:** (1) bump const to 2 + implement render; (2) set seed with one active skill `{companyId:'acme', process:'planning', schemaVersion:2}`; (3) run a one-shot write of `buildStablePrefix(seed)` → `fixtures/prefix.v2.golden.txt`; (4) commit file; pin test reads `prefix.v${CONTEXT_SCHEMA_VERSION}.golden.txt`. Do not hand-edit golden. Keep `prefix.v1.golden.txt` as historical (unused once version is 2).

**`:v1`→`:v2` churn:** `cohort.test.ts:42`; `worker-intent.test.ts` hard-coded `io:acme:…:v1` (2 asserts); any fixture building `scope.schemaVersion: 1` for PRESENT skills must use `2` (or `CONTEXT_SCHEMA_VERSION`). Deepseek-live derives dynamically — OK.

**Boundary relaxation (exact):** in `boundary.test.ts` “TYPE-ONLY” block — still require every non-relative import match `^@io/business-domain/`; **drop** the `^import\s+type\s` assertion (or allow either `import type` or value `import { activeSkillsFor, … }`). Forbidden-specifier list unchanged. Update comments: BD is the single allowed **runtime** dep (matches manifest).

**R7 rewrite:** replace ABSENT assertion with: matching active skills render into prefix; non-matching filtered; empty/`undefined` skills ⇒ seg7 ABSENT; deps still BD-only.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No data migration (skills read-only). Schema bump re-derives all cohorts to `:v2` — old `:v1` cache entries miss (safe). Empty tenants keep ABSENT seg7 (backward compatible). Stacked PRs to main (`auto-chain`, budget 400 authored lines).

### PR slice plan (stacked-to-main)

| PR | Scope | Est. authored lines |
|----|-------|---------------------|
| **PR1** | `@io/context`: render + v2 + golden + boundary + cohort/inverse/compiler tests | ~150–180 (excl. generated golden from risk count) |
| **PR2** | `@io/app` worker seam + harness/tests + `skill.test.ts` R7 rewrite | ~80–100 |

Spec deltas already in change folder; land with PR2 or earlier docs-only if preferred. Total authored ~230–280 < 400.

## Open Questions

- None blocking. Serialize template wording is fixed above; tasks lock the exact string via golden.
