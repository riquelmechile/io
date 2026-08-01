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
