# Delta for work-lifecycle

## MODIFIED Requirements

### Requirement: Work Execution Fields

A Work MUST carry `companyId`, `workId`, `delegationId`, `proposer`,
`description`, `state`, `version`, `evidenceRefs`, and optionally `deliverable`
and `outcome`. The `companyId` MUST be a mandatory, non-empty neutral string
identifying the tenant scope. The `delegationId` MUST be a neutral string ID
identifying the authority under which execution is attempted. The `version` MUST
be a numeric optimistic-concurrency counter initialized to `1` on creation.
[ADR-0002] [INF]
(Previously: Work carried no `companyId` and no `version`; it was tenant-unscoped and last-write-wins.)

#### Scenario: Valid proposed work

- GIVEN a work with a non-empty `companyId`, `workId`, `delegationId`, `proposer`, `description`, `state` set to `proposed`, and `version` set to `1`
- WHEN validated
- THEN it MUST be accepted as valid

#### Scenario: Missing delegation reference rejected

- GIVEN a work with an empty `delegationId`
- WHEN validated
- THEN it MUST be rejected as invalid

#### Scenario: Empty companyId rejected

- GIVEN a work with an empty or missing `companyId`
- WHEN validated
- THEN it MUST be rejected as invalid

## ADDED Requirements

### Requirement: Optimistic Concurrency via Compare-And-Swap

The Work repository MUST provide a compare-and-swap update (`updateIfVersion`)
that writes ONLY when the supplied `expectedVersion` matches the stored `version`,
and on success MUST increment `version` by one (`version = version + 1`). A write
whose `expectedVersion` does not match MUST NOT overwrite the stored work and MUST
return `{ ok: false, reason: 'version-conflict', current? }`, carrying the current
work when available. Under concurrent writes, exactly one writer MUST win and
every losing writer MUST receive an explicit `version-conflict`. Last-write-wins
overwrite MUST NOT occur. [ADR-0002] [INF]

#### Scenario: Successful CAS bumps the version

- GIVEN a stored work at `version` N
- WHEN `updateIfVersion` is called with `expectedVersion` N
- THEN the update MUST succeed, return `{ ok: true, value }`, and the stored `version` MUST become N + 1

#### Scenario: Stale expectedVersion yields version-conflict

- GIVEN a stored work at `version` N
- WHEN `updateIfVersion` is called with `expectedVersion` N - 1
- THEN the update MUST fail with `{ ok: false, reason: 'version-conflict', current? }` and the stored work MUST remain unchanged

#### Scenario: Concurrent writers, single winner

- GIVEN two writers issuing `updateIfVersion` against the same work and version
- WHEN both writes are applied
- THEN exactly one MUST succeed and the other MUST receive `{ ok: false, reason: 'version-conflict' }`

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
