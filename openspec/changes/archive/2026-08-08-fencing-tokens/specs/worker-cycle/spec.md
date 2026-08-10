# Delta for worker-cycle

## MODIFIED Requirements

### Requirement: Single-Winner Claim via Compare-And-Swap

The worker MUST claim through `startWork` with `expectedVersion`. The winner MUST mint and return the next server-side fencing token; losers MUST receive `version-conflict` and MUST NOT execute an effect. Resume without a fresh claim MUST retain the token. The token MUST NOT enter compiled context bytes. Business-domain MUST retain zero `@io/*` imports, and no runtime dependency MAY be added. [REQ]
(Previously: Claim selected one winner but produced no fencing token.)

#### Scenario: Exactly one winner among concurrent workers
- GIVEN two workers claim the same version
- WHEN both invoke `startWork`
- THEN exactly one MUST receive token N + 1 and the other `version-conflict`

#### Scenario: Losing claimant does not proceed
- GIVEN claim returned `version-conflict`
- WHEN the cycle continues
- THEN no effect or receipt MUST occur

#### Scenario: Same-token resume preserves context bytes
- GIVEN a claimed cycle resumes without re-claim
- WHEN intent is compiled again
- THEN its token MUST be unchanged and compiled bytes MUST equal the token-free baseline

### Requirement: Atomic Terminal Close

The worker MUST close via `completeWorkAtomically`: journal decision → replay, DENY, or continue → token-checked Work CAS → one receipt → status-guarded journal completion, in one transaction. Replay MUST be token-free. Continue MUST supply the claim token; a stale token MUST roll back every terminal mutation. Exactly one receipt MUST exist per `(work_id, terminal_event_id)`. [REQ] [INF]
(Previously: Terminal close checked version but not claim token.)

#### Scenario: Replay returns the recorded result
- GIVEN completed matching journal data
- WHEN replay runs without a fencing token
- THEN result MUST return without effect, receipt, or event

#### Scenario: Hash mismatch under the same key is denied
- GIVEN completed journal data with a different hash
- WHEN close is attempted
- THEN it MUST be DENIED

#### Scenario: One receipt per terminal event
- GIVEN a terminal event was already closed
- WHEN close is repeated
- THEN no second receipt MUST be issued

#### Scenario: End-to-end happy path against live PostgreSQL
- GIVEN adapters, `FakeLlmClient`, and PostgreSQL
- WHEN the full cycle runs
- THEN terminal Work and exactly one receipt MUST persist

#### Scenario: Stale-token close rolls back atomically
- GIVEN token N + 1 owns Work and a holder supplies N
- WHEN terminal close runs
- THEN Work, journal, receipt, and event stores MUST remain unchanged

### Requirement: Journal-Anchored Reconciliation

After post-effect failure the worker MUST reconcile from journal and undo log. Applied effects MUST be undone before close; unapplied effects MUST retry via token-free replay. CAS loss while Work remains `in_progress` MUST call token-gated `markRetryable` with the retained token. Irreconcilable state MUST status-guardedly complete as `UNRESOLVED_REQUIRES_HUMAN` without requiring token ownership, preserving honest T2(ii) close. [REQ]
(Previously: Reconciliation carried no claim token and journal writes were unfenced.)

#### Scenario: Applied effect reversed then attempt closed
- GIVEN effect applied and terminal transaction failed
- WHEN reconciliation runs
- THEN it MUST undo and then close the attempt

#### Scenario: No effect applied leads to clean replay
- GIVEN undo log shows no applied effect
- WHEN reconciliation runs
- THEN it MUST use token-free replay and MUST NOT undo

#### Scenario: Unresolvable state reported honestly
- GIVEN journal and undo log disagree irreconcilably after Work became terminal
- WHEN stale-holder reconciliation closes an `in_flight` row
- THEN `UNRESOLVED_REQUIRES_HUMAN` MUST persist despite stale token

#### Scenario: CAS loss with applied effect and in-progress work sets the retryable marker
- GIVEN applied effect, in-progress Work, retained token N, and CAS loss
- WHEN reconciliation calls `markRetryable` with N
- THEN `aborted_retryable` MUST persist and same-token retry MUST remain possible

#### Scenario: Stale reconciliation token is rejected
- GIVEN journal ownership advanced from N to N + 1
- WHEN `markRetryable` supplies N
- THEN it MUST reject the write and leave the row unchanged
