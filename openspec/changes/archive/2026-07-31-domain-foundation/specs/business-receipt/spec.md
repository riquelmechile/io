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

A BusinessReceipt MUST carry `receiptId`, `workId`, `delegationId`, `actor`,
`policyHash`, `evidenceRefs`, `terminalState`, `artifactHash`, and `issuedAt`.
The `workId` and `delegationId` MUST be neutral string IDs. The receipt MUST
record the terminal state reached by the work it covers. [ADR-0002] [INF]

#### Scenario: Complete receipt fields

- GIVEN a terminal work outcome under a delegation authority
- WHEN a BusinessReceipt is issued
- THEN it MUST contain `workId`, `delegationId`, `actor`, `policyHash`, `evidenceRefs`, `terminalState`, `artifactHash`, and `issuedAt`

#### Scenario: Missing required field rejected

- GIVEN a BusinessReceipt missing `policyHash` or `artifactHash`
- WHEN validated
- THEN it MUST be rejected as invalid

### Requirement: Single Issuance

A BusinessReceipt MUST be issued exactly once for a given terminal event. The
repository MUST NOT accept a second save for the same `receiptId`. No re-issue
MUST be possible after the first successful write. [INF]

#### Scenario: First issuance succeeds

- GIVEN a terminal work event with no existing receipt
- WHEN a BusinessReceipt is saved for the first time
- THEN it MUST be persisted successfully

#### Scenario: Duplicate issuance rejected

- GIVEN a `receiptId` that already exists in the repository
- WHEN a second save is attempted with the same `receiptId`
- THEN it MUST be rejected and the original receipt MUST remain unchanged
