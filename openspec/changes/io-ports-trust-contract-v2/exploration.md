# Exploration: IO Ports & Trust Contract v2

> **Contract:** Hexagonal port topology with product/port separation, full ADR-0001/0002/0003 enforcement, command-bound authority envelope, expanded persistence records, and corrected provenance labels. [INF] The local daemon has no direct PostgreSQL or DeepSeek access and exchanges commands and results only through authenticated server/application ports. [INF] Supersedes prior ports/trust attempts. [INF]

---

## 1. Product Surfaces vs Ports [SRC] [INF]

Four product surfaces from source §5: [SRC]

| Surface | Role | Adapter Type | Credential Access |
|---------|------|-------------|-------------------|
| Web/PWA | Human/agent command center (§5.1) | Thin HTTP consumer via `ui/` | None — API-only |
| Server Runtime | API, workers, scheduler, workflows, memory, execution (§5.2) | Composition root wires `http/` → inbound ports | PG [INF] |
| Local Daemon | Git, shell, files, tests, browser, sandbox, local execution (§5.3) | Authenticated client of server/application ports; returns signed results through them | None — no direct PG or DeepSeek access [INF] |
| CLI | Terminal commands: `io company`, `io memory`, etc. (§5.4) | Thin HTTP consumer via `cli/` | None — API-only |

Web/PWA and CLI are stateless HTTP API consumers. [INF] Server Runtime wires the HTTP adapter to inbound use-case ports. [INF] Daemon authenticates with the server, receives authorized commands through the explicit `DaemonCommand` application port, and returns signed results through authenticated server/application ports. [INF]

---

## 2. Hexagonal Topology

### 2.1 Inbound Ports — Use-Case Contracts

Inbound ports are application-owned command/query interfaces, NOT transports. [INF] Each defines input, output, authorization requirement, risk classification, and evidence expectations. [INF] Role and agreement references in boundary contracts use neutral `principal_id` and `position_id` values, never package-specific entity types. [ADR-0001]

| Example Port | Contract | Authorization |
|-------------|----------|--------------|
| `IWorkExecution` | `ExecuteWork(cmd, envelope)` → `WorkResult` | Full envelope revalidated |
| `IDaemonCommand` | `RunDaemon(cmd, envelope)` → `SignedResult` | Server-authorized envelope |
| `IDelegationCommand` | `DelegateAuthority(grant)` → `CommitmentId` | Human-level approval for critical |
| `IBudgetQuery` | `GetBudget(scope, asOf)` → `BudgetState` | Read authorization |
| `IPolicyEvaluation` | `EvaluatePolicy(action, ctx)` → `Verdict` | System-level |

### 2.2 Adapter Wiring [INF]

```
Web/PWA ──[ui/]──→ HTTP client ──→ [http/ adapter] ──→ Server Runtime ──→ inbound ports
CLI     ──[cli/]──→ HTTP client ──→ [http/ adapter] ──→ Server Runtime ──→ inbound ports
Daemon  ──[daemon/]──→ authenticated server/application port ──→ DaemonCommand
        ←────────────── signed result through the same trust boundary ──────────
```

Web/CLI adapters call server HTTP adapter. [INF] Server HTTP adapter deserializes and dispatches to use-case ports. [INF] The daemon is outside the server credential trust zone: it obtains server authorization, receives daemon commands, and returns signed results through authenticated application ports without direct PostgreSQL or DeepSeek access. [INF]

### 2.3 Outbound (Driven) Ports

| Port | Adapter | Credential | Label |
|------|---------|-----------|-------|
| Agent inference | `deepseek/` | Worker-side credential custody | [INF] |
| Persistent store | `database/` PG | Server composition root only | [INF] |
| Clock/timer | `scheduler/` | None | [INF] |
| Durable orchestration | `workflows/` engine | Zero secrets | [INF] |

---

## 3. Work / Workflows / Worker / Scheduler [INF] [ADR-0002]

**Workflows lease/step possession grants NO authority.** [INF] [ADR-0002] **Workflows has zero secrets.** [INF]

- **Work** (§4.5): business execution — programs, projects, tasks, deliverables, acceptance, evidence, outcomes. [SRC] References Delegation authority commitment ID. [ADR-0002] **NO ambient authority from assignment.** [ADR-0001] [ADR-0002]
- **Workflows:** technical machinery — durable state machines, checkpoints, compensation, cursor/lease state. [INF] **No business semantics.** [INF]
- **Worker** (inferred deployment process): loads fenced step from Workflows; executes via outbound ports; each step carries command-bound authority envelope (§4). [INF]
- **Scheduler:** timer triggers, heartbeat filters, cron. [INF] No business schedule ownership. [INF]

