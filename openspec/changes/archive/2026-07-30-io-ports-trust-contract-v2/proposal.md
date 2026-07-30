# Proposal: IO Ports Trust Contract v2

## Intent

Convert the approved exploration into a spec/design-ready trust contract for IO's hexagonal ports. The change resolves the prior handoff by separating product surfaces from ports, enforcing command-bound authority, and carrying ADR-0001/0002/0003 rules without adding runtime implementation.

## Scope

### In Scope
- Define product surfaces, inbound use-case ports, and driven-port credential boundaries.
- Specify command-bound authority envelopes and mandatory revalidation points.
- Carry ADR-0001 role, ADR-0002 delegation, and ADR-0003 risk/SOD rules into the ports trust contract.
- Enumerate required audit, recovery, receipt, authority, daemon, and LLM records for downstream design.

### Out of Scope
- Runtime code, schemas, migrations, vault/HSM design, process isolation, lease protocol, idempotency, and replay.
- Concrete policy threshold values for non-source-reserved risk tiers.
- Notification channels and cross-daemon reconciliation protocol details.

## Capabilities

### New Capabilities
- `io-ports-trust-contract`: Defines IO product surface separation, hexagonal port trust boundaries, command-bound authority envelopes, daemon credential restrictions, ADR authority rules, and required persistence/recovery records.

### Modified Capabilities
- `io-domain-contract`: Resolve its deferred ports/trust handoff by moving default-deny mechanism, classification-before-authority, no-aggregate-sharing enforcement, and traceable downstream records into the new ports trust contract.

## Approach

Use the approved exploration as the sole source for proposal scope. Specs should capture behavior and invariants first; design should choose mechanisms later. Treat daemon access as authenticated command/result exchange only, with no direct PostgreSQL or DeepSeek credentials. Treat DeepSeek output as untrusted proposal data that must re-enter the full authority pipeline.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/io-ports-trust-contract/spec.md` | New | New normative contract for port topology, authority envelope, ADR carry, and required records. |
| `openspec/specs/io-domain-contract/spec.md` | Modified | Replace deferred ports/trust handoff with references to the new resolved capability. |
| `openspec/changes/io-ports-trust-contract-v2/` | Modified | Add proposal, then specs/design/tasks in later phases. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Spec overreaches into design mechanisms | Medium | Keep schema, vault, leases, idempotency, and reconciliation details downstream. |
| Authority gaps from incomplete ADR carry | Medium | Specs must encode ADR-0001/0002/0003 invariants and deny-on-any-failure behavior. |
| Daemon trust boundary ambiguity | Medium | Require no direct PG/DeepSeek access and signed result return through authenticated ports. |

## Rollback Plan

Revert this change's proposal/spec/design/tasks artifacts and keep the existing `io-domain-contract` deferred handoff unchanged. No runtime state or code is affected.

## Dependencies

- Approved exploration: `openspec/changes/io-ports-trust-contract-v2/exploration.md`.
- Existing ADR-0001, ADR-0002, ADR-0003 authority decisions.

## Success Criteria

- [ ] Specs can be generated without inventing requirements beyond the exploration.
- [ ] New and modified capabilities are explicit and traceable.
- [ ] Rollback and downstream exclusions are clear to reviewers.
