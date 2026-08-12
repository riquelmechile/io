# Delta for business-event

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Idempotent Single Emission

Worker terminal close MUST emit at most once with `eventId = evt:{attemptId}` where the worker `attemptId` follows the grammar `att:{companyId}:{idempotencyKey}` (full worker identity `evt:att:{companyId}:{idempotencyKey}`), and duplicate `append` MUST throw. Every supervisor evaluation MUST emit at most once with `eventId = evt:hb:{sha256(companyId \0 (cursor ?? ∅) \0 decision.kind).hex.slice(0,16)}`. Each accept transition MUST emit at most once with `eventId = evt:acc:{workId}`. Identical identity inputs MUST produce the same event ID; `occurredAt` MUST be excluded from all three identities. The three identities share the `evt:` root and MUST be kept collision-free: the segment immediately after `evt:` is exactly one of three disjoint namespaces — `att:` (worker, `evt:att:{companyId}:{idempotencyKey}`), `hb:` (supervisor), or `acc:` (acceptor, `evt:acc:{workId}`). Collision freedom follows from these disjoint namespaces plus EXCLUSIVE builder/source ownership — each ID is produced by exactly ONE builder and MUST carry its matching exclusive `source` (`worker`, `supervisor`, `acceptor`) — plus the `uq_business_event_event_id` unique constraint as persistence backstop.

(Previously: Only worker `evt:{attemptId}` and supervisor `evt:hb:{digest}` identities existed.)

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

#### Scenario: Acceptance identity is deterministic and namespaced

- GIVEN equal `workId` with different clocks and LLM outputs
- WHEN acceptance event IDs are built
- THEN both MUST equal `evt:acc:{workId}`
- AND the `acc:` segment MUST be produced only by the acceptor builder with `source: 'acceptor'`, distinct from the `hb:` supervisor namespace and the `att:{companyId}:{idempotencyKey}` worker namespace

#### Scenario: Retry conditionally appends once

- GIVEN a supervisor retry with the same unadvanced cursor and decision
- WHEN `appendIfAbsent` receives the rebuilt event
- THEN exactly one original decision event MUST remain
