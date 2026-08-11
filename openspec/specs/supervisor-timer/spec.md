# supervisor-timer

Polling supervisor that discovers companies via the event log, evaluates each company sequentially through the heartbeat gate, advances a durable per-company cursor on both decision paths, and invokes an injectable `onActivate` callback only on `activate`. Pure `tailCursor` + `HeartbeatCursorStore` live in business-domain; PG migration 008 + adapters mirror existing patterns. Single-instance this slice — no fencing tokens or multi-instance lease.

## Requirements

### Requirement: Periodic Discoverable Lifecycle

`startSupervisor(deps, { intervalMs, now?, onActivate? })` MUST return `{ stop }`, evaluate ticks at the configured interval, and discover each tick's companies through `listCompanyIds()`. Clock and timer behavior MUST be injectable for deterministic tests.

#### Scenario: Injected timer drives a tick
- GIVEN two discoverable companies and a controlled timer
- WHEN one interval elapses
- THEN both companies MUST be selected for evaluation using the injected clock

#### Scenario: Stop prevents later ticks
- GIVEN a running supervisor
- WHEN `stop()` is called before another interval
- THEN no later company discovery or evaluation MUST occur

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

### Requirement: Durable Cursor Recovery

The persisted cursor row MUST be the supervisor checkpoint. A restart MUST resume from stored per-company cursors; work completed before persistence MAY be re-evaluated, providing at-least-once evaluation.

#### Scenario: Restart resumes from checkpoint
- GIVEN a persisted cursor and a stopped supervisor
- WHEN a fresh supervisor evaluates the company
- THEN it MUST supply that persisted cursor to the gate

#### Scenario: Interrupted checkpoint is retried
- GIVEN evaluation finished but cursor persistence did not
- WHEN the supervisor restarts
- THEN it MUST re-evaluate from the previous persisted cursor

### Requirement: Non-Invasive Activation Seam

`onActivate(companyId, model)` MUST remain injectable and MAY be a recorded no-op. On `activate`, the supervisor MUST pass the exact heartbeat-selected tier through the seam to dispatch and `runWorker`; `runWorker` MAY gain only that model parameter. Decision-event appends and cursor writes MUST remain supervisor-owned and decision appends MUST occur only in the supervisor tick. `cycle.ts`, `evaluate.ts`, and the read-only gate MUST remain byte-identical.

(Previously: The post-heartbeat seam appended decisions but did not thread a model tier, and `runWorker` was byte-identical.)

#### Scenario: Recorded no-op receives the selected model

- GIVEN an activation callback that only records its arguments
- WHEN the gate activates with model `pro`
- THEN the callback MUST receive the company and `pro` without starting Work

#### Scenario: Existing paths preserve composed boundaries

- GIVEN decision-event emission and model threading are present
- WHEN sources are compared with their baselines
- THEN `cycle.ts`, `evaluate.ts`, and the gate MUST be byte-identical
- AND `runWorker` MUST differ only by model-parameter threading

### Requirement: Single-Instance Operation

The supervisor MUST assume one active instance; cross-instance fencing and duplicate-activation prevention are outside this capability.

#### Scenario: No fencing contract is introduced
- GIVEN the supervisor dependency surface
- WHEN cursor coordination is inspected
- THEN no fencing token or multi-instance lease MUST be required
