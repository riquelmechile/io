# Delta for delegation-lifecycle

## MODIFIED Requirements

### Requirement: Delegation Authority Fields

A Delegation MUST carry `companyId`, `delegationId`, `delegator`, `delegate`,
`authorityScope`, `budget`, `validFrom`, `validUntil`, `expectedOutcome`, and
`state`. The `companyId` MUST be a mandatory, non-empty neutral string identifying
the tenant scope. Authority scope and budget MUST be explicit before the delegation
becomes active. All actor references MUST be stable strings. [ADR-0002] [INF]
(Previously: Delegation carried no `companyId`; it was tenant-unscoped.)

#### Scenario: Active delegation with all fields

- GIVEN a delegation with a non-empty `companyId`, delegator, delegate, authority scope, budget, duration, and expected outcome
- WHEN transitioned to active
- THEN it MUST be accepted as a valid active delegation

#### Scenario: Missing required field rejected

- GIVEN a delegation missing budget or authority scope
- WHEN evaluated for activation
- THEN it MUST be rejected as invalid

#### Scenario: Empty companyId rejected

- GIVEN a delegation with an empty or missing `companyId`
- WHEN validated
- THEN it MUST be rejected as invalid

## ADDED Requirements

### Requirement: Window-Active Delegation

A Delegation (and any temporary assignment it represents) MUST be considered
active ONLY within its window `validFrom <= now < validUntil`. A delegation whose
`validFrom` is in the future (`validFrom > now`) MUST be treated as NOT active. A
delegation past `validUntil` (`now >= validUntil`) MUST be NOT active. Activity
MUST be decided by the same window rule as the trust kernel
(`isWindowActive(start, now, expiry)`). [ADR-0002] [INF]

#### Scenario: Future-start assignment is inactive

- GIVEN a delegation with `validFrom > now`
- WHEN its activity is evaluated
- THEN it MUST be NOT active and MUST confer no authority

#### Scenario: In-window assignment is active

- GIVEN a delegation with `validFrom <= now < validUntil`
- WHEN its activity is evaluated
- THEN it MUST be active

#### Scenario: Expired assignment is inactive

- GIVEN a delegation with `now >= validUntil`
- WHEN its activity is evaluated
- THEN it MUST be NOT active

#### Scenario: Boundary validFrom equals now is active

- GIVEN a delegation with `validFrom == now` and `now < validUntil`
- WHEN its activity is evaluated
- THEN it MUST be active
