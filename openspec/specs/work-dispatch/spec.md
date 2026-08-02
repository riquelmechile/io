# work-dispatch Specification

## Requirements

### Requirement: Deterministic Dispatch Identity

`dispatchIdempotencyKeyFor(companyId, workId)` MUST equal `wk:${companyId}:${workId}`, remain restart-stable, company-scoped, and collision-free. `dispatchRequestHashFor(work)` MUST be SHA-256 over canonical `{ companyId, workId, delegationId, description }`; all other fields MUST be excluded.

#### Scenario: Key is deterministic and company-scoped
- GIVEN restarts and distinct tenant/Work identities
- WHEN dispatch keys are derived
- THEN keys MUST remain stable and collision-free

#### Scenario: Hash survives lifecycle transitions
- GIVEN Work transitioning `accepted → in_progress → completed`
- WHEN hashed at every state
- THEN each hash MUST be identical

### Requirement: One Oldest-First Cycle per Activation

`activate` MUST invoke unchanged `runWorker` once for the first actionable Work. An empty queue MUST settle without worker or LLM invocation.

#### Scenario: Activation dispatches one oldest Work
- GIVEN multiple accepted Work items
- WHEN activation runs
- THEN exactly one `runWorker` cycle MUST run for the oldest item

#### Scenario: Empty actionable queue is cost-free
- GIVEN no accepted Work
- WHEN activation runs
- THEN it MUST settle with zero worker and LLM invocations

### Requirement: Non-Invasive Heartbeat Wiring

Dispatch MUST use existing `onActivate`; `no-llm-heartbeat` MUST NOT dispatch. Cursor writes MUST remain supervisor-only and heartbeat evaluation read-only. `supervisor.ts`, `tick.ts`, `runWorker`, `cycle.ts`, and `evaluate.ts` MUST remain byte-identical. Business-domain MUST keep zero `@io/*` imports, `openai` MUST remain confined to `deepseek-client.ts`, and runtime dependencies MUST remain unchanged.

#### Scenario: Heartbeat decline performs no dispatch
- GIVEN a `no-llm-heartbeat` decision
- WHEN the tick runs
- THEN no actionable read, worker cycle, or LLM invocation MUST occur

#### Scenario: Existing boundaries remain unchanged
- GIVEN dispatch is added
- WHEN boundaries and manifests are inspected
- THEN named sources and boundaries MUST remain unchanged

### Requirement: Journal Replay Safety

Same-Work re-activation with matching key and hash MUST journal-replay without repeating the effect or receipt (`UNIQUE(work_id, terminal_event_id)`).

#### Scenario: Re-activation replays once
- GIVEN an attempt recorded under its dispatch key and hash
- WHEN re-activated
- THEN the recorded result MUST replay with no second effect or receipt

### Requirement: Failure Settlement Controls Cursor Progress

Typed `invalid-plan`, `denied`, `recovery-required`, `invalid-transition`, and `idempotency-conflict` failures MUST settle and advance the cursor. Thrown network, timeout, LLM, or database errors MUST propagate, leaving it unadvanced for R4-001 re-activation.

#### Scenario: Typed failure consumes activation
- GIVEN `runWorker` returns a listed typed failure
- WHEN dispatch settles
- THEN the supervisor MUST advance its cursor without a hot LLM retry loop

#### Scenario: Thrown error remains retryable
- GIVEN `runWorker` throws a listed error
- WHEN dispatch runs
- THEN the error MUST propagate and the supervisor MUST NOT advance its cursor

### Requirement: Crash-Recovery Non-Guarantee

This capability MUST NOT guarantee exactly-once execution or automatic crash resumption. Post-claim failures MAY orphan excluded `in_progress` Work. Supervisor-driven `recoverInFlightWork` remains follow-up work because `FileDocumentSandbox` lacks `snapshotUndoLog`.

#### Scenario: Orphaned in-progress Work is not auto-resumed
- GIVEN a post-claim failure leaves `in_progress` Work
- WHEN a later activation lists actionable Work
- THEN that Work MUST remain excluded and automatic recovery MUST NOT be claimed
