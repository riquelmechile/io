# worker-cycle Specification

## Purpose

The worker cycle orchestrates one unit of delegated low-risk Work end to end:
`claim → authority → intent → effect OUTSIDE the transaction → reconcile →
verify → terminal transaction` (architecture §13.1, abbreviated low-risk form).
It ASSEMBLES the archived harden foundation — CAS, idempotency journal, SoD,
business receipts, runtime guards — and modifies none of it. Reconciliation is
journal-anchored: the idempotency journal is the source of truth for attempt
state and the sandbox undo log is the source of truth for whether the effect
ran, so the external effect and the durable bookkeeping never share one
transaction (§9.8). [ADR-0002] [ADR-0003] [INF]

The cycle's end-to-end form runs the worker with `FakeLlmClient` through the real
adapters and the real terminal transaction, and verifies against live PostgreSQL
18.4 (`io_pg`). The E2E scenarios below prove the full happy path, replay/DENY,
single receipt, and atomic close against that live database. [INF]

## Requirements

### Requirement: Single-Winner Claim via Compare-And-Swap

The worker MUST claim Work through the CAS `startWork` use case using the work's
current `expectedVersion`. Among concurrent claimants exactly one MUST win; every
loser MUST receive an explicit `{ ok: false, reason: 'version-conflict' }` and
MUST NOT proceed to an effect. A claim MUST NOT fail silently. [REQ]

#### Scenario: Exactly one winner among concurrent workers

- GIVEN two workers claiming the same work at the same `expectedVersion`
- WHEN both invoke `startWork`
- THEN exactly one MUST return `{ ok: true }` and the other MUST return `{ ok: false, reason: 'version-conflict' }`

#### Scenario: Losing claimant does not proceed

- GIVEN a worker whose claim returned `version-conflict`
- WHEN the cycle continues
- THEN it MUST stop with no effect executed and no receipt issued

### Requirement: Authority Verified at Action Time

Before any effect the worker MUST verify authority at action time: the grant
window MUST be active (`isWindowActive`), the delegation MUST NOT be revoked, and
SoD `ABSOLUTE_PAIRS` MUST hold — proposer≠approver AND executor≠verifier at EVERY
tier including low risk. A revoked, expired, or out-of-window grant MUST yield DENY
at action time. [REQ]

#### Scenario: Active grant with distinct principals proceeds

- GIVEN an active grant window, an unrevoked delegation, and distinct proposer/approver and executor/verifier principals
- WHEN authority is checked at action time
- THEN the check MUST pass and the effect MAY proceed

#### Scenario: Revoked delegation denied at action time

- GIVEN a delegation revoked while work is in-flight
- WHEN the worker next attempts the effect
- THEN authority MUST DENY at action time and no effect MUST run

#### Scenario: Expired or out-of-window grant denied

- GIVEN a grant whose window is no longer active (`isWindowActive` false)
- WHEN authority is checked at action time
- THEN the check MUST DENY

#### Scenario: Verifier equal to executor denied even at low risk

- GIVEN a low-risk work whose verifier principal equals its executor principal
- WHEN authority is checked at action time
- THEN `ABSOLUTE_PAIRS` MUST DENY the cycle

### Requirement: Tenant Scope on Every Operation

Every worker operation MUST be scoped by a non-empty `companyId`. An empty
`companyId` MUST be rejected. Access to another tenant's Work MUST surface as
not-found, never as the foreign record. [INF]

#### Scenario: Empty companyId rejected

- GIVEN a worker operation with an empty or missing `companyId`
- WHEN invoked
- THEN it MUST be rejected

#### Scenario: Wrong-tenant access returns not-found

- GIVEN a work owned by tenant A
- WHEN a worker scoped to tenant B requests it
- THEN the result MUST be not-found and MUST NOT return tenant A's record

### Requirement: Intent Recorded Before the Effect

The worker MUST record intent and an idempotency key BEFORE executing any effect,
via `insertInFlight` (the D6 pre-effect pattern). The durable in-flight record
MUST exist prior to the first external side effect. [INF]

#### Scenario: In-flight record precedes the effect

- GIVEN a cycle about to run its effect
- WHEN the worker reaches the effect step
- THEN `insertInFlight` MUST be committed before `SandboxPort.execute` is called

### Requirement: Effect Executed Outside the Terminal Transaction

The external effect MUST execute OUTSIDE the terminal transaction. The external
effect and the durable bookkeeping MUST NOT share one transaction (§9.8). [INF]

#### Scenario: Effect does not run inside the terminal transaction

- GIVEN the worker executing its effect
- WHEN `SandboxPort.execute` runs
- THEN it MUST NOT run within `completeWorkAtomically`'s transaction

### Requirement: Atomic Terminal Close

