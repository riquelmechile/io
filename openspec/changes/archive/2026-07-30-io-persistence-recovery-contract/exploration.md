# Exploration: IO Persistence, Audit, Idempotency & Recovery Contract

> **Contract:** PostgreSQL authoritative state ownership, single-aggregate transaction boundary with embedded immutable authorization snapshots, append-only audit, atomic idempotency, outbox/inbox at-least-once with inbox safety (never mark processed first), lease fencing with monotonic scoped token, LLM/daemon UNKNOWN-outcome handling with UNRESOLVED_REQUIRES_HUMAN terminal, privacy-compliant true hard delete, and recovery matrix -- carrying all 17 required records from ports/trust v2 and all ADR-0001/0002/0003 invariants. [INF] Supersedes S11 downstream items 3-8 from ports/trust v2. [INF]

---

## 1. PostgreSQL Authoritative State Ownership [SRC] [INF]

PostgreSQL is the authoritative state source for IO. [SRC] S6.3 No other store (memory, LLM context, filesystem, daemon) holds business-authoritative data. [INF]

### 1.1 Logical Ownership by Capability

Each domain/application capability owns the records it produces. [INF] The database/ package provides connection, migration, and query utilities -- it does NOT own business tables or aggregates. [DOMAIN]

| Capability | Owns records for |
|---|---|
| work/ | Work state transitions, deliverables, acceptance, outcomes |
| contracts/ | Agreement terms, versions, status |
| organization/ | Positions and reporting structure ONLY [ADR-0001] |
| workforce/ | **Worker identity, assignment lifecycle and history exclusively** [ADR-0001] |
| policy/ | Policy rules, versions, allowed/prohibited actions |
| approvals/ | Approval chains, routing, authority resolution |
| budgets/ | Budget policy, caps, consumption, cost attribution |
| evidence/ | Artifact hashes, verification proofs |
| receipts/ | Execution receipts per S12 |
| audit/ | Append-only audit trail [SRC] S9.8, S4.10 |
| evaluation/ | Quality scoring, outcome measurement |
| incidents/ | Incidents, classification, resolution, post-mortems |
| process/ | Procedure definitions, SLA, error scenarios, recovery strategies [SRC] S3.3 |
| Delegation (placement deferred [DOMAIN]) | Authority scope, budget, duration, revocation, reassignment [ADR-0002] |

### 1.2 Neutral Assignment References [ADR-0001]

Contracts, budgets, evaluation, and audit keep neutral assignment references (assignment ID, effective dates, principal_id, position_id) as history -- they do NOT own or duplicate the assignment aggregate. [ADR-0001] Organization owns positions/reporting structure only; **workforce exclusively owns worker identity and assignment lifecycle/history**. [ADR-0001]

### 1.3 Cross-Context References

Cross-context references use neutral IDs (work_id, principal_id, position_id, authority_commitment_id). [ADR-0001] Database-enforced FKs are permitted when ownership/transaction boundary justifies them -- no blanket prohibition or requirement. [HYP]

---

## 2. Transaction Boundary [INF]

One business command mutates at most **ONE authoritative business aggregate/context** plus technical control records: [INF]

1. **One** business state transition (work completed, budget consumed, delegation activated). [DOMAIN]
2. **Embedded immutable authorization/risk/SOD/policy/approval/evidence snapshot** needed to prove the decision -- stored, not just weakly referenced; references may supplement. [INF]
3. Audit event (R16). [PORTS]
4. Idempotency terminal state update (S5). [INF]
5. Outbox messages when applicable (S6). [INF]

Cross-context business changes use **messages, saga, or process coordination** -- no multi-aggregate transactional coupling. [INF]

---

## 3. Required Records -- Full Carry from Ports/Trust v2 [PORTS]

All 17 records from ports/trust v2 S8 are carried. [PORTS]

