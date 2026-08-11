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

## Requirements

### Requirement: Journal Status Domain and Pre-Effect Lookup Decision Table

Journal status MUST be exactly `in_flight | aborted_retryable | completed`. `insertInFlight` MUST precede the effect and store the claim fencing token. `complete` MUST transition only an `in_flight` row, MUST reject any other status without mutation, and MUST NOT require token ownership. Lookup MUST resolve: absent → fresh attempt; matching `completed` → token-free REPLAY; mismatching `completed` → DENY; `in_flight` → attempt-in-flight. Tenant scope, uniqueness, and fake/PostgreSQL parity MUST hold. Existing rows MUST validly default to token 0. [REQ] [INF]
(Previously: Rows had no fencing token and completion had no status guard.)

#### Scenario: Same key and same hash replays the stored result
- GIVEN matching `completed` row
- WHEN lookup runs without a token
- THEN stored result MUST replay without effect

#### Scenario: Same key and different hash is denied
- GIVEN differing-hash `completed` row
- WHEN lookup runs
- THEN it MUST DENY

#### Scenario: In-flight attempt is never replayed
- GIVEN an `in_flight` row
- WHEN lookup runs
- THEN it MUST report attempt-in-flight

#### Scenario: Fresh key records in-flight before the effect
- GIVEN no row and claim token N
- WHEN `insertInFlight` runs
- THEN `in_flight` with token N MUST persist before effect

#### Scenario: Tenant scope enforced on lookup
- GIVEN tenant A owns a row
- WHEN empty scope or tenant B looks up
- THEN empty scope MUST reject and tenant B MUST see no row

#### Scenario: Status guard preserves honest unresolved close
- GIVEN an `in_flight` row and stale-holder honest T2(ii) reconciliation
- WHEN `complete` stores `UNRESOLVED_REQUIRES_HUMAN`
- THEN completion MUST succeed without a token check

#### Scenario: Completion rejects non-in-flight status
- GIVEN a `completed` or `aborted_retryable` row
- WHEN `complete` runs
- THEN it MUST reject and leave the row unchanged

#### Scenario: Pre-fencing row remains valid
- GIVEN an existing row defaulted to token 0
- WHEN resumed without a fresh claim
- THEN token 0 MUST be retained and valid

### Requirement: Retryable Marker on Finalize CAS Loss

For `in_flight` Work that remains `in_progress`, `markRetryable` MUST change the attempt to durable `aborted_retryable` when either an applied effect has been undone or durable evidence proves no effect was applied. The supplied token MUST equal the stored token; a stale token MUST return a typed failure without mutation. Abort MUST NOT call `complete`, store a completed result, or seal the key. Controlled retry MUST retain the same token without re-claim or increment. PostgreSQL and fake MUST behave identically. [REQ] [INF]
(Previously: `markRetryable` was specified only after an applied effect and finalize CAS loss.)

#### Scenario: Marker set after applied effect is undone
- GIVEN applied effect, in-progress Work, and matching token N
- WHEN undo succeeds and `markRetryable` runs
- THEN `aborted_retryable` MUST persist

#### Scenario: W2 abort requires no preceding undo
- GIVEN an `in_flight` attempt and durable evidence that no effect was applied
- WHEN `markRetryable` runs with matching token N
- THEN `aborted_retryable` MUST persist without invoking undo

#### Scenario: Marker is distinct from in-flight and completed
- GIVEN a retryable row
- WHEN status is inspected
- THEN it MUST be neither `in_flight` nor `completed`

#### Scenario: Marker survives a restart
- GIVEN marker stored in PostgreSQL 18.4
- WHEN the process restarts
- THEN `aborted_retryable` MUST remain

#### Scenario: Stale token cannot mark retryable
- GIVEN stored token N + 1
- WHEN `markRetryable` supplies N
- THEN it MUST return a typed failure and preserve status and result

#### Scenario: Fake and PostgreSQL parity
- GIVEN equivalent journal rows in fake and PostgreSQL
- WHEN matching, stale, and token-0 writes run
- THEN decisions and stored rows MUST match

#### Scenario: Controlled retry retains its token
- GIVEN `aborted_retryable` row with token N
- WHEN a same-key retry resumes
- THEN it MUST use N without a fresh claim or increment

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
