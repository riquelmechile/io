# io-persistence-recovery-contract Specification

## Purpose

Persistence and recovery contract for IO authoritative state, audit, idempotency, messaging, leases, external effects, receipts, privacy deletion, and failure recovery. PostgreSQL is the sole business-authoritative source. It carries all 17 records (R1-R17) and ADR-0001/0002/0003 invariants from `io-ports-trust-contract` and defines their persistence/recovery semantics; record field detail is authoritative there. All mechanisms (DDL, ORM, retry constants, receipt signing, crypto-erasure) are downstream.

## Requirements

### Requirement: Authoritative State Ownership and Degradation

PostgreSQL MUST be the sole business-authoritative state source; memory, LLM context, filesystem, and daemon MUST NOT hold business-authoritative data. Each capability owns the records it produces; the database layer is connection/migration/query utilities only, and cross-context references MUST use neutral IDs (`work_id`, `principal_id`, `authority_commitment_id`). When PostgreSQL is unavailable, the system MUST reject authoritative mutations and external effects requiring durable coordination, MAY allow only stateless read-only computation, and MUST NOT silently buffer or defer authoritative mutations.

#### Scenario: PG down rejects mutations

- **GIVEN** PostgreSQL unavailable
- **WHEN** an authoritative mutation is requested
- **THEN** it MUST be rejected and only stateless read-only computation MAY proceed

### Requirement: Single-Aggregate Transaction Boundary

One business command MUST mutate at most one authoritative aggregate plus technical control records, committed atomically: the state transition, an embedded immutable authorization/risk/SOD/policy/approval/evidence snapshot (stored, not merely referenced), the audit event (R16), the idempotency terminal state, and outbox messages when applicable. Cross-context business changes MUST use messages, saga, or process coordination.

#### Scenario: Embedded snapshot proves the decision

- **GIVEN** a business command mutating an aggregate
- **WHEN** the transaction commits
- **THEN** the immutable authorization snapshot MUST be stored in the same transaction and recoverable for audit

### Requirement: Required Records Carriage

All 17 records below MUST be carried as REQUIRED for audit, recovery, and reconciliation; storage mechanisms remain downstream. Field detail is authoritative in `io-ports-trust-contract`. Persistence-specific invariants: R10 links Work to a separate, independently auditable Delegation authority; R13 journals every daemon invocation under a command-bound grant with a signed/bound result (trust requirement); R15 immutable receipt binds Work ID plus Delegation/policy-authority ID; R16 is the append-only audit log.

| # | Record |
|---|--------|
| R1 | Authority evaluation |
| R2 | Policy version |
| R3 | Risk input/output |
| R4 | Human downgrade exception |
| R5 | SOD / principal-independence |
| R6 | Approvals |
| R7 | Evidence |
| R8 | Verification |
| R9 | Assignment-attributed history |
| R10 | Delegation authority history |
| R11 | Command/grant binding |
| R12 | Lease/fencing |
| R13 | Daemon command/outcome |
| R14 | LLM invocation/attempt/cost |
| R15 | Immutable receipt fields |
| R16 | Append-only audit |
| R17 | Unknown/partial reconciliation |

#### Scenario: All records recoverable

- **GIVEN** the system operating across authority, work, delegation, daemon, and LLM flows
- **WHEN** inspected for audit or recovery
- **THEN** records R1-R17 MUST be present with the Work/authority dual-reference identifiable in R10 and R15

### Requirement: Append-Only Integrity and Privacy Deletion

Audit records (R16) MUST be append-only enforced by database roles, permissions, constraints, or triggers — NOT application booleans. When policy or law mandates deletion, the system MUST perform a true hard delete of original personal content; a tombstone or deletion receipt MAY be preserved ONLY when legally permitted, and MUST NOT retain data the deletion requires removing. Redaction and crypto-erasure are alternatives, NOT substitutes, when hard delete is mandated.

#### Scenario: Mandated hard delete destroys content

- **GIVEN** a deletion mandate requiring removal of personal content
- **WHEN** the deletion executes
- **THEN** original personal content MUST be destroyed and a tombstone preserved ONLY if legally permitted

### Requirement: Atomic Idempotency

Idempotency MUST be scoped by tenant, operation type, and idempotency key; concurrent mutations for the same scoped key MUST be serialized. The business effect and terminal idempotency result MUST commit atomically, and a rollback MUST leave no completed marker and no orphan pending state. A key reused with a different request hash MUST be DENIED (conflict). A separate durable attempt record MUST be used for pre-external-call reservation, the idempotency record remaining pending until the attempt reaches a proven terminal state.

#### Scenario: No orphan pending after rollback

