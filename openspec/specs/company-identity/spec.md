# company-identity Specification

## Purpose

Company identity provides the tenant scope boundary for all business-domain
aggregates. A Company carries minimal identity (`companyId`, `purpose`) and does
NOT act as a global aggregate root, container, or parent over Delegation, Work,
or BusinessReceipt. [ADR-0002] [INF]

## Requirements

### Requirement: Minimal Company Identity

A Company MUST expose exactly `companyId` and `purpose`. Both fields MUST be
non-empty strings. The type MUST carry no framework dependency, no persistence
concern, and no reference to other aggregates. [INF]

#### Scenario: Valid company

- GIVEN a company with a non-empty `companyId` and a non-empty `purpose`
- WHEN validated
- THEN it MUST be accepted as valid

#### Scenario: Empty fields rejected

- GIVEN a company with an empty `companyId` or an empty `purpose`
- WHEN validated
- THEN it MUST be rejected as invalid

### Requirement: Scope Boundary, Not Global Aggregate

A Company MUST function as a tenant scope boundary. It MUST NOT own, contain,
or transitively reference Delegation, Work, or BusinessReceipt aggregates. No
business aggregate MUST import or reference the Company aggregate as a parent.
Company identity MAY be carried as a neutral string ID by other aggregates for
attribution. [ADR-0002] [INF]

#### Scenario: No aggregate parent

- GIVEN the Company type
- WHEN its fields and exports are inspected
- THEN it MUST NOT contain collections, back-references, or imports of Delegation, Work, or BusinessReceipt

#### Scenario: ID-based attribution only

- GIVEN a business aggregate that needs tenant attribution
- WHEN it references a Company
- THEN it MUST carry only a neutral string `companyId` and MUST NOT import the Company aggregate
