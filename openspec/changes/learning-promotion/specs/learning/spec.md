# Learning Specification

## Purpose

Define tenant-isolated creation and policy-governed promotion of learning candidates from verified outcomes.

## Requirements

### Requirement: Append-only learning candidate

A `LearningCandidate` MUST contain `companyId`, stable `candidateId`, monotonic `revision`, exactly one state (`candidate|active|needs_review|superseded`), append-only provenance/lineage, and unique linked verified outcome IDs. Revisions MUST be immutable; each successor MUST identify its superseded revision.

#### Scenario: Create and revise a candidate
- GIVEN tenant-scoped verified outcomes and valid identity
- WHEN a candidate and successor are created
- THEN both MUST remain attributable and linked
- AND invalid identity, state, revision, duplicate ID, or tenant MUST produce no mutation

### Requirement: Deterministic success-only aggregation

Aggregation MUST consume only tenant-scoped, success-only composite `work.skill-outcome` facts, deduplicate IDs, preserve provenance, and canonically order inputs. Missing evidence MUST mean unknown/absent, never harmful. Evaluation MUST be read-only; worker, T1, Skill, and `MATERIAL_EVENT_TYPES` behavior MUST remain unchanged.

#### Scenario: Aggregate equivalent inputs
- GIVEN equivalent verified facts in different orders, replayed IDs, or foreign facts
- WHEN aggregated for the same tenant
- THEN identity and evidence MUST be identical, with foreign facts excluded
- AND missing facts MUST NOT become harmful

### Requirement: Operator-deployed promotion policy

A versioned `PromotionPolicy` MUST declare ID/version, company/cohort scope, minimum positive observations, linked-outcome minimum/uniqueness, conflict behavior, delegated risk boundary, activation, and inclusive-start/exclusive-end interval. It MAY declare an observation window, confidence/source-authority constraints, harmful cap, and catastrophic veto; unavailable harmful facts MUST NOT be inferred. Values MUST be operator-deployed data without universal numeric defaults.

#### Scenario: Resolve applicable policy
- GIVEN zero, one, or multiple policies, including malformed, expired, scope-mismatched, and boundary cases
- WHEN evaluation occurs
- THEN only one valid applicable version MUST apply
- AND every other case MUST fail closed or typed-escalate without nearest-policy selection or mutation

### Requirement: Deterministic bounded evaluation

Evaluation MUST return `promote`, `remain-candidate`, or `needs-review` with typed reasons and reproducible policy/evidence references. Promotion MAY be automatic only when evidence satisfies policy within delegated authority. Company purpose, capital, critical limits, irreversible actions, constitutional modification, unresolved conflict/risk, and catastrophic veto MUST return `needs-review`; vetoes MUST NOT be averaged away. Neither a universal human gate nor unbounded autonomy is permitted.

#### Scenario: Evaluation outcomes
- GIVEN sufficient evidence and delegated authority
- WHEN evaluated
- THEN the result MUST be `promote`
- AND insufficient evidence MUST remain `candidate`; veto, conflict, risk, or reserved authority MUST produce `needs_review`

### Requirement: Concurrent transition persistence

Transitions MUST append an immutable revision with command, policy, evidence, and lineage references. Same command/policy/evidence replay MUST converge. Conflicting concurrent transitions or equal revisions MUST have one current winner. Stale/superseded candidates MUST NOT transition. Adapters MUST be INSERT-only and MUST NOT UPDATE or DELETE.

#### Scenario: Replay and concurrency
- GIVEN replay, conflicting concurrent attempts, equal revisions, or a stale candidate
- WHEN persistence resolves them
- THEN replay MUST converge and at most one conflict MUST become current
- AND stale or losing attempts MUST cause no mutation

### Requirement: Portable validated behavior

PostgreSQL and in-memory repositories MUST provide identical tenant isolation, ordering, idempotency, concurrency outcomes, and runtime row validation. Stored evidence MUST reproduce evaluation and rescoring under its policy version.

#### Scenario: Adapter parity and malformed row
- GIVEN identical operations or a malformed persisted row
- WHEN each adapter is exercised
- THEN valid results MUST match and malformed data MUST be rejected without cross-tenant disclosure

### Requirement: Evaluation quality and scope boundary

Evaluator tests MUST include gold, decoy, semantically equivalent variant, missing-evidence, and catastrophic-veto cases and prove deterministic typed outcomes. Stage 4 versioned Skill creation/update is out of scope; `SkillState` MUST remain unchanged. Policy retirement/rollback MUST fail closed without rewriting history.

#### Scenario: Quality controls and rollback
- GIVEN the required control corpus and a retired policy
- WHEN evaluation and rollback behavior are tested
- THEN controls MUST distinguish relevant evidence and subsequent promotion MUST fail closed while history remains intact
