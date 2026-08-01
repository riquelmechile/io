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

### Requirement: Append-Only Repository Port

`BusinessEventRepository` MUST expose only `append(event)` and `listByCompany(companyId)`. It MUST NOT expose update, delete, or overwrite operations.

#### Scenario: Port surface prevents mutation

- GIVEN the repository contract
- WHEN its operations are inspected
- THEN only those operations MUST be available

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

The worker MUST build the event only from terminal Work state, receipt fields, `evidenceId`, `attemptId`, and actor. LLM output MUST NOT select, judge, or alter any event field.

#### Scenario: Model output cannot change the event

- GIVEN equal terminal-close facts and different LLM outputs
- WHEN events are built
- THEN the resulting events MUST be identical

### Requirement: Idempotent Single Emission

Each terminal close MUST produce at most one event. `eventId` MUST be `evt:{attemptId}`; persistence MUST reject duplicates.

#### Scenario: Completed replay does not append

- GIVEN a completed attempt with its event already persisted
- WHEN the same attempt is replayed
- THEN no second event MUST be appended

#### Scenario: Duplicate identity is rejected

- GIVEN an event ID persisted
- WHEN another append uses that event ID
- THEN persistence MUST reject it and preserve the original event

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
