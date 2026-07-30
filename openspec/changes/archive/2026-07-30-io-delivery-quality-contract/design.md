# Design: IO Delivery Quality Contract

## Technical Approach

This documentation-only change promotes delivery governance into the new `io-delivery-quality-contract` capability. Its delta is the normative cross-cutting policy; the `development-toolchain` delta is deliberately an alignment seam, not a second source of truth. The design traces to the proposal and both delta specs, while current authority for active delivery configuration remains the reviewed `openspec/config.yaml` Git candidate.

## Architecture Impact

No application architecture, runtime component, CI workflow, receipt provider, or toolchain is introduced. The contract defines the boundary between SDD dispatch/review evidence and future concrete toolchain implementation:

```text
Reviewed Git candidate + openspec/config.yaml (authority)
  -> native provider review receipt (provider-owned schema)
  -> allowed review state -> verify dispatch / archive
  -> derived Engram cache (post-review only; never candidate authority)
```

## Architecture Decisions

| Decision | Choice | Alternative | Rationale |
|---|---|---|---|
| Policy ownership | New delivery-quality capability owns cross-cutting delivery rules. | Duplicate them in `development-toolchain`. | One normative owner prevents drift while retaining toolchain-specific realization. |
| Receipt boundary | Consume provider-owned repository review receipts; do not define their schema. | Define an IO receipt model here. | The proposal excludes redesign; future business receipts are separately product-owned. |
| Authority | Reviewed Git candidate and current `openspec/config.yaml` are authoritative; Engram is derived. | Treat cache as a committed/equivalent artifact. | Preserves candidate identity and prevents false distributed atomicity claims. |
| Delta promotion | Promote the new capability, then merge only the alignment requirement into canonical `development-toolchain`. | Copy delivery requirements into both specs. | Avoids collisions with its existing concrete strict-TDD, CI, cache, lockfile, and rollback requirements. |

## Data / Model Impact

No application data model or repository receipt schema changes. Contractual state terms are referenced only: review readiness (`ready_final_verification`, `final_verifying`) and CI applicability, requirement, and outcome dimensions. Provider receipt fields and validation remain opaque external contracts.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/io-delivery-quality-contract/design.md` | Create | Design and archive plan. |
| `openspec/changes/io-delivery-quality-contract/specs/io-delivery-quality-contract/spec.md` | Reference | New normative delivery contract. |
| `openspec/changes/io-delivery-quality-contract/specs/development-toolchain/spec.md` | Reference | Minimal conformity delta. |
| `openspec/specs/io-delivery-quality-contract/spec.md` | Create on archive | Canonical promoted contract. |
| `openspec/specs/development-toolchain/spec.md` | Modify on archive | Add alignment requirement only. |

## Review / Verification Strategy

| Layer | What to verify | Approach |
|---|---|---|
| Contract review | Proposal constraints and six new requirements | Trace each requirement/scenario; confirm no implementation or tool selection is invented. |
| Collision review | Existing toolchain ownership | Compare the delta with canonical requirements; retain concrete mechanics there and reference the contract. |
| Archive review | Clean promotion | Promote new spec, apply the one alignment addition, and check each rule has one normative owner. |

No unit, integration, E2E, or RED tests are created: no executable behavior changes. Future dispatcher/CI/provider integrations must add RED tests for their applicable behaviors before implementation.

## Threat Matrix

The contract documents future routing and VCS/PR policy but introduces no executable routing, shell, subprocess, VCS/PR automation, or process-integration boundary. All rows are N/A; therefore no RED tests are planned in this documentation-only change.

| Boundary | Applicability | Design response / planned RED tests |
|---|---|---|
| Documentation-like paths | N/A — no classifier/executor | None. |
| Git repository selection | N/A — no Git command integration | None. |
| Commit state | N/A — no commit automation | None. |
| Push state | N/A — no push automation | None. |
| PR commands | N/A — no PR command integration | None. |

## Risks / Tradeoffs

Over-specification is avoided by keeping tools and workflows downstream. The tradeoff is that future implementations must map policy to provider APIs. Stale state is mitigated by treating current `openspec/config.yaml`, not exploration/cache claims, as authority.

## Migration / Rollback

No runtime migration. During archive, create the canonical new spec and apply the minimal `development-toolchain` alignment delta after duplicate-ownership review. Rollback reverts the documentation change and removes its promoted delta; no product, data, CI, or toolchain state changes require restoration.

## Open Questions

- [ ] Which future dispatcher/provider integration will implement native-review state routing and its RED tests?
