# runtime-validation Specification

## Purpose

Runtime validation guards at the system edges. They reject malformed command
input, corrupt rows read back from persistence, illegal state transitions, and
invalid structured LLM plans BEFORE domain logic runs — rather than trusting
TypeScript types alone. Guards are pure functions that throw a typed
`ValidationError` on invalid input and return silently on valid input. They live
in `packages/business-domain/src/validation/` so use cases and adapters reuse
them without importing infrastructure. [INF]

## Requirements

### Requirement: Validate Command Input Shape

Every transition command entering a use case MUST pass `assertValidCommand`. The
guard MUST reject a command missing required fields (`companyId`, `workId`,
`delegationId`, principal identity, action) or carrying empty/non-string values,
throwing a `ValidationError`. A valid command MUST pass through silently. [INF]

#### Scenario: Valid command accepted

- GIVEN a command with all required non-empty fields
- WHEN `assertValidCommand` runs
- THEN it MUST return without throwing

#### Scenario: Malformed command rejected

- GIVEN a command missing `companyId` or with an empty `workId`
- WHEN `assertValidCommand` runs
- THEN it MUST throw a `ValidationError` describing the missing field

### Requirement: Validate Persisted Row Integrity

Rows read back from persistence MUST pass `assertValidWorkRow` (and the
delegation/receipt equivalents) before being trusted as domain aggregates. The
guard MUST reject a row whose required fields are null, the wrong primitive
type, or whose `state`/`version` are out of the legal domain set, throwing a
`ValidationError`. A corrupt row MUST never reach domain logic. [INF]

#### Scenario: Well-formed row accepted

- GIVEN a persisted Work row with all required fields of the correct type
- WHEN `assertValidWorkRow` runs
- THEN it MUST return the validated Work without throwing

#### Scenario: Corrupt row rejected

- GIVEN a persisted Work row with `version` as a string or `state` outside the legal set
- WHEN `assertValidWorkRow` runs
- THEN it MUST throw a `ValidationError` and the row MUST NOT reach domain logic

### Requirement: Validate Transition Legality

A requested transition MUST pass `assertValidTransition(from, to)`. The guard
MUST reject any transition not permitted by the Work (or Delegation) state
machine, throwing a `ValidationError`. The guard MUST reuse the existing pure
transition tables (`canTransitionWork`/`canTransitionDelegation`) as its single
source of truth. [ADR-0002]

#### Scenario: Legal transition accepted

- GIVEN a Work in `proposed` transitioning to `accepted`
- WHEN `assertValidTransition` runs
- THEN it MUST return without throwing

#### Scenario: Illegal transition rejected

- GIVEN a Work in `accepted` transitioning to `verified`
- WHEN `assertValidTransition` runs
- THEN it MUST throw a `ValidationError`

### Requirement: Validate Structured LLM Plan

A structured plan produced by an LLM MUST pass `assertValidLlmPlan` before it is
used to create Work or drive transitions. The guard MUST reject a plan whose
required domain fields are absent or malformed, throwing a `ValidationError`. An
LLM plan MUST NEVER be trusted to define risk classification or authority.
[ADR-0003]

#### Scenario: Well-formed plan accepted

- GIVEN an LLM plan with all required domain fields well-formed
- WHEN `assertValidLlmPlan` runs
- THEN it MUST return without throwing

#### Scenario: Malformed plan rejected

- GIVEN an LLM plan missing the deliverable description or action references
- WHEN `assertValidLlmPlan` runs
- THEN it MUST throw a `ValidationError` and the plan MUST NOT drive execution
