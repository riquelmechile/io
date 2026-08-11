# Delta for work-lifecycle

## ADDED Requirements

### Requirement: Operator Recovery Designation

Recovery designation MUST be operational repository metadata, not a Work field or lifecycle transition. The domain `Work` type and `WORK_TRANSITIONS` MUST remain unchanged; `in_progress → completed` MUST remain the only outgoing edge from `in_progress`. A designation request MUST be an explicit operator action, MUST use expected-version CAS, MUST increment `version`, MUST preserve state and fencing token, and MUST return a typed result without thrown control flow. It MUST NOT depend on age, lease, heartbeat, or a clock. The business-domain implementation MUST retain zero `@io/*` imports. Successful recovery and `UNRESOLVED_REQUIRES_HUMAN` escalation MUST clear the marker so another attempt requires explicit re-designation. [REQ] [INF]

#### Scenario: Designation preserves lifecycle state
- GIVEN `in_progress` Work at version N
- WHEN an operator designates it for recovery with expected version N
- THEN state MUST remain `in_progress` and version MUST become N + 1

#### Scenario: Designation fences stale-version zombies without a new token
- GIVEN a worker holding version N and fencing token T
- WHEN designation succeeds
- THEN stored version MUST become N + 1, token MUST remain T, and the stale version-N close MUST fail

#### Scenario: Recovery metadata stays outside Work
- GIVEN the public domain `Work` type and transition table
- WHEN their fields and edges are inspected
- THEN no recovery marker or new `in_progress` edge MUST exist

#### Scenario: Unresolved escalation permits explicit re-designation
- GIVEN a designated recovery returns `UNRESOLVED_REQUIRES_HUMAN`
- WHEN escalation is recorded
- THEN the marker MUST be cleared and no later recovery MUST run until an operator designates again
