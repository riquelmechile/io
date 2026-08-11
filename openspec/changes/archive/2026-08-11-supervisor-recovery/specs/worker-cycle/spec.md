# Delta for worker-cycle

## MODIFIED Requirements

### Requirement: Journal-Anchored Reconciliation

Recovery of designated `in_progress` Work MUST reconcile from the journal and durable undo evidence using the retained fencing token. W1 (no journal row and no effect evidence) MUST resume at pre-effect reconciliation. W2 (`in_flight`, no applied effect) MUST become `aborted_retryable` without undo. W3 (`in_flight`, applied effect) MUST undo before becoming `aborted_retryable`. Retryable outcomes MUST resume without re-claiming. Missing or contradictory evidence, failed undo, and other unsafe states MUST return a typed `UNRESOLVED_REQUIRES_HUMAN` disposition and MUST NOT re-execute the effect. Recovery MUST be idempotent when repeated. [REQ]
(Previously: Reconciliation treated no-effect recovery as token-free replay and did not define supervisor recovery for W1/W2/W3.)

#### Scenario: W1 resumes with no journal row
- GIVEN designated `in_progress` Work with no journal row and no effect evidence
- WHEN recovery runs
- THEN it MUST return a resumable disposition without undo or token minting

#### Scenario: W2 becomes retryable without undo
- GIVEN matching-token `in_flight` attempt and durable proof of no applied effect
- WHEN recovery runs
- THEN it MUST mark `aborted_retryable` without undo and permit same-token resume

#### Scenario: W3 undoes before retry
- GIVEN matching-token `in_flight` attempt with an applied effect
- WHEN recovery runs
- THEN it MUST undo first, mark `aborted_retryable`, and permit same-token resume

#### Scenario: Unresolvable terminal state is reported honestly
- GIVEN journal and undo evidence disagree after Work became terminal
- WHEN stale-holder reconciliation closes the `in_flight` row
- THEN `UNRESOLVED_REQUIRES_HUMAN` MUST persist despite stale token

#### Scenario: Applied-effect CAS loss sets the retryable marker
- GIVEN applied effect, in-progress Work, retained token N, and CAS loss
- WHEN reconciliation undoes and marks retryable with N
- THEN `aborted_retryable` MUST persist and same-token retry MUST remain possible

#### Scenario: Stale reconciliation token is rejected
- GIVEN journal ownership advanced from N to N + 1
- WHEN recovery supplies N
- THEN it MUST return a typed failure and leave the row unchanged

#### Scenario: Missing evidence or undo failure escalates
- GIVEN recovery evidence is unavailable or required undo fails
- WHEN recovery evaluates the attempt
- THEN it MUST return `UNRESOLVED_REQUIRES_HUMAN` and MUST NOT resume the effect

#### Scenario: Recovery is idempotent on re-tick
- GIVEN recovery already produced a retryable, terminal, or unresolved disposition
- WHEN the same designation is evaluated again
- THEN no second undo, effect, or terminal mutation MUST occur
