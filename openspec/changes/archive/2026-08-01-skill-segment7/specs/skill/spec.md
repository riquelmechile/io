# Delta for skill

## MODIFIED Requirements

### Requirement: Stable-Prefix Isolation

Cohort-selected active Skills MUST feed `compileContext` as segment 7 (`active-skills`). For a fixed append-only tenant skill-store state, rendered skill bytes MUST be a pure function only of cohort `io:{companyId}:{process}:v{schemaVersion}` and MUST NOT vary with work, delegation, clocks, identifiers, dynamic-tail content, or insertion order. Selection and rendering MUST be read-only and MUST NOT alter skill history. `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`; `business-domain` MUST retain zero `@io/*` dependencies, `openai` MUST remain confined to `llm-client`, and no new runtime dependency MAY be added. An empty selection MUST render segment 7 ABSENT with zero bytes.
(Previously: Skills could not feed `compileContext`, and segment 7 was required to remain ABSENT.)

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
