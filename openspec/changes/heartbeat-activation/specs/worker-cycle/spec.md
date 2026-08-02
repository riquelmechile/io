# Delta for worker-cycle

## ADDED Requirements

### Requirement: Company-Scoped Heartbeat Boundary Gate

The heartbeat boundary gate MUST accept only a non-empty `companyId`, the read-only business-event seam, and an optional cursor; it MUST NOT accept a `workId`. It MUST return the exact deterministic `HeartbeatDecision` produced by `evaluateHeartbeatForCompany` for that tenant. Actionable Work is the activation signal, so work-bearing cycles always activate independently of this gate.

#### Scenario: Gate excludes work identity

- GIVEN the public gate contract
- WHEN its accepted inputs are inspected
- THEN it MUST accept `companyId`, the read-only event seam, and an optional cursor
- AND it MUST NOT accept a `workId`

#### Scenario: Empty stream declines activation

- GIVEN a company with an empty event stream
- WHEN its boundary gate is evaluated
- THEN it MUST return `{ kind: 'no-llm-heartbeat' }`

#### Scenario: Unseen completed work activates Flash

- GIVEN a company stream containing `work.completed` after the optional cursor
- WHEN its boundary gate is evaluated
- THEN it MUST return `{ kind: 'activate', model: 'flash' }`

#### Scenario: Seen completed work declines activation

- GIVEN a cursor positioned at the latest `work.completed` event
- WHEN the same company stream is evaluated
- THEN the gate MUST return `{ kind: 'no-llm-heartbeat' }`

#### Scenario: Tenant decisions are isolated

- GIVEN company A has unseen `work.completed` and company B has no material event
- WHEN the gate is evaluated for company B
- THEN company A's events MUST NOT affect company B's `no-llm-heartbeat` decision

#### Scenario: Empty company scope is rejected

- GIVEN an empty `companyId`
- WHEN the gate is evaluated
- THEN it MUST reject the request before reading the event stream

### Requirement: Read-Only Non-Self-Activating Evaluation

On both decision paths, the gate MUST be a pure read over the event seam. It MUST NOT claim Work, mutate journals or receipts, append events, or invoke an LLM. In particular, `no-llm-heartbeat` MUST emit nothing and MUST NOT create `work.completed`, preventing self-activation.

#### Scenario: Evaluation preserves all stores

- GIVEN snapshots of Work, journal, receipt, and event stores
- WHEN either gate decision is evaluated
- THEN every snapshot MUST remain unchanged and zero events MUST be appended

#### Scenario: Evaluation never invokes the LLM

- GIVEN a `FakeLlmClient` whose `requests` collection is empty
- WHEN either gate decision is evaluated
- THEN `FakeLlmClient.requests` MUST remain empty

#### Scenario: No-LLM decision cannot self-activate

- GIVEN an evaluation returning `no-llm-heartbeat`
- WHEN the tenant's material-event stream is read afterward
- THEN it MUST be unchanged and contain no gate-emitted `work.completed`

### Requirement: Work-Bearing Cycle Preservation

The gate MUST remain outside the work-bearing `runWorker` path, and `runWorker` MUST remain byte-identical in this change. A cycle processing Work MUST continue through its existing terminal close: CAS, one receipt, journal completion, and one `work.completed` event atomically. Existing replay and idempotency behavior MUST remain unchanged.

#### Scenario: Work-bearing cycle bypasses the gate

- GIVEN actionable Work and the existing `runWorker` entry point
- WHEN the work-bearing cycle executes
- THEN it MUST activate without evaluating the heartbeat boundary gate

#### Scenario: Full cycle retains terminal close

- GIVEN a valid Work cycle with terminal dependencies
- WHEN `runWorker` completes successfully
- THEN CAS, one receipt, journal completion, and exactly one `work.completed` MUST commit as before

#### Scenario: Replay remains idempotent

- GIVEN a successfully closed Work and a replay with the same idempotency key and request hash
- WHEN the cycle is replayed
- THEN it MUST return the recorded result without another effect, receipt, or `work.completed`
