# Tasks: IO Persistence Recovery Contract

> Documentation-only contract change; specs already exist. **Routing order**:
> `sdd-apply` (now) completes + checks off the tasks below → `sdd-verify`
> writes `verify-report.md` (never an apply checkbox) → `sdd-archive` promotes
> canonical specs. No runtime code, no RED tests (threat matrix N/A).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500–650 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Validate new-capability contract (R1–R17, recovery matrix) | PR 1 | Review requirements vs `exploration.md` + ADR-0001/0002/0003; confirm downstream mechanisms excluded | N/A — doc-only, no runtime | Revert `proposal.md`, `design.md`, `specs/io-persistence-recovery-contract/spec.md` |
| 2 | Resolve ports/trust handoff by reference + promote at archive | PR 2 | Delta review: MODIFIED refs new capability, no duplication; resolved-handoff scenario updated intentionally | N/A — doc-only, no runtime | Revert `specs/io-ports-trust-contract/spec.md` + delete `openspec/specs/io-persistence-recovery-contract/` |

## Phase 1: New-Capability Contract Validation (sdd-apply)

- [x] 1.1 Confirm all 10 requirements + scenarios present and complete.
- [x] 1.2 Ownership: PG sole authority; PG-down rejects mutations, stateless read-only only.
- [x] 1.3 Transaction Boundary: state + immutable snapshot + audit (R16) + idempotency + outbox atomic.
- [x] 1.4 Records: R1–R17 present; R10 (Work↔Delegation) + R15 (Work ID + authority) dual-reference identifiable.
- [x] 1.5 Append-Only/Privacy: DB controls (not app booleans); mandated delete = true hard delete; tombstone only if legal.
- [x] 1.6 Idempotency: scoped/serialized/atomic; rollback leaves no orphan; key reuse w/ different hash DENIED.
- [x] 1.7 Outbox/Inbox: same-tx, effect-before-dedup, at-least-once only, dead-letter after max retries.
- [x] 1.8 Fencing: token scoped/monotonic; expired holder cannot commit; no auto-retry external effects.
- [x] 1.9 UNKNOWN Recovery: reconcile before retry, `UNRESOLVED_REQUIRES_HUMAN` terminal, non-compensable escalates.
- [x] 1.10 Receipt (R15): hash = local integrity only (no non-repudiation); signing/custody/anchoring deferred.
- [x] 1.11 Recovery Matrix: all 7 failure rows (safe action + terminal + human path); idempotency-orphan ruled out.

## Phase 2: Ports/Trust Delta Validation (sdd-apply)

- [x] 2.1 Confirm `specs/io-ports-trust-contract/spec.md` MODIFIES required-records requirement to carry semantics into the new capability.
- [x] 2.2 Confirm delta references new capability with NO duplication; R1–R17 table intact; resolved-handoff scenario updated intentionally, unchanged preserved.

## Phase 3: Traceability & Threat-Matrix Review (sdd-apply)

- [x] 3.1 Trace every requirement/scenario to `exploration.md` + ADR-0001/0002/0003 via [SRC]/[INF]/[ADR]/[HYP] labels, each cited once.
- [x] 3.2 Cross-check delta scenarios do not contradict new-capability scenarios.
- [x] 3.3 Confirm threat-matrix rows N/A with reasons; no RED tests required.

## Phase 4: Archive Readiness (prepared in apply; executed at sdd-archive)

- [x] 4.1 Confirm promotion path: `openspec/specs/io-persistence-recovery-contract/spec.md` created at archive.
- [x] 4.2 Confirm ports/trust MODIFIED delta applies at archive preserving R1–R17 + scenarios; semantics from new capability only.
- [x] 4.3 Confirm archive folder `YYYY-MM-DD-io-persistence-recovery-contract`; destructive-delta warning satisfied (MODIFIED).
