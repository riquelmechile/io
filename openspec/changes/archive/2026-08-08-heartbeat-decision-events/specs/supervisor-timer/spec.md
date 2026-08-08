# Delta for supervisor-timer

## MODIFIED Requirements

### Requirement: Sequential Checkpointed Tick

For each company, a tick MUST sequentially read its cursor, call the companyId-only gate, derive the pre-append stream tail, append exactly one `heartbeat.decision` with `appendIfAbsent`, then invoke `onActivate(companyId)` only for `activate`, and finally upsert the cursor. Both decision branches MUST append before any callback or checkpoint. Append or callback failure MUST fail the tick and MUST leave the cursor unadvanced so the next interval retries. Companies MUST NOT be evaluated concurrently.

(Previously: Ticks checkpointed both branches but did not persist gate decisions.)

#### Scenario: No-LLM decision advances the cursor
- GIVEN a stream with no unseen material event
- WHEN its tick returns `no-llm-heartbeat`
- THEN one decision event MUST be appended before the tail is checkpointed
- AND `onActivate` MUST NOT run

#### Scenario: Activation is consumed and renewed by novelty
- GIVEN one unseen `work.completed`
- WHEN two unchanged ticks run and then a new `work.completed` is appended
- THEN activation MUST run initially and after the new event
- AND each tick MUST append its decision before callback and checkpoint

#### Scenario: Callback failure leaves activation retryable
- GIVEN unseen material work and a callback that throws after decision append
- WHEN the tick fails
- THEN no cursor MUST be persisted and the next tick MUST invoke activation again

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
- THEN the tick MUST fail before callback and checkpoint
- AND the next interval MUST retry from the prior cursor

#### Scenario: Companies are processed sequentially
- GIVEN multiple discovered companies
- WHEN a tick executes
- THEN each company's append, callback, and checkpoint MUST finish before the next begins

### Requirement: Non-Invasive Activation Seam

`onActivate` MUST remain injectable and MAY be a recorded no-op. Decision-event appends and cursor writes MUST belong only to the supervisor. `runWorker`, `cycle.ts`, `evaluate.ts`, the read-only gate, and the worker path MUST remain unchanged; decision appends MUST occur only in the supervisor tick.

(Previously: Only cursor writes were explicitly supervisor-owned.)

#### Scenario: Recorded no-op is valid
- GIVEN an activation callback that only records the company
- WHEN the gate activates
- THEN the callback MUST receive the company without starting Work

#### Scenario: Existing paths remain unchanged
- GIVEN decision-event emission is added
- WHEN sources are compared with their baseline
- THEN `runWorker`, `cycle.ts`, and `evaluate.ts` MUST be byte-identical
