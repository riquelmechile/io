# Delta for company-identity

## ADDED Requirements

### Requirement: Mandatory Company Tenant Scope on Business Operations

Every business operation (create, read, transition, receipt issuance) on
Delegation, Work, and BusinessReceipt MUST be scoped by a mandatory `companyId`.
Repository read methods MUST require `companyId` as a parameter and MUST return
nothing for a row whose `companyId` does not match. An unscoped read MUST be
impossible to express against the repository port (the `companyId` parameter is
required, not optional). The `companyId` MUST be a neutral string ID carried on
each business aggregate, never an import of the Company aggregate. [ADR-0002]
[INF]

#### Scenario: Scoped read returns only matching rows

- GIVEN two Work rows with different `companyId` values and the same `workId` namespace
- WHEN a repository read is performed with one `companyId`
- THEN only the row matching that `companyId` MUST be returned

#### Scenario: Unscoped read is impossible

- GIVEN the Work, Delegation, and BusinessReceipt repository ports
- WHEN their read method signatures are inspected
- THEN each MUST require a `companyId` parameter (no overload or default omits it)

#### Scenario: Cross-company access rejected

- GIVEN a Work belonging to company A
- WHEN a read is attempted with company B's `companyId`
- THEN the result MUST be `undefined` (no cross-tenant leak)
