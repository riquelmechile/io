# business-event

## Purpose

The worker cycle ends at a *technical* terminal record (receipt + journal). The architecture mandates a *business-fact* record produced deterministically — never model-judged — that later slices consume (heartbeats, skills, Increment-5 memory, segment 12). This capability creates it: the first append-only business-fact stream, written atomically with its producing change.

## Requirements

### Requirement: Pure Deterministic BusinessEvent

`business-domain` MUST define a pure `BusinessEvent` carrying `eventId`, `companyId`, `aggregateKind`, `aggregateId`, `eventType`, `occurredAt`, `payload`, and `source`. Construction MUST be deterministic from terminal-close facts. The package MUST have zero `@io/*` imports and no runtime dependency; `openai` MUST remain confined to `llm-client`.

#### Scenario: Event construction is deterministic and isolated

- GIVEN identical terminal-close facts
- WHEN two business events are constructed
- THEN the events MUST be equal
- AND boundary tests MUST find no `@io/*` import or runtime dependency in `business-domain`

### Requirement: Read-Only Company Discovery

`listCompanyIds()` MUST return each company represented in the event log once through a read-only distinct `company_id` selection. It MUST NOT append, update, delete, or otherwise mutate events.

#### Scenario: Discovery returns distinct companies

- GIVEN interleaved events for companies A and B with repeated company IDs
- WHEN company IDs are listed
- THEN A and B MUST each appear exactly once

#### Scenario: Discovery preserves event facts

- GIVEN a snapshot of the append-only event log
- WHEN `listCompanyIds()` executes
- THEN the snapshot MUST remain unchanged
- AND terminal-close facts MUST remain the only worker-emitted events

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

### Requirement: Ordered In-Memory Repository

`InMemoryBusinessEventRepository` MUST append without replacement and return company events in insertion order, matching PostgreSQL reads.

#### Scenario: Fake preserves append order

- GIVEN interleaved events for two companies
- WHEN one company's events are listed
- THEN its events MUST be returned in insertion order

### Requirement: Insert-Only PostgreSQL Persistence

`PgBusinessEventRepository` MUST use `INSERT` only. `006_business_events.sql` MUST create `business_event` with non-null event fields, unique `event_id`, `company_id`, and tenant-read indexes. `parseBusinessEventRow` MUST reject malformed rows. A boundary guard MUST reject adapter SQL containing `UPDATE` or `DELETE`.

#### Scenario: PostgreSQL round-trip is guarded

- GIVEN an event persisted to live PostgreSQL
- WHEN it is listed for its company
- THEN all fields MUST round-trip through `parseBusinessEventRow`

#### Scenario: Mutation SQL is prohibited

- GIVEN the PostgreSQL adapter source
- WHEN its write statements are inspected
- THEN `INSERT` MUST be present and `UPDATE` and `DELETE` MUST be absent

### Requirement: Atomic Worker Terminal Emission

`finalizeInFlightWorkAtomically` MUST append one `work.completed` event in the same transaction as Work CAS, receipt save, and `journal.complete`.

#### Scenario: Terminal close commits one event

- GIVEN an in-progress Work whose CAS succeeds
- WHEN terminal close commits
- THEN the Work, receipt, journal completion, and exactly one event MUST commit together

#### Scenario: CAS loss leaves no orphan event

- GIVEN a concurrent writer wins the Work CAS
- WHEN terminal close rolls back
- THEN no event from the losing attempt MUST remain

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

### Requirement: Tenant-Scoped Event Log

Every event MUST carry a non-empty `companyId`; every read MUST require a company and MUST NOT return another company's events.

#### Scenario: Cross-tenant events are isolated

- GIVEN events belonging to companies A and B
- WHEN events are listed for company A
- THEN no company B event MUST be returned

### Requirement: Stable-Prefix Isolation

This capability MUST NOT feed business events into `compileContext`; segment 12 MUST remain absent. `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`.

#### Scenario: Context remains unchanged

- GIVEN persisted business events
- WHEN `compileContext` runs for the same input as before this capability
- THEN compiled context bytes MUST be unchanged and segment 12 MUST be absent
