# Delta for supervisor-timer

## ADDED Requirements

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

For each discovered company, a tick MUST sequentially read its stored cursor, call the companyId-only `evaluateHeartbeatGate`, and derive the stream tail. For `activate`, the tick MUST call `onActivate(companyId)` and only then atomically upsert the cursor; for `no-llm-heartbeat`, it MUST upsert the cursor directly. The cursor checkpoint MUST NOT be persisted before the activation callback returns, so a failure or crash during the callback leaves the activation retryable (at-least-once). The supervisor MUST NOT evaluate companies concurrently.

#### Scenario: No-LLM decision advances the cursor
- GIVEN a company stream with no unseen material event
- WHEN its tick returns `no-llm-heartbeat`
- THEN the stream tail MUST be persisted and `onActivate` MUST NOT run

#### Scenario: Activation is consumed and renewed by novelty
- GIVEN one unseen `work.completed`
- WHEN two unchanged ticks run and then a new `work.completed` is appended
- THEN `onActivate` MUST run once initially and once after the new event
- AND each activating cursor MUST be persisted only after its callback returns

#### Scenario: Callback failure leaves the activation retryable
- GIVEN one unseen `work.completed` and a callback that fails or crashes before returning
- WHEN the tick runs and the cursor was not persisted
- THEN the next tick MUST re-evaluate the same stream tail and re-invoke `onActivate`
- AND no checkpoint MUST suppress that retry

#### Scenario: Companies are processed sequentially
- GIVEN multiple discovered companies
- WHEN a tick executes
- THEN each company's evaluation and cursor upsert MUST finish before the next begins

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

`onActivate` MUST remain injectable and MAY be a recorded no-op. The supervisor MUST be a new gate caller and MUST NOT mutate `runWorker`, `cycle.ts`, `evaluate.ts`, the gate, or the worker path; cursor writes MUST belong only to the supervisor.

#### Scenario: Recorded no-op is valid
- GIVEN an activation callback that only records the company
- WHEN the gate activates
- THEN the callback MUST receive the company without starting Work

#### Scenario: Existing paths remain unchanged
- GIVEN this capability is added
- WHEN worker and heartbeat gate sources are compared with their baseline
- THEN `runWorker`, `cycle.ts`, and `evaluate.ts` MUST be byte-identical

### Requirement: Single-Instance Operation

The supervisor MUST assume one active instance; cross-instance fencing and duplicate-activation prevention are outside this capability.

#### Scenario: No fencing contract is introduced
- GIVEN the supervisor dependency surface
- WHEN cursor coordination is inspected
- THEN no fencing token or multi-instance lease MUST be required
