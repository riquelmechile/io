# heartbeat

Deterministic novelty filter that decides `no-llm-heartbeat | activate flash | activate pro` from a company's BusinessEvent fact stream via a caller-supplied cursor. Zero model involvement in the decision; materiality is a declared extensible constant; novelty is cursor-defined, never clock-defined. Pro escalation (§13.2) selects `pro` only when novel material events carry `riskClass ≥ high`; otherwise defaults to `flash`. The timer triggers *when* to evaluate; the filter decides *whether* and at *which tier*. Cost is part of reasoning (§2): the model is the expensive resource; the filter decides whether an activation is justified and which tier.

## Purpose

Gates every model activation behind a deterministic filter (§13.2) that decides whether there is material novelty. If there is not — the system emits a no-LLM heartbeat (cheap, no model invocation). If there is — it activates Flash (the model). The timer triggers *when* to evaluate; the filter decides *whether*. Cost is part of reasoning (§2): the model is the expensive resource; the filter decides whether an activation is justified.

## Requirements

### Requirement: Deterministic Model-Tier Escalation

For an activation, the domain MUST select `pro` iff at least one novel material event after the cursor has a valid `payload.riskClass` at or above `PRO_ESCALATION_THRESHOLD = 'high'` (`high` or `critical`); otherwise it MUST select `flash`. Selection MUST be a pure function of `(events, cursor)` and MUST NOT consult `occurredAt`, clocks, LLMs, or randomness. No risk-signal producer is introduced, so absent or invalid facts MUST remain cost-safe as `flash`.

#### Scenario: Threshold and above select Pro

- GIVEN novel material events carrying `high` or `critical` risk
- WHEN the heartbeat is evaluated after the cursor
- THEN the activation model MUST be `pro`

#### Scenario: Below, absent, invalid, or seen risk defaults to Flash

- GIVEN risk is `low`, `medium`, absent, invalid, non-material, or at/before the cursor
- WHEN the heartbeat is evaluated with material novelty
- THEN the activation model MUST be `flash`

#### Scenario: Ambient nondeterminism cannot affect tier

- GIVEN identical events and cursor while clock, LLM output, and randomness vary
- WHEN model selection is repeated
- THEN every selected model MUST be identical

### Requirement: Pure Heartbeat Decision

`business-domain` MUST define `HeartbeatDecision` as `{ kind: 'activate', model: 'flash' | 'pro' } | { kind: 'no-llm-heartbeat' }`, deterministically and with zero `@io/*` imports or runtime dependencies.

#### Scenario: Decision type remains pure

- GIVEN a valid decision branch
- WHEN constructed repeatedly
- THEN the values MUST be equal
- AND boundary checks MUST find no forbidden import or dependency

### Requirement: Declared Material Event Types

`MATERIAL_EVENT_TYPES` MUST be `['work.accepted', 'work.completed']`; an event MUST be material iff declared there. `heartbeat.decision` MUST remain undeclared, MUST NOT renew novelty, and MUST NOT feed `compileContext`; segment 12 MUST remain absent. Novelty MUST continue to be governed solely by the per-company cursor — the cursor is the ONLY novelty guard; `work.accepted` MUST NOT introduce any second guard, any reactivation rule, or any clock-derived trigger.

(Previously: Material set was `['work.completed']` only; acceptance was not material.)

#### Scenario: Declared completed event is material

- GIVEN an event whose type is `work.completed`
- WHEN materiality is evaluated
- THEN the event MUST be material

#### Scenario: Declared accepted event is material

- GIVEN an event whose type is `work.accepted`
- WHEN materiality is evaluated
- THEN the event MUST be material

#### Scenario: Undeclared event is not material

- GIVEN an undeclared event type
- WHEN materiality is evaluated
- THEN the event MUST NOT be material

#### Scenario: Decision events neither renew novelty nor context

- GIVEN a cursor followed only by `heartbeat.decision` events
- WHEN heartbeat and context behavior are observed
- THEN the decision MUST be `no-llm-heartbeat`
- AND compiled context bytes MUST remain unchanged with segment 12 absent

#### Scenario: Accepted event at or before the cursor does not activate

- GIVEN a cursor at or after a `work.accepted` event and no later material event
- WHEN the heartbeat is evaluated
- THEN it MUST return `{ kind: 'no-llm-heartbeat' }`

#### Scenario: Cursor remains the sole novelty guard

- GIVEN two or more novel `work.accepted` events for one company
- WHEN the heartbeat is evaluated once with the cursor unchanged
- THEN exactly one `activate` decision MUST result
- AND no second reactivation guard or clock trigger MUST influence the decision

> Operational note (unchanged cursor semantics): an activation that does not produce a further material event — e.g. a settled typed failure downstream of dispatch — does NOT renew novelty. The next accepted Work then waits for the next accept or completion event. This is the pre-existing cursor behavior, not a new rule.

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
