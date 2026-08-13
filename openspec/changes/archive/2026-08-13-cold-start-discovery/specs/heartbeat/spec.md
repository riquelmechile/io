# Delta for heartbeat

## MODIFIED Requirements

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
