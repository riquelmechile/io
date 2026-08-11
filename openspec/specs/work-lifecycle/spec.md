# work-lifecycle Specification

## Purpose

Work is the execution aggregate — separate from Delegation — that owns
execution state, deliverable, acceptance, evidence references, and outcome. Work
references its authority via a neutral string ID and MUST NOT import the
Delegation aggregate. [ADR-0002] [INF]

## Requirements

### Requirement: Work Execution Fields

A Work MUST carry `companyId`, `workId`, `delegationId`, `proposer`, `description`, `state`, `version`, `fencingToken`, `evidenceRefs`, and optional `deliverable` and `outcome`. `companyId` and `delegationId` MUST be non-empty neutral string IDs. `version` MUST initialize to `1`; `fencingToken` MUST initialize to `0`, the valid pre-fencing epoch. The business-domain package MUST retain zero `@io/*` imports. [ADR-0002] [INF]
(Previously: Work had no claim-scoped fencing token.)

#### Scenario: Valid proposed work
- GIVEN proposed Work with every mandatory field, `version` 1, and `fencingToken` 0
- WHEN validated
- THEN it MUST be accepted as valid

#### Scenario: Missing delegation reference rejected
- GIVEN Work with an empty `delegationId`
- WHEN validated
- THEN it MUST be rejected as invalid

#### Scenario: Empty companyId rejected
- GIVEN Work with an empty or missing `companyId`
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

## ADDED Requirements

### Requirement: Optimistic Concurrency via Compare-And-Swap

`updateIfVersion` MUST write only when `expectedVersion` matches and MUST increment `version`; mismatch MUST return `{ ok: false, reason: 'version-conflict', current? }` without overwrite. Concurrent ordinary transitions MUST have one winner. A claim transition MUST additionally mint its token server-side within that same CAS by incrementing stored `fencingToken` and returning it. A terminal-close CAS MUST match both version and fencing token; token mismatch MUST leave Work unchanged and return a typed conflict. Fakes and PostgreSQL MUST expose identical results. [ADR-0002] [INF]
(Previously: CAS checked only version and did not mint or validate claim ownership.)

#### Scenario: Successful CAS bumps the version
- GIVEN stored Work at version N
- WHEN `updateIfVersion` receives N
- THEN it MUST succeed and store version N + 1

#### Scenario: Stale expectedVersion yields version-conflict
- GIVEN stored Work at version N
- WHEN `updateIfVersion` receives N - 1
- THEN it MUST return `version-conflict` and leave Work unchanged

#### Scenario: Concurrent writers, single winner
- GIVEN two writers target the same Work version
- WHEN both writes are applied
- THEN exactly one MUST succeed

#### Scenario: Claim mints from the pre-fencing epoch
- GIVEN accepted Work with `fencingToken` 0
- WHEN a fresh claim wins
- THEN it MUST atomically return and store token 1

#### Scenario: Stale token cannot close Work
- GIVEN in-progress Work owned by token N
- WHEN terminal close supplies a token other than N
- THEN it MUST return a typed conflict and persist no terminal mutation

#### Scenario: Fake and PostgreSQL parity
- GIVEN equivalent fake and PostgreSQL Work states
- WHEN claim and stale-close cases run
- THEN outcomes, versions, tokens, and stored states MUST match

### Requirement: Transition Use Cases Replace Raw Save

Work state changes MUST be performed through transition use cases (`propose`,
`accept`, `start`, `complete`, `verify`, `reject`), each loading the work and
applying a compare-and-swap transition. Raw `save()` MUST be demoted to
insert/internals (creating a new Work) and MUST NOT be the state-change path for an
existing Work. Each use case MUST return a typed result
`{ ok: true, value } | { ok: false, reason, current? }` and MUST NOT use thrown
exceptions for control flow. Use cases MUST depend ONLY on repository ports and
MUST NOT import any `@io/*` package (business-domain purity). [ADR-0002] [INF]

#### Scenario: Use case drives a valid transition

- GIVEN a work in state `proposed` at `version` N
- WHEN the `accept` use case is invoked with `expectedVersion` N
- THEN the work MUST transition to `accepted`, the `version` MUST become N + 1, and the result MUST be `{ ok: true, value }`

#### Scenario: Raw save is not the transition path

- GIVEN an existing work whose state must change
- WHEN the change is attempted
- THEN it MUST go through a transition use case, and a raw `save()` MUST NOT be used to mutate the state of an existing work

#### Scenario: Use case reports conflict without throwing

- GIVEN a work whose stored `version` advanced past the caller's `expectedVersion`
- WHEN a transition use case is invoked
- THEN it MUST return `{ ok: false, reason: 'version-conflict', current? }` and MUST NOT throw to signal the conflict

### Requirement: Tenant-Scoped Actionable Work Selection

`ACTIONABLE_WORK_STATES` MUST be `readonly ['accepted']`, mirroring `MATERIAL_EVENT_TYPES`. `listActionableByCompany(companyId)` MUST return that tenant's accepted Work in insertion order and reject empty scope before reading storage. Business-domain MUST retain zero `@io/*` imports.

#### Scenario: Accepted Work is returned oldest first
- GIVEN mixed-state, mixed-tenant Work
- WHEN `listActionableByCompany(companyId)` is called
- THEN only scoped accepted Work MUST appear, in insertion order

#### Scenario: No actionable Work returns empty
- GIVEN no accepted Work
- WHEN its actionable Work is listed
- THEN the result MUST be empty

#### Scenario: Empty tenant scope fails before access
- GIVEN empty `companyId` and observable storage
- WHEN actionable Work is listed
- THEN rejection MUST precede every store read

### Requirement: Operator Recovery Designation

Recovery designation MUST be operational repository metadata, not a Work field or lifecycle transition. The domain `Work` type and `WORK_TRANSITIONS` MUST remain unchanged; `in_progress → completed` MUST remain the only outgoing edge from `in_progress`. A designation request MUST be an explicit operator action, MUST use expected-version CAS, MUST increment `version`, MUST preserve state and fencing token, and MUST return a typed result without thrown control flow. It MUST NOT depend on age, lease, heartbeat, or a clock. The business-domain implementation MUST retain zero `@io/*` imports. Successful recovery and `UNRESOLVED_REQUIRES_HUMAN` escalation MUST clear the marker so another attempt requires explicit re-designation. [REQ] [INF]

#### Scenario: Designation preserves lifecycle state
- GIVEN `in_progress` Work at version N
- WHEN an operator designates it for recovery with expected version N
- THEN state MUST remain `in_progress` and version MUST become N + 1

#### Scenario: Designation fences stale-version zombies without a new token
- GIVEN a worker holding version N and fencing token T
- WHEN designation succeeds
- THEN stored version MUST become N + 1, token MUST remain T, and the stale version-N close MUST fail

#### Scenario: Recovery metadata stays outside Work
- GIVEN the public domain `Work` type and transition table
- WHEN their fields and edges are inspected
- THEN no recovery marker or new `in_progress` edge MUST exist

#### Scenario: Unresolved escalation permits explicit re-designation
- GIVEN a designated recovery returns `UNRESOLVED_REQUIRES_HUMAN`
- WHEN escalation is recorded
- THEN the marker MUST be cleared and no later recovery MUST run until an operator designates again