The worker MUST close via `completeWorkAtomically`: journal lookup → replay (same
key + same hash → return the recorded result) | DENY (same key + different hash) |
continue → in_flight → CAS → a single business receipt → complete, all in ONE
transaction. Exactly one receipt MUST be issued per `(work_id, terminal_event_id)`
(`UNIQUE(work_id, terminal_event_id)`). [REQ] [INF]

#### Scenario: Replay returns the recorded result

- GIVEN a journal entry for a key whose input hash matches the current attempt
- WHEN the terminal close is attempted again with the same key and same hash
- THEN the recorded result MUST be returned and no new effect or receipt MUST occur

#### Scenario: Hash mismatch under the same key is denied

- GIVEN a journal entry for a key whose input hash differs from the current attempt
- WHEN the terminal close is attempted with the same key but a different hash
- THEN the attempt MUST be DENIED

#### Scenario: One receipt per terminal event

- GIVEN a work already closed for a terminal event
- WHEN the close is re-attempted for the same `(work_id, terminal_event_id)`
- THEN no second business receipt MUST be issued

#### Scenario: End-to-end happy path against live PostgreSQL

- GIVEN the worker wired with `FakeLlmClient`, the real adapters, and the reversible sandbox adapter against live PostgreSQL 18.4 (`io_pg`)
- WHEN the full cycle runs `claim → authority → intent → effect → reconcile → verify → terminal`
- THEN the work MUST reach a terminal state with exactly one business receipt persisted in the live database

### Requirement: Journal-Anchored Reconciliation

After a post-effect failure the worker MUST reconcile by consulting the
idempotency journal AND the sandbox undo log. If the effect was applied, the worker
MUST `undo()` it and then close the attempt; if no effect was applied, the worker
MUST retry cleanly via the replay path. When a finalize attempt loses the CAS race
with an applied effect while the Work is still `in_progress`, the worker MUST set
the journal's retryable marker (`aborted_retryable`, see the `idempotency-journal`
capability) rather than failure-completing the key, so a future same-key attempt is
allowed a controlled retry (foundation parity). An unresolvable state MUST yield the
typed `UNRESOLVED_REQUIRES_HUMAN` (§9.8) and MUST NOT fabricate a resolution. [REQ]

#### Scenario: Applied effect reversed then attempt closed

- GIVEN the effect was applied and the terminal transaction then failed
- WHEN the worker reconciles
- THEN it MUST call `undo()` on the effect and then close the journal attempt

#### Scenario: No effect applied leads to clean replay

- GIVEN the undo log shows no effect was applied
- WHEN the worker reconciles
- THEN it MUST retry via the replay path and MUST NOT call `undo()`

#### Scenario: Unresolvable state reported honestly

- GIVEN the journal and the undo log disagree irreconcilably
- WHEN the worker reconciles
- THEN it MUST return typed `UNRESOLVED_REQUIRES_HUMAN` and MUST NOT fabricate a resolution

#### Scenario: CAS loss with applied effect and in-progress work sets the retryable marker

- GIVEN the effect was applied, the Work is still `in_progress`, and the finalize CAS lost a race
- WHEN the worker reconciles the attempt
- THEN it MUST set the journal retryable marker (`aborted_retryable`), MUST NOT failure-complete the key, and a future same-key attempt MUST be allowed a controlled retry

### Requirement: Durable Restart Recovery

A worker that dies mid-cycle MUST recover from the durable (PostgreSQL-backed)
journal in-flight row, which is the recovery anchor and MUST survive process death.
A test fake MUST mirror this durability, or the restart scenario is vacuous. [REQ]

#### Scenario: Restart recovers from the durable journal

- GIVEN a worker that crashed after `insertInFlight` and the effect, with the journal row durable
- WHEN a fresh worker recovers the cycle
- THEN it MUST read the in-flight row and reconcile to a terminal state

#### Scenario: Fake mirrors journal durability

- GIVEN an in-memory fake used for a restart test
- WHEN a process restart is simulated
- THEN the in-flight row MUST survive (the fake MUST be PG-backed or equivalently durable)

### Requirement: Runtime Validation of Untrusted Input

The worker MUST validate untrusted LLM output via `parseLlmPlan` and commands via
`parseCommand`. Malformed input MUST be explicitly rejected with a typed reason and
MUST NOT be passed through or treated as authority. [REQ]

#### Scenario: Malformed LLM plan rejected

- GIVEN corrupt model output
- WHEN the worker parses it with `parseLlmPlan`
- THEN it MUST return `{ ok: false, reason }` and the worker MUST NOT act on the plan

#### Scenario: Malformed command rejected

- GIVEN a malformed business command
- WHEN the worker parses it with `parseCommand`
- THEN it MUST return `{ ok: false, reason }` and MUST NOT be passed through

### Requirement: Retry-Stable Evidence Identity

