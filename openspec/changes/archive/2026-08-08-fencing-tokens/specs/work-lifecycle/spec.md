# Delta for work-lifecycle

## MODIFIED Requirements

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
