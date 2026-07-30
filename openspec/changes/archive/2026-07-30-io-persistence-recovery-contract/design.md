# Design: IO Persistence Recovery Contract

## Technical Approach

This documentation-only change makes persistence and recovery semantics normative in a new `io-persistence-recovery-contract` capability. It carries R1–R17 and ADR-0001/0002/0003 invariants from `io-ports-trust-contract`, then modifies that source contract to hand persistence concerns to the new capability without duplication. The specs define required outcomes and explicit downstream boundaries; they do not select runtime mechanisms.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Capability ownership | Create a focused persistence/recovery capability and a ports/trust delta | Add all semantics to `io-ports-trust-contract` | Keeps authority/port topology separate from durable-state and recovery obligations while preserving a single normative source per concern. |
| Normative level | Specify invariants, state outcomes, and recovery paths only | DDL, ORM/repository, retry values, or provider workflows | The proposal expressly defers these choices; outcome contracts remain durable through implementation changes. |
| Transaction boundary | One business aggregate plus technical control records per atomic command | Cross-context transactions or shared aggregates | Preserves the `io-domain-contract` ID/port boundary and makes audit, snapshots, idempotency, and outbox obligations jointly recoverable. |
| External uncertainty | Require durable attempts, `UNKNOWN` reconciliation, and human terminal escalation | Retry after timeout or claim exactly-once | An external side effect may have happened; reconciliation prevents duplicate effects and gives unrecoverable cases an auditable disposition. |

## Data Flow

```text
Business command
  └─> one aggregate transaction
       ├─> immutable authority snapshot + R1–R17 records
       ├─> terminal idempotency + audit + optional outbox
       └─> commit or rollback

External/daemon/LLM attempt ─> proven outcome
                         └─> UNKNOWN ─> reconcile ─> terminal / human decision
```

PostgreSQL is contractual business authority. Cross-context changes use messages, saga, or process coordination; no implementation, transport, or execution topology is introduced by this change.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/io-persistence-recovery-contract/design.md` | Create | This technical design for the documentation/specification change. |
| `openspec/changes/io-persistence-recovery-contract/specs/io-persistence-recovery-contract/spec.md` | Reference only | New normative contract for ownership, atomicity, audit/privacy, recovery, and receipts. |
| `openspec/changes/io-persistence-recovery-contract/specs/io-ports-trust-contract/spec.md` | Reference only | Delta that transfers persistence/recovery semantics by capability reference. |
| `openspec/specs/io-persistence-recovery-contract/spec.md` | Create on archive | Canonical promoted capability. |
| `openspec/specs/io-ports-trust-contract/spec.md` | Modify on archive | Applies the handoff delta without copying semantics. |

## Interfaces / Contracts

No code interface is introduced. The normative contract requires: neutral cross-context IDs; immutable embedded authorization/risk/SOD/policy/approval/evidence snapshots; R1–R17 carriage; at-least-once messaging with durable effect-before-dedup; scoped monotonic fencing; and immutable receipt fields whose hash is local integrity only. Required terminal terms include `UNKNOWN` and `UNRESOLVED_REQUIRES_HUMAN`. Receipt signing, key custody, canonicalization, DDL, crypto-erasure, retry values, and provider deduplication guarantees remain downstream.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Contract review | R1–R17, recovery matrix, and all normative scenarios | Trace each requirement to the proposal/exploration and ADR invariants; confirm excluded mechanisms are absent. |
| Delta review | Handoff ownership | Confirm the ports/trust delta references the new capability and does not redefine its semantics. |
| Archive readiness | Canonical promotion | Verify the new spec and modified ports/trust requirement merge without loss or duplication. |

No unit, integration, E2E, or RED tests are added: this change has no runtime implementation. Future implementation must add RED tests for each applicable normative scenario.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is introduced by this documentation/specification change.

## Migration / Rollout

No runtime migration required. On archive, promote the new capability to `openspec/specs/io-persistence-recovery-contract/spec.md` and apply the `io-ports-trust-contract` delta. Validate that the prior record list remains intact and persistence semantics have one normative owner.

## Open Questions

- [ ] Downstream implementation/design must choose storage schema, repository approach, retry/dead-letter policy, receipt canonicalization/signing, key custody, and privacy-erasure mechanism.
