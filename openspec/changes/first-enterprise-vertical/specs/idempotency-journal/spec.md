# idempotency-journal Specification

## Purpose

The idempotency journal (D6) records business-operation attempts keyed by
`(companyId, idempotencyKey)` so a retried request is handled deterministically:
same key + same hash REPLAYS the stored result, same key + different hash is
DENIED, and a fresh key records an attempt (`in_flight`) before the effect and is
closed (`completed`) afterwards. The journal is the source of truth for attempt
state; the atomic terminal close (`completeWorkAtomically`) and the single-receipt
invariant depend on it. The journal port is pure (zero `@io/*` imports); a
PostgreSQL adapter over the `idempotency_journal` table (004) and an in-memory fake
implement it, and the fake MUST mirror the PG status domain and durability. This
capability speccs the concrete journal port behavior — the status domain and
pre-effect lookup decision table (the archived foundation behavior) — and ADDS the
durable retryable marker for finalize CAS-loss recovery (foundation parity). The
marker is consistent with the persistence-recovery contract: it is neither a
completed marker nor an orphan pending state. [ADR-0002] [ADR-0003] [INF]

## ADDED Requirements

### Requirement: Journal Status Domain and Pre-Effect Lookup Decision Table

The journal MUST record each attempt under a status drawn from a fixed domain and
MUST resolve a pre-effect lookup deterministically. `insertInFlight` MUST record the
attempt BEFORE the effect; `complete` MUST close it with the stored result for
replay. On lookup the journal MUST distinguish: no row (proceed and record a fresh
attempt); `completed` + same request hash (REPLAY the stored result, effect NOT
re-run); `completed` + different request hash (DENY as idempotency-conflict);
`in_flight` (attempt-in-flight, never replayed). The journal MUST be scoped by
`companyId`: an empty `companyId` MUST be rejected and a lookup under the wrong
tenant MUST return no row. The status domain and the `UNIQUE(company_id,
idempotency_key)` MUST be durable in PostgreSQL and mirrored by the in-memory fake.
[REQ] [INF]

#### Scenario: Same key and same hash replays the stored result

- GIVEN a `completed` journal row whose request hash matches the current attempt
- WHEN the journal is looked up for that key
- THEN the stored result MUST be replayed and the effect MUST NOT be re-run

#### Scenario: Same key and different hash is denied

- GIVEN a `completed` journal row whose request hash differs from the current attempt
- WHEN the journal is looked up for that key
- THEN the lookup MUST DENY as idempotency-conflict

#### Scenario: In-flight attempt is never replayed

- GIVEN an `in_flight` journal row for a key
- WHEN the journal is looked up for that key
- THEN the result MUST be attempt-in-flight and MUST NOT replay any result

#### Scenario: Fresh key records in-flight before the effect

- GIVEN no journal row for a key
- WHEN `insertInFlight` is invoked
- THEN an `in_flight` row MUST be recorded BEFORE the effect runs

#### Scenario: Tenant scope enforced on lookup

- GIVEN a journal row owned by tenant A
- WHEN looked up with an empty `companyId`, or under a different tenant B
- THEN an empty `companyId` MUST be rejected and the wrong-tenant lookup MUST return no row

### Requirement: Retryable Marker on Finalize CAS Loss

When a finalize attempt loses the CAS race AFTER its effect was applied while the
Work is still `in_progress` (the attempt lost a race but the Work remains
legitimately completable), the journal MUST record a durable retryable marker
(status `aborted_retryable`) distinct from `in_flight` and `completed`, instead of
sealing the key with a failure. The marker MUST be durable in PostgreSQL (a
migration extends the status domain) and mirrored by the fake. The marker MUST NOT
brick the idempotency key. [REQ] [INF]

#### Scenario: Marker set on CAS loss with applied effect and in-progress work

- GIVEN the effect was applied, the Work is `in_progress`, and the finalize CAS lost a race
- WHEN the attempt is finalized
- THEN the journal row status MUST become `aborted_retryable`, durable in PostgreSQL

#### Scenario: Marker is distinct from in-flight and completed

- GIVEN a row carrying the retryable marker
- WHEN its status is inspected
- THEN it MUST be neither `in_flight` nor `completed`

#### Scenario: Marker survives a restart

- GIVEN a retryable marker written to live PostgreSQL 18.4 (`io_pg`)
- WHEN the process restarts and the journal is read again
- THEN the row MUST survive with status `aborted_retryable`

### Requirement: Retryable Lookup Permits a Controlled Retry (No-Zombie)

On a pre-effect lookup, a row marked `aborted_retryable` for a key MUST allow a
controlled retry: the caller MUST proceed with a fresh attempt rather than replaying
a failure or being permanently blocked. A retryable row MUST NOT replay a failure
result and MUST NOT poison future retries — foundation parity with the rollback in
`complete-work.ts:103-108`, which lets a future retry succeed. This MUST NOT weaken
replay/DENY for genuinely completed attempts: `completed` + same hash still REPLAYS
and `completed` + different hash still DENIES. The single-receipt invariant
(`UNIQUE(work_id, terminal_event_id)`) and the atomic terminal close MUST still hold
for the retry that wins. [REQ] [INF]

#### Scenario: Retry after a retryable marker can succeed

- GIVEN a retryable row for a key and a Work still `in_progress`
- WHEN a fresh same-key attempt runs and wins the CAS
- THEN it MUST complete and the journal MUST record `completed` with the stored result

#### Scenario: Retryable row does not replay a failure

- GIVEN a retryable row for a key
- WHEN the journal is looked up for that key
- THEN the caller MUST NOT receive a replayed failure result and MUST proceed with a fresh attempt

#### Scenario: Completed attempt still replays correctly

- GIVEN a `completed` row with a matching request hash
- WHEN the journal is looked up for that key
- THEN the stored result MUST be replayed (the retryable path MUST NOT regress this)

#### Scenario: Completed attempt still denies on hash mismatch

- GIVEN a `completed` row with a differing request hash
- WHEN the journal is looked up for that key
- THEN the lookup MUST DENY as idempotency-conflict (the retryable path MUST NOT regress this)

#### Scenario: Single receipt holds across the retry

- GIVEN a retryable-marked attempt whose receipt did not survive the CAS loss
- WHEN the retry wins and issues its receipt for `(work_id, terminal_event_id)`
- THEN exactly one receipt MUST exist and a duplicate close MUST be rejected by `UNIQUE(work_id, terminal_event_id)`
