# Delta for company-identity

## ADDED Requirements

### Requirement: Tenant-Scoped Operations

Every business operation and repository lookup MUST be scoped by a mandatory,
non-empty `companyId`. A scoped lookup MUST return only entities belonging to the
requested company; an entity belonging to a different company MUST NOT be returned
(the lookup MUST resolve to not-found or an explicit rejection). A lookup or write
with an empty or missing `companyId` MUST be rejected. Company scope MUST be
carried as a neutral string ID; enforcing this MUST NOT introduce an aggregate
import of the Company type. [ADR-0002] [INF]

#### Scenario: Create with companyId

- GIVEN a business entity created under a non-empty `companyId`
- WHEN it is written and then read back under the same `companyId`
- THEN it MUST be returned successfully

#### Scenario: Scoped get for the wrong company is rejected

- GIVEN an entity that belongs to company A
- WHEN a scoped get is attempted under company B
- THEN the lookup MUST resolve to not-found or an explicit rejection and MUST NOT return company A's entity

#### Scenario: Empty companyId rejected

- GIVEN a scoped operation whose `companyId` is empty or missing
- WHEN the operation is invoked
- THEN it MUST be rejected and MUST NOT read or write any entity