The worker MUST compute a stable `evidenceId` as `ev:${companyId}:${idempotencyKey}`
so that `evidenceRefs` survive retries and restarts. The same attempt MUST always
resolve to the same `evidenceId`. [INF]

#### Scenario: evidenceId stable across retry and restart

- GIVEN a fixed `companyId` and `idempotencyKey`
- WHEN `evidenceId` is computed before and after a retry or restart
- THEN the value MUST be identical

---

### Requirement: Production Composition Root

`buildWorkerDeps` MUST assemble PostgreSQL adapters, `connection`, sandbox, injected `LlmClient`, and a transaction-scoped `repositories` factory. The factory MUST mirror `completeWorkAtomically` so finalize T1 remains atomic. [INF]

#### Scenario: Wired worker finalizes atomically

- GIVEN dependencies built with PostgreSQL
- WHEN the worker runs through finalize
- THEN journal completion, Work CAS, and the single receipt MUST commit atomically

#### Scenario: LLM client remains injectable

- GIVEN a fake or real `LlmClient`
- WHEN `buildWorkerDeps` assembles dependencies
- THEN the supplied client MUST be used

### Requirement: Real-Model Live End-to-End Verification

A live E2E MUST run claim → authority → intent via real `DeepSeekClient.complete` → effect → reconcile → verify → atomic finalize against `deepseek-v4-flash` and live PostgreSQL. Context MUST produce a `parseLlmPlan`-valid `create-document` plan. [REQ]

#### Scenario: Real model produces an actionable plan

- GIVEN both gates and seeded Work
- WHEN compiled context is completed by the real model
- THEN the plan MUST contain `create-document` with non-empty `relativePath` and string `content`

#### Scenario: Full cycle reaches a reversible terminal outcome

- GIVEN a valid plan and PostgreSQL
- WHEN the full cycle completes
- THEN Work MUST be `completed`, exactly one `business_receipt` MUST exist, and the journal MUST be `completed`
- AND the sandbox effect MUST be applied and reversible

### Requirement: Cost-Safe Double Gate

The live E2E MUST require `DEEPSEEK_API_KEY` AND `IO_LIVE_LLM === '1'`; otherwise it MUST skip before model invocation. The secret MUST NOT be printed. [REQ]

#### Scenario: Both gates permit execution

- GIVEN the key exists and `IO_LIVE_LLM` equals `1`
- WHEN the live suite is evaluated
- THEN the live E2E MUST run

#### Scenario: Explicit opt-in is absent

- GIVEN the key exists but `IO_LIVE_LLM` is not `1`
- WHEN the live suite is evaluated
- THEN it MUST skip without invoking the real model

#### Scenario: API key is absent

- GIVEN `DEEPSEEK_API_KEY` is absent
- WHEN a plain test or CI run evaluates the suite
- THEN it MUST skip without invoking the real model

### Requirement: Structure-Not-Output Assertions

The live E2E MUST assert terminal structure, one receipt, completed journal, model echo, cache fields, and prompt accounting. It MUST NOT assert exact generated output. [REQ]

#### Scenario: Serving model is echoed

- GIVEN a live completion
- WHEN its response is inspected
- THEN `model` MUST equal `deepseek-v4-flash`

#### Scenario: Cache structure is asserted

- GIVEN a live completion
- WHEN usage is inspected
- THEN cache-hit and cache-miss fields MUST be present

#### Scenario: Generated output remains unconstrained

- GIVEN a valid terminal run
- WHEN assertions evaluate generated plan data
- THEN they MUST NOT require an exact path, content, or plan

### Requirement: Bounded Reliability Retry

The live E2E MAY retry only `invalid-plan`, MUST use a fresh idempotency key, and MUST stop after two attempts. Retry MUST remain test-only. [REQ]

#### Scenario: Invalid first plan retries safely

- GIVEN the first attempt returns `invalid-plan`
- WHEN the live E2E retries
- THEN the retry MUST use a fresh idempotency key

#### Scenario: Retry is bounded

- GIVEN repeated `invalid-plan`
- WHEN two total attempts have run
- THEN no third model completion MUST occur

#### Scenario: Worker behavior remains unchanged

- GIVEN live-E2E retry is required
- WHEN retry ownership is inspected
- THEN retry logic MUST exist only in test code and worker source MUST remain unchanged

### Requirement: KV-Cache Economics Surface

The live run MUST forward derived cohort `user` and surface `promptCacheHitTokens` and `promptCacheMissTokens`. Prompt tokens MUST equal their sum. [REQ]

#### Scenario: Cache accounting reflects the forwarded cohort

- GIVEN context with a derived cohort `user`
- WHEN the real completion returns usage
- THEN cache fields MUST be present and non-negative
- AND request `user` MUST equal the derived cohort
- AND prompt tokens MUST equal hit plus miss tokens

---

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
