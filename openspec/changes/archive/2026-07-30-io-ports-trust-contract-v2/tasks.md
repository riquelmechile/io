# Tasks: IO Ports Trust Contract v2

> Documentation-only formalization. Proposal, design, and both specs already
> exist; `apply` is validation/integrity work. Canonical spec promotion happens
> at `archive`. No runtime code, no RED tests (threat matrix all N/A).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450–600 across the change (proposal/design/2 specs/tasks + canonical promotion at archive) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 new-capability contract → PR 2 domain delta + archive promotion |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Finalize + validate new `io-ports-trust-contract` normative contract | PR 1 | Citation + field review vs `exploration.md` and ADR-0001/0002/0003 (doc-only: no `pnpm test` applies) | N/A — documentation-only, no runtime behavior to exercise | Revert `proposal.md`, `design.md`, `specs/io-ports-trust-contract/spec.md`; `io-domain-contract` deferred handoff stays unchanged |
| 2 | Resolve `io-domain-contract` handoff by reference + promote canonical specs at archive | PR 2 | Delta review: both MODIFIED requirements reference the new capability, no duplication; unchanged scenarios preserved and resolved-handoff scenarios intentionally updated | N/A — documentation-only, no runtime behavior to exercise | Revert `specs/io-domain-contract/spec.md` delta + delete `openspec/specs/io-ports-trust-contract/`; `io-domain-contract` reverts to deferred state |

## Phase 1: New-Capability Contract Validation (apply)

- [x] 1.1 Confirm `specs/io-ports-trust-contract/spec.md` has all 7 requirements: Product/Port Separation, Command-Bound Authority Envelope, Default-Deny Reserved Categories, SOD Tiers, Bounded Role Model, Delegation Separation & Conservative Revocation, R1–R17 Records.
- [x] 1.2 Validate the envelope carries every required field (work_id/step_id, principal_id/position_id, authority_commitment_id, action_scope, assignment_id, policy_version, risk_class, budget_reservation, approvals/evidence, expiry/revocation_state, sod_decision, invocation_id/command_id).
- [x] 1.3 Validate the fixed 16-step evaluation ordering and DENY-on-any-failure invariant.
- [x] 1.4 Validate ADR carry cited once per requirement: ADR-0001 roles, ADR-0002 delegation, ADR-0003 risk/SOD; the 5 source-reserved categories are never autonomously delegated.
- [x] 1.5 Validate boundary IDs are neutral `principal_id`/`position_id` (never package entities); daemon holds NO direct PG/DeepSeek credentials.
- [x] 1.6 Validate R1–R17 are enumerated with scope; R10 and R15 carry the Work ID + Delegation/policy-authority dual-reference.
- [x] 1.7 Validate downstream exclusions are explicit: no vault/HSM, lease, idempotency, schema/DDL, reconciliation, or policy thresholds finalized here.

## Phase 2: Domain Delta Validation (apply)

- [x] 2.1 Confirm `specs/io-domain-contract/spec.md` resolves the deferred handoff exactly once (Deny-by-Default Authority, Contract Meta-Handoff).
- [x] 2.2 Confirm default-deny mechanism, classification ordering, no-aggregate-sharing, and required records reference `io-ports-trust-contract` with no mechanism duplication.
- [x] 2.3 Confirm H1–H6 are dispositioned: H1–H3 excluded, H4 enforced, H5/H6 resolved; no outstanding handoff remains.

## Phase 3: Traceability & Threat-Matrix Review (verify prep)

- [x] 3.1 Verify every requirement/scenario traces to `exploration.md` + ADRs via [SRC]/[INF]/[ADR]/[HYP] labels, each cited once.
- [x] 3.2 Cross-check delta scenarios do not contradict the new-capability scenarios.
- [x] 3.3 Confirm all threat-matrix rows are N/A with reasons (no classifier/executor/VCS/commit/push/PR automation designed); no RED tests required.

## Phase 4: Verify Readiness

- [x] 4.1 Confirm requirement/scenario counts are stable and match design; no runtime/unit/integration/E2E tests apply (documentation-only).
  - Verify phase obligation: `sdd-verify` must produce `verify-report.md` attesting traceability + unique delta resolution. This is not an apply checkbox because native task routing requires apply-owned checkboxes to be complete before verify can run.

## Phase 5: Archive Readiness

- [x] 5.1 Confirm the new-capability promotion path: `openspec/specs/io-ports-trust-contract/spec.md` created at archive.
- [x] 5.2 Confirm the domain `MODIFIED` delta replaces the full requirement block, preserves unchanged scenarios exactly, and intentionally updates scenarios whose requirement status changed from deferred to resolved.
- [x] 5.3 Confirm archive folder `YYYY-MM-DD-io-ports-trust-contract-v2`; destructive-delta warning satisfied (delta is MODIFIED, non-destructive).
