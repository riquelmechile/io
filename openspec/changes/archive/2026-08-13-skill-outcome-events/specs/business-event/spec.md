# Delta for business-event

## MODIFIED Requirements

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
