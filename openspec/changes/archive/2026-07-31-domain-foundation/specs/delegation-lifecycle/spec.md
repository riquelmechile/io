# delegation-lifecycle Specification

## Purpose

Delegation is a business authority commitment — separate from Work — that owns
delegator, delegate, authority scope, budget, duration, expected outcome, and a
guarded lifecycle. Delegation and Work share no aggregate boundary; receiving
work MUST NOT grant authority. [ADR-0002] [INF]

## Requirements

### Requirement: Delegation Authority Fields

A Delegation MUST carry `delegationId`, `delegator`, `delegate`,
`authorityScope`, `budget`, `validFrom`, `validUntil`, `expectedOutcome`, and
`state`. Authority scope and budget MUST be explicit before the delegation
becomes active. All actor references MUST be stable strings. [ADR-0002] [INF]

#### Scenario: Active delegation with all fields

- GIVEN a delegation with delegator, delegate, authority scope, budget, duration, and expected outcome
- WHEN transitioned to active
- THEN it MUST be accepted as a valid active delegation

#### Scenario: Missing required field rejected

- GIVEN a delegation missing budget or authority scope
- WHEN evaluated for activation
- THEN it MUST be rejected as invalid

### Requirement: Delegation State Machine

A Delegation MUST follow the lifecycle `draft → active → revoked | expired`.
Transitions NOT in this set MUST be rejected. Terminal states (`revoked`,
`expired`) MUST reject all further transitions. [ADR-0002] [INF]

#### Scenario: Draft to active

- GIVEN a delegation in state `draft`
- WHEN transitioned to `active`
- THEN the state MUST become `active`

#### Scenario: Invalid transition rejected

- GIVEN a delegation in state `draft`
- WHEN a transition to `completed` is attempted
- THEN the transition MUST be rejected and the state MUST remain `draft`

#### Scenario: Terminal state frozen

- GIVEN a delegation in state `revoked`
- WHEN any transition is attempted
- THEN it MUST be rejected

### Requirement: Delegation-Work Aggregate Separation

Delegation MUST NOT import or reference the Work aggregate. The Delegation
package MUST be self-contained with zero runtime dependencies on Work.
Cross-aggregate coordination MUST be performed by the application layer, not by
aggregate imports. [ADR-0002] [INF]

#### Scenario: No Work dependency

- GIVEN the Delegation type and its package
- WHEN its imports are inspected
- THEN it MUST NOT import Work or any Work-related type

### Requirement: Work Does Not Grant Authority

Receiving, holding, or executing work MUST NOT grant ambient authority to the
holder. Authority to act MUST be evaluated independently of work assignment.
[ADR-0002]

#### Scenario: Work assignment without authority

- GIVEN a principal who has received a work assignment
- WHEN that principal's authority to act is evaluated
- THEN no authority MUST be implied by the work assignment alone
