# development-toolchain Specification

## Purpose

A reproducible, root-only, non-product engineering foundation: enforced runtime, ADR-accepted tools, reproducible install/lockfile, quality gates, secret-free CI, and a proof-gated strict-TDD switch. It contains NO product, domain, or business behavior and uses NO external services.

## Requirements

### Requirement: Enforced Node 24 LTS and Strict-ESM TypeScript 6.x Root

The workspace root MUST enforce the latest secure Node 24 LTS patch and a TypeScript 6.x strict-ESM configuration. Non-LTS or stale patches MUST be rejected.

#### Scenario: Enforced engine pin
- GIVEN a clean clone with no lockfile
- WHEN Node is not the enforced 24 LTS patch
- THEN install MUST fail and refuse to proceed

#### Scenario: Strict ESM typecheck
- GIVEN the TS 6.x strict root configuration
- WHEN typecheck/build runs
- THEN it MUST pass under strict mode with ESM module resolution

### Requirement: ADR-Accepted Tool Selection After Primary-Doc Verification

Concrete tools (package manager, runner, lint/format, build) MUST be selected ONLY in `docs/adr/0004-development-toolchain.md`, and ONLY after compatibility is verified against current official primary docs. This spec MUST NOT name concrete tools.

#### Scenario: No acceptance without verification
- GIVEN a candidate tool choice
- WHEN its compatibility is not verified against current official primary docs
- THEN ADR 0004 MUST NOT accept it

#### Scenario: Verified choice recorded
- GIVEN compatibility verified against primary docs
- WHEN the choice is accepted
- THEN ADR 0004 MUST record the tool, rationale, and doc reference

### Requirement: Root-Only Non-Product Harness

The bootstrap MUST be a root-only non-product harness. It MUST NOT create speculative `apps/` or `packages/` trees, product/domain behavior, or external services.

#### Scenario: No product tree
- GIVEN the bootstrapped root
- WHEN inspected
- THEN it MUST contain only root harness/config — no speculative apps/packages tree

#### Scenario: No external services or domain behavior
- GIVEN the harness
- WHEN it runs
- THEN it MUST NOT start or reach PostgreSQL, DeepSeek, web, or any daemon, and MUST NOT specify business/domain rules

### Requirement: Reproducible Install and Committed Lockfile

The toolchain MUST produce a reproducible install and a committed lockfile.

#### Scenario: Clean reproduction
- GIVEN a clean clone under enforced Node 24 LTS
- WHEN install runs
- THEN it MUST reproduce the committed lockfile deterministically

#### Scenario: Lockfile committed
- GIVEN a frozen candidate
- WHEN delivered
- THEN the lockfile MUST be committed

### Requirement: Meaningful Local RED to GREEN Proof

The harness MUST capture meaningful local RED evidence then reach GREEN. The reviewed candidate MUST always be green.

#### Scenario: RED captured before fix
- GIVEN a meaningful failing harness assertion
- WHEN run before the fix
- THEN RED evidence MUST be recorded

#### Scenario: GREEN and green-only candidate
- GIVEN the recorded RED
- WHEN fixed then reviewed
- THEN the harness MUST pass GREEN and a red candidate MUST NOT merge

### Requirement: Quality-Gate Command Suite

The toolchain MUST provide successful format check-only, typecheck/build, lint/static-analysis, and test commands.

#### Scenario: All gates pass
- GIVEN the active harness
- WHEN each command runs
- THEN it MUST exit 0

#### Scenario: Format is check-only
- GIVEN the format command in CI
- WHEN it runs
- THEN it MUST verify formatting without rewriting files

### Requirement: Minimal Secret-Free GitHub CI

The repo MUST contain minimal additive application/toolchain GitHub CI that reproduces the secret-free local checks and preserves the existing governance PR-validation CI.

#### Scenario: CI mirrors local
- GIVEN locally passing checks
- WHEN CI runs
- THEN the same checks MUST pass

#### Scenario: No secrets required
- GIVEN the CI workflow
- WHEN it executes
- THEN it MUST NOT require any secrets

### Requirement: Orthogonal Check Status Dimensions

Every quality-gate check MUST be classified across three orthogonal dimensions: **applicability** (`applicable | not_applicable`), **requirement** (`required | optional`), and **outcome**, declared only when `applicable` (`passed | failed | unavailable | not_run`). A check that is `required` AND `applicable` MUST reach outcome `passed`. Outcome `unavailable` MUST never count as a pass and MUST block activation and review unless an explicit maintainer decision overrides the block. `not_applicable` MUST be distinguished from `unavailable`, MUST be reported with a rationale, and MUST never be silently omitted.

#### Scenario: Required-and-applicable must pass
- GIVEN a check classified `required` and `applicable`
- WHEN the suite runs
- THEN its outcome MUST be `passed`; any other outcome fails the suite

#### Scenario: Unavailable blocks without explicit decision
- GIVEN an applicable check whose outcome is `unavailable`
- WHEN activation or review is considered
- THEN it MUST block activation/review unless an explicit maintainer decision overrides, and MUST never count as a pass

