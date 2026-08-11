# Delta for io-persistence-recovery-contract

## MODIFIED Requirements

### Requirement: Recovery Matrix

The system MUST apply this authoritative recovery matrix. Retry requires durable proof of non-execution or successful compensation; otherwise recovery MUST escalate without re-executing the effect.

| Failure | Safe action | Terminal condition | Human path |
|---|---|---|---|
| PG down mid-tx | Roll back; reject new mutations | PG restored | Verify no partial commit |
| W1: claimed, no journal row | Resume pre-effect with retained token | Completed or typed failure | Escalate if evidence missing |
| W2: `in_flight`, no applied effect | Token-matched `markRetryable`; resume | Retryable then completed | Escalate if proof missing |
| W3: `in_flight`, applied effect | Undo; token-matched `markRetryable`; resume | Retryable then completed | Escalate if undo fails |
| Worker crash after external call | Mark UNKNOWN; reconcile | Confirmed/no-exec/UNRESOLVED | Retry, compensate, or accept |
| Worker crash before external call | Release budget; no orphan pending | Reconciled or expired | None |
| Daemon disconnect | Mark UNKNOWN; reconcile | Confirmed/no-effect/UNRESOLVED | Retry or compensate |
| Lease expiry mid-workflow | Halt; no automatic effect retry | Proven safe or UNRESOLVED | Review, reassign, or cancel |
| Outbox max retries | Dead-letter; audit | Dead-letter created | Re-dispatch or mark failed |
| Non-compensable unknown | Halt; escalate | Human decision recorded | Retry, compensate, or accept |

(Previously: The matrix did not distinguish post-claim crash windows W1, W2, and W3.)

#### Scenario: Idempotency orphan ruled out
- GIVEN the recovery matrix coverage
- WHEN an idempotency pending orphan is considered
- THEN the atomic-commit invariant MUST rule it out without recovery action

#### Scenario: W1 resumes from proven pre-effect state
- GIVEN no journal row and durable proof that no effect ran
- WHEN designated recovery applies the matrix
- THEN it MUST resume with the retained token and MUST NOT re-claim

#### Scenario: W2 abort remains retryable
- GIVEN `in_flight` and durable proof that no effect ran
- WHEN designated recovery applies the matrix
- THEN it MUST mark retryable, never complete the abort, and permit resume

#### Scenario: W3 compensates before retry
- GIVEN `in_flight` and durable proof that an effect ran
- WHEN designated recovery applies the matrix
- THEN it MUST undo before marking retryable and resuming

#### Scenario: Unsafe recovery escalates
- GIVEN required evidence is missing or undo fails
- WHEN designated recovery applies the matrix
- THEN it MUST produce `UNRESOLVED_REQUIRES_HUMAN` and MUST NOT re-execute
