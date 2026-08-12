# Proposal: Cold-Start Discovery

## Intent

Make accepted Work discoverable and dispatchable. Acceptance currently emits no BusinessEvent, so a zero-history company is absent from supervisor discovery and its Work remains `accepted`.

## Scope

### In Scope
- Emit deterministic `work.accepted` only after a successful acceptance CAS, in the same PostgreSQL transaction.
- Make `work.accepted` material while preserving cursor novelty and event-log discovery.
- Prove accept → discovery → activation → dispatch → completion through the real path.

### Out of Scope
- Company/work-table discovery, a second reactivation guard, or supervisor/gate redesign.
- Events for other transitions or taxonomy expansion.
- Memory, learning, separation-of-duties, risk producers, CI stubs, and unrelated test restructuring.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `heartbeat`: Add `work.accepted` to material event types; retain cursor-only novelty.
- `business-event`: Define disjoint acceptance-event identity and atomic emission.
- `work-lifecycle`: Require acceptance and its event to commit atomically without changing typed failures.

## Approach

Adopt Approach A. Widen `acceptWork` through ports, build a retry-stable event with a third disjoint prefix, and run CAS plus append on one transaction-scoped connection. Keep `listCompanyIds`, heartbeat, and dispatch unchanged; the cursor remains the sole novelty guard. Add unit, live-PostgreSQL atomicity, spec-seam, and real-path e2e coverage without `seedAcceptedWork`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/business-domain/src/use-cases/accept-work.ts` | Modified | Emit the typed acceptance fact after CAS success. |
| `packages/business-domain/src/heartbeat.ts` | Modified | Extend material event types. |
| `packages/database/src/` | Modified | Add transaction-scoped acceptance wiring. |
| `packages/app/test/e2e/` | New | Exercise the unbypassed cold-start path. |
| `openspec/specs/{heartbeat,business-event,work-lifecycle}/spec.md` | Modified | Receive deltas. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Crash leaves accepted Work eventless | Med | One transaction; rollback tests. |
| Retry duplicates or collides with another emitter | Med | Deterministic third prefix plus unique event identity. |
| Settled typed failure parks the next Work | Med | Preserve documented cursor semantics; expose as an operational limitation. |

## Rollback Plan

Revert emission, transactional wiring, materiality, tests, and deltas together. Retain appended facts as immutable history; undeclared facts no longer activate.

## Dependencies

- Event repository, transaction seam, cursor, and pump.

## Proposal Question Round

- Backfill existing accepted Work? Assumption: no migration; cover future acceptance.
- Change settled-failure behavior? Assumption: no; another material event remains required.
- Emit other transition events? Assumption: no; acceptance only.

## Success Criteria

- [ ] Successful acceptance commits one deterministic event atomically; typed failures commit neither mutation.
- [ ] A zero-history company is discovered and its accepted Work reaches completion through the supervisor path.
- [ ] Existing cursor, prefix-disjointness, domain-boundary, and no-bypass constraints remain verified.
