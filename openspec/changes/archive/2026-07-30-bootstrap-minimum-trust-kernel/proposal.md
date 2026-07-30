# Proposal: Bootstrap Minimum Trust Kernel

## Intent

Create IO's first strict-TDD product behavior: a persistence-free trust kernel proving identity, deterministic risk, deny-by-default authority, SOD, evidence/audit, and honest in-memory receipts before adapters or storage.

## Scope

### In Scope
- Add transitional `packages/trust-kernel/` with pure TypeScript domain logic and unit tests.
- Implement the minimum flow: principal/position identity, risk class, explicit grant check, SOD, evidence/audit entry, and receipt.
- Scope the 16-step pipeline to persistence-free checks: classification, authority, identity, assignment, bounded scope, evidence, SOD, expiry/revocation, action scope, and final deny/allow.
- Document later split into `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, and `audit/`.

### Out of Scope
- Persistence, adapters, HTTP, database, daemon, LLM, or external frameworks.
- Hardened delegation lifecycle, policy-version store, budget reservation, real approval chains, persistent R1-R17 records, cryptographic receipts.
- Final canonical package layout.

## Capabilities

### New Capabilities
- `trust-kernel`: Minimum in-memory authority evaluation behavior for Increment 2.

### Modified Capabilities
- `io-ports-trust-contract`: Define which 16-step pipeline checks are enforceable without persistence and which remain downstream hardening.
- `io-domain-contract`: Document `packages/trust-kernel/` as a transitional package before canonical package extraction.

## Approach

Use strict TDD to drive pure functions and in-memory records. Tests define RED first, then GREEN behavior for deny-by-default decisions, SOD failures, deterministic risk, evidence, audit, and receipts. No state survives process memory.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/trust-kernel/` | New | Transitional domain module and tests. |
| `tsconfig*.json`, `vitest.config.ts` | Modified | Include package in check/build/test gates if required. |
| `pnpm-workspace.yaml` | Modified | Add `packages/*` if workspace package support is needed. |
| `openspec/changes/bootstrap-minimum-trust-kernel/specs/` | New | Delta specs for trust behavior and transitional boundary. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 16-step pipeline overbuild | Med | Enforce only persistence-free steps; mark delegation/policy/budget/approval/records later. |
| Transitional package becomes permanent | Med | Record explicit future refactor targets in specs/design. |
| Receipt scope ambiguity | Low | Define honest receipt as in-memory, unsigned, non-persistent evidence summary. |
| 400-line budget pressure | Med | Keep one package and pure unit tests; auto-chain later if needed. |

## Rollback Plan

Revert the proposal/spec/design/tasks and any later package/config changes in one approved Git revert, returning to the toolchain-only baseline with no product package.

## Dependencies

- Existing strict-TDD toolchain and `pnpm check` gates.
- ADR 0001, ADR 0002, ADR 0003, roadmap Increment 2, `io-ports-trust-contract`, and `io-domain-contract`.

## Success Criteria

- [ ] Specs can trace every minimum trust-kernel behavior to roadmap/ADRs/contracts.
- [ ] Later implementation can be proven by RED-GREEN unit tests only.
- [ ] Deferred hardening is explicit and not accidentally implemented.