---

## 4. Authority Envelope — Command-Bound [INF]

Every worker step carries an envelope bound to its command/invocation. [INF] Holding a step, lease, or task grant NO ambient authority. [INF]

### 4.1 Envelope Fields [INF]

| Field | Purpose |
|-------|---------|
| `work_id` / `step_id` | Exact work unit identity |
| `principal_id` / `position_id` | Neutral executing principal and position references; never package-specific entities [ADR-0001] |
| `authority_commitment_id` | Delegation or policy grant reference |
| `action_scope` | Exact permitted actions |
| `assignment_id` | Active role binding with neutral principal/position references [ADR-0001] |
| `policy_version` | Policy ruleset at grant time |
| `risk_class` | Deterministic risk tier per [ADR-0003] |
| `budget_reservation` | Budget envelope + consumed amount |
| `approvals` / `evidence` | Approval chain + evidential artifacts |
| `expiry` / `revocation_state` | Temporal validity + revocation status |
| `sod_decision` | SOD verdict per [ADR-0003] |
| `invocation_id` / `command_id` | Unique trace identifier |

### 4.2 Revalidation Points [INF]

Envelope revalidated at EVERY: **DeepSeek call**, **DB mutation**, **tool call**, **daemon command**, **state transition**. [INF]

### 4.3 DeepSeek Output [INF]

DeepSeek output is **untrusted proposal data**. [INF] It CANNOT: grant authority, call tools directly, mutate operational state, or bypass validation. [INF] Every derived action passes through the full authority pipeline. [INF]

---

## 5. Authority Model — ADR-0003 Applied [ADR-0003] [INF]

### 5.1 Principle [INF]

Every action is DENIED unless an explicit grant exists. [INF] Five source-reserved categories NEVER autonomously delegable: [SRC] §2.1

1. Company purpose
2. Capital
3. Critical limits
4. Irreversible actions
5. Constitutional modification

### 5.2 Irreversibility Criteria [ADR-0003]

An action is irreversible when deterministic criteria identify ≥1 of:
1. Destructive data loss without tested restoration
2. External side effects without reliable compensation
3. Legal/financial commitments not automatically cancellable within policy
4. Production/security/secret changes with non-restorable impact
5. Configured rollback time or cost limits exceeded

### 5.3 Classification Rules [ADR-0003]

- Risk classification BEFORE authority evaluation. [ADR-0003]
- Source-reserved categories → always critical. [ADR-0003]
- Other tiers by deterministic impact, reversibility, radius, budget, sensitivity thresholds. [ADR-0003]
- Humans may elevate risk class. [ADR-0003]
- **Lowering** machine-determined class requires explicit, reasoned, auditable exception by authorized human authority. [ADR-0003]
- Source-reserved categories NEVER downgraded for autonomous execution. [ADR-0003]
- LLM output provides context/evidence only — NEVER final classification. [ADR-0003]

### 5.4 Algorithm Order [INF] [ADR-0003]

```
[1] Risk classification    →  [2] Authority exists
[3] Identity valid         →  [4] Active assignment
[5] Bounded authority      →  [6] Delegation valid
[7] Policy version current →  [8] Budget sufficient
[9] Evidence complete      → [10] Approval obtained
[11] SOD tier satisfied    → [12] Exception record clean
[13] Expiry/revocation OK  → [14] Action scope matches
[15] Records verified      → [16] Evaluation check
→ DENY on ANY failure
```

### 5.5 SOD Tier Matrix [ADR-0003]

| Tier | Proposal | Review | Approval | Execute | Verify |
|------|----------|--------|----------|---------|--------|
| Critical | 5 distinct | 5 distinct | 5 distinct | 5 distinct | 5 distinct |
| High | 5 distinct | 5 distinct | 5 distinct | 5 distinct | 5 distinct |
| Medium | Proposer | Reviewer* | Approver | Executor | Verifier |
| Low | Combined† | — | Combined† | Combined† | Combined† |

For medium risk, proposer, approver, executor, and verifier are mutually distinct: proposer ≠ approver, executor, or verifier; approver ≠ executor or verifier; and executor ≠ verifier. [ADR-0003] *Reviewer may equal approver only when policy explicitly permits and remains independent from proposer and executor. [ADR-0003] No principal may self-approve or self-verify at ANY tier. [ADR-0003] †When policy permits. **Every prohibited overlap produces action-time `DENY`.** [ADR-0003]

