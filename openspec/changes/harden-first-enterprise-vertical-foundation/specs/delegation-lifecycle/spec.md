# Delta for delegation-lifecycle

## ADDED Requirements

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

## MODIFIED Requirements

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