| # | Record | ADR Carry | Key Fields |
|---|---|---|---|
| R1 | Authority evaluation | Verdict, action, policy version, risk class [ADR-0003] |
| R2 | Policy version | Ruleset hash, effective range |
| R3 | Risk input/output | Classification inputs, deterministic tier, human override [ADR-0003] |
| R4 | Human downgrade exception | Reason, authorizer, evidence [ADR-0003] |
| R5 | SOD/principal-independence | Principals per function, DENY on overlap [ADR-0003] |
| R6 | Approvals | Chain: identity, timestamp, scope [ADR-0001] |
| R7 | Evidence | Artifact hash, verification proof, outcome link |
| R8 | Verification | Post-execution result, verifier identity |
| R9 | Assignment-attributed history | Assignment ID, effective dates, in contract/budget/evaluation/audit [ADR-0001] |
| R10 | Delegation authority history | **Separate identity, lifecycle, revocation, reassignment, independently auditable history separate from Work**; Work linked by stable authority reference [ADR-0002] |
| R11 | Command/grant binding | Grant ID, command ID, action scope |
| R12 | Lease/fencing | Lease ID, holder, monotonic token **scoped to resource/aggregate/lease**, expiry |
| R13 | Daemon command/outcome | **Journals EVERY daemon invocation/command transition**, carries command-bound grant; **signed/bound result is a trust REQUIREMENT**; cryptographic mechanism remains downstream [PORTS] |
| R14 | LLM invocation/attempt/cost | Invocation ID, attempt ID, provider request ID, fingerprint, usage, cost, outcome |
| R15 | **Immutable** receipt fields | **Links Work plus Delegation or policy-authority ID**, artifact hash/version, policy, evidence, actor, terminal state [ADR-0002] |
| R16 | Append-only audit | Immutable R/W log with authority reference [SRC] S9.8 |
| R17 | Unknown/partial reconciliation | Original outcome, reconciliation result, reconciler, timestamp |

---

## 4. Append-Only Integrity [SRC] [INF]

### 4.1 Enforcement Mechanism

Audit records (R16) are append-only. [SRC] S9.8 Enforcement is through database roles, permissions, constraints, or triggers -- not application booleans. [INF]

### 4.2 Privacy-Compliant Deletion [INF]

Policy or law may require **true hard delete of original personal content**. [INF]
- Authorized hard deletion MUST destroy original personal content when policy or law requires. [INF]
- A non-identifying compliance tombstone or deletion receipt is preserved **only when legally permitted**; never retain data the deletion requires removing. [INF]
- All exceptions are independently authorized and audited **without retaining prohibited data**. [INF]
- Redaction and crypto-erasure are **alternatives, not substitutes**, when hard delete is mandated. [INF]

The exact crypto-erasure or redaction mechanism requires its own ADR. [INF]

---

## 5. Idempotency [SRC] [INF]

Source S9.8 prescribes idempotency keys. [SRC]

### 5.1 Atomic Commit -- No Orphan Pending

Idempotency scoped by company_id (tenant) + operation_type + idempotency_key. [INF] **Concurrent mutations for the same scoped key are serialized.** [INF] **Business effect and terminal idempotency result commit atomically in the same transaction;** a rollback leaves no completed marker and **no impossible orphan pending** state. [INF]

### 5.2 State Machine

| State | Meaning |
|---|---|
| pending | Transaction in progress (cannot be orphaned by rolled-back atomic tx) |
| completed | Durable result available |
| expired | Retention window elapsed |
| conflict | Key reuse with different request hash -- DENIED | [INF]

### 5.3 Pre-External-Call and UNKNOWN

For pre-external-call reservation (LLM, daemon, provider), a **separate durable attempt record** is used explicitly, with UNKNOWN reconciliation before terminal resolution. [INF] The idempotency record remains pending until the attempt reaches a proven terminal state. [INF]

### 5.4 Non-Reusable Key Tombstone

When keys can never be reused, a non-sensitive tombstone `(company, operation, key_digest)` is retained after payload/result expiry. [INF] A conflicting request with the same key but different hash is denied. [INF]

---

## 6. Outbox/Inbox -- At-Least-Once [INF]

### 6.1 Outbox Same Transaction

Outbox messages are written in the same transaction boundary as the business state transition (S2). [INF] Each message gets a unique delivery_id. [INF]

### 6.2 Inbox Safety

**Never mark a message processed before its effects are durably applied.** [INF]
- **DB-local consumer effects:** Apply effects and insert completed inbox/dedup record in the **same transaction**; crash rolls **both** back and redelivery is safe. [INF]
- **Non-transactional external effects:** Use a durable attempt record with UNKNOWN state; rely on consumer-specific idempotency and reconciliation. Do not skip delivery until terminal completion is proven. [INF]

At-least-once delivery only; **no exactly-once claim**. [INF]

### 6.3 Retry, Backoff, and Dead-Letter

