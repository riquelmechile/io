# Proposal: IO Delivery Quality Contract

## Intent

Define IO's delivery, quality, SDD/TDD, RDD, CI, review-budget, and chained-delivery contract as a reviewable documentation capability. This replaces ad-hoc quality assumptions with a single contract that preserves Organic RDD, native provider-owned repository review receipts, 400-line review units, proof-before-strict-TDD, and honest CI status semantics.

## Scope

### In Scope
- Document the delivery/quality contract for SDD phase dependencies, verification dispatch readiness, native review receipts, freeze/correction rules, and rollback expectations.
- Specify quality evidence rules: behavior-layered tests, RED → GREEN → REFACTOR after bootstrap, CI applicability/requirement/outcome separation, and DeepSeek live-smoke fork handling.
- Capture review workload policy: native 400-line budget, auto-chain delivery, stacked-to-main PR topology, and work-unit commit discipline.

### Out of Scope
- Selecting or changing application toolchain, package manager, test DB, dependency scanner, secret scanner, or CI provider.
- Implementing product code, test harnesses, CI workflows, candidate-freeze automation, or IO business receipt schemas.
- Redesigning native repository review receipt schemas or validation authority.

## Capabilities

### New Capabilities
- `io-delivery-quality-contract`: Unified policy for IO delivery evidence, SDD phase dependencies, RDD review authority, CI status dimensions, review budgeting, chaining, and work-unit commits.

### Modified Capabilities
- `development-toolchain`: Align existing toolchain requirements with the broader delivery-quality contract where the contract references strict-TDD activation, CI dimensions, cache synchronization authority, lockfile forecasting, and rollback.

## Approach

Create concise OpenSpec delta documentation from the approved exploration. Preserve settled constraints: Organic RDD enabled; native review provider owns repository receipts; verification dispatch waits for persisted native review states `ready_final_verification` or `final_verifying`; `not_applicable` is distinct from `unavailable`; live DeepSeek smoke is not applicable to untrusted forks; additive application/toolchain CI must preserve governance PR-validation CI where present.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/io-delivery-quality-contract/specs/io-delivery-quality-contract/spec.md` | New | Delta spec for the new contract capability. |
| `openspec/changes/io-delivery-quality-contract/specs/development-toolchain/spec.md` | Modified | Delta spec only where existing toolchain requirements need alignment. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-specifying future tooling | Medium | Keep tool choices and bootstrap implementation out of scope. |
| Confusing native repository receipts with IO business receipts | Medium | State native provider authority and defer business receipt schema design. |
| Stale current-state claims | Medium | Specs must anchor authority to current `openspec/config.yaml` and explicitly separate Git candidate authority from Engram caches. |

## Rollback Plan

Revert this documentation-only change and remove its delta specs. No product code, data, CI, or toolchain state changes are introduced.

## Dependencies

- Approved exploration: Engram `sdd/io-delivery-quality-contract/explore` (#5499).
- Existing capabilities: `development-toolchain`, `io-domain-contract`, `io-ports-trust-contract`, `io-persistence-recovery-contract`.

## Success Criteria

- [ ] Proposal and subsequent specs preserve all settled delivery-quality constraints without inventing implementation tasks.
- [ ] New and modified capabilities give `sdd-spec` a clear contract boundary.
- [ ] Downstream toolchain/bootstrap work remains explicitly out of scope.
