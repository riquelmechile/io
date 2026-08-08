# Delta for heartbeat

## MODIFIED Requirements

### Requirement: Declared Material Event Types

`MATERIAL_EVENT_TYPES` MUST remain `['work.completed']`; an event MUST be material iff declared there. `heartbeat.decision` MUST remain undeclared, MUST NOT renew novelty, and MUST NOT feed `compileContext`; segment 12 MUST remain absent.

(Previously: Undeclared events were non-material without naming the decision event.)

#### Scenario: Declared event is material
- GIVEN an event whose type is `work.completed`
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
