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

`activate` MUST invoke `runWorker` once for the first actionable Work and MUST pass the activation's model tier unchanged. An empty queue MUST settle without worker or LLM invocation.

(Previously: Dispatch invoked `runWorker` without a model tier.)

#### Scenario: Activation dispatches one oldest Work with its model

- GIVEN multiple accepted Work items and selected tier `pro`
- WHEN activation runs
- THEN exactly one cycle MUST run for the oldest item with model `pro`

#### Scenario: Empty actionable queue is cost-free

- GIVEN no accepted Work
- WHEN activation runs
- THEN it MUST settle with zero worker and LLM invocations

### Requirement: Non-Invasive Heartbeat Wiring

`tickCompany` MUST pass `onActivate(companyId, model)` to `dispatchCompanyActivation(companyId, model)`; `no-llm-heartbeat` MUST NOT dispatch. Cursor and decision-event writes MUST remain supervisor-only and heartbeat evaluation read-only. `supervisor.ts`, `cycle.ts`, `evaluate.ts`, and the gate MUST remain byte-identical; `tick.ts` and `runWorker` MAY change only to thread the tier. Business-domain MUST keep zero `@io/*` imports, `openai` MUST remain confined to `packages/llm-client/src/deepseek-client.ts`, `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`, and no runtime dependency or migration MAY be added.

(Previously: `tick.ts` and `runWorker` were required to remain byte-identical.)

#### Scenario: Heartbeat decline performs no dispatch

- GIVEN a `no-llm-heartbeat` decision
- WHEN the tick runs
- THEN no actionable read, worker cycle, or LLM invocation MUST occur

#### Scenario: Existing boundaries preserve allowed byte changes

- GIVEN model threading is added
- WHEN sources, manifests, and dependency boundaries are inspected
- THEN only `tick.ts` and `runWorker` MAY differ among the named paths
- AND all forbidden-coupling and no-migration constraints MUST hold

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

### Requirement: Designated Recovery Dispatch

`dispatchRecovery` MUST directly resume designated `in_progress` Work through the claimed-work cycle without listing actionable Work, re-claiming, minting a fencing token, or changing Work state first. It MUST reuse the deterministic dispatch key and request hash. Recovery MUST NOT add, remove, reorder, or otherwise alter LLM context or the cohort §7.2/§7.3 prefix. Expected recovery failures MUST be returned as typed values rather than thrown control flow. [REQ] [INF]

#### Scenario: Recovery resumes without re-claim
- GIVEN designated `in_progress` Work with retained token N
- WHEN recovery dispatch runs
- THEN it MUST execute the claimed-work cycle with N and MUST NOT claim or mint a token

#### Scenario: Recovery reuses dispatch identity
- GIVEN the same Work before claim and during recovery
- WHEN dispatch identity is derived
- THEN both key and request hash MUST be identical

#### Scenario: Recovery preserves LLM context
- GIVEN compiled context for the claimed Work
- WHEN recovery dispatch prepares intent
- THEN context bytes and cohort prefix MUST equal the normal claimed-work baseline

### Requirement: Crash-Recovery Non-Guarantee

This capability MUST NOT guarantee exactly-once execution or automatic crash resumption by normal activation dispatch. Normal actionable selection MUST continue to exclude `in_progress` Work. A separate supervisor-owned recovery path MAY resume only explicitly designated orphan Work after safe reconciliation; undesignated or unresolved Work MUST remain excluded. [REQ]
(Previously: Supervisor recovery was follow-up work because the production sandbox lacked durable undo snapshots.)

#### Scenario: Normal dispatch never auto-resumes an orphan
- GIVEN a post-claim failure leaves `in_progress` Work
- WHEN a later activation lists actionable Work
- THEN normal dispatch MUST exclude it and MUST NOT invoke recovery

#### Scenario: Supervisor recovery is a separate path
- GIVEN the orphan is explicitly designated and safely reconciled
- WHEN supervisor recovery dispatches it
- THEN it MAY resume without making `in_progress` actionable to normal dispatch
