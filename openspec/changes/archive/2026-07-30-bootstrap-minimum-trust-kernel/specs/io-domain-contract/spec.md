# Delta for io-domain-contract

## ADDED Requirements

### Requirement: Transitional Package Boundary

`packages/trust-kernel/` is a transitional package that concentrates the minimum
in-memory authority-evaluation behavior before canonical package extraction. It
MUST NOT be classified as a 31st canonical package and MUST NOT alter the
8+12+10=30 partition defined in "Primary-Responsibility Classification." Its
domain logic (identity, risk classification, authority, SOD, evidence, receipts,
audit) MUST be extracted into the canonical packages `organization/`, `policy/`,
`approvals/`, `evidence/`, `receipts/`, and `audit/` at a later increment
(persistence/first-vertical); the extraction target MUST be recorded and
re-validated under package change pressure. While transitional, it MUST remain a
pure in-memory, persistence-free, adapter-free module. [INF]

#### Scenario: Not a canonical package

- GIVEN `packages/trust-kernel/`
- WHEN the 30-package classification is inspected
- THEN it MUST be excluded from the canonical partition and documented as transitional

#### Scenario: Extraction target recorded

- GIVEN the transitional package
- WHEN reviewed
- THEN the planned extraction into `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/` MUST be documented and re-validated under change pressure
