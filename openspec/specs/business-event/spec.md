# business-event

## Purpose

The worker cycle ends at a *technical* terminal record (receipt + journal). The architecture mandates a *business-fact* record produced deterministically — never model-judged — that later slices consume (heartbeats, skills, Increment-5 memory, segment 12). This capability creates it: the first append-only business-fact stream, written atomically with its producing change.

## Requirements

### Requirement: Pure Deterministic BusinessEvent

`business-domain` SHALL define a pure `BusinessEvent` carrying `eventId`, `companyId`, `aggregateKind`, `aggregateId`, `eventType`, `occurredAt`, `payload`, and `source`. Construction SHALL be deterministic from terminal-close facts. The package SHALL have zero `@io/*` imports and no runtime dependency; `openai` SHALL remain confined to `llm-client`. The exclusive worker-owned `work.skill-outcome` builder SHALL produce one non-material composite event with `source: 'worker'`, `aggregateKind: 'work'`, `aggregateId` equal to the closed Work, and a minimal versioned payload containing only `version` and the intent-captured `activatedSkills` identities and versions.

(Previously: construction defined no skill-outcome builder or payload contract.)

#### Scenario: Event construction is deterministic and isolated
- GIVEN identical terminal-close facts
- WHEN two business events are constructed
- THEN the events SHALL be equal
- AND boundary tests SHALL find no `@io/*` import or runtime dependency in `business-domain`

#### Scenario: Composite empty selection is recorded
- GIVEN a verified terminal close whose intent captured no activated Skills
- WHEN its skill-outcome event is built
- THEN one event SHALL contain a versioned payload with an empty `activatedSkills` list

### Requirement: Read-Only Company Discovery

`listCompanyIds()` MUST return each company represented in the event log once through a read-only distinct `company_id` selection. It MUST NOT append, update, delete, or otherwise mutate events.

(Previously: discovery reflected a worker-terminal-only emitted universe; a zero-event company was permanently undiscoverable.)

#### Scenario: Discovery returns distinct companies

- GIVEN interleaved events for companies A and B with repeated company IDs
- WHEN company IDs are listed
- THEN A and B MUST each appear exactly once

#### Scenario: Discovery preserves event facts

- GIVEN a snapshot of the append-only event log
- WHEN `listCompanyIds()` executes
- THEN the snapshot MUST remain unchanged
- AND terminal-close facts MUST remain the only `worker`-emitted events, and acceptance facts MUST remain the only `acceptor`-emitted events

#### Scenario: Acceptance makes a zero-event company discoverable

- GIVEN a company with zero events whose first Work is accepted
- WHEN the `work.accepted` event commits
- THEN `listCompanyIds()` MUST include that company exactly once

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

`finalizeInFlightWorkAtomically` SHALL append one `work.completed` event and exactly one `work.skill-outcome` event in the same transaction as Work CAS, receipt save, and `journal.complete`. The skill-outcome event SHALL be emitted only for a verified successful close; replay and typed failure dispositions, including `invalid-plan`, `denied`, and `recovery-required`, SHALL emit no skill-outcome event.

(Previously: terminal close appended only one `work.completed` event.)

#### Scenario: Terminal close commits its events
- GIVEN an in-progress Work whose CAS succeeds
- WHEN terminal close commits
- THEN the Work, receipt, journal completion, `work.completed`, and one skill-outcome event SHALL commit together

#### Scenario: CAS loss leaves no orphan event
- GIVEN a concurrent writer wins the Work CAS
- WHEN terminal close rolls back
- THEN neither event from the losing attempt SHALL remain

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

Worker terminal close SHALL emit at most once with `eventId = evt:{attemptId}` where the worker `attemptId` follows the grammar `att:{companyId}:{idempotencyKey}` (full worker identity `evt:att:{companyId}:{idempotencyKey}`), and duplicate `append` SHALL throw. Every verified terminal close SHALL additionally emit at most one skill-outcome with `eventId = evt:sk:att:{companyId}:{idempotencyKey}`. Every supervisor evaluation SHALL emit at most once with `eventId = evt:hb:{sha256(companyId \0 (cursor ?? ∅) \0 decision.kind).hex.slice(0,16)}`. Each accept transition SHALL emit at most once with `eventId = evt:acc:{workId}`. Identical identity inputs SHALL produce the same event ID; `occurredAt` SHALL be excluded from all identities. The four namespaces after `evt:` SHALL be disjoint: `att:` (worker completion), `sk:` (worker skill outcome), `hb:` (supervisor), and `acc:` (acceptor). Each ID SHALL have exactly one builder and matching exclusive source: `worker` owns `att:` and `sk:`, `supervisor` owns `hb:`, and `acceptor` owns `acc:`; `uq_business_event_event_id` SHALL remain the persistence backstop. `work.skill-outcome` SHALL NOT enter `MATERIAL_EVENT_TYPES` or alter heartbeat behavior. Existing records SHALL NOT be backfilled.

