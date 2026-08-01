# Proposal: first-skill — Versioned Skill Definition + Cohort-Safe Activation

## Intent

IO workers need durable procedural knowledge the stateless model cannot supply (§3.10/§9.1). A skill is versioned, declarative procedural knowledge with explicit states — tenant-scoped, safe for the KV-cache stable prefix (§7.2 segment 7). No Skill concept exists. This slice ships DECLARED + SELECTED: a durable store plus deterministic selection — BusinessEvent's write-side twin, segment 7's exact input.

## Scope

### In Scope
- `Skill` type (skillId, companyId, name, version, body, scope, state `draft|active|retired`, timestamps) in `packages/business-domain`, zero `@io/*`.
- Versioned `SkillRepository` port (append-new-version `save`, `get` latest, tenant-scoped `listByCompany`) + `InMemorySkillRepository` fake.
- Pure, cohort-safe `activeSkillsFor(...)` selecting only on companyId, process, schemaVersion, state.
- `PgSkillRepository` (INSERT-only) + `parseSkillRow` + `007_skills.sql` (UNIQUE(company_id, skill_id, version)) in `packages/database`.
- Unit, sequential live-PG round-trip, boundary, purity tests.

### Out of Scope
- Segment-7 wiring + `CONTEXT_SCHEMA_VERSION` bump + golden regen (next slice).
- Worker activation/execution + `buildWorkerDeps` wiring (B).
- Skill outcome/activation BusinessEvents; heartbeats.
- Learning/promotion (Increment 8); Memory OS; seed content.
- Extraction to `competency/` (recorded target).

## Capabilities

### New Capabilities
- `skill`: versioned definition store, explicit lifecycle states, tenant-scoped reads, cohort-safe activation.

### Modified Capabilities
- None — `context-compiler`, `worker-cycle`, `business-event` unchanged (compiler untouched).

## Approach

Approach A (recommended): definition + versioned registry + deterministic activation in `business-domain`, persisted by `packages/database`, no compiler/worker wiring; mirrors BusinessEvent. Rationale: smallest honest slice; invariants structurally safe (compiler untouched ⇒ cohort safe, domain pure, no new deps); proves DECLARED + SELECTED. B (worker) is incoherent without segment 7; C (segment 7) is forbidden this slice — the next step.

## Affected Areas

- `packages/business-domain`: `types.ts` (+`Skill`), `ports/repositories.ts` (+port), `ports/fakes.ts` (+fake), `index.ts` (exports), new `test/skill.test.ts`.
- `packages/database`: new `sql/007_skills.sql` + `src/skill-adapter.ts`; `row-guards.ts` (+`parseSkillRow`); `index.ts` (exports); round-trip + boundary + sql-migrations tests.

## Constraints / Invariants

- No agentic/business frameworks; no new runtime deps; `openai` confined to `llm-client`; `business-domain` zero `@io/*`; `packages/context` deps stay `@io/business-domain`.
- Versioned no-overwrite (§9.2): new version = new row; INSERT-only; boundary guard forbids UPDATE/DELETE.
- States `draft|active|retired`, only `active` selectable; tenant scoped (ADR-0002): non-empty companyId, scoped reads.
- Activation is a pure function of the cohort (§7.2/§7.3; R2/R6 cache-poisoning precedent): dynamic input cannot change selection.
- `compileContext` untouched, segment 7 ABSENT; human constitutional authority over capital/secrets/limits unaffected (principle 1).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope drift into segment 7 / worker / heartbeats | High | DECLARE + SELECT only (A) |
| Cache poisoning if activation feeds segment 7 | Med | Compiler untouched; test enforces dynamic input ignored |
| Versioning ambiguity (upsert vs append) | Med | UNIQUE + INSERT-only from the start |
| Budget pressure (~250–400 lines) | Med | Focused tests; auto-chain 2 stacked PRs (domain, database) |

## Rollback Plan

Additive only: revert the PR(s) to remove type, port, fake, adapter, tests; drop `007_skills.sql` (nothing depends on it).

## Dependencies

- Live PostgreSQL `postgresql://io:io_dev@localhost:5432/io_dev` (sequential round-trip; skip if unreachable).

## Success Criteria

- [ ] `Skill` has explicit states + version; `activeSkillsFor` pure (same cohort ⇒ same set, dynamic input ignored, test-proven).
- [ ] INSERT-only versioned persistence; UNIQUE(company_id, skill_id, version); boundary guard green.
- [ ] `PATH=/data/node24/bin:$PATH pnpm check` green; sequential PG round-trip green; ~868 baseline preserved.