#### Scenario: Not-applicable needs rationale
- GIVEN a check classified `not_applicable`
- WHEN the suite runs
- THEN it MUST be reported as `not_applicable` with rationale, distinct from `unavailable`, never silently omitted

### Requirement: Proof-Before-Activation (Strict-TDD Switch)

`openspec/config.yaml` is the authoritative reviewed Git state for the testing block, command metadata, and `strict_tdd`. `strict_tdd` and command metadata MUST remain `false`/empty on any failure. Activation MAY occur only after all tool proofs pass: update that config in the same candidate, rerun all final checks on that exact candidate, then freeze and review it without post-freeze source mutation. The derived Engram testing-capabilities cache MUST NOT be part of candidate bytes or be represented as atomically committed with Git.

#### Scenario: Failure keeps TDD off
- GIVEN any command or proof that fails
- WHEN activation is considered
- THEN `strict_tdd` MUST stay `false` and command metadata MUST stay empty

#### Scenario: Same-candidate activation, recheck, and freeze
- GIVEN all tool proofs pass
- WHEN activating strict TDD
- THEN the authoritative repo testing block, command metadata, and `strict_tdd` MUST update in the same Git candidate, all final checks MUST be rerun and pass before freeze, and the reviewed candidate MUST be that frozen candidate with no post-freeze source mutation

### Requirement: Post-Review Testing-Capabilities Cache Synchronization

After native review allows the exact frozen Git candidate, but before delivery or the next apply, the system MUST idempotently synchronize Engram `sdd/io/testing-capabilities` from the reviewed `openspec/config.yaml` authority plus candidate and allowed-receipt identity. It MUST read the cache back and verify substantive equality and lineage. This derived cache MUST NOT be treated as a Git artifact or as evidence of distributed atomicity.

Synchronization evidence MUST identify the authoritative config, candidate identity, allowed receipt lineage, Engram observation and revision, and readback result. A write failure, readback failure, identity mismatch, content mismatch, or lineage mismatch MUST fail closed and block delivery and the next apply.

#### Scenario: Allowed candidate synchronizes before progression
- GIVEN native review allows the exact frozen candidate and its receipt identifies that candidate
- WHEN delivery or the next apply is requested
- THEN the cache MUST first be idempotently synchronized from the reviewed config plus candidate/receipt identity and read back successfully

#### Scenario: Synchronization evidence is complete
- GIVEN a successful cache synchronization and readback
- WHEN its evidence is inspected
- THEN it MUST identify the authoritative config identity, candidate identity, Engram observation/revision, readback result, and allowed receipt lineage

#### Scenario: Cache mismatch fails closed
- GIVEN cache synchronization or readback fails, or content, identity, or lineage does not match the reviewed authority
- WHEN delivery or the next apply is considered
- THEN progression MUST be blocked until synchronization and readback succeed

### Requirement: Rollback to Docs-Only Baseline

A rollback MUST first apply an approved Git revert that restores the docs-only repo authority with `strict_tdd: false` and empty command metadata. It MUST then idempotently synchronize and read back the derived Engram testing-capabilities cache from that reverted authority and the approved revert receipt lineage. The cache MUST NOT be treated as a Git artifact, and synchronization failure or mismatch MUST block delivery and the next apply.

#### Scenario: Revert removes toolchain
- GIVEN a delivered candidate
- WHEN rollback is invoked
- THEN an approved Git revert MUST remove the toolchain, application/toolchain CI, harness, and lockfile, preserve governance PR-validation CI, and restore repo `strict_tdd` to `false` with empty commands

#### Scenario: Approved revert resynchronizes derived cache
- GIVEN the approved Git revert restored the repo authority
- WHEN rollback completion is considered
- THEN the derived cache MUST be synchronized from the reverted config plus revert receipt lineage, read back, and verified before delivery or the next apply can proceed

### Requirement: Authored-Line Budget and Lockfile Forecasting

Authored additions plus deletions MUST stay within the 400-line review budget as classified by the native review authority. Generated goldens alone are known to be excluded from the native authored count while remaining candidate identity and receipt validation. Lockfiles and generated snapshots MUST remain candidate identity and review burden, MUST be forecast separately, and the native authority MUST decide whether and how they count. This spec MUST NOT assert that lockfile lines are automatically outside the authored or review budget. If authored lines as classified exceed 400, the work MUST auto-chain stacked-to-main without separating proof from activation.

#### Scenario: Authored within budget, native-classified
- GIVEN the delivered candidate
- WHEN the native authority classifies authored additions plus deletions
- THEN the count MUST be <= 400 lines

#### Scenario: Goldens excluded from authored count but retained
- GIVEN generated golden files in the candidate
- WHEN the native authority classifies
- THEN goldens MUST be excluded from the authored count yet MUST remain candidate identity and receipt validation

#### Scenario: Lockfile forecast separately, native-decided
- GIVEN a lockfile or generated snapshot in the candidate
- WHEN delivered
- THEN it MUST remain candidate identity and review burden, MUST be forecast separately, and the native authority MUST decide whether/how it counts

#### Scenario: Over budget auto-chains
- GIVEN authored lines as native-classified exceeding 400
- WHEN delivery proceeds
- THEN it MUST auto-chain stacked-to-main without splitting proof from activation
