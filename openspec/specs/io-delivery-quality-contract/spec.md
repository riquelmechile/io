# io-delivery-quality-contract Specification

## Purpose

IO's unified delivery-quality policy binding every change: SDD phase dependencies, Receipt-Driven Development (RDD) review authority, orthogonal CI status dimensions, 400-line review budget, stacked-to-main chaining, work-unit commits, and the Git-candidate-versus-Engram-cache authority boundary. Concrete toolchain realization lives in `development-toolchain`.

## Requirements

### Requirement: SDD Phase Dependencies and Verification Dispatch Readiness

Phases MUST follow `proposal -> (spec || design) -> tasks -> apply -> native bounded review -> verify -> archive`: `tasks` requires spec and design; `apply` requires tasks, spec, and design; `archive` requires completed tasks, verify evidence, and an allowed review receipt. `verify` is independent in purpose, but the dispatcher MUST NOT route to verify until the persisted native review transaction reaches `ready_final_verification` or `final_verifying`; missing or active review MUST route to native review. No claim-label or automatic-AC gate is a native SDD dependency.

#### Scenario: Verification waits for persisted review state

- GIVEN apply completed
- WHEN review is missing or active
- THEN the dispatcher MUST route to native review, not verify

### Requirement: Native Review Authority and Candidate Freeze

RDD is enabled. The native review provider owns the versioned repository review receipt schema and validation authority; IO MUST consume, not redesign, it - only the future IO business receipt schema is product-owned. After review START, candidate bytes MUST be frozen and only check-only operations are permitted. Ordinary review MUST permit at most one native-authorized bounded correction transaction; any post-freeze byte, path, or mode change invalidates authority and requires a new candidate.

#### Scenario: Freeze invalidation

- GIVEN a frozen candidate
- WHEN bytes, paths, or modes change after START
- THEN review authority MUST be invalidated and a new candidate required

### Requirement: Orthogonal CI Status Dimensions (Delivery Contract)

Every CI check MUST be classified across independent applicability, requirement, and outcome dimensions; a `required` AND `applicable` check MUST reach `passed`. `not_applicable` MUST be distinguished from `unavailable` with rationale. Fork builds MUST run every secret-free required check; live DeepSeek smoke MUST be `not_applicable` to untrusted forks and MUST NOT be standard PR CI. Concrete mechanics are specified in `development-toolchain`.

#### Scenario: Fork excludes live smoke

- GIVEN an untrusted fork build
- WHEN live DeepSeek smoke is classified
- THEN it MUST be `not_applicable`, distinct from `unavailable`

### Requirement: 400-Line Review Budget and Stacked-to-Main Chaining

Authored additions plus deletions MUST stay within the 400-changed-line budget as native-classified; tests, docs, and config count, while generated goldens are excluded from the authored count but remain candidate identity and receipt burden. When native-classified authored lines exceed 400, delivery MUST auto-chain stacked-to-main: PR1 branches from `main`; each later PR branches from its predecessor and is retargeted to `main` after the predecessor merges, without history rewrite.

#### Scenario: Over budget auto-chains

- GIVEN native-classified authored lines exceed 400
- WHEN delivery proceeds
- THEN work MUST auto-chain stacked-to-main

### Requirement: Work-Unit Commits

Each commit MUST express one reviewable outcome with a conventional prefix (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`) describing the outcome, not a file list. Tests, docs, migrations, and config MUST travel with the behavior they verify. Commits MUST NOT add AI-attribution tags and MUST be created only when explicitly requested.

#### Scenario: Outcome-scoped commit

- GIVEN a behavior change
- WHEN committed
- THEN one commit MUST carry its tests and docs with a conventional message

### Requirement: Authority Boundary - Git Candidate vs Engram Cache

Reviewed Git candidate bytes and `openspec/config.yaml` are the delivery authority. Derived Engram caches (e.g. `sdd/io/testing-capabilities`) MUST NOT be treated as Git artifacts, candidate bytes, or evidence of distributed atomicity, and MUST be synchronized and read back only after native review allows the exact frozen candidate. Additive application/toolchain CI MUST preserve existing governance PR-validation CI.

#### Scenario: Cache is not candidate bytes

- GIVEN a synchronized Engram cache
- WHEN the candidate is reviewed
- THEN the cache MUST be excluded from candidate bytes and receipt authority
