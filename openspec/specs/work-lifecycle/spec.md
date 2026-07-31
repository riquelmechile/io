# work-lifecycle Specification

## Purpose

Work is the execution aggregate — separate from Delegation — that owns
execution state, deliverable, acceptance, evidence references, and outcome. Work
references its authority via a neutral string ID and MUST NOT import the
Delegation aggregate. [ADR-0002] [INF]

## Requirements

### Requirement: Work Execution Fields

A Work MUST carry `workId`, `delegationId`, `proposer`, `description`, `state`,
`evidenceRefs`, and optionally `deliverable` and `outcome`. The `delegationId`
MUST be a neutral string ID identifying the authority under which execution is
attempted. [ADR-0002] [INF]

#### Scenario: Valid proposed work

- GIVEN a work with `workId`, `delegationId`, `proposer`, `description`, and `state` set to `proposed`
- WHEN validated
- THEN it MUST be accepted as valid

#### Scenario: Missing delegation reference rejected

- GIVEN a work with an empty `delegationId`
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