Bounded retry with exponential backoff -- these are **recovery semantics**, not a delivery policy. [INF] After max attempts, message moves to dead-letter queue. [INF] Dead-letter recovery requires operator or human intervention with audit trail. [INF]

---

## 7. Leases and Fencing [INF]

### 7.1 Scoped Monotonic Fencing Token

A **monotonic** fencing token is scoped to the resource, aggregate, or lease it protects. [INF] Every protected commit validates the token: stale token yields write rejected. [INF] Heartbeat/expiry alone is INSUFFICIENT -- an expired holder MUST NOT commit. [INF]

### 7.2 Lease Expiry and External Effects

Lease expiry does **NOT automatically retry** external-effect steps (LLM calls, daemon commands, provider requests). [INF] Reconcile the LLM/daemon/provider attempt state first; retry only after proving the previous attempt was not executed or **after explicit human authorization accepting duplicate risk**. [INF]

### 7.3 Terminal Outcomes

Max acquisition attempts exceeded yields terminal failure, escalate to human. [INF] No zombie state where two holders believe they are active. [INF]

---

## 8. LLM and External Call Handling [INF]

### 8.1 Invocation vs Attempt

One logical invocation may produce multiple attempts. [INF] Logical invocation ID is stable; each attempt gets its own ID and provider request ID (if available). [INF]

### 8.2 Budget Reservation

Budget reserved before the call. [INF] On completion, converts to actual consumption. [INF] On unknown outcome, reservation remains held until reconciliation. [INF]

### 8.3 Timeout = UNKNOWN

Timeout is classified as unknown, NOT failed. [INF] Provider may have processed the request. [INF] Reconciliation required before retry. [INF]

### 8.4 UNRESOLVED_REQUIRES_HUMAN Terminal Path

When reconciliation is impossible (provider unreachable, evidence destroyed), the attempt transitions to terminal `UNRESOLVED_REQUIRES_HUMAN`. [INF] Human may: record accepted external outcome, abandon/no-retry, compensate, or **authorize a new attempt with explicit duplicate-risk evidence**. [INF] The original attempt retains its **immutable terminal disposition**; it does not remain pending indefinitely. [INF]

### 8.5 Provider Dedup

Provider-side deduplication used ONLY if the provider documents and guarantees it. [INF] Otherwise each attempt is independent. [INF]

---

## 9. Daemon Command Handling [PORTS] [INF]

### 9.1 Command Lifecycle

| State | Meaning |
|---|---|
| accepted | Command received, authority validated |
| started | Daemon acknowledged and began execution |
| completed | Result returned with fingerprint/evidence |
| unknown | Disconnect, timeout, or no response | [INF]

### 9.2 Required Fields

Command ID, capability/grant reference, boot epoch, state, result fingerprint or evidence (when completed). [PORTS]

### 9.3 Unknown and UNRESOLVED Handling

Disconnect or timeout yields unknown state. [INF] Reconcile before retry. [INF] When reconciliation is impossible, transition to `UNRESOLVED_REQUIRES_HUMAN` with the same human resolution paths as S8.4. [INF] Non-compensable effects escalate to human immediately. [INF]

---

## 10. PG-Down Degradation [SRC] [INF]

When PostgreSQL is unavailable: REJECT authoritative mutations and external effects requiring durable coordination. [INF] ALLOW explicitly stateless/read-only computation that cannot create commitment or authoritative output. [INF] The system does not silently buffer or defer authoritative mutations. [INF]

---

## 11. Receipts [SRC] [PORTS] [ADR-0002]

### 11.1 Required Fields (Immutable)

Receipt fields are immutable once written. [INF] Required: source-required identity [SRC] S12.1, artifact version and hash [SRC] S3.11, policy version reference [PORTS], evidence reference [PORTS], authorized actor principal_id [ADR-0001], terminal state [PORTS], **Work ID plus Delegation or policy-authority ID** [ADR-0002].

### 11.2 Hash Verification -- Local Integrity Only

Canonical hash verifies artifact bytes against a trusted stored anchor. [INF] This provides local integrity under immutable DB controls and audit assumptions. [INF] It is **NOT** independent tamper-proof or non-repudiation if artifact, receipt, and hash can all be replaced. [INF] External signing, key custody, and **transparency-log anchoring** require a later ADR before non-repudiation can be claimed. [INF]

### 11.3 Canonicalization and Signing

Exact canonicalization algorithm is design-phase. [INF] Receipt signing, key custody, and transparency anchor explicitly **DEFERRED** to a later ADR. [INF] [HYP]

