# Delta for business-receipt

## MODIFIED Requirements

### Requirement: Receipt Links Authority, Work, and Outcome

A BusinessReceipt MUST carry `receiptId`, `companyId`, `workId`, `delegationId`,
`actor`, `policyHash`, `evidenceRefs`, `terminalState`, `terminalEventId`,
`artifactHash`, and `issuedAt`. The `companyId`, `workId`, `delegationId`, and
`terminalEventId` MUST be neutral string IDs; `companyId` MUST be non-empty. The
`terminalEventId` MUST identify the terminal event (the attempt) that closed the
work. The receipt MUST record the terminal state reached by the work it covers.
[ADR-0002] [INF]
(Previously: receipt carried no `companyId` and no `terminalEventId`.)

#### Scenario: Complete receipt fields

- GIVEN a terminal work outcome under a delegation authority
- WHEN a BusinessReceipt is issued
- THEN it MUST contain `companyId`, `workId`, `delegationId`, `actor`, `policyHash`, `evidenceRefs`, `terminalState`, `terminalEventId`, `artifactHash`, and `issuedAt`

#### Scenario: Missing required field rejected

- GIVEN a BusinessReceipt missing `policyHash` or `artifactHash`
- WHEN validated
- THEN it MUST be rejected as invalid

#### Scenario: Receipt carries companyId

- GIVEN a terminal work outcome belonging to a company
- WHEN a BusinessReceipt is issued
- THEN it MUST carry the non-empty `companyId` of the company that owns the work

### Requirement: Single Issuance

A BusinessReceipt MUST be issued exactly once for a given terminal event. The
repository MUST NOT accept a second save for the same `receiptId`. A single
terminal close MUST be enforced per work via a `UNIQUE (work_id, terminal_event_id)`
constraint: a second receipt for the same `(work_id, terminal_event_id)` pair MUST
be rejected even if it carries a different `receiptId`. No re-issue MUST be
possible after the first successful write. [INF]
(Previously: uniqueness was keyed only on `receiptId`; duplicate receipts for the same work + terminal event were possible.)

#### Scenario: First issuance succeeds

- GIVEN a terminal work event with no existing receipt
- WHEN a BusinessReceipt is saved for the first time
- THEN it MUST be persisted successfully

#### Scenario: Duplicate receiptId rejected

- GIVEN a `receiptId` that already exists in the repository
- WHEN a second save is attempted with the same `receiptId`
- THEN it MUST be rejected and the original receipt MUST remain unchanged

#### Scenario: Duplicate work and terminal event rejected

- GIVEN a persisted receipt for `(work_id, terminal_event_id)`
- WHEN a second receipt is attempted for the same `(work_id, terminal_event_id)` pair, even with a different `receiptId`
- THEN it MUST be rejected by the `UNIQUE (work_id, terminal_event_id)` constraint and the original receipt MUST remain unchanged
