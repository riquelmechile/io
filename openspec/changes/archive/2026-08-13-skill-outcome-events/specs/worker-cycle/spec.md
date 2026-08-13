# Delta for worker-cycle

## MODIFIED Requirements

### Requirement: Intent Recorded Before the Effect

The worker SHALL record intent and an idempotency key BEFORE executing any effect, via `insertInFlight` (the D6 pre-effect pattern). The durable in-flight record SHALL exist prior to the first external side effect. Intent preparation SHALL retain the exact `activatedSkills` selection surfaced by `compileContext`; it SHALL pass that immutable selection to finalization and SHALL NOT re-derive it after intent.

(Previously: intent recorded only the pre-effect idempotency state.)

#### Scenario: In-flight record precedes the effect
- GIVEN a cycle about to run its effect
- WHEN the worker reaches the effect step
- THEN `insertInFlight` SHALL be committed before `SandboxPort.execute` is called

#### Scenario: Version drift does not alter the outcome
- GIVEN a Skill version changes after intent was prepared
- WHEN the same cycle reaches verified finalization
- THEN its outcome SHALL use the selection captured at intent

### Requirement: Atomic Terminal Close

The worker SHALL close via `completeWorkAtomically`: journal decision → replay, DENY, or continue → token-checked Work CAS → one receipt → status-guarded journal completion, in one transaction. Replay SHALL be token-free. Continue SHALL supply the claim token; a stale token SHALL roll back every terminal mutation. Exactly one receipt SHALL exist per `(work_id, terminal_event_id)`. A verified successful continue SHALL atomically append `work.completed` and exactly one composite `work.skill-outcome`; all replay, denial, invalid-plan, recovery-required, and CAS-loss paths SHALL append no outcome.

(Previously: terminal close had no skill-outcome emission contract.)

#### Scenario: Replay returns the recorded result
- GIVEN completed matching journal data
- WHEN replay runs without a fencing token
- THEN result SHALL return without effect, receipt, or event

#### Scenario: Hash mismatch under the same key is denied
- GIVEN completed journal data with a different hash
- WHEN close is attempted
- THEN it SHALL be DENIED

#### Scenario: One receipt per terminal event
- GIVEN a terminal event was already closed
- WHEN close is repeated
- THEN no second receipt SHALL be issued

#### Scenario: End-to-end happy path against live PostgreSQL
- GIVEN adapters, `FakeLlmClient`, and PostgreSQL
- WHEN the full cycle runs
- THEN terminal Work and exactly one receipt SHALL persist
- AND `work.completed` and one skill-outcome event SHALL persist in the same close

#### Scenario: Stale-token close rolls back atomically
- GIVEN token N + 1 owns Work and a holder supplies N
- WHEN terminal close runs
- THEN Work, journal, receipt, and both event stores SHALL remain unchanged
