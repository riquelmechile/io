# work-lifecycle Specification

## Purpose

Work is the execution aggregate — separate from Delegation — that owns
execution state, deliverable, acceptance, evidence references, and outcome. Work
references its authority via a neutral string ID and MUST NOT import the
Delegation aggregate. [ADR-0002] [INF]

## Requirements


### Requirement: Work Execution Fields

A Work MUST carry `workId`, `companyId`, `delegationId`, `proposer`,
`description`, `state`, `version`, `evidenceRefs`, and optionally `deliverable`
and `outcome`. The `delegationId` MUST be a neutral string ID identifying the
authority under which execution is attempted. The `companyId` MUST be a
non-empty neutral string ID scoping the Work to its tenant. The `version` MUST
be a nonnegative integer. [ADR-0002] [INF]

(Previously: Work carried no `companyId` and no `version`; transitions used raw
`save()` with no concurrency control.)

#### Scenario: Valid proposed work

- GIVEN a work with `workId`, `companyId`, `delegationId`, `proposer`, `description`, `version` 0, and `state` set to `proposed`
- WHEN validated
- THEN it MUST be accepted as valid

#### Scenario: Missing delegation reference rejected

- GIVEN a work with an empty `delegationId`
- WHEN validated
- THEN it MUST be rejected as invalid

#### Scenario: Missing company scope rejected

- GIVEN a work with an empty `companyId`
- WHEN validated
- THEN it MUST be rejected as invalid

### Requirement: Work State Machine

A Work MUST follow the lifecycle `proposed → accepted → in_progress → completed → verified | rejected`. Transitions NOT in this set MUST be rejected. Terminal states
(`verified`, `rejected`) MUST reject all further transitions. `proposed` MAY
transition directly to `rejected`. [ADR-0002] [INF]

#### Scenario: Full happy path

- GIVEN a work in state `proposed`
- WHEN transitioned `proposed → accepted → in_progress → completed → verified`
- THEN each transition MUST succeed and the final state MUST be `verified`

#### Scenario: Invalid transition rejected

- GIVEN a work in state `accepted`
- WHEN a transition to `verified` is attempted
- THEN the transition MUST be rejected and the state MUST remain `accepted`

#### Scenario: Terminal state frozen

- GIVEN a work in state `rejected`
- WHEN any transition is attempted
- THEN it MUST be rejected

### Requirement: Neutral Authority Reference

Work MUST reference Delegation via a plain string `delegationId`. The Work
package MUST NOT import the Delegation aggregate. Resolution of the delegation
reference MUST be the responsibility of the application layer, not the Work
aggregate. [ADR-0002] [INF]

#### Scenario: No Delegation import

- GIVEN the Work type and its package
- WHEN its imports are inspected
- THEN it MUST NOT import Delegation or any Delegation-related type

#### Scenario: Authority under which execution is attempted

- GIVEN a work with a `delegationId` string value
- WHEN inspected
- THEN it MUST declare the authority reference under which execution is attempted

### Requirement: Work Company Scope and Version

A Work MUST carry a mandatory `companyId` (neutral string ID) and a `version`
(nonnegative integer, starting at 0 on creation). All Work repository operations
MUST be scoped by `companyId`. The `version` MUST monotonically increase on
every persisted transition and MUST be used for optimistic concurrency control.
[ADR-0002] [INF]

#### Scenario: Work carries company scope and version

- GIVEN a Work created for a company
- WHEN inspected
- THEN it MUST carry a non-empty `companyId` and a `version` starting at 0

### Requirement: Work Optimistic Concurrency

A Work transition MUST persist via compare-and-set: the repository MUST update
the row only when the persisted `version` equals the caller's `expectedVersion`,
incrementing `version` by one. A concurrent mutation (persisted `version` differs
from `expectedVersion`) MUST raise an explicit conflict and MUST NOT overwrite
the newer state. Last-write-wins MUST be impossible for transitions. [INF]

#### Scenario: Concurrent transition conflicts

- GIVEN a Work at version 3 read by two callers
- WHEN both attempt a transition with expectedVersion 3
- THEN exactly one MUST succeed (to version 4) and the other MUST raise a version conflict

#### Scenario: Stale write rejected

- GIVEN a Work whose persisted version is 5
- WHEN an update is attempted with expectedVersion 3
- THEN the update MUST raise a conflict and the row MUST remain at version 5

### Requirement: Work Transition Use Cases

State changes MUST occur through transition use cases (`proposeWork`,
`acceptWork`, `startWork`, `completeWork`, `verifyWork`, `rejectWork`) rather
than raw `save()`. Each use case MUST validate the command, enforce authority and
separation of duties via the trust kernel, check the activation window, verify
the transition is legal, persist the Work with optimistic concurrency, and close
the operation inside a single transaction. Raw `save()` MUST remain available
only for initial Work creation. [ADR-0002] [ADR-0003]

#### Scenario: Propose creates work

- GIVEN a valid propose command scoped to a company
- WHEN `proposeWork` runs
- THEN a Work MUST be created in `proposed` with version 0

#### Scenario: Illegal transition rejected by use case

- GIVEN a Work in `accepted`
- WHEN `verifyWork` is attempted
- THEN the use case MUST reject the transition and MUST NOT persist

#### Scenario: Self-approval rejected at transition time

- GIVEN a transition use case where the same principal is proposer and approver
- WHEN the use case evaluates authority
- THEN the trust kernel MUST DENY and the transition MUST NOT persist

### Requirement: Idempotency for Work Transitions

A transition use case MUST accept an idempotency key and request hash. Before
any external effect, it MUST register the attempt in a company-scoped
`IdempotencyStore`. A second call with the same key and same hash MUST replay
the prior result without re-executing the effect. A second call with the same key
but a different hash MUST be denied as a conflict. [INF]

#### Scenario: Same key same hash replays

- GIVEN a completed transition recorded under a key with a hash
- WHEN the same transition is requested with the same key and hash
- THEN the prior result MUST be replayed and no new effect MUST occur

#### Scenario: Same key different hash denied

- GIVEN a completed transition recorded under a key with a hash
- WHEN a transition is requested with the same key but a different hash
- THEN it MUST be denied as an idempotency conflict
