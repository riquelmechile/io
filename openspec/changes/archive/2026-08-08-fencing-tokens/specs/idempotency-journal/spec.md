# Delta for idempotency-journal

## MODIFIED Requirements

### Requirement: Journal Status Domain and Pre-Effect Lookup Decision Table

Journal status MUST be exactly `in_flight | aborted_retryable | completed`. `insertInFlight` MUST precede the effect and store the claim fencing token. `complete` MUST transition only an `in_flight` row, MUST reject any other status without mutation, and MUST NOT require token ownership. Lookup MUST resolve: absent → fresh attempt; matching `completed` → token-free REPLAY; mismatching `completed` → DENY; `in_flight` → attempt-in-flight. Tenant scope, uniqueness, and fake/PostgreSQL parity MUST hold. Existing rows MUST validly default to token 0. [REQ] [INF]
(Previously: Rows had no fencing token and completion had no status guard.)

#### Scenario: Same key and same hash replays the stored result
- GIVEN matching `completed` row
- WHEN lookup runs without a token
- THEN stored result MUST replay without effect

#### Scenario: Same key and different hash is denied
- GIVEN differing-hash `completed` row
- WHEN lookup runs
- THEN it MUST DENY

#### Scenario: In-flight attempt is never replayed
- GIVEN an `in_flight` row
- WHEN lookup runs
- THEN it MUST report attempt-in-flight

#### Scenario: Fresh key records in-flight before the effect
- GIVEN no row and claim token N
- WHEN `insertInFlight` runs
- THEN `in_flight` with token N MUST persist before effect

#### Scenario: Tenant scope enforced on lookup
- GIVEN tenant A owns a row
- WHEN empty scope or tenant B looks up
- THEN empty scope MUST reject and tenant B MUST see no row

#### Scenario: Status guard preserves honest unresolved close
- GIVEN an `in_flight` row and stale-holder honest T2(ii) reconciliation
- WHEN `complete` stores `UNRESOLVED_REQUIRES_HUMAN`
- THEN completion MUST succeed without a token check

#### Scenario: Completion rejects non-in-flight status
- GIVEN a `completed` or `aborted_retryable` row
- WHEN `complete` runs
- THEN it MUST reject and leave the row unchanged

#### Scenario: Pre-fencing row remains valid
- GIVEN an existing row defaulted to token 0
- WHEN resumed without a fresh claim
- THEN token 0 MUST be retained and valid

### Requirement: Retryable Marker on Finalize CAS Loss

After an applied effect and finalize CAS loss while Work remains `in_progress`, `markRetryable` MUST change `in_flight` to durable `aborted_retryable` only when the supplied token equals the stored token. A stale token MUST be rejected without mutation. Controlled retry MUST retain that same token without re-claim or increment. PostgreSQL and fake MUST behave identically. [REQ] [INF]
(Previously: `markRetryable` checked status but not claim ownership or same-token retry.)

#### Scenario: Marker set on CAS loss with applied effect and in-progress work
- GIVEN applied effect, in-progress Work, and matching token N
- WHEN `markRetryable` runs
- THEN `aborted_retryable` MUST persist

#### Scenario: Marker is distinct from in-flight and completed
- GIVEN a retryable row
- WHEN status is inspected
- THEN it MUST be neither `in_flight` nor `completed`

#### Scenario: Marker survives a restart
- GIVEN marker stored in PostgreSQL 18.4
- WHEN process restarts
- THEN `aborted_retryable` MUST remain

#### Scenario: Stale token cannot mark retryable
- GIVEN stored token N + 1
- WHEN `markRetryable` supplies N
- THEN it MUST reject and preserve status and result

#### Scenario: Fake and PostgreSQL parity
- GIVEN equivalent journal rows in fake and PostgreSQL
- WHEN matching, stale, and token-0 writes run
- THEN decisions and stored rows MUST match

#### Scenario: Controlled retry retains its token
- GIVEN `aborted_retryable` row with token N
- WHEN a same-key retry resumes
- THEN it MUST use N without a fresh claim or increment