---

## 12. Recovery Matrix [INF]

| Failure | Owner | Safe Action | Terminal Condition | Human Path |
|---|---|---|---|---|
| PG down mid-tx | database/ | Roll back; reject new mutations (S10) | PG restored | Operator verifies no partial commit |
| Worker crash after LLM call | work/ + deepseek/ | Mark invocation unknown; reconcile (S8.4) | Provider confirms, confirms no execution, or UNRESOLVED_REQUIRES_HUMAN | Human: retry, compensate, or accept |
| Worker crash before LLM call | work/ | Release budget reservation; no orphan pending (S5.1) | Reconciled or expired | None -- no external effect |
| Daemon disconnect | work/ + daemon | Mark command unknown; reconcile (S9.3) | Daemon confirms, confirms no effect, or UNRESOLVED_REQUIRES_HUMAN | Human: retry or manual compensation |
| Lease expiry mid-workflow | workflows/ | Halt; do NOT auto-retry external effects (S7.2) | New lease + proven no-duplicate, or UNRESOLVED_REQUIRES_HUMAN | Human reviews, reassign or cancel |
| Idempotency pending orphan | -- | Ruled out by atomic commit (S5.1) | N/A | N/A |
| Outbox max retries | Consumer owner | Dead-letter; audit event | Dead-letter created | Operator/human re-dispatches or marks failed |
| Non-compensable unknown | Escalation owner | Halt affected work; escalate | Human decision recorded | Human: retry, compensate, or accept |

---

## 13. Explicitly Downstream [INF] [HYP]

1. Concrete SQL DDL, table design, index strategy
2. ORM/tool selection and repository pattern
3. Retry backoff constants, dead-letter retention
4. Canonicalization algorithm for receipt artifact hashing
5. Crypto-erasure / redaction mechanism (requires own ADR)
6. Receipt signing, key custody, transparency-log anchoring (requires own ADR)
7. Policy threshold values for non-reserved risk tiers [ADR-0003]
8. Provider-side dedup verification per LLM vendor

---

## 14. Provenance and Claim Labels

| Claim | Label | Rationale |
|---|---|---|
| PG authoritative | [SRC] | Source S6.3 |
| Append-only audit, idempotency keys | [SRC] | Source S9.8 |
| Durable work survives restart | [SRC] | Source principle 6 |
| Receipt as execution evidence | [SRC] | Source S12.1 |
| Memory not operational truth | [SRC] | Source principle 4 |
| Deterministic writes | [SRC] | Source S9.3 |
| Logical ownership per capability | [INF] | Domain contract package ownership |
| Organization owns positions only; workforce exclusively owns identity/assignments | [ADR-0001] | ADR-0001 ownership boundary |
| Contracts/budgets/evaluation/audit keep neutral assignment refs | [ADR-0001] | ADR-0001 consequence |
| Single-aggregate tx boundary; cross-context via coordination | [INF] | Atomicity + coordination inference |
| Embedded immutable authorization snapshots in transaction | [INF] | Audit-proof and recovery requirement |
| FK policy | [HYP] | No source prescription on FK granularity |
| Append-only via DB roles/triggers not booleans | [INF] | Security-pattern inference |
| Privacy-compliant true hard delete with conditional tombstone | [INF] | Legal/privacy requirement |
| Atomic idempotency; no orphan pending from rollback | [INF] | Transactional atomicity |
| Serialized concurrent scoped key; business effect + terminal atomically | [INF] | Concurrency safety |
| Separate durable attempt for pre-external-call | [INF] | UNKNOWN reconciliation requirement |
| Non-reusable key tombstone (company, op, key_digest) | [INF] | Conflict prevention |
| Outbox same-tx; inbox safety same-tx for DB-local | [INF] | Messaging-pattern inference |
| Never mark processed first; at-least-once only | [INF] | Honesty about delivery semantics |
| Retry/backoff/DLQ are recovery semantics | [INF] | No dishonest delivery-policy claim |
| Fencing scoped monotonic token to resource/aggregate/lease | [INF] | Distributed-systems inference |
| Lease expiry does not auto-retry external effects | [INF] | Safety requirement |
| Timeout = unknown; UNRESOLVED_REQUIRES_HUMAN terminal | [INF] | Source principle 6 derivation |
| Provider dedup only if vendor-documented | [INF] | Conservative inference |
| PG-down reject mutations | [INF] | PG authoritative stance |
| Canonical hash = local integrity only; not non-repudiation | [INF] | Honesty about integrity scope |
| Signing/key custody/transparency anchor deferred | [INF] [HYP] | No source/ADR mandate yet |
| All 17 records carried | [PORTS] | Ports/trust v2 S8 |
| R10 separate Delegation identity + independent auditable history | [ADR-0002] | ADR-0002 invariant |
| R13 daemon journal + command-bound grant; signing is trust req | [PORTS] | Ports/trust v2 + trust contract |
| R15 immutable receipt linking Work + Delegation/authority | [ADR-0002] | ADR-0002 invariant |
| Assignment IDs in four histories | [ADR-0001] | ADR-0001 consequence |
| Risk class before authority; DENY on overlap | [ADR-0003] | ADR-0003 invariants |
| Recovery matrix | [INF] | Failure-mode derivation |

