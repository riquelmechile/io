# Delta for trust-kernel

## ADDED Requirements

### Requirement: Activation Window Gate

A grant or temporary assignment whose `start` is in the future (relative to
`now`) MUST be treated as NOT active, even when structurally valid and
unexpired. The kernel MUST expose a single shared helper
`isWindowActive(start, now, expiry)` (in `model.ts`, alongside
`validateBoundedWindow`) that returns `true` only when `start <= now` AND
`expiry > now`. The grant active-check (`grant.ts`), the temporary-assignment
resolver (`identity.ts`), and pipeline step 12 MUST all use this helper so an
activation-window violation is DENIED at a single source of truth. [ADR-0001]
[INF]

#### Scenario: Future-start grant rejected at step 12

- GIVEN a structurally valid, non-revoked grant whose `start` is after `now`
- WHEN the action is evaluated through the pipeline
- THEN step 12 MUST DENY with a window reason and the grant MUST grant no authority

#### Scenario: Currently active grant allowed

- GIVEN a valid grant with `start <= now` and `expiry > now`
- WHEN `isWindowActive(start, now, expiry)` is evaluated
- THEN it MUST return `true` and the grant MUST remain active

#### Scenario: Future-start temp role inactive

- GIVEN a principal with a temporary assignment whose `start` is after `now`
- WHEN `resolveActiveIdentity` runs at `now`
- THEN the assignment MUST be excluded from the active identity

## MODIFIED Requirements

### Requirement: In-Memory Separation of Duties

SOD MUST be enforced per risk tier. No principal MAY self-approve or self-verify
at ANY tier. The proposer and approver MUST be distinct principals at every
tier; the approver and executor MUST be distinct; the verifier and executor MUST
be distinct. Medium-risk proposer/approver/executor/verifier MUST be mutually
distinct; critical and high-risk MUST use five distinct principals; low-risk MAY
combine roles only when policy permits, but the absolute proposer≠approver,
approver≠executor, and verifier≠verifier-actor pairs MUST still hold. Every
prohibited role overlap MUST produce a DENY. [ADR-0003]

(Previously: only approver≠executor and verifier≠executor were absolute pairs;
proposer≠approver was missing, so self-approval was allowed at low risk with the
combination policy.)

#### Scenario: Self-approval denied

- GIVEN one principal acting as both proposer and approver at low risk with the combination policy allowed
- WHEN SOD is checked
- THEN the action MUST be DENIED because proposer and approver share a principal

#### Scenario: Self-approval denied at every tier

- GIVEN the same principal assigned to both proposer and approver
- WHEN SOD is checked at low, medium, high, and critical risk
- THEN the action MUST be DENIED at every tier

#### Scenario: Distinct proposer and approver allowed

- GIVEN distinct principals for proposer and approver satisfying all tier distinctness
- WHEN SOD is checked
- THEN the action MUST be ALLOWED

#### Scenario: Self-verification denied

- GIVEN one principal acting as both verifier and executor
- WHEN SOD is checked
- THEN the action MUST be DENIED
