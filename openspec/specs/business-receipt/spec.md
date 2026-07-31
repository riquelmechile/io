# business-receipt Specification

## Purpose

BusinessReceipt is an immutable, persisted record that links terminal Work state
to the Delegation authority, actor identity, policy, evidence, and artifact hash.
It is distinct from the trust kernel's `UnsignedInMemoryReceipt` — it is durable,
issued once, and MUST NOT be updated. [ADR-0002] [INF]

## Requirements


### Requirement: Immutable Persisted Receipt

A BusinessReceipt MUST be persisted and immutable. It MUST NOT share identity
with the kernel's `UnsignedInMemoryReceipt`. Once written, a receipt MUST NOT be
modified, overwritten, or re-issued. [INF]

#### Scenario: Receipt persisted

- GIVEN a BusinessReceipt saved to a repository
- WHEN retrieved by its `receiptId`
- THEN the returned receipt MUST match every field of the saved receipt

#### Scenario: No update path

- GIVEN a BusinessReceipt that has been persisted
- WHEN any update or overwrite is attempted through the repository
- THEN the attempt MUST NOT alter the original receipt

### Requirement: Receipt Links Authority, Work, and Outcome

A BusinessReceipt MUST carry `receiptId`, `workId`, `delegationId`, `companyId`,
`actor`, `policyHash`, `evidenceRefs`, `terminalEventId`, `terminalState`,
`artifactHash`, and `issuedAt`. The `workId`, `delegationId`, and `companyId`
MUST be neutral string IDs. The `terminalEventId` MUST uniquely identify the
terminal work event the receipt covers. The receipt MUST record the terminal
state reached by the work it covers. [ADR-0002] [INF]

(Previously: the receipt had no `companyId` and no `terminalEventId`; it could
not enforce single-issuance per terminal event.)

#### Scenario: Complete receipt fields

- GIVEN a terminal work outcome under a delegation authority
- WHEN a BusinessReceipt is issued
- THEN it MUST contain `workId`, `delegationId`, `companyId`, `actor`, `policyHash`, `evidenceRefs`, `terminalEventId`, `terminalState`, `artifactHash`, and `issuedAt`

#### Scenario: Missing required field rejected

- GIVEN a BusinessReceipt missing `policyHash`, `artifactHash`, or `terminalEventId`
- WHEN validated
- THEN it MUST be rejected as invalid

### Requirement: Single Issuance

A BusinessReceipt MUST be issued exactly once for a given terminal event. The
repository MUST enforce `UNIQUE(work_id, terminal_event_id)` so that no second
receipt MAY be written for the same work and terminal event, and MUST NOT accept
a second save for the same `receiptId`. No re-issue MUST be possible after the
first successful write. [INF]

(Previously: single-issuance was a port-level promise with no UNIQUE
constraint; duplicate `terminal_event_id` inserts were silently accepted.)

#### Scenario: First issuance succeeds

- GIVEN a terminal work event with no existing receipt
- WHEN a BusinessReceipt is saved for the first time
- THEN it MUST be persisted successfully

#### Scenario: Duplicate terminal event rejected

- GIVEN a `receiptId` that already exists OR a `(work_id, terminal_event_id)` pair that already has a receipt
- WHEN a second save is attempted
- THEN it MUST be rejected and the original receipt MUST remain unchanged

### Requirement: Receipt Company Scope

A BusinessReceipt MUST carry a mandatory `companyId` (neutral string ID). All
BusinessReceipt repository operations MUST be scoped by `companyId`. The receipt
MUST NOT import the Company aggregate; the `companyId` is attribution only.
[ADR-0002] [INF]

#### Scenario: Receipt carries company scope

- GIVEN a BusinessReceipt issued for a company
- WHEN inspected
- THEN it MUST carry a non-empty `companyId` and reads MUST be scoped by it
