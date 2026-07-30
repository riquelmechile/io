# io-ports-trust-contract Specification

## Purpose

Hexagonal port trust topology for IO: product/port separation, command-bound
authority envelopes, ADR-0001/0002/0003 enforcement, and required
persistence/recovery records. Supersedes prior ports/trust attempts. Labels
`[SRC §]`, `[ADR-0001]`, `[ADR-0002]`, `[ADR-0003]`, `[INF]`, `[HYP]` are
normative, cited once per requirement. Mechanisms (vault/HSM, lease protocol,
idempotency, schemas) are explicitly downstream and MUST NOT be finalized here.

## Requirements

### Requirement: Product Surface and Port Separation

IO exposes four product surfaces over a hexagonal port topology. Web/PWA and
CLI are stateless HTTP API consumers with NO credentials; the Server Runtime
wires the HTTP adapter to inbound ports and is the sole holder of PostgreSQL
credentials; the Local Daemon is OUTSIDE the server credential trust zone and
exchanges commands and results only through authenticated server/application
ports. Inbound ports are use-case contracts (NOT transports), each declaring
input, output, authorization requirement, risk class, and evidence
expectations. Driven (outbound) ports keep credentials server-side only. The
daemon MUST NOT hold direct PostgreSQL or DeepSeek credentials. Boundary
references in port contracts MUST use neutral `principal_id` / `position_id`,
never package-specific entities. [SRC §5] [INF]

#### Scenario: Daemon has no direct credentials

- GIVEN the local daemon executing work
- WHEN it needs PostgreSQL or DeepSeek
- THEN it MUST reach them only through authenticated server/application ports and MUST NOT hold direct credentials

#### Scenario: Inbound ports are use-case contracts

- GIVEN an inbound application port
- WHEN inspected
- THEN it MUST declare input, output, authorization, risk class, and evidence and MUST NOT be a transport

### Requirement: Command-Bound Authority Envelope

Every worker step carries an authority envelope bound to its command/invocation.
Holding a step, lease, or task grants NO ambient authority. The envelope MUST
carry: `work_id`/`step_id`, `principal_id`/`position_id`,
`authority_commitment_id`, `action_scope`, `assignment_id`, `policy_version`,
`risk_class`, `budget_reservation`, `approvals`/`evidence`,
`expiry`/`revocation_state`, `sod_decision`, and `invocation_id`/`command_id`.
The envelope MUST be revalidated at EVERY DeepSeek call, DB mutation, tool call,
daemon command, and state transition. DeepSeek output is untrusted proposal
data: it CANNOT grant authority, call tools directly, mutate operational state,
or bypass validation, and every derived action MUST re-enter the full authority
pipeline. [INF] [ADR-0001]

#### Scenario: Revalidation at every critical point

- GIVEN a worker step carrying a command-bound envelope
- WHEN it reaches a DeepSeek call, DB mutation, tool call, daemon command, or state transition
- THEN the envelope MUST be revalidated before proceeding

#### Scenario: DeepSeek output untrusted

- GIVEN DeepSeek output proposing an action
- WHEN the action is considered for execution
- THEN it MUST be treated as proposal data and MUST re-enter the full authority pipeline with no bypass

### Requirement: Default-Deny Authority with Reserved Categories

Every action is DENIED unless an explicit grant exists. Five source-reserved
categories MUST NEVER be autonomously delegated: company purpose, capital,
critical limits, irreversible actions, constitutional modification. An action is
irreversible when deterministic criteria identify ≥1 of: destructive data loss
without tested restoration; external side effects without reliable compensation;
legal/financial commitments not auto-cancellable within policy;
production/secret changes with non-restorable impact; configured rollback
time/cost exceeded. Risk classification MUST precede authority evaluation;
source-reserved categories are always critical and NEVER downgraded for
autonomous execution; humans MAY elevate risk class; lowering a
machine-determined class requires an explicit, reasoned, auditable human
exception; LLM output provides context/evidence only and is NEVER the final
classification. The evaluation proceeds in the fixed order: classification →
authority → identity → assignment → bounded authority → delegation → policy
version → budget → evidence → approval → SOD → exceptions → expiry/revocation →
action scope → records → check, and MUST DENY on ANY failure. [SRC §2.1]
[ADR-0003] [INF]

