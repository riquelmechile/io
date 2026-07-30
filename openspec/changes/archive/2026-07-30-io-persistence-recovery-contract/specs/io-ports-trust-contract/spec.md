# Delta for io-ports-trust-contract

## MODIFIED Requirements

### Requirement: Required Persistence and Recovery Records

The following records are REQUIRED for audit, recovery, and reconciliation. The
persistence and recovery semantics for ALL of these records — ownership,
transaction boundary, append-only integrity, privacy deletion, idempotency,
outbox/inbox, lease fencing, external-call UNKNOWN recovery, daemon outcomes,
receipts, and the failure recovery matrix — are carried into and defined by the
`io-persistence-recovery-contract` capability. This contract MUST NOT duplicate
those semantics; it references them by capability. Storage mechanisms remain
downstream. [INF] [HYP]

| # | Record | Scope |
|---|--------|-------|
| R1 | Authority evaluations/decisions | Per-action check outcome |
| R2 | Policy versions | Auditable history of rules |
| R3 | Risk classification input/output | Per-action deterministic class |
| R4 | Human downgrade exceptions | Reasoned, auditable risk reduction |
| R5 | Principal-independence/SOD results | Per-action SOD verification |
| R6 | Approvals | Chain with identities, timestamps |
| R7 | Evidence | Artifact hashes, verification proofs |
| R8 | Verification | Post-execution verification results |
| R9 | Assignment-attributed histories | Assignment IDs/effective dates in contract, budget, evaluation, and audit histories [ADR-0001] |
| R10 | Delegation authority history | Separate identity, lifecycle, revocation, reassignment; Work linked by stable authority reference; independently auditable [ADR-0002] |
| R11 | Command/grant binding | Grant-authorizes-command mapping |
| R12 | Lease/fencing inputs | Exclusive execution grants |
| R13 | Daemon command/outcome journal | Every invocation + result |
| R14 | LLM invocation/attempt/cost/outcome | Per-call DeepSeek telemetry |
| R15 | Immutable receipt fields | Work ID and Delegation/policy-authority ID used, artifact hash, policy, evidence, actor, terminal state [ADR-0002] |
| R16 | Append-only audit log | Immutable R/W log with authority |
| R17 | Unknown/partial outcome reconciliation | Crash recovery, partial-result resolution |

(Previously: records were REQUIRED with storage mechanisms left undefined and downstream; now their persistence/recovery semantics are explicitly carried into `io-persistence-recovery-contract`.)

#### Scenario: Records present for every required area

- GIVEN the system executing authority, work, delegation, daemon, and LLM operations
- WHEN inspected for audit or recovery
- THEN records R1–R17 MUST be present, and the Work/authority dual-reference MUST be identifiable in R10 and R15

#### Scenario: Persistence and recovery handoff resolved

- GIVEN records R1-R17 referenced by this contract
- WHEN their persistence, idempotency, lease, daemon/LLM, receipt, or recovery semantics are needed
- THEN they MUST be sourced from the `io-persistence-recovery-contract` capability and MUST NOT be redefined or duplicated here
