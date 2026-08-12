# Delta for work-lifecycle

## ADDED Requirements

### Requirement: Atomic Acceptance Fact

The `accept` transition MUST, on a successful CAS, append a deterministic `work.accepted` business event in the same transaction as the Work CAS. The accept use case MUST be wired with a business-event repository, and the Work and event repositories MUST be bound to one transaction-scoped connection. Typed acceptance failures (`version-conflict`, `invalid-transition`, `not-found`, `invalid-command`) MUST persist NEITHER the Work mutation NOR any event. Because the shared transaction commits on a resolved value (commit-on-resolved), the use case MUST resolve every typed failure BEFORE any write — a preflight short-circuit over the loaded Work (the verified `applyWorkTransition` behavior: `invalid-command` and `not-found` return before any write; `invalid-transition` and `expectedVersion` mismatch return after read-only checks; a lost CAS returns the concurrent winner without writing) — and MUST return `{ ok: false, reason, current? }` with no thrown control flow. A failure that occurs AFTER the CAS write (for example, a duplicate-event `append` that rejects) MUST propagate through the shared transaction so NEITHER the Work mutation NOR the event persists. Adding emission MUST NOT alter any other transition's behavior or typed-result contract. The use case MUST remain free of `@io/*` imports and MUST NOT use thrown exceptions for control flow.

(Previously: the accept transition performed the Work CAS only and emitted no event.)

#### Scenario: Successful accept commits Work and event together

- GIVEN proposed Work at version N
- WHEN the `accept` use case succeeds with expected version N
- THEN the Work MUST become `accepted` at version N + 1
- AND exactly one `work.accepted` event MUST commit in the same transaction

#### Scenario: Version-conflict commits no event

- GIVEN proposed Work whose stored version advanced past the caller's expected version
- WHEN the `accept` use case is invoked
- THEN it MUST return `{ ok: false, reason: 'version-conflict', current? }`
- AND the Work MUST be unchanged and no event MUST be appended

#### Scenario: Invalid-transition commits no event

- GIVEN Work already in a non-`proposed` state
- WHEN the `accept` use case is invoked
- THEN it MUST return `{ ok: false, reason: 'invalid-transition', current? }`
- AND no event MUST be appended

#### Scenario: Atomic rollback on post-CAS failure

- GIVEN an acceptance whose event `append` rejects after the Work CAS has written
- WHEN the rejection propagates through the shared transaction
- THEN the transaction MUST roll back and NEITHER the accepted Work mutation NOR the event MUST persist

#### Scenario: Other transitions keep their typed-failure behavior

- GIVEN the non-acceptance transitions and their documented typed failures
- WHEN each is executed
- THEN each MUST behave exactly as before this change
- AND this change MUST NOT add any new event emission to them; their pre-existing emissions (e.g. `complete` → `work.completed`) MUST remain unchanged
