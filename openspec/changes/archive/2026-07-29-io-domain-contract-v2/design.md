# Design: IO Domain Contract v2

## Technical Approach

Formalize the approved `exploration.md` into a documentation-only OpenSpec change. The delta specification is the reviewable contract; it preserves the explored 30-package classification, non-circular boundaries, and authority constraints without creating packages, source interfaces, storage, or runtime behavior. The existing root `src/toolchain-probe.ts` and its Vitest test are non-product toolchain proof and are not affected.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Semantic authority | Treat `exploration.md` as the sole approved semantic source; retain its `[SRC]`, `[ADR-*]`, `[INF]`, and `[HYP]` distinctions in downstream artifacts. | Re-derive rules from ADRs or add inferred mechanisms. | The proposal explicitly forbids new requirements and tool/mechanism decisions. |
| Boundary formalization | Specify IDs-by-value/ports, no shared transactional aggregates, and Delegation/Work separation; do not create interfaces or package directories. | Implement packages or define transport/persistence APIs. | This is a domain contract, while implementation is expressly out of scope. |
| Deferred ownership | Keep Delegation package placement and mechanism design open for the next ports/trust contract. | Assign Delegation to Communication, Work, or a new package now. | ADR-0002 settles ownership separation, but exploration defers package placement; selecting one would exceed the approved scope. |

## Data Flow

This change formalizes evidence, not runtime data flow:

```text
approved exploration + ADR-0001/0002
                  |
                  v
delta io-domain-contract specification
                  |
                  v
design/tasks documentation -> archive into main OpenSpec spec
```

The documented future domain crossing remains:

```text
Delegation authority ID -> Work reference -> coordination link
Communication transports requests/events only
```

No aggregate shares transaction state; authority is not granted by receiving work.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/io-domain-contract-v2/design.md` | Create | Records the documentation-only formalization and archive path. |
| `openspec/changes/io-domain-contract-v2/specs/io-domain-contract/spec.md` | Retain | Approved delta contract; no change in this phase. |
| `openspec/specs/io-domain-contract/spec.md` | Create at archive | Archive merges the new delta as the main contract source of truth. |

No application, package, test, configuration, ADR, or exploration files are changed.

## Interfaces / Contracts

The contract intentionally defines conceptual boundaries only:

```text
Cross-context reference = stable ID by value | port/interface
Shared transactional aggregate = prohibited
Delegation authority commitment != Work execution record
Work assignment = no ambient authority grant
```

Concrete port signatures, Delegation aggregate placement, action classification, default-deny mechanism, and grant lifecycle remain deferred to the next ports/trust contract, as required by H4-H6. H1-H3 remain excluded pure design hypotheses.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Documentation | Traceability and scope | Review that requirements map only to exploration/ADRs and preserve labels. |
| Runtime unit | N/A | No domain runtime code is introduced. |
| Integration/E2E | N/A | No executable integration boundary is introduced. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is changed.

## Migration / Rollout

No data migration or feature rollout is required. At archive, merge the approved delta into the new `openspec/specs/io-domain-contract/spec.md` and move the complete change directory to the dated OpenSpec archive; do not alter the approved exploration.

## Open Questions

- [ ] The next ports/trust contract must define Delegation placement, H5 action classification, and H6 default-deny/grant mechanics.
