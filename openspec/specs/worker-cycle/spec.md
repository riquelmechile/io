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

The worker MUST claim through `startWork` with `expectedVersion`. The winner MUST mint and return the next server-side fencing token; losers MUST receive `version-conflict` and MUST NOT execute an effect. Resume without a fresh claim MUST retain the token. The token MUST NOT enter compiled context bytes. Business-domain MUST retain zero `@io/*` imports, and no runtime dependency MAY be added. [REQ]
(Previously: Claim selected one winner but produced no fencing token.)

#### Scenario: Exactly one winner among concurrent workers
- GIVEN two workers claim the same version
- WHEN both invoke `startWork`
- THEN exactly one MUST receive token N + 1 and the other `version-conflict`

#### Scenario: Losing claimant does not proceed
- GIVEN claim returned `version-conflict`
- WHEN the cycle continues
- THEN no effect or receipt MUST occur

#### Scenario: Same-token resume preserves context bytes
- GIVEN a claimed cycle resumes without re-claim
- WHEN intent is compiled again
- THEN its token MUST be unchanged and compiled bytes MUST equal the token-free baseline

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

The worker MUST close via `completeWorkAtomically`: journal decision → replay, DENY, or continue → token-checked Work CAS → one receipt → status-guarded journal completion, in one transaction. Replay MUST be token-free. Continue MUST supply the claim token; a stale token MUST roll back every terminal mutation. Exactly one receipt MUST exist per `(work_id, terminal_event_id)`. [REQ] [INF]
(Previously: Terminal close checked version but not claim token.)

#### Scenario: Replay returns the recorded result
- GIVEN completed matching journal data
- WHEN replay runs without a fencing token
- THEN result MUST return without effect, receipt, or event

#### Scenario: Hash mismatch under the same key is denied
- GIVEN completed journal data with a different hash
- WHEN close is attempted
- THEN it MUST be DENIED

#### Scenario: One receipt per terminal event
- GIVEN a terminal event was already closed
- WHEN close is repeated
- THEN no second receipt MUST be issued

#### Scenario: End-to-end happy path against live PostgreSQL
- GIVEN adapters, `FakeLlmClient`, and PostgreSQL
- WHEN the full cycle runs
- THEN terminal Work and exactly one receipt MUST persist

#### Scenario: Stale-token close rolls back atomically
- GIVEN token N + 1 owns Work and a holder supplies N
- WHEN terminal close runs
- THEN Work, journal, receipt, and event stores MUST remain unchanged

### Requirement: Journal-Anchored Reconciliation

Recovery of designated `in_progress` Work MUST reconcile from the journal and durable undo evidence using the retained fencing token. W1 (no journal row and no effect evidence) MUST resume at pre-effect reconciliation. W2 (`in_flight`, no applied effect) MUST become `aborted_retryable` without undo. W3 (`in_flight`, applied effect) MUST undo before becoming `aborted_retryable`. Retryable outcomes MUST resume without re-claiming. Missing or contradictory evidence, failed undo, and other unsafe states MUST return a typed `UNRESOLVED_REQUIRES_HUMAN` disposition and MUST NOT re-execute the effect. Recovery MUST be idempotent when repeated. [REQ]
(Previously: Reconciliation treated no-effect recovery as token-free replay and did not define supervisor recovery for W1/W2/W3.)

#### Scenario: W1 resumes with no journal row
- GIVEN designated `in_progress` Work with no journal row and no effect evidence
- WHEN recovery runs
- THEN it MUST return a resumable disposition without undo or token minting

#### Scenario: W2 becomes retryable without undo
- GIVEN matching-token `in_flight` attempt and durable proof of no applied effect
- WHEN recovery runs
- THEN it MUST mark `aborted_retryable` without undo and permit same-token resume

#### Scenario: W3 undoes before retry
- GIVEN matching-token `in_flight` attempt with an applied effect
- WHEN recovery runs
- THEN it MUST undo first, mark `aborted_retryable`, and permit same-token resume

