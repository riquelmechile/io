# Delta for work-lifecycle

## ADDED Requirements

### Requirement: Tenant-Scoped Actionable Work Selection

`ACTIONABLE_WORK_STATES` MUST be `readonly ['accepted']`, mirroring `MATERIAL_EVENT_TYPES`. `listActionableByCompany(companyId)` MUST return that tenant's accepted Work in insertion order and reject empty scope before reading storage. Business-domain MUST retain zero `@io/*` imports.

#### Scenario: Accepted Work is returned oldest first
- GIVEN mixed-state, mixed-tenant Work
- WHEN `listActionableByCompany(companyId)` is called
- THEN only scoped accepted Work MUST appear, in insertion order

#### Scenario: No actionable Work returns empty
- GIVEN no accepted Work
- WHEN its actionable Work is listed
- THEN the result MUST be empty

#### Scenario: Empty tenant scope fails before access
- GIVEN empty `companyId` and observable storage
- WHEN actionable Work is listed
- THEN rejection MUST precede every store read
