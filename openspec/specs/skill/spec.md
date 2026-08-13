# skill

## Purpose

Versioned declarative procedural knowledge — durable, tenant-scoped, cohort-safe activation for the IO worker's compiled context prefix. A skill is declared procedural memory that conditions the worker's reasoned plan; it is not executed directly but shapes what the worker produces.

This capability provides the definition store, deterministic selection and segment-7 rendering rules, and intent-captured outcome attribution (DECLARED + SELECTED + ATTRIBUTED). Learning/promotion and direct Skill execution remain outside this capability.

## Requirements

### Requirement: Pure Versioned Skill

`business-domain` MUST define an immutable `Skill` carrying `skillId`, `companyId`, `name`, `version`, `body`, `scope`, `state`, `createdAt`, and `updatedAt`. Construction MUST be deterministic from supplied values and MUST NOT read clocks or generate identifiers. The package MUST retain zero `@io/*` imports and no runtime dependencies; `openai` MUST remain confined to `llm-client`.

#### Scenario: Construction is deterministic and isolated

- GIVEN identical Skill values
- WHEN two Skills are constructed
- THEN they MUST be equal
- AND package boundaries MUST satisfy the dependency restrictions

### Requirement: Append-Only Versioned Registry

`SkillRepository` MUST expose only append-new-version `save`, tenant-scoped `get` of the latest version, and tenant-scoped `listByCompany` of persisted versions. It MUST NOT expose mutation operations; a duplicate `(companyId, skillId, version)` MUST fail without altering the original.

#### Scenario: Latest version is retrieved without overwriting history

- GIVEN versions 1 and 2 of a Skill are saved
- WHEN that Skill is retrieved
- THEN version 2 MUST be returned and both versions MUST remain listed

### Requirement: Versioned In-Memory Repository

`InMemorySkillRepository` MUST append versions, reject duplicate version identities, retain history, and enforce tenant-scoped reads without replacement.

#### Scenario: Fake preserves history and tenant isolation

- GIVEN interleaved Skill versions for companies A and B
- WHEN company A is listed and its Skill is retrieved
- THEN only company A versions MUST be returned and its latest version MUST be retrieved

### Requirement: Explicit Skill Lifecycle

Skill state MUST be `draft`, `active`, or `retired`; a guard MUST reject every other state. Only `active` Skills MAY be selected.

#### Scenario: Invalid and inactive states are excluded

- GIVEN draft, active, retired, and malformed Skill records
- WHEN records are validated and eligible Skills are selected
- THEN malformed records MUST be rejected and only active records MUST be selectable

### Requirement: Cohort-Safe Deterministic Activation

`activeSkillsFor({companyId, process, schemaVersion}, skills)` MUST purely select active Skills eligible for that cohort. Selection MUST depend solely on cohort values and Skill state/scope, never work, clocks, generated IDs, or dynamic-tail content.

#### Scenario: Same cohort produces the same set

- GIVEN identical Skills and identical cohort values
- WHEN activation is evaluated repeatedly
- THEN the selected Skill identities and versions MUST be identical

#### Scenario: Dynamic input cannot poison selection

- GIVEN identical Skills and cohort values but different work and dynamic-tail values
- WHEN activation is evaluated for both requests
- THEN the selected Skill identities and versions MUST remain identical

### Requirement: Insert-Only PostgreSQL Persistence

`PgSkillRepository` MUST write versions using `INSERT` only. `007_skills.sql` MUST create `skill` with non-null fields, `UNIQUE(company_id, skill_id, version)`, and a tenant index. `parseSkillRow` MUST reject malformed rows; a boundary guard MUST forbid adapter `UPDATE` and `DELETE` statements.

#### Scenario: PostgreSQL versions round-trip

- GIVEN two valid versions persisted to live PostgreSQL
- WHEN the tenant reads them through `parseSkillRow`
- THEN every field and both immutable versions MUST round-trip

#### Scenario: Mutation SQL and malformed rows are rejected

- GIVEN adapter source and a malformed database row
- WHEN boundary and row guards inspect them
- THEN `UPDATE` and `DELETE` MUST be absent and the row MUST be rejected

### Requirement: Tenant-Scoped Skill Access

Every Skill and read MUST carry a non-empty `companyId`. Reads MUST NOT reveal another company's Skills.

#### Scenario: Cross-tenant and empty scopes are rejected

- GIVEN Skills owned by companies A and B
- WHEN company A reads or an empty company scope is supplied
- THEN no company B Skill MUST be returned and the empty scope MUST be rejected

### Requirement: Stable-Prefix Isolation

Cohort-selected active Skills MUST feed `compileContext` as segment 7 (`active-skills`). For a fixed append-only tenant skill-store state, rendered skill bytes MUST be a pure function only of cohort `io:{companyId}:{process}:v{schemaVersion}` and MUST NOT vary with work, delegation, clocks, identifiers, dynamic-tail content, or insertion order. Selection and rendering MUST be read-only and MUST NOT alter skill history. `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`; `business-domain` MUST retain zero `@io/*` dependencies, `openai` MUST remain confined to `llm-client`, and no new runtime dependency MAY be added. An empty selection MUST render segment 7 ABSENT with zero bytes.

#### Scenario: Compiler renders cohort-selected skills
- GIVEN active matching Skills and non-matching or inactive Skills in the tenant store
- WHEN `compileContext` runs for the cohort
- THEN segment 7 MUST render only the matching selection without mutating history
- AND package runtime dependencies MUST satisfy the stated boundaries

#### Scenario: Dynamic input cannot poison rendered skills
- GIVEN the same cohort and tenant Skills in different insertion orders with different work, delegation, and dynamic-tail values
- WHEN both inputs are compiled
- THEN segment 7 and the complete stable prefix MUST be byte-identical

#### Scenario: No selected skills preserves absence
- GIVEN the tenant store has no Skill eligible for the cohort
- WHEN the input is compiled
- THEN segment 7 MUST be ABSENT and contribute zero bytes

### Requirement: Intent-Captured Skill Usage Outcomes

An activated Skill SHALL be attributable only through the exact `{ skillId, version }` selection captured at intent from the compiler. A verified successful Work close SHALL emit one composite `work.skill-outcome` fact for that selection, including an empty selection; it SHALL NOT fan out one event per Skill. The selection SHALL NOT be re-evaluated at finalization. Failed or typed non-success paths SHALL emit no outcome. This requirement SHALL NOT define promotion, learning, expected-outcome comparison, consumer behavior, or a backfill.

#### Scenario: Captured version is attributed
- GIVEN intent selected a Skill at version 1 and version 2 becomes active before close
- WHEN the Work closes successfully
- THEN the emitted composite fact SHALL attribute version 1 only

#### Scenario: Failure emits no usage outcome
- GIVEN an intent has selected Skills
- WHEN the cycle ends as invalid-plan, denied, or recovery-required
- THEN no `work.skill-outcome` fact SHALL be emitted

#### Scenario: Historical Work remains untouched
- GIVEN Work completed before usage outcomes were introduced
- WHEN skills or event discovery are read
- THEN no outcome SHALL be synthesized for that Work