#### Scenario: Unresolvable terminal state is reported honestly
- GIVEN journal and undo evidence disagree after Work became terminal
- WHEN stale-holder reconciliation closes the `in_flight` row
- THEN `UNRESOLVED_REQUIRES_HUMAN` MUST persist despite stale token

#### Scenario: Applied-effect CAS loss sets the retryable marker
- GIVEN applied effect, in-progress Work, retained token N, and CAS loss
- WHEN reconciliation undoes and marks retryable with N
- THEN `aborted_retryable` MUST persist and same-token retry MUST remain possible

#### Scenario: Stale reconciliation token is rejected
- GIVEN journal ownership advanced from N to N + 1
- WHEN recovery supplies N
- THEN it MUST return a typed failure and leave the row unchanged

#### Scenario: Missing evidence or undo failure escalates
- GIVEN recovery evidence is unavailable or required undo fails
- WHEN recovery evaluates the attempt
- THEN it MUST return `UNRESOLVED_REQUIRES_HUMAN` and MUST NOT resume the effect

#### Scenario: Recovery is idempotent on re-tick
- GIVEN recovery already produced a retryable, terminal, or unresolved disposition
- WHEN the same designation is evaluated again
- THEN no second undo, effect, or terminal mutation MUST occur

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

The live E2E MUST assert terminal structure, one receipt, completed journal, requested-model echo, cache fields, and prompt accounting. Its default activation MUST request and echo `deepseek-v4-flash`. It MUST NOT assert exact generated output. Verification MUST use strict TDD via `PATH=/data/node24/bin:$PATH pnpm test`; live PostgreSQL tests MUST run sequentially via `pnpm vitest run --no-file-parallelism`. [REQ]

(Previously: Model echo was fixed to Flash without an explicit requested-tier contract.)

#### Scenario: Serving model echoes the requested tier

- GIVEN a completion requested with tier `flash` or `pro`
- WHEN its response is inspected
- THEN `model` MUST equal respectively `deepseek-v4-flash` or `deepseek-v4-pro`

#### Scenario: Live default remains Flash

- GIVEN a live completion without a produced Pro risk signal
- WHEN the response is inspected
- THEN `model` MUST equal `deepseek-v4-flash`

#### Scenario: Cache structure is asserted

- GIVEN a live completion
- WHEN usage is inspected
- THEN cache-hit and cache-miss fields MUST be present

#### Scenario: Generated output remains unconstrained

- GIVEN a valid terminal run
- WHEN assertions evaluate generated plan data
- THEN they MUST NOT require an exact path, content, or plan

#### Scenario: Live database verification is sequential

- GIVEN the worker-cycle verification suite
- WHEN live PostgreSQL tests execute
- THEN file parallelism MUST be disabled

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

The gate MUST remain outside the work-bearing path. `runWorker` MUST accept the selected tier and pass it unchanged to `prepareIntent`, which MUST map `flash` to `deepseek-v4-flash` and `pro` to `deepseek-v4-pro` at the app/LLM boundary. `business-domain` MUST NOT import `LlmModel`. Both tiers MUST use the SAME stable compiled context prefix. Apart from the model parameter, terminal-close, replay, and idempotency behavior MUST remain unchanged.

(Previously: `runWorker` was byte-identical and no model tier reached `prepareIntent`.)

#### Scenario: Work-bearing cycle bypasses the gate

- GIVEN actionable Work and a selected model tier
- WHEN `runWorker` executes
- THEN it MUST activate without evaluating the heartbeat boundary gate

#### Scenario: Selected tier reaches intent unchanged

- GIVEN `pro` was selected
- WHEN `runWorker` prepares intent
- THEN the request MUST use `deepseek-v4-pro` and the existing stable prefix

#### Scenario: Full cycle retains terminal close

- GIVEN a valid Work cycle with terminal dependencies
- WHEN `runWorker` completes successfully
- THEN CAS, one receipt, journal completion, and exactly one `work.completed` MUST commit as before

#### Scenario: Replay remains idempotent

- GIVEN closed Work replayed with the same idempotency key and request hash
- WHEN the cycle is replayed
- THEN it MUST return the recorded result without another effect, receipt, or `work.completed`
