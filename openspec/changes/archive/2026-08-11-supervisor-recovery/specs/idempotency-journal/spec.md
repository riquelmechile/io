# Delta for idempotency-journal

## MODIFIED Requirements

### Requirement: Retryable Marker on Finalize CAS Loss

For `in_flight` Work that remains `in_progress`, `markRetryable` MUST change the attempt to durable `aborted_retryable` when either an applied effect has been undone or durable evidence proves no effect was applied. The supplied token MUST equal the stored token; a stale token MUST return a typed failure without mutation. Abort MUST NOT call `complete`, store a completed result, or seal the key. Controlled retry MUST retain the same token without re-claim or increment. PostgreSQL and fake MUST behave identically. [REQ] [INF]
(Previously: `markRetryable` was specified only after an applied effect and finalize CAS loss.)

#### Scenario: Marker set after applied effect is undone
- GIVEN applied effect, in-progress Work, and matching token N
- WHEN undo succeeds and `markRetryable` runs
- THEN `aborted_retryable` MUST persist

#### Scenario: W2 abort requires no preceding undo
- GIVEN an `in_flight` attempt and durable evidence that no effect was applied
- WHEN `markRetryable` runs with matching token N
- THEN `aborted_retryable` MUST persist without invoking undo

#### Scenario: Marker is distinct from in-flight and completed
- GIVEN a retryable row
- WHEN status is inspected
- THEN it MUST be neither `in_flight` nor `completed`

#### Scenario: Marker survives a restart
- GIVEN marker stored in PostgreSQL 18.4
- WHEN the process restarts
- THEN `aborted_retryable` MUST remain

#### Scenario: Stale token cannot mark retryable
- GIVEN stored token N + 1
- WHEN `markRetryable` supplies N
- THEN it MUST return a typed failure and preserve status and result

#### Scenario: Fake and PostgreSQL parity
- GIVEN equivalent journal rows in fake and PostgreSQL
- WHEN matching, stale, and token-0 writes run
- THEN decisions and stored rows MUST match

#### Scenario: Controlled retry retains its token
- GIVEN `aborted_retryable` row with token N
- WHEN a same-key retry resumes
- THEN it MUST use N without a fresh claim or increment
