# Proposal: Bootstrap Development Toolchain

## Intent and Problem

Create the smallest reproducible foundation for the **next** product behavior to use strict TDD and Gentle AI v2.2.0 native Organic RDD. Governance PR-validation CI exists, but no application runtime, toolchain, lockfile, test runner, or application/toolchain CI exists, so `strict_tdd` remains `false`.

## Proposal Question Round

Auto-mode assumptions: root-only non-product harness; ADR-selected tools; no product rules.

## Scope

### In Scope
- Pin/enforce the latest secure Node 24 LTS patch and a TypeScript 6.x strict-ESM workspace root.
- Decide package manager, runner, lint/format, and build tools in an ADR before implementation.
- Prove reproducible install, check-only format, typecheck/build, lint/static checks, tests, and minimal application/toolchain GitHub CI that preserves the existing governance PR-validation CI.
- Demonstrate meaningful local harness RED→GREEN; commit only green.
- Only after all commands pass, update the `openspec/config.yaml` testing block, command metadata, and `strict_tdd: true`; complete final checks before freezing that authoritative Git candidate.
- After native review allows the exact candidate, but before delivery or the next apply, idempotently synchronize the derived Engram `sdd/io/testing-capabilities` cache from the reviewed config and candidate/receipt identity, then read it back and fail closed on mismatch.

### Out of Scope
- Product/domain behavior; the 30-package/app tree; PostgreSQL, DeepSeek, web, daemon, runtime, business schemas, integration/E2E, coverage policy, or receipt redesign.

## Capabilities

### New Capabilities
- `development-toolchain`: Reproducible workspace, quality gates, harness proof, and application/toolchain CI before strict TDD activation.

### Modified Capabilities
- None (no main specs exist).

## Approach

1. Verify compatibility against current official primary docs; accept choices in `docs/adr/0004-development-toolchain.md`.
2. Implement a root workspace and non-product harness—no speculative apps/packages.
3. Capture RED→GREEN evidence, update the authoritative repo config, pass final CI-equivalent checks, and freeze the green Git candidate for native review.
4. After native review allows that exact candidate, synchronize and verify the derived Engram testing-capabilities cache before delivery or the next apply.

## Affected Areas

| Area | Impact |
|---|---|
| Root config/harness/lockfile; application/toolchain CI; ADR | New; additive to existing governance PR-validation CI |
| `openspec/config.yaml` | Authoritative reviewed Git candidate, modified after proof and before freeze |
| Engram `sdd/io/testing-capabilities` | Derived cache, synchronized and read back after review; not candidate bytes |

## Delivery Boundary and Forecast

**PR1/work unit:** ADR + bootstrap proof + application/toolchain CI + TDD activation. Forecast: **180–320 authored lines**; no goldens. Lockfile: **nonzero, unknown until install, and separately classified by native authority**. If over 400, auto-chain stacked-to-main without separating proof from activation.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Incompatible/stale tool choice | Medium | Primary-doc verification before manifests |
| Premature workspace sprawl | Medium | Root harness only |
| False TDD readiness | High | Proof-gated config switch plus fail-closed post-review cache readback |

## Rollback Plan

Apply the approved Git revert to remove the toolchain, application/toolchain CI, harness, and lockfile, preserve governance PR-validation CI, and restore repo authority to `strict_tdd: false` with empty commands. Then synchronize and read back the derived Engram cache from that reverted authority and its revert receipt lineage; block delivery or the next apply on mismatch.

## Dependencies

- Node 24 LTS, registry access, GitHub Actions, and official tool docs.

## Success Criteria

- [ ] Clean install reproduces the lockfile under enforced Node 24 LTS.
- [ ] Evidence shows local RED→GREEN; reviewed candidate is green.
- [ ] Format-check, typecheck/build, lint/static, test, and application/toolchain CI pass.
- [ ] Before freeze, the same authoritative Git candidate enables strict TDD, populates commands/testing metadata, and passes final checks without post-freeze source mutation.
- [ ] After native review allows that exact candidate, cache evidence records config identity, Engram observation/revision, readback, and receipt lineage; mismatch blocks delivery or the next apply.
- [ ] Authored scope is ≤400 lines; lockfile burden is separate.

## Next Change

`bootstrap-minimum-trust-kernel`: first strict-TDD product behavior for deterministic risk and deny-by-default authority, without persistence/adapters.