- **GIVEN** an idempotent mutation whose transaction rolls back
- **WHEN** recovery inspects the idempotency record
- **THEN** there MUST be no completed marker and no orphan pending state

### Requirement: At-Least-Once Outbox and Inbox Safety

Outbox messages MUST be written in the same transaction as the business state transition. A consumer MUST NOT mark a message processed before its effects are durably applied: DB-local effects and the inbox/dedup record MUST commit in the same transaction, while non-transactional external effects MUST use a durable attempt record with UNKNOWN reconciliation. The system MUST claim at-least-once delivery only — exactly-once MUST NOT be claimed. After max bounded retries, a message MUST move to dead-letter requiring human/operator recovery with audit trail.

#### Scenario: Processed only after durable effect

- **GIVEN** an inbox consumer applying DB-local effects
- **WHEN** the consumer transaction commits
- **THEN** both the effect and the dedup record MUST commit together, and a crash MUST allow safe redelivery

### Requirement: Lease Fencing

A monotonic fencing token MUST be scoped to the resource, aggregate, or lease it protects. Every protected commit MUST validate the token; a stale token MUST be rejected, and heartbeat or expiry alone MUST NOT authorize a commit — an expired holder MUST NOT commit. Lease expiry MUST NOT automatically retry external-effect steps; reconciliation of the prior attempt MUST occur first, and retry is permitted only after proving non-execution or explicit human authorization accepting duplicate risk.

#### Scenario: Expired holder cannot commit

- **GIVEN** a lease holder whose lease has expired
- **WHEN** the holder attempts a protected commit
- **THEN** the commit MUST be rejected regardless of heartbeat recency

### Requirement: External-Effect Unknown-Outcome Recovery

For LLM, daemon, and provider calls, one logical invocation MAY produce multiple attempts, each with its own attempt ID and provider request ID. A timeout MUST be classified as UNKNOWN — the provider MAY have processed it — and MUST require reconciliation before retry. Budget reserved before a call MUST remain held until reconciliation on unknown outcome. When reconciliation is impossible, the attempt MUST transition to terminal `UNRESOLVED_REQUIRES_HUMAN`, retaining an immutable terminal disposition. A human MAY record the accepted outcome, abandon, compensate, or authorize a new attempt with explicit duplicate-risk evidence. Non-compensable effects MUST escalate to a human immediately.

#### Scenario: Timeout reconciled before retry

- **GIVEN** an external call that times out
- **WHEN** the timeout is classified
- **THEN** it MUST be treated as UNKNOWN and reconciled before retry, or transitioned to UNRESOLVED_REQUIRES_HUMAN when reconciliation is impossible

### Requirement: Receipt Integrity

Receipt fields (R15) MUST be immutable once written and MUST include source identity, artifact version and hash, policy version reference, evidence reference, authorized actor principal_id, terminal state, and the Work ID plus Delegation or policy-authority ID. A canonical hash MUST verify artifact bytes against a trusted stored anchor for local integrity only; it MUST NOT be claimed as independent tamper-proof or non-repudiation evidence. Receipt signing, key custody, and transparency-log anchoring are deferred and MUST NOT be claimed as satisfied.

#### Scenario: Hash is local integrity only

- **GIVEN** a receipt with a verified canonical hash
- **WHEN** its integrity scope is described
- **THEN** it MUST be stated as local integrity under immutable DB controls and MUST NOT be claimed as non-repudiation

### Requirement: Recovery Matrix

The system MUST provide safe recovery with terminal conditions for each failure mode below.

| Failure | Safe action | Terminal condition | Human path |
|---|---|---|---|
| PG down mid-tx | Roll back; reject new mutations | PG restored | Operator verifies no partial commit |
| Worker crash after external call | Mark attempt UNKNOWN; reconcile | Confirmed/no-exec/UNRESOLVED | Retry, compensate, or accept |
| Worker crash before external call | Release budget; no orphan pending | Reconciled or expired | None — no external effect |
| Daemon disconnect | Mark command UNKNOWN; reconcile | Confirmed/no-effect/UNRESOLVED | Retry or compensate |
| Lease expiry mid-workflow | Halt; no auto-retry external effects | New lease + proven-no-duplicate, or UNRESOLVED | Review, reassign, or cancel |
| Outbox max retries | Dead-letter; audit event | Dead-letter created | Operator re-dispatch or mark failed |
| Non-compensable unknown | Halt affected work; escalate | Human decision recorded | Retry, compensate, or accept |

#### Scenario: Idempotency orphan ruled out

- **GIVEN** the recovery matrix coverage
- **WHEN** an idempotency pending orphan is considered
- **THEN** it MUST be ruled out by the atomic-commit invariant and require no recovery action
