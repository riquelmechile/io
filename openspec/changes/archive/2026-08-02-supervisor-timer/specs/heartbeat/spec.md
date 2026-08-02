# Delta for heartbeat

## ADDED Requirements

### Requirement: Pure Tail Cursor

`tailCursor(events)` MUST return `{ lastEventId }` for the final event in stream order, or no cursor for an empty stream. It MUST be pure and MUST NOT access clocks, LLMs, randomness, or `@io/*` imports.

#### Scenario: Non-empty stream returns its tail
- GIVEN an ordered stream with multiple events
- WHEN `tailCursor` is evaluated
- THEN it MUST return the final event's ID as `lastEventId`

#### Scenario: Empty stream has no cursor
- GIVEN an empty event stream
- WHEN `tailCursor` is evaluated
- THEN it MUST return no cursor without consulting ambient state

### Requirement: Per-Company Heartbeat Cursor Store

`HeartbeatCursorStore` MUST expose tenant-scoped `get(companyId)` and atomic `upsert(companyId, cursor)` operations. An upsert MUST create or replace exactly one checkpoint for that company without affecting another company.

#### Scenario: Missing checkpoint is absent
- GIVEN a company with no cursor row
- WHEN its cursor is read
- THEN the store MUST return no cursor

#### Scenario: Atomic upsert preserves tenant isolation
- GIVEN cursors for companies A and B
- WHEN company A's cursor is upserted
- THEN a later read MUST return A's new cursor and B's unchanged cursor

### Requirement: Pure Port and Supervisor-Only Writes

The cursor port and `tailCursor` MUST remain in `business-domain` with zero `@io/*` imports. Only the supervisor MAY write cursors; the existing gate and evaluator MUST remain read-only and unchanged.

#### Scenario: Gate cannot checkpoint itself
- GIVEN an evaluation on either decision path
- WHEN cursor-store operations are observed
- THEN the gate and evaluator MUST perform zero cursor writes
- AND business-domain boundary checks MUST find no `@io/*` imports
