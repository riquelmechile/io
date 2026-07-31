# delegation-lifecycle Specification

## Purpose

Delegation is a business authority commitment — separate from Work — that owns
delegator, delegate, authority scope, budget, duration, expected outcome, and a
guarded lifecycle. Delegation and Work share no aggregate boundary; receiving
work MUST NOT grant authority. [ADR-0002] [INF]

## Requirements


### Requirement: Delegation Authority Fields

A Delegation MUST carry `delegationId`, `companyId`, `delegator`, `delegate`,
`authorityScope`, `budget`, `validFrom`, `validUntil`, `expectedOutcome`, and
`state`. Authority scope and budget MUST be explicit before the delegation
becomes active. All actor references MUST be stable strings. The `companyId`
MUST be a non-empty neutral string ID scoping the delegation to its tenant.
[ADR-0002] [INF]

(Previously: the Delegation had no `companyId` field; operations were
tenant-unscoped.)

#### Scenario: Active delegation with all fields

- GIVEN a delegation with companyId, delegator, delegate, authority scope, budget, duration, and expected outcome
- WHEN transitioned to active
- THEN it MUST be accepted as a valid active delegation

#### Scenario: Missing required field rejected

- GIVEN a delegation missing budget, authority scope, or companyId
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

### Requirement: Delegation Company Scope

A Delegation MUST carry a mandatory `companyId` (neutral string ID). All
Delegation repository operations MUST be scoped by `companyId`. A delegation
MUST NOT import the Company aggregate; the `companyId` is attribution only.
[ADR-0002] [INF]

#### Scenario: Delegation carries company scope

- GIVEN a Delegation created for a company
- WHEN inspected
- THEN it MUST carry a non-empty `companyId` and the read MUST be scoped by it

### Requirement: Delegation Activation Window

A Delegation MUST be considered active only within its `[validFrom, validUntil)`
window relative to `now`. A delegation whose `validFrom` is after `now` MUST be
treated as not-yet-active even if structurally valid. The activation-window
check MUST reuse the trust-kernel `isWindowActive` semantics (single source of
truth for the start/expiry window rule). [ADR-0001] [ADR-0002]

#### Scenario: Future-start delegation not active

- GIVEN a structurally valid delegation whose `validFrom` is after `now`
- WHEN its activation is evaluated at `now`
- THEN it MUST be treated as not active

#### Scenario: Currently active delegation

- GIVEN a delegation with `validFrom <= now` and `validUntil > now`
- WHEN its activation is evaluated at `now`
- THEN it MUST be active