#### Scenario: Reserved category refused

- GIVEN an action in a source-reserved category
- WHEN autonomous delegation is requested
- THEN it MUST be refused as human-only

#### Scenario: Classification before authority; deny on any failure

- GIVEN any action under evaluation
- WHEN the 16-step evaluation is run
- THEN risk class MUST be determined before authority and any single failed step MUST produce DENY

### Requirement: Separation-of-Duties Tiers

SOD MUST be enforced per risk tier. Critical and High risk MUST use five
distinct principals for proposal, review, approval, execution, and
verification. Medium risk MUST keep proposer, approver, executor, and verifier
mutually distinct (proposer ≠ approver/executor/verifier; approver ≠
executor/verifier; executor ≠ verifier), with reviewer equal to approver ONLY
when policy explicitly permits and the reviewer remains independent of proposer
and executor. Low risk MAY combine roles when policy permits. NO principal MAY
self-approve or self-verify at ANY tier. Every prohibited role overlap MUST
produce action-time DENY. [ADR-0003]

#### Scenario: Medium-risk mutual distinctness

- GIVEN a medium-risk action
- WHEN roles are assigned
- THEN proposer, approver, executor, and verifier MUST be mutually distinct and no principal MAY self-approve or self-verify

### Requirement: Bounded Role Model

Each worker holds exactly one active primary role plus zero or more compatible
temporary roles. Each temporary role MUST declare: a stable persisted assignment
ID; explicit start/expiry (indefinite is INVALID); compatibility with the
primary role AND each other, reassessed when assignments/policies change; an
explicit bounded authority scope with NO ambient authority; reserved capacity
allocation; a per-assignment budget envelope; a SOD/conflict check before
activation and on policy change; risk-proportional approval with NO
self-approval of a conflicting assignment; and expiry/revocation that removes
authority, capacity allocation, AND budget access while leaving the primary
role unchanged. Assignment IDs and effective dates MUST be retained in
contract, budget, evaluation, and audit histories. [ADR-0001]

#### Scenario: Expiry removes temporary authority

- GIVEN a temporary role that expires or is revoked
- WHEN expiry/revocation is applied
- THEN temporary authority, capacity, and budget MUST be removed while the primary role is unchanged

### Requirement: Delegation Separation and Conservative Revocation

Delegation owns delegator, delegate, authority scope, budget, duration,
escalation, revocation rules/state, expected outcome, lifecycle, and
reassignment history, persisted separately from Work. Work references a
Delegation authority commitment ID only; there is NO aggregate sharing.
Delegation MAY create or reference Work via application coordination, and both
histories remain independently auditable. Receipts MUST identify both the Work
ID and the Delegation or policy-authority ID used. When delegation is revoked,
linked in-flight Work requiring that authority MUST default to
`PAUSED` / `AUTHORITY_REQUIRED`, MAY resume ONLY with valid replacement
authority, and otherwise policy chooses reassignment or cancellation. There
MUST be NO continued execution under revoked authority. [ADR-0002] [INF]

#### Scenario: No continued execution under revoked authority

- GIVEN in-flight Work backed by a revoked delegation
- WHEN revocation occurs
- THEN the Work MUST pause or require replacement authority and MUST NOT continue under revoked authority

### Requirement: Required Persistence and Recovery Records

The following records are REQUIRED for audit, recovery, and reconciliation;
storage mechanisms are downstream. [INF] [HYP]

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

#### Scenario: Records present for every required area

- GIVEN the system executing authority, work, delegation, daemon, and LLM operations
- WHEN inspected for audit or recovery
- THEN records R1–R17 MUST be present, and the Work/authority dual-reference MUST be identifiable in R10 and R15