---

## 6. Role Model — ADR-0001 Applied [ADR-0001]

Every worker: **exactly one active primary role** + zero or more compatible temporary roles. [ADR-0001]

| Temporary Role Requirement | Rule |
|---|---|
| Assignment ID | Stable, persisted for lifecycle |
| Effective dates | Explicit start/expiry; indefinite INVALID |
| Compatibility | With primary AND each other; reassessed when assignments/policies change |
| Authority scope | Explicit and bounded; NO ambient authority from assignment |
| Capacity allocation | Reserved share of worker capacity |
| Budget envelope | Per-assignment budget |
| SOD/conflict check | Before activation AND on policy change |
| Approval | Proportional to risk; NO self-approval of conflicting assignment |
| Expiry/revocation | Removes authority, capacity allocation, AND budget access; primary unchanged |
| Persistence | Assignment IDs/effective dates in contracts, budgets, evaluation, audit |

---

## 7. Delegation Model — ADR-0002 Applied [ADR-0002] [INF]

### 7.1 Ownership Boundaries [ADR-0002]

**Delegation** owns: delegator, delegate, authority scope, budget, duration, escalation, revocation rules/state, expected outcome, lifecycle, and reassignment history. [ADR-0002] Receipts identify both Work and the Delegation or policy-authority identifier used. [ADR-0002]

**Work** references Delegation authority commitment ID only. [ADR-0002] **No aggregate sharing.** [ADR-0002]

Delegation may **create or reference** Work via application coordination. [ADR-0002] Delegation lifecycle, revocation, reassignment, and history are persisted separately from Work; both histories remain independently auditable. [ADR-0002]

### 7.2 Conservative Revocation Rule [INF]

When delegation is revoked: [INF]
- Linked in-flight Work requiring that authority → `PAUSED` / `AUTHORITY_REQUIRED` by default. [INF]
- May resume ONLY with valid replacement authority. [INF]
- Otherwise, explicit policy chooses reassignment or cancellation. [INF]
- **No continued execution under revoked authority.** [INF] [ADR-0002]

---

## 8. Persistence & Recovery Handoff — REQUIRED Records [INF]

All records REQUIRED for audit, recovery, reconciliation. [INF] Mechanisms DOWNSTREAM. [INF] [HYP]

| # | Record | Scope |
|---|--------|-------|
| R1 | Authority evaluations/decisions | Per-action check outcome |
| R2 | Policy versions | Auditable history of rules |
| R3 | Risk classification input/output | Per-action deterministic class |
| R4 | Human downgrade exceptions | Reasoned, auditable risk-reduction |
| R5 | Principal-independence/SOD results | Per-action SOD verification |
| R6 | Approvals | Chain with identities, timestamps |
| R7 | Evidence | Artifact hashes, verification proofs |
| R8 | Verification | Post-execution verification results |
| R9 | Assignment-attributed histories | Assignment IDs and effective dates retained in contract, budget, evaluation, and audit histories [ADR-0001] |
| R10 | Delegation authority history | Separate identity, lifecycle, revocation, reassignment, and independently auditable history; Work linked by stable authority reference [ADR-0002] |
| R11 | Command/grant binding | Grant-authorizes-command mapping |
| R12 | Lease/fencing inputs | Exclusive execution grants |
| R13 | Daemon command/outcome journal | Every invocation + result |
| R14 | LLM invocation/attempt/cost/outcome | Per-call DeepSeek telemetry |
| R15 | Immutable receipt fields | Work ID and Delegation or policy-authority ID used, artifact hash, policy, evidence, actor, terminal state [ADR-0002] |
| R16 | Append-only audit | Immutable R/W log with authority |
| R17 | Unknown/partial outcome reconciliation | Crash recovery, partial-result resolution |

---

## 9. Provenance & Claim Labels

