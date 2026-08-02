# Proposal: Wire Active Skills into Context Segment 7

## Intent

Segment 7 (`active-skills`) is reserved in the §7.2 stable prefix but renders ABSENT. `first-skill` shipped `activeSkillsFor` (cohort-safe selection in `@io/business-domain`) but nothing feeds it to the compiler. This slice wires that selection into segment 7 so a tenant's active skills render into the byte-stable prefix (§7.2/§13.1) and adds the worker seam so skills enter the compiled context — the prerequisite for one-skill heartbeats (§13.2).

## Scope

### In Scope
- Compiler renders segment 7 via `activeSkillsFor`; empty selection ⇒ ABSENT (zero bytes, backward compatible).
- `CONTEXT_SCHEMA_VERSION` bump 1→2; golden regenerated as `prefix.v2.golden.txt`.
- Cohort + inverse cache-poisoning tests.
- Worker seam: `WorkerDeps.skills` → `runWorker` `listByCompany` → `prepareIntent` → `compileContext`.
- Spec deltas: `context-compiler` and `skill` R7 (both modified).

### Out of Scope
- Heartbeats (§13.2); worker EXECUTION of skills; skill outcome/activation BusinessEvents.
- Learning/promotion (Increment 8); Memory OS; extraction to `competency/`; seed skill content.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `context-compiler`: segment 7 renders active skills (was ABSENT); `CONTEXT_SCHEMA_VERSION` 1→2 re-derives all cohorts; prefix stays a pure function of the cohort; golden regenerates as `prefix.v2.golden.txt`.
- `skill`: R7 "Stable-Prefix Isolation" — segment 7 no longer ABSENT; skill content enters `compileContext` only as a pure function of the cohort; dependency constraint preserved.

## Approach

Option B (exploration recommendation): segment-7 rendering + schema bump + golden regeneration + cohort/inverse tests, plus the minimal worker seam. Segment 7 passes ONLY `{companyId, process, schemaVersion: CONTEXT_SCHEMA_VERSION}` into `activeSkillsFor` — the exact `deriveCohort` tuple — and serializes deterministically (skillId ASC, fixed fields); the worker stays PG-agnostic (D5 precedent). ~200–260 authored lines; `auto-chain` supports 2 stacked PRs (context, then app+spec).

## Cohort Rule and Constraints (critical)

- Segment 7 bytes MUST be a pure function of cohort `io:{companyId}:{process}:v{schemaVersion}` plus the tenant skill store — NEVER work, delegation, clocks, ids, or dynamic tail. Inverse tests: same cohort + different work/delegation/insertion-order/non-matching entries ⇒ byte-identical prefix. Promotion changes bytes = cache MISS, never stale serve.
- `packages/context` deps stay exactly `@io/business-domain` (boundary test relaxes `import type`-only for the `activeSkillsFor` value import). `business-domain` zero `@io/*`; `openai` confined to `llm-client`; no new runtime deps; append-only skill history.

## Affected Areas

| Area | Change |
|------|--------|
| `packages/context/src/{segments,index}.ts` | `skills?` input; segment 7 render; bump 1→2; relocate version const |
| `packages/context/test/*` | Boundary relaxation; golden `prefix.v2`; cohort/inverse tests |
| `packages/app/src/worker/*`, `composition/worker-deps.ts` | `skills` port; fetch; pass-through; wire `PgSkillRepository` |
| `packages/app/test/*`, `business-domain/test/skill.test.ts` | Seam assertions; `:v1`→`:v2`; R7 test → new contract |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope drift into heartbeats | High | Hold Option B boundaries |
| Silent prefix change | Low | Schema bump + golden pin (R6) |
| Boundary relaxation misread | Med | Documented; manifest declares the dep |
| `:v1`→`:v2` test churn | Med | Enumerate in tasks |

## Rollback Plan

Revert the two stacked PRs in reverse (worker seam, then context); restoring version 1 and the ABSENT render returns `prefix.v1.golden.txt` bytes. No persisted data changes (skills read-only here).

## Dependencies

- Archived `context-compiler` and `first-skill` slices (done).

## Success Criteria

- [ ] Segment 7 renders cohort-selected skills; empty selection ⇒ ABSENT.
- [ ] `CONTEXT_SCHEMA_VERSION` is 2; `prefix.v2.golden.txt` pins the bytes.
- [ ] Inverse tests prove same cohort ⇒ byte-identical prefix.
- [ ] Worker passes skills into `compileContext`; sequential suite green (~922+).
