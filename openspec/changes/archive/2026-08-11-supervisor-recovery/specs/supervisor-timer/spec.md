# Delta for supervisor-timer

## MODIFIED Requirements

### Requirement: Sequential Checkpointed Tick

For each company, a tick MUST sequentially read its cursor, call the companyId-only gate, derive the pre-append tail, append one decision with `appendIfAbsent`, invoke `onActivate(companyId, model)` only for `activate`, invoke optional `onRecovery(companyId)` exactly once, and finally upsert the cursor. `onRecovery` MUST run after activation and before checkpoint on both decision branches. Its designation and execution MUST NOT depend on `now`, age, lease, or heartbeat. Recovery writes are supervisor-owned only within this tick boundary. Append or callback failure MUST leave the cursor unadvanced for at-least-once retry. Companies MUST NOT be evaluated concurrently, preserving single-instance operation. [REQ] [INF]
(Previously: The tick had only the activation callback before checkpoint and did not legitimate recovery writes.)

#### Scenario: No-LLM decision advances the cursor
- GIVEN a stream with no unseen material event
- WHEN its tick returns `no-llm-heartbeat`
- THEN one decision MUST be appended, recovery MUST run, and the tail MUST be checkpointed
- AND `onActivate` MUST NOT run

#### Scenario: Activation is consumed and renewed by novelty
- GIVEN one unseen `work.completed`
- WHEN two unchanged ticks run and then a new completion is appended
- THEN activation MUST run initially and after novelty
- AND each tick MUST append, activate, recover, then checkpoint

#### Scenario: Activation failure leaves the cursor retryable
- GIVEN unseen material work and `onActivate` throws after decision append
- WHEN the tick fails
- THEN recovery and checkpoint MUST NOT run and the next tick MUST retry

#### Scenario: Both branches emit
- GIVEN evaluations producing `activate` and `no-llm-heartbeat`
- WHEN their ticks run
- THEN each evaluation MUST append exactly one `heartbeat.decision`

#### Scenario: Retry does not duplicate the decision
- GIVEN a decision was appended but its tick failed before checkpoint
- WHEN the unadvanced cursor is retried
- THEN `appendIfAbsent` MUST preserve exactly one event with the same event ID

#### Scenario: Append failure remains retryable
- GIVEN decision append fails
- WHEN the tick runs
- THEN callbacks and checkpoint MUST NOT run
- AND the next interval MUST retry from the prior cursor

#### Scenario: Companies are processed sequentially
- GIVEN multiple discovered companies
- WHEN a tick executes
- THEN each company's append, activation, recovery, and checkpoint MUST finish before the next begins

#### Scenario: Recovery runs in checkpoint order
- GIVEN activation and recovery callbacks record their calls
- WHEN an activating tick succeeds
- THEN order MUST be append, activation, one recovery call, and cursor upsert

#### Scenario: Recovery failure leaves cursor unadvanced
- GIVEN `onRecovery` throws after activation
- WHEN the tick fails
- THEN cursor upsert MUST NOT occur and the next tick MUST retry recovery

#### Scenario: Recovery runs once per company per tick
- GIVEN one company and multiple designated Work items
- WHEN one supervisor tick runs
- THEN `onRecovery(companyId)` MUST be invoked exactly once
