# Proposal: Harden First Enterprise Vertical Foundation

## Intent

The domain foundation (Increments 1–3) is structurally correct but operationally unsafe for the first enterprise vertical. Verified gaps: SoD permits self-approval at low risk (`proposer≠approver` missing from `ABSOLUTE_PAIRS`); grants with future `start` are treated as active; no `companyId` tenant scope on aggregates; no UNIQUE constraints; no `DbConnection.transaction()`; no Work versioning (last-write-wins); no idempotency pre-effect; no transition use cases (raw `save()` mutates state); no runtime input validation. This change hardens all 7 areas so the vertical can execute governed actions safely.

## Scope

### In Scope
- Fix `ABSOLUTE_PAIRS`: add `proposer≠approver`; enforce SoD at transition time, not just kernel-action time
- Add `isWindowActive(start, now, expiry)` + future-start rejection for grants, temp roles, delegations
- Add `companyId` to `Work`, `Delegation`, `BusinessReceipt`; company-scoped repository reads
- Add `DbConnection.transaction(fn)` (PG `BEGIN/COMMIT/ROLLBACK` + in-memory fake)
- Add UNIQUE constraints on `company_id`, `delegation_id`, `work_id`, `receipt_id`; `UNIQUE(work_id, terminal_event_id)` for receipts
- Add Work `version` field + optimistic compare-and-set; explicit conflict on stale version
- Add idempotency-key store + attempt journal (pre-effect registration; same-key+same-hash→replay; same-key+different-hash→DENY)
- Add transition use cases: `propose` / `accept` / `start` / `complete` / `verify` / `reject`
- Add runtime validation guards at edges (command input, PG rows, structured LLM plan)
- CI: Postgres service; integration tests no longer silently skipped

### Out of Scope
- DeepSeek client, worker process, sandbox execution (vertical change)
- Cross-aggregate sagas / outbox-inbox delivery (Increment 5+)
- Cryptographic receipts / transparency-log anchoring (architecture doc §9.8: deferred decision)
- Semantic memory, organizational hierarchy

## Capabilities

### New Capabilities
- `runtime-validation`: guards at system edges — validate command input shape, PG rows read back, and structured LLM plans before domain logic runs; reject invalid inputs and illegal transitions explicitly rather than trusting TypeScript types alone

### Modified Capabilities
- `trust-kernel`: add `proposer≠approver` to absolute SoD pairs; add `isWindowActive(start, now, expiry)` shared helper; reject future-start grants/assignments as inactive (step 12 becomes a window gate)
- `company-identity`: enforce `companyId` as mandatory tenant scope on all business operations
- `delegation-lifecycle`: add `companyId`; add window-active activation check; define delegation use cases
- `work-lifecycle`: add `companyId` + `version`; define transition use cases with SoD enforcement, optimistic concurrency, and transactional closure
- `business-receipt`: add `companyId` + `terminal_event_id`; enforce `UNIQUE(work_id, terminal_event_id)` single-issuance
- `db-connection-port`: add `transaction(fn)` method; add UNIQUE constraints to business tables

## Approach

Deliver as 3 chained PRs (Slice A: authority+scope → Slice B: persistence+concurrency → Slice C: use-cases+idempotency+validation). Each slice ships RED→GREEN under strict TDD, stays ≤400 changed lines, and is independently reviewable. Transactions are added to the driver-free `DbConnection` port as `transaction(fn: (tx) => Promise<T>): Promise<T>`; the in-memory fake simulates atomicity. Work optimistic concurrency uses `version` compare-and-set via `UPDATE ... WHERE version = $expected`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/trust-kernel/src/sod.ts` | Modified | Add `proposer≠approver` to ABSOLUTE_PAIRS |
| `packages/trust-kernel/src/model.ts` | Modified | Add `isWindowActive()` shared helper |
| `packages/trust-kernel/src/grant.ts`, `identity.ts`, `pipeline.ts` | Modified | Enforce `start <= now` window check |
| `packages/business-domain/src/types.ts` | Modified | Add `companyId`, Work `version`, Receipt `terminalEventId` |
| `packages/business-domain/src/use-cases/` | New | Transition use cases with SoD + concurrency |
| `packages/database/src/connection.ts` | Modified | Add `transaction(fn)` to `DbConnection` |
| `packages/database/src/pg-connection.ts` | Modified | Implement `BEGIN/COMMIT/ROLLBACK` |
| `packages/database/sql/002_create_business_tables.sql` | Modified | UNIQUE constraints + new columns |
| `.github/workflows/` | Modified | Postgres service for CI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking 411 existing tests | Low | All changes are additive; existing fixtures satisfy new constraints |
| In-memory transaction fake hides partial-failure bugs | Medium | Fake rolls back on thrown error; test explicit rollback paths |
| Optimistic concurrency port-surface change breaks adapters | Medium | Add `updateWithVersion()` alongside `save()`; deprecate blind INSERT for transitions |
| Scope creep into vertical orchestration | Medium | Strict out-of-scope list; use cases stop at domain transition, not execution |

## Rollback Plan

Each PR slice is independently revertible. Slice A reverts SoD/window changes (delete the pair, remove helper). Slice B reverts transaction + UNIQUE (drop columns/constraints, remove method). Slice C deletes the use-case layer. No production data exists (greenfield), so schema changes need no data migration.

## Dependencies

- Node 24 LTS runtime (already bootstrapped, ADR 0004)
- PostgreSQL 18.4 for integration tests (CI service addition)
- Architecture doc §9.8 (single-aggregate transaction principle), §13.3 (risk-tiered SoD), ADR-0002/0003

## Success Criteria

- [ ] `proposer≠approver` enforced at every risk tier; self-approval DENIED even at low risk with combination policy
- [ ] Future-start grants/assignments/delegations are inactive (window gate rejects)
- [ ] All business aggregates carry `companyId`; unscoped reads return nothing
- [ ] `DbConnection.transaction(fn)` provides atomic multi-statement execution (PG + fake)
- [ ] UNIQUE constraints prevent duplicate business keys; `UNIQUE(work_id, terminal_event_id)` enforces single receipt issuance
- [ ] Work versioning detects concurrent state change; stale write raises explicit conflict
- [ ] Idempotency key + request hash replayed on match, DENIED on mismatch
- [ ] Transition use cases replace raw `save()` for state changes
- [ ] Runtime guards reject malformed command input, corrupt PG rows, invalid LLM plans
- [ ] 411 existing tests stay GREEN; new tests added per slice
- [ ] CI runs integration tests against real Postgres (no silent skips)