| Claim | Label | Rationale |
|-------|-------|-----------|
| Four product surfaces | [SRC] | Source §5 enumerates Web/PWA, server, daemon, CLI |
| Inbound ports = use-case contracts | [INF] | Hexagonal architecture inference |
| Worker-side DeepSeek credential custody | [INF] | Security mechanism, not source-prescribed |
| PG adapter in server root only; daemon outside credential trust zone | [INF] | Composition-root and trust-boundary inference |
| Authority envelope fields | [INF] | Derived from ADR invariants |
| DeepSeek output untrusted | [INF] | Security-pattern inference |
| Irreversibility criteria | [ADR-0003] | Verbatim from ADR-0003 |
| SOD tier matrix | [ADR-0003] | Table from ADR-0003 |
| Algorithm order | [INF] | Sequence from ADR-0003 invariants |
| Primary + temp roles | [ADR-0001] | Decision from ADR-0001 |
| Neutral principal/position boundary IDs and assignment-attributed histories | [ADR-0001] | Invariants and consequence from ADR-0001 |
| Delegation separate from Work | [ADR-0002] | Decision from ADR-0002 |
| Separate Delegation history and dual Work/authority receipt references | [ADR-0002] | Invariants and consequence from ADR-0002 |
| Conservative revocation | [INF] | Derived policy, not ADR-0002 verbatim |
| Required records | [INF] | Derived from audit/recovery requirements |

---

## 10. Acceptance Criteria

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| AC1 | Product surfaces vs inbound ports separated. [INF] | §1: 4 surfaces [SRC]; §2.1: use-case ports [INF]; §2.2: Web/CLI→HTTP→server→ports, daemon→authenticated server/application port→DaemonCommand | ✅ |
| AC2 | Authority envelope + revalidation at every critical call. [INF] | §4.1: 12 envelope fields; §4.2: 5 revalidation points (DeepSeek, DB, tool, daemon, state); §4.3: DeepSeek untrusted proposal | ✅ |
| AC3 | ADR-0003 carried exactly. [ADR-0003] | §5.1: 5 reserved categories; §5.2: 5 irreversibility criteria verbatim; §5.3: elevation/downgrade/no-LLM rules; §5.4: 16-step algorithm; §5.5: five-way critical/high separation, four-way mutually distinct medium principals, conditional reviewer=approver, and action-time DENY | ✅ |
| AC4 | ADR-0001 carried exactly. [ADR-0001] | §§2.1/4.1: neutral principal/position boundary IDs; §6: one primary, temp compatibility with primary AND each other, reassess on change, no self-approval, expiry removes authority+capacity+budget; §§6/8 R9: assignment IDs/effective dates in contract, budget, evaluation, and audit histories | ✅ |
| AC5 | ADR-0002 carried exactly with conservative revocation. [ADR-0002] [INF] | §7.1: create-or-reference via coordination, receipts identify both Work and used Delegation/policy authority, Delegation lifecycle/revocation/reassignment persists separately from independently auditable Work history, no aggregate sharing; §7.2: PAUSED/AUTHORITY_REQUIRED default, resume only with valid replacement, no continued execution under revoked | ✅ |
| AC6 | Expanded persistence records enumerated. [INF] | §8: R9 retains assignment IDs/effective dates in four histories [ADR-0001]; R10 persists Delegation lifecycle/revocation/reassignment separately from Work [ADR-0002]; R15 identifies both Work and used Delegation/policy authority [ADR-0002]; R1–R17 cover remaining audit/recovery records [INF] | ✅ |
| AC7 | All claims labeled correctly. [INF] | §9: daemon credential boundary and PG placement [INF]; surfaces [SRC]; use-case ports [INF]; neutral IDs/histories [ADR-0001]; Delegation history/receipts [ADR-0002]; SOD [ADR-0003]; inferred revocation mechanism and remaining records [INF] | ✅ |
| AC8 | No continued execution under revoked authority. [INF] [ADR-0002] | §7.2: prohibited; default → PAUSED/AUTHORITY_REQUIRED | ✅ |
| AC9 | Daemon has no direct PG or DeepSeek credentials. [INF] | Contract conclusion and §§1/2.2/2.3: daemon is outside the server credential trust zone, uses authenticated server/application ports for commands and signed results, and PG adapter is wired only in the server composition root; §9 labels this [INF] | ✅ |
| AC10 | Line count within 220–300. [INF] | Structural count | ✅ |

---

## 11. Explicitly Downstream [INF] [HYP]

1. Key rotation, HSM/vault, encrypted credential storage
2. Process isolation: executor ↔ tools ↔ model client
3. Lease protocol, idempotency keys, exactly-once replay
4. Workflows step checkpoint and cursor recovery
5. Policy threshold values for non-source-reserved risk tiers
6. Notification/channel for revocation/cancellation propagation
7. Cross-daemon outcome reconciliation protocol
8. Schema design, table DDL, index strategy for records in §8
