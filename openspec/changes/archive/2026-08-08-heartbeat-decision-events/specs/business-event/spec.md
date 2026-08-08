# Delta for business-event

## MODIFIED Requirements

### Requirement: Append-Only Repository Port

`BusinessEventRepository` MUST expose `append(event)`, `appendIfAbsent(event)`, `listByCompany(companyId)`, and read-only `listCompanyIds()`, with no update, delete, or overwrite operation. `append` MUST throw on duplicate identity. `appendIfAbsent` MUST insert at most once and MUST no-op on duplicate while preserving the original row. The existing `business_event` table and `uq_business_event_event_id` MUST support both operations without migration.

(Previously: The port exposed only throwing append and read operations.)

#### Scenario: Port surface prevents mutation
- GIVEN the repository contract
- WHEN its operations are inspected
- THEN only the two append semantics and read-only listings MUST be available

#### Scenario: Duplicate conditional append preserves the original
- GIVEN an event ID and its original persisted row
- WHEN `appendIfAbsent` receives another event with that ID
- THEN it MUST no-op and the original row MUST remain byte-for-byte unchanged

#### Scenario: PostgreSQL conditional append is single-issuance
- GIVEN concurrent conditional appends with one event ID
- WHEN the live PostgreSQL operations complete sequential verification
- THEN exactly one original row MUST exist without a schema migration

### Requirement: Model-Independent Event Facts

Worker events MUST derive only from terminal-close facts. Supervisor decision events MUST have `eventType: 'heartbeat.decision'`, `aggregateKind: 'heartbeat'`, `aggregateId: companyId`, `source: 'supervisor'`, and payload `{ decision, model?, cursor }`, where `decision` is the decision kind, `model` is `flash` only for activation, and absent cursors are `null`. LLM output MUST NOT alter any event field. An injectable clock MAY set `occurredAt`, but time MUST NOT affect identity. No new runtime dependency is permitted; `openai` MUST remain confined to `packages/llm-client/src/deepseek-client.ts`, `business-domain` MUST have zero `@io/*` imports, and `packages/context` dependencies MUST remain exactly `@io/business-domain`.

(Previously: Model independence covered only worker terminal-close facts.)

#### Scenario: Model output cannot change a worker event
- GIVEN equal terminal-close facts and different LLM outputs
- WHEN events are built
- THEN the resulting events MUST be identical

#### Scenario: Supervisor fact contains only gate inputs and outcome
- GIVEN a company, cursor, decision, and injected clock
- WHEN its decision event is built
- THEN its shape and payload MUST match the contract
- AND changing only the clock MUST change no identity field

### Requirement: Idempotent Single Emission

Worker terminal close MUST emit at most once with `eventId = evt:{attemptId}` and duplicate `append` MUST throw. Every supervisor evaluation MUST emit at most once with `eventId = evt:hb:{sha256(companyId \0 (cursor ?? ∅) \0 decision.kind).hex.slice(0,16)}`. Identical identity inputs MUST produce the same event ID; `occurredAt` MUST be excluded. The emitter prefixes MUST remain disjoint.

(Previously: Only worker `evt:{attemptId}` identity and duplicate rejection were specified.)

#### Scenario: Completed replay does not append
- GIVEN a completed attempt with its event persisted
- WHEN that attempt is replayed
- THEN no second worker event MUST be appended

#### Scenario: Duplicate throwing append is rejected
- GIVEN an event ID is persisted
- WHEN `append` receives that event ID again
- THEN persistence MUST throw and preserve the original event

#### Scenario: Decision identity is deterministic
- GIVEN equal company, cursor, and decision-kind inputs with different clocks
- WHEN decision event IDs are built
- THEN both MUST equal the same `evt:hb:{digest}` identity

#### Scenario: Retry conditionally appends once
- GIVEN a supervisor retry with the same unadvanced cursor and decision
- WHEN `appendIfAbsent` receives the rebuilt event
- THEN exactly one original decision event MUST remain
