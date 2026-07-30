# Proposal: IO Persistence Recovery Contract

## Intent

Define IO's persistence, audit, idempotency, outbox/inbox, lease fencing, external-call recovery, privacy deletion, and receipt integrity contract before implementation. This closes the downstream mechanism gap left by the ports/trust contract while preserving PostgreSQL as the only business-authoritative state source.

## Scope

### In Scope
- PostgreSQL authoritative state ownership and per-capability record ownership.
- Single-aggregate transaction boundary with immutable authorization/risk/SOD/policy/approval/evidence snapshots.
- Append-only audit, privacy-compliant hard deletion, idempotency, outbox/inbox, fencing, UNKNOWN recovery, daemon/LLM attempts, PG-down behavior, receipts, and recovery matrix.

### Out of Scope
- SQL DDL, schema/index design, ORM/repository selection, and concrete code.
- Retry constants, DLQ retention values, provider-specific dedup guarantees.
- Receipt signing, key custody, transparency-log anchoring, and crypto-erasure/redaction ADR.

## Capabilities

### New Capabilities
- `io-persistence-recovery-contract`: Persistence and recovery semantics for authoritative state, audit, idempotency, messaging, leases, external effects, receipts, privacy deletion, and failure recovery.

### Modified Capabilities
- `io-ports-trust-contract`: Treat required records R1-R17 as carried into the new persistence/recovery contract and resolve downstream mechanism handoffs for idempotency, leases, daemon/LLM outcomes, receipts, and recovery.

## Approach

Create a focused OpenSpec capability from the approved exploration. Keep mechanisms normative at the contract level, label downstream implementation details explicitly, and use delta specs to link the existing ports/trust record requirements to the new contract.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/io-persistence-recovery-contract/spec.md` | New | Source capability after archive. |
| `openspec/specs/io-ports-trust-contract/spec.md` | Modified | Handoff from required records to persistence/recovery semantics. |
| `openspec/changes/io-persistence-recovery-contract/` | New/Modified | Proposal, delta specs, design, tasks, and verification artifacts. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-specifying implementation | Med | Keep DDL, ORM, constants, signing, and crypto mechanisms downstream. |
| False exactly-once assumptions | Med | State at-least-once only; require inbox safety and UNKNOWN reconciliation. |
| Privacy/audit conflict | Med | Require true hard delete when mandated; tombstones only when legally permitted. |

## Rollback Plan

Revert this change folder and any archived spec deltas. The prior ports/trust contract remains authoritative with persistence mechanisms explicitly downstream.

## Dependencies

- Approved exploration `sdd/io-persistence-recovery-contract/explore`.
- Existing `io-ports-trust-contract` and `io-domain-contract` boundaries.

## Success Criteria

- [ ] New capability captures all 17 required records and recovery semantics from the approved exploration.
- [ ] Existing ports/trust spec links to the new contract without duplicating implementation detail.
- [ ] No code, DDL, ORM, signing, or crypto-erasure mechanism is finalized.
