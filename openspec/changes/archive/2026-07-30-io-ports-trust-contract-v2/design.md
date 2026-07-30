# Design: IO Ports Trust Contract v2

## Technical Approach

This documentation-only change formalizes the approved ports/trust exploration as a reviewable OpenSpec contract. It adds the new `io-ports-trust-contract` capability and resolves the two deferred `io-domain-contract` requirements by reference. It does not introduce runtime code, storage, deployment topology, or a mechanism for enforcement.

The design preserves the approved hexagonal boundary: Web/PWA and CLI are credential-free HTTP consumers; the server composition boundary owns driven-port credentials; the daemon exchanges authenticated commands and signed results through application ports. Authority is command-bound, revalidated at defined critical points, and default-deny. Specs remain the normative behavior source; ADR-0001/0002/0003 provide the cited invariant sources.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Contract location | New full change spec plus a delta for `io-domain-contract` | Embed all rules in the existing domain spec | Keeps ports/trust ownership explicit while resolving—not duplicating—the deferred handoff. |
| Boundary expression | Specify product surfaces, inbound use-case ports, driven-port custody, and neutral IDs | Name transports, packages, entities, or adapters as contracts | Preserves hexagonal and cross-context boundaries without prematurely fixing package/API design. |
| Authority expression | Specify envelope contents, evaluation ordering, and revalidation obligations | Select middleware, workflow, lease, or authorization implementation | Makes the security invariant reviewable while leaving mechanism choices downstream. |
| Record handoff | Enumerate R1–R17 as required auditable/recovery records | Define tables, schemas, DDL, or reconciliation protocol | Establishes traceable downstream obligations without constraining persistence design. |

## Data Flow

```text
Web/PWA or CLI ──HTTP──> server adapter ──> inbound use-case port
Daemon ──authenticated command/result exchange──> application port
                                             │
                         command-bound authority envelope
                                             │
                    validate → act/propose → required records
```

Every action follows classification before authority and denies on any failed check. DeepSeek output is untrusted proposal data and re-enters the authority pipeline; it cannot directly act or grant authority. The diagram is contractual, not a runtime/process implementation.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/io-ports-trust-contract-v2/design.md` | Create | Architecture, traceability, validation, and archive plan for this documentation change. |
| `openspec/changes/io-ports-trust-contract-v2/specs/io-ports-trust-contract/spec.md` | Reference only | New normative capability: boundaries, envelope, ADR carry, and R1–R17 records. |
| `openspec/changes/io-ports-trust-contract-v2/specs/io-domain-contract/spec.md` | Reference only | Delta resolving the prior ports/trust handoff. |

## Interfaces / Contracts

The change defines contracts, not code interfaces. An inbound port contract MUST declare input, output, authorization requirement, risk class, and evidence expectations. Boundary identifiers remain `principal_id` and `position_id`. The authority envelope includes work/step, principal/position, commitment, scope, assignment, policy/risk/budget, approvals/evidence, revocation/expiry, SOD, and invocation/command identity. These fields are semantic requirements; serialization, signing, transport, and storage are downstream.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Contract review | Requirements/scenarios trace to exploration and ADRs | Inspect citations, required fields, ordering, SOD, revocation, and R1–R17. |
| Delta review | Deferred handoff is resolved exactly once | Verify both changed domain requirements reference the new capability without duplicating mechanisms. |
| Archive readiness | Change specs merge cleanly into canonical specs | Confirm new capability promotion and domain delta application preserve requirement/scenario wording. |

No unit, integration, E2E, or RED tests are introduced: there is no runtime implementation. Future implementation must add tests for each normative scenario before production behavior.

## Threat Matrix

The matrix was reviewed because the contract describes a daemon boundary. No routing, shell command, subprocess, VCS/PR automation, executable-file classification, or implemented process integration is introduced; all rows are N/A.

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No classifier or executor is designed. |
| Git repository selection | N/A | No VCS command behavior. |
| Commit state | N/A | No commit automation. |
| Push state | N/A | No push automation. |
| PR commands | N/A | No PR automation. |

## Migration / Rollout

No migration required. This change is documentation-only. Archive promotes the new capability to `openspec/specs/io-ports-trust-contract/` and applies the `io-domain-contract` delta after confirming traceability and explicit downstream exclusions.

## Open Questions

- [ ] Downstream design must choose vault/HSM custody, lease/idempotency and recovery semantics, schemas/DDL, cross-daemon reconciliation, policy thresholds, and tools/libraries.
