# Proposal: Domain Foundation

## Intent

Build Company, Delegation, Work, and BusinessReceipt domain types with lifecycle invariants (ADR-0001/0002/0003), async repository ports, and PG-backed persistence. Foundation for the first enterprise vertical; zero external dependencies.

## Scope

### In Scope

- **Company** — `companyId`, `purpose` (doc §4: identity and scope, NOT a global aggregate)
- **Delegation** — delegator, delegate, authority scope, budget, duration, escalation, revocation, expected outcome; lifecycle `draft → active → revoked | expired` (ADR-0002)
- **Work** — execution state, deliverable, acceptance, evidence refs, outcome; lifecycle `proposed → accepted → in_progress → completed → verified | rejected` (ADR-0002)
- **BusinessReceipt** — immutable, persisted; links Work ID + Delegation authority + identity + policy + evidence + terminal state + artifact hash (doc §9.8)
- State machines with transition guards; async repository ports; PG adapters; in-memory fakes; SQL schema (4 tables)

### Out of Scope

- LLM/DeepSeek (Change 2), worker/orchestration (Change 3), HTTP/CLI, full org hierarchy, memory system, modifications to existing source

## Capabilities

### New Capabilities

- `company-identity`: Company type — tenant scope, minimal identity
- `delegation-lifecycle`: Delegation aggregate + state machine (ADR-0002 invariants)
- `work-lifecycle`: Work aggregate + state machine (ADR-0002 invariants)
- `business-receipt`: BusinessReceipt immutable aggregate (Work + Delegation + identity + terminal state)

### Modified Capabilities

None.

## Approach

- **Domain**: `packages/business-domain/` (transitional, mirrors trust-kernel) — types, state machines, validation, async ports, fakes. Zero infra deps.
- **PG adapters**: NEW files in `packages/database/src/` over existing `DbConnection`. SQL in adapters.
- **Schema**: `packages/database/sql/002_create_business_tables.sql` — idempotent `CREATE TABLE IF NOT EXISTS`.
- **Cross-aggregate refs**: neutral string IDs (`workId`, `delegationId`); no aggregate imports another.

## Design Considerations (for sdd-design)

- Delegation has no canonical package in the 30-package taxonomy — placement deferred
- BusinessReceipt ≠ `UnsignedInMemoryReceipt` (kernel receipt = trust artifact; business receipt = persisted record with artifact hash)
- PG schema: SERIAL PKs, snake_case→camelCase via `AS` aliases, JSONB for nested fields

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Over-architecting types (doc risk #1) | High | Company minimal; Delegation/Work only ADR-0002 fields |
| Exceeds 400-line budget | Medium | Split into domain-types + domain-persistence |
| Receipt type confusion | Medium | Separate packages; distinct names |

## Rollback Plan

Delete `packages/business-domain/`, remove new adapter files/SQL from `packages/database/`, `DROP TABLE company, delegation, work, business_receipt`. No existing code modified.

## Dependencies

`DbConnection` port (reused). ADR-0001/0002/0003 invariants.

## Success Criteria

- [ ] 4 types are pure (zero infra deps)
- [ ] State machines reject invalid transitions
- [ ] Ports async, driver-free, generic
- [ ] PG adapters round-trip all 4 types against real PostgreSQL
- [ ] Fakes enable unit testing without PG
- [ ] No existing code modified; 264 existing tests pass
