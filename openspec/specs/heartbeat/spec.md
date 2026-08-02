# heartbeat

Deterministic novelty filter that decides `no-llm-heartbeat | activate flash` from a company's BusinessEvent fact stream via a caller-supplied cursor. Zero model involvement in the decision; materiality is a declared extensible constant; novelty is cursor-defined, never clock-defined.

## Purpose

Gates every model activation behind a deterministic filter (§13.2) that decides whether there is material novelty. If there is not — the system emits a no-LLM heartbeat (cheap, no model invocation). If there is — it activates Flash (the model). The timer triggers *when* to evaluate; the filter decides *whether*. Cost is part of reasoning (§2): the model is the expensive resource; the filter decides whether an activation is justified.

## Requirements

### Requirement: Pure Heartbeat Decision

`business-domain` MUST define `HeartbeatDecision` as `{ kind: 'activate', model: 'flash' } | { kind: 'no-llm-heartbeat' }`, deterministically and without `@io/*` imports or runtime dependencies.

#### Scenario: Decision type remains pure

- GIVEN a valid decision branch
- WHEN constructed repeatedly
- THEN the values MUST be equal
- AND boundary checks MUST find no forbidden import or dependency

### Requirement: Declared Material Event Types

`MATERIAL_EVENT_TYPES` MUST declare `['work.completed']`. An event MUST be material iff its `eventType` is in that extensible set.

#### Scenario: Declared event is material

- GIVEN an event whose `eventType` is `work.completed`
- WHEN materiality is evaluated
- THEN the event MUST be material

#### Scenario: Undeclared event is not material

- GIVEN an undeclared `eventType`
- WHEN materiality is evaluated
- THEN the event MUST NOT be material

### Requirement: Deterministic Novelty Filter

`hasMaterialNovelty(events, cursor)` and `evaluateHeartbeat(events, cursor)` MUST depend only on those inputs, never clocks, LLMs, randomness, or generated identifiers.

#### Scenario: Equal inputs produce equal decisions

- GIVEN identical events and cursor
- WHEN `evaluateHeartbeat` is called repeatedly
- THEN every decision MUST be identical

#### Scenario: Ambient nondeterminism is unavailable

- GIVEN fixed events and a fixed cursor
- WHEN clocks, randomness, and identifier sources vary
- THEN the result MUST remain unchanged

### Requirement: Cursor-Defined Novelty

Novelty MUST mean a material event follows the cursor, never that it is recent. An absent cursor MUST precede all events.

#### Scenario: Unseen material event activates Flash

- GIVEN an absent cursor and a stream containing `work.completed`
- WHEN the heartbeat is evaluated
- THEN it MUST return `{ kind: 'activate', model: 'flash' }`

#### Scenario: Cursor has seen all material events

- GIVEN a cursor at or after the last material event
- WHEN the heartbeat is evaluated
- THEN it MUST return `{ kind: 'no-llm-heartbeat' }`

#### Scenario: Cursor is ahead of the stream

- GIVEN a cursor after every supplied event
- WHEN the heartbeat is evaluated
- THEN it MUST return `{ kind: 'no-llm-heartbeat' }`

### Requirement: No-LLM Decision Guarantee

The decision MUST derive only from events and cursor. Its signature MUST admit no model/LLM, work, delegation, or dynamic context.

#### Scenario: Surrounding world cannot poison the decision

- GIVEN identical inputs with different work, delegation, and dynamic context
- WHEN each surrounding world evaluates the heartbeat
- THEN both decisions MUST be identical
- AND no model capability MUST be available

### Requirement: Read-Only Evaluator Seam

The app evaluator MUST return the domain decision after calling `BusinessEventRepository.listByCompany(companyId)`. It MUST NOT write or mutate state.

#### Scenario: Evaluator reads and decides

- GIVEN unseen `work.completed` for a company
- WHEN the app evaluator runs with that company and cursor
- THEN it MUST call `listByCompany` and return the Flash activation decision

#### Scenario: Evaluation performs zero writes

- GIVEN a repository that records every operation
- WHEN the app evaluator runs
- THEN one tenant-scoped list operation MUST occur
- AND no write or state mutation MUST occur

### Requirement: Tenant-Scoped Evaluation

Every evaluation MUST require a non-empty `companyId`. Other companies' events MUST NOT affect its decision.

#### Scenario: Cross-tenant events are isolated

- GIVEN company A has unseen material events and company B has none
- WHEN company B is evaluated
- THEN company B MUST receive `{ kind: 'no-llm-heartbeat' }`

#### Scenario: Empty company scope is rejected

- GIVEN an empty `companyId`
- WHEN evaluation is requested
- THEN the request MUST be rejected before reading events

### Requirement: Stable-Prefix Isolation

Heartbeat decisions/content MUST NOT feed `compileContext` or become leading content. `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`.

#### Scenario: Context boundary remains unchanged

- GIVEN any heartbeat decision
- WHEN context inputs and package dependencies are inspected
- THEN `compileContext` MUST admit no heartbeat input
- AND `packages/context` MUST depend at runtime only on `@io/business-domain`