---

## 15. Acceptance Criteria

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| AC1 | PG authoritative; no other store holds business-authoritative data. [SRC] | S1: [SRC] S6.3; memory/LM/filesystem not authoritative [SRC] principle 4 | PASS |
| AC2 | Logical ownership by capability, not central DB module. [INF] | S1.1: 13 capability owners; database/ = utilities only [DOMAIN] | PASS |
| AC3 | Organization owns positions/reporting only; workforce exclusively owns identity/assignment lifecycle; contracts/budgets/evaluation/audit keep neutral refs. [ADR-0001] | S1.1 + S1.2: ownership split + neutral references [ADR-0001] | PASS |
| AC4 | Single-aggregate tx with embedded immutable auth snapshots; cross-context via coordination. [INF] | S2: one aggregate + embedded snapshots stored + cross-context via messages/saga | PASS |
| AC5 | R10: separate Delegation identity + independently auditable history. R13: journals every invocation + command-bound grant; signed result = trust requirement. R15: immutable + links Work + Delegation/authority ID. [PORTS] [ADR-0002] | S3 R10/R13/R15 rows | PASS |
| AC6 | Append-only enforced by DB, not application booleans. [INF] | S4.1: DB roles/permissions/constraints/triggers | PASS |
| AC7 | Privacy-compliant deletion: true hard delete when law requires; tombstone only when legally permitted; redaction/crypto-erasure are alternatives not substitutes. [INF] | S4.2: all four sub-points | PASS |
| AC8 | Atomic idempotency; no orphan pending; separate durable attempt for pre-external-call; non-reusable key tombstone. [INF] | S5: S5.1 atomic commit + serialized, S5.3 separate attempt, S5.4 tombstone | PASS |
| AC9 | Inbox safety: never mark processed before effects; DB-local same-tx; non-transactional via UNKNOWN. At-least-once only. [INF] | S6.2: same-tx for DB-local; UNKNOWN for external; no exactly-once | PASS |
| AC10 | Outbox same-tx; dead-letter with human recovery; retry/backoff labeled as recovery semantics only. [INF] | S6.1 + S6.3 | PASS |
| AC11 | Fencing scoped monotonic token to resource/aggregate/lease; lease expiry does NOT auto-retry external effects. [INF] | S7.1 scoped monotonic token + S7.2 reconcile-first rule | PASS |
| AC12 | LLM timeout = UNKNOWN; UNRESOLVED_REQUIRES_HUMAN terminal with human options. [INF] | S8.3 + S8.4: four human options; immutable terminal disposition | PASS |
| AC13 | Daemon UNKNOWN and UNRESOLVED_REQUIRES_HUMAN; non-compensable escalation. [INF] | S9.3: reconcile then UNRESOLVED terminal | PASS |
| AC14 | PG-down rejects mutations; allows stateless/read-only only. [INF] | S10 | PASS |
| AC15 | Receipts immutable; hash = local integrity only; non-repudiation NOT claimed; signing/transparency deferred. [INF] | S11.1 + S11.2: honesty about scope; S11.3 deferred | PASS |
| AC16 | Recovery matrix with UNRESOLVED terminal; idempotency orphan ruled out. [INF] | S12: eight rows; orphan N/A by S5.1 | PASS |
| AC17 | Every substantive claim labeled. [INF] | S14: 34 labeled claims with rationale | PASS |
| AC18 | No SQL DDL, ORM, code, or delivery constants. [INF] | S13: all downstream | PASS |
| AC19 | Line count 260-340. [INF] | Structural count | PASS |