(Previously: only `att:`, `hb:`, and `acc:` namespaces existed.)

#### Scenario: Completed replay does not append
- GIVEN a completed attempt with its event persisted
- WHEN that attempt is replayed
- THEN no second worker event SHALL be appended

#### Scenario: Duplicate throwing append is rejected
- GIVEN an event ID is persisted
- WHEN `append` receives that event ID again
- THEN persistence SHALL throw and preserve the original event

#### Scenario: Decision identity is deterministic
- GIVEN equal company, cursor, and decision-kind inputs with different clocks
- WHEN decision event IDs are built
- THEN both SHALL equal the same `evt:hb:{digest}` identity

#### Scenario: Acceptance identity is deterministic and namespaced
- GIVEN equal `workId` with different clocks and LLM outputs
- WHEN acceptance event IDs are built
- THEN both SHALL equal `evt:acc:{workId}`
- AND the `acc:` segment SHALL be produced only by the acceptor builder with `source: 'acceptor'`, distinct from `hb:`, `att:`, and `sk:`

#### Scenario: Retry conditionally appends once
- GIVEN a supervisor retry with the same unadvanced cursor and decision
- WHEN `appendIfAbsent` receives the rebuilt event
- THEN exactly one original decision event SHALL remain

#### Scenario: Skill-outcome identity is deterministic and non-material
- GIVEN equal company and idempotency-key inputs with different clocks and pre-change Work
- WHEN skill-outcome IDs are built and heartbeat evaluates the log
- THEN both IDs SHALL equal `evt:sk:att:{companyId}:{idempotencyKey}`, heartbeat behavior SHALL remain unchanged, and no historical event SHALL be synthesized

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

### Requirement: Atomic Acceptance Event Emission

A successful `proposed → accepted` transition MUST append exactly one `work.accepted` event in the same PostgreSQL transaction as the Work CAS. The event MUST carry `eventId = evt:acc:{workId}`, `eventType: 'work.accepted'`, `aggregateKind: 'work'`, `aggregateId: workId`, and `source: 'acceptor'`. The CAS and the append MUST commit or roll back together — there MUST be no accepted Work without its event and no acceptance event without the accepted Work. The determinism contract is three-part: (1) `eventId` is determined SOLELY by `workId`; (2) the other non-time routing/typing/payload fields (`companyId`, `aggregateKind`, `aggregateId`, `eventType`, `source`, `payload`) are deterministic from the accepted Work facts — LLM output, randomness, and generated identifiers MUST NOT alter them; (3) `occurredAt` MAY derive from an injected `now` and MUST remain excluded from identity. The event MUST be built by a pure `business-domain` function with zero `@io/*` imports. Single issuance is guaranteed by the one-shot `proposed → accepted` transition, backed by `uq_business_event_event_id`.

(Previously: no acceptance event existed; acceptance committed only the Work CAS.)

#### Scenario: Successful acceptance commits one event atomically

- GIVEN proposed Work that wins its acceptance CAS
- WHEN the transaction commits
- THEN exactly one `work.accepted` event with `eventId = evt:acc:{workId}` and `source: 'acceptor'` MUST be persisted with the accepted Work

#### Scenario: Crash between CAS and append is impossible

- GIVEN an acceptance transaction that fails after the CAS succeeds
- WHEN it rolls back
- THEN neither the accepted Work mutation NOR any event MUST remain

#### Scenario: Only the accept transition emits work.accepted

- GIVEN any non-acceptance transition (`propose`, `start`, `complete`, `verify`, `reject`) alongside the existing supervisor `heartbeat.decision` emission
- WHEN each is executed
- THEN only `accept` MUST append a `work.accepted` event
- AND `complete` MUST remain free to append `work.completed` and the supervisor to append `heartbeat.decision` (this requirement constrains only `work.accepted`)

#### Scenario: Pre-change accepted Work is not backfilled

- GIVEN Work already in `accepted` before this change with no event
- WHEN discovery and heartbeat run
- THEN no `work.accepted` event MUST be synthesized for it
- AND no migration or backfill MUST occur (emission covers future acceptances only)

#### Scenario: Cold-start chain is provable through the real path

- GIVEN a zero-history company and no `seedAcceptedWork`-style direct seed
- WHEN Work is proposed and accepted through the real use cases and the supervisor tick is pumped (discovery via `listCompanyIds` → `evaluateHeartbeatGate` → `onActivate`)
- THEN the company MUST be discovered by `listCompanyIds`, the gate MUST return `activate`, dispatch MUST run the worker, and the Work MUST reach `completed` with a `work.completed` event
- AND the test MUST NOT call `onActivate`/`onRecovery` directly with a hardcoded company in place of discovery; no existing test is a precedent for this path
