# Exploration: IO Domain Contract v2

> **Contract:** Exact 30-package inventory, single primary-responsibility classification, labeled assertions, and resolved cycles. [INF] Supersedes prior `io-domain-taxonomy` and `io-domain-contract` attempts. [INF]
> **Audience:** Next ports/trust contract receives zero semantic cycles [INF], a deny-by-default authority model [INF], resolved Delegation/Work boundaries [ADR-0002], and explicit hypothesis scope [INF].

---

## 1. Source Inventory

Source §14 lists 30 `packages/`, 5 `apps/`, and 9 additional top-level directories beyond apps+packages (constitution/, processes/, roles/, curricula/, skills/, schemas/, migrations/, tests/, docs/). [SRC] §14 is an initial directory layout, not a permanent bounded-context mandate — actual boundaries are change-pressure validated per §3.8. [INF]

The source prescribes or references PostgreSQL (§6.3), DeepSeek (§7), HTTP/PWA surfaces (§5.1), migrations (§14), and technical packages (§14). [SRC] This domain contract classifies all 30 packages by primary responsibility, including technical infrastructure. [INF] Section 2 also records inferred mechanism candidates; they are non-binding pending later design/ADR and do not finalize any new tool or library selection. [INF]

---

## 2. Primary-Responsibility Classification

All 30 packages are classified exactly once by primary responsibility. [INF] The source defines business concepts and invariants for platform-enabled capabilities. [SRC] Classifying those capabilities as domain-relevant rather than pure infrastructure is an architectural inference. [INF]

### 2.1 Core Business Contexts (8 packages)

Enterprise rules survive model/API/DB/interface changes (§3.2). [SRC] Company ID is enterprise identity scope, never a shared transactional aggregate. [INF]

| Package | Owned Concepts | Boundary & Rules | Source |
|---------|---------------|------------------|--------|
| `company/` | Enterprise identity and constitution: purpose, ownership, **reserved human powers**, principles, critical restrictions, constitutional modification, and board-reserved decisions (§4.1). [SRC] | Provides tenant scope to all contexts. [INF] **Five reserved human categories can NEVER be autonomously delegated: purpose, capital, critical limits, irreversible actions, constitutional modification** (§2.1). [SRC] Every other action is NOT automatically delegable; it requires an explicit policy/contract grant with budget, scope, risk classification, and evidence. [INF] The delegation mechanism and default-deny policy are defined in the next ports/trust contract. [INF] Open-domain freedom for agents applies within granted policies and budgets only (§2.2). [SRC] | [SRC] [INF] |
| `strategy/` | Vision, corporate OKRs, and investment thesis (§4.2). [SRC] | References company ID and produces direction for portfolio. [INF] | [SRC] [INF] |
| `portfolio/` | Business units, products, capital allocation, experiments, and scale/pause/close decisions (§4.2). [SRC] | References strategy objective IDs and produces scope for work. [INF] | [SRC] [INF] |
| `organization/` | Departments, org tree, positions, and reporting lines (§4.4). [SRC] | Owns structural positions and stores no worker identity. [INF] | [SRC] [INF] |
| `workforce/` | Worker identity, role-assignment lifecycle, performance, and career (§4.4, §11). [SRC] Primary plus compatible temporary roles. [ADR-0001] | References organization position IDs. [INF] **Role cardinality: one primary + zero or more compatible temporary roles.** Every temporary role has explicit duration, capacity allocation, budget, **bounded authority scope**, separation-of-duties/conflict checks, and risk-appropriate approval. Expiry/revocation removes temporary authority without changing the primary role. [ADR-0001] Low-risk temporary roles within a pre-approved budget may be CEO-created; roles with money, secret, or production access require human approval (§11). [SRC] Consumes a contract-status projection from contracts and does NOT own a contract aggregate. [INF] [ADR-0001] | [SRC] [ADR-0001] [INF] |
| `contracts/` | Agreement terms, versioning, and status lifecycle (§3.5, §4.4). [SRC] Neutral principal/position references. [ADR-0001] | Uses neutral IDs, owns no workforce aggregate, and provides a contract-status projection/port for workforce consumers. [ADR-0001] [INF] | [SRC] [ADR-0001] [INF] |
| `process/` | Process definitions, procedures, controls, SLA, indicators, risks, inputs/outputs, error scenarios, and recovery (§4.3). [SRC] | Every process declares inputs/outputs, complexity, budget, terminal condition, error scenarios, iteration limits, partial failures, and recovery strategy (§3.3). [SRC] Process owns definitions; work owns execution instances. [INF] | [SRC] [INF] |
| `work/` | Programs, projects, tasks, dependencies, blockers, deliverables, deadlines, and ownership (§4.5). [SRC] | References strategy/portfolio intent IDs, process procedure IDs, and workforce assignee IDs. [INF] Owns execution lifecycle, acceptance, evidence, and outcome. Receiving work NEVER grants ambient authority. May reference a Delegation authority commitment ID when execution requires authority, but Work does NOT import or own the Delegation aggregate. [ADR-0002] | [SRC] [ADR-0002] [INF] |

### 2.2 Platform-Enabled Domain Capabilities (12 packages)

Each carries source-defined business concepts and, where specified, lifecycles or invariants. [SRC] Their platform-level implementation and cross-cutting reach do not erase domain semantics. [INF]

| Package | Owned Concepts | Source |
|---------|---------------|--------|
| `communication/` | Message/request/event transport, handoff protocol coordination, notifications, escalations between agents. Communication transports requests and events — it does NOT own the Delegation record (§ADR-0002). Delegation is a conceptual domain capability (authority commitment) whose package placement and aggregate owner are **[INF] deferred to the next design phase**. Communication may reference delegation authority IDs for coordination context but does not own their lifecycle. | [SRC] [ADR-0002] [INF] |
| `competency/` | Skill definitions and certification criteria (§4.7, §10). [SRC] Capability mapping. [INF] | [SRC] [INF] |
| `learning/` | Learning journeys, outcomes, curriculum execution, evaluation lifecycle, and baseline comparison (§10). [SRC] References competency definition IDs. [INF] | [SRC] [INF] |
| `budgets/` | Budget policy, caps, consumption tracking, cost attribution by entity/model/tool/outcome (§4.10) | [SRC] |
| `policy/` | Policy rules, allowed/prohibited actions, versioning (§4.10) | [SRC] |
| `approvals/` | Approvals (§4.10). [SRC] Approval lifecycle, routing, and authority resolution. [INF] | [SRC] [INF] |
| `evidence/` | Artifact hashes, verification proofs, outcome-proof linkage (§3.11, §4.10) | [SRC] |
| `receipts/` | Execution receipt: work identity, artifact hash/version, policy applied, evidence run, authorized actor, terminal state (§3.11) | [SRC] |
| `audit/` | Read/write/change log with authority, policy, evidence (§4.10, §9) | [SRC] |
| `evaluation/` | Quality scoring, outcome measurement, performance analysis (§4.10, §16) | [SRC] |
| `incidents/` | Incidents and outcomes (§4.8). [SRC] Detection, classification, resolution, post-mortems, and incident-to-outcome linkage. [INF] | [SRC] [INF] |
| `memory/` | 9 memory types (working/episodic/semantic/procedural/organizational/business-object/agent/learning/audit), progressive retrieval, conflict resolution, consolidation, lifecycle, retention, multi-agent consistency (§9) | [SRC] |

### 2.3 Technical Infrastructure (10 packages)

These packages own no business rules. [INF] They provide machinery, adapters, or execution substrate. [INF]

| Package | Role | Notes | Source |
|---------|------|-------|--------|
| `runtime/` | Agent lifecycle: wake/sleep, contract verification, budget check, and context compilation (§13.1) | Has domain hook points and owns no business rules. [INF] | [SRC] [INF] |
| `scheduler/` | Timer triggers and heartbeat filters (§13.2). [SRC] Cron scheduling. [INF] | Scheduling policy belongs to process/work. [INF] | [SRC] [INF] |
| `workflows/` | Durable execution: state machines, checkpoints, compensation, terminal conditions | Owns NO business process semantics — executes procedure definitions as technical machinery | [INF] |
| `deepseek/` | LLM client: streaming, tool protocol, Flash/Pro routing, KV-cache cohorts (§7). [SRC] | Classified here as a pure LLM adapter. [INF] | [SRC] [INF] |
| `context/` | Context compiler: canonical prefix ordering, dynamic suffix, prompt budget (§7.2) | Prompt construction | [SRC] |
| `tools/` | Tool registry, sandbox contracts, result parsing | Tool authorization policy belongs to policy/approvals | [INF] |
| `database/` | PostgreSQL pool, migrations, and query utilities (§6.3, §14). [SRC] | Connection and migration mechanism per context. [INF] | [SRC] [INF] |
| `http/` | HTTP server, routing, middleware, and API surface. [INF] | Transport layer. [INF] | [INF] |
| `ui/` | Web/PWA dashboards (§5.1) | Presentation. [INF] | [SRC] [INF] |
| `observability/` | Telemetry, traces, metrics, structured diagnostics | Monitoring | [INF] |

**Total: 8 + 12 + 10 = 30** ✓ [INF]

---

## 3. Business Context Map

All crossings are IDs-by-value or port/interface. No shared aggregates across contexts. [INF]

### 3.1 Enterprise Scope

```
company ─┬── provides identity/tenant scope ──→ ALL packages  [INF]
          │
          └── owns constitution: five reserved human categories
              that can NEVER be autonomously delegated:
              = purpose, capital, critical limits, irreversible
                actions, constitutional modification (§2.1)  [SRC]
              │
              └── every other action is NOT automatically delegable;
                  requires explicit policy/contract grant with
                  budget, scope, risk classification, and evidence.
                  Delegation mechanism + default-deny policy in
                  next ports/trust contract.  [INF]
```

### 3.2 Organization → Workforce → Contracts

```
organization ─── owns positions/reporting tree [SRC] §4.4
                 ──→ no worker data  [INF] [ADR-0001]
                    │ IDs-by-value
                    ▼
workforce ─── owns worker identity, role assignments ──→ one primary
              + compatible temporary roles. Every temp role:
              [bounded authority, duration, capacity, budget,
               SOD checks, risk approval]  [SRC] §4.4, §11, [ADR-0001]
              │                    │
               │ position refs      │ consumes contract-status  [INF]
              ▼                    ▼   projection/port
contracts ─── owns agreement terms/version/status ──→ neutral
              party/position IDs only  [SRC] §3.5, [ADR-0001]
```

### 3.3 Strategy → Portfolio → Work

```
strategy ─── owns vision/OKRs (corporate direction) [SRC] §4.2
             ──→ referenced by portfolio  [INF]
              │
              ▼ objective IDs
portfolio ─── owns BUs/products/capital allocation [SRC] §4.2
              ──→ referenced by work  [INF]
              │
              ▼ unit IDs
work ─── owns programs/projects/tasks (execution) [SRC] §4.5
         ──→ references strategy + portfolio intent IDs  [INF]
```

### 3.4 Process / Work / Workflows

```
process ─── owns definitions/procedures [SRC] §4.3, §3.3
            ──→ consumed by work + workflows  [INF]
work ─── owns execution instances (doing)  [INF]
workflows ─── technical execution machinery (how) ──→ owns NO business semantics  [INF]
```

### 3.5 Competency → Learning

```
competency ─── owns skill/capability/certification criteria  [SRC] §4.7, §10
learning ─── owns journeys/outcomes [SRC] §10
             ──→ references competency definition IDs  [INF]
```

### 3.6 Delegation / Work / Communication (Authority Boundary)

```
Delegation ─── conceptual domain capability: stable authority
               commitment ID + bounded grant (scope, budget,
               duration, revocation rules). Package placement/
               aggregate owner is [INF] deferred to design phase;
               not owned by communication/ or work/.  [INF] [ADR-0002]
               │
               │ issues authority commitment ID  [ADR-0002]
               ▼
work ─── references Delegation authority ID when execution
         requires authority. Work does NOT own, import, or
         duplicate the Delegation record.  [ADR-0002]
               │
               │ separate coordination/link projection  [INF]
               ▼
Application Coordination Layer ─── maps Delegation IDs to
Work IDs for navigation and creation workflows. Neither
aggregate owns/imports the other.  [INF]

communication ─── transports requests, events, and handoff
messages between agents. Does NOT own Delegation lifecycle
or authority records.  [SRC] §4.6, §12.2, [ADR-0002]
```

### 3.7 Horizontal Capabilities

Communication, competency, learning, budgets, policy, approvals, evidence, receipts, audit, evaluation, incidents, memory serve ALL business contexts through defined interfaces. [INF] Each owns separate aggregates — no transactional coupling. [INF]

---

## 4. Hypotheses for Next Contract

| # | Question | Status | Scope for Ports/Trust | Authority Relevance |
|---|----------|--------|-----------------------|---------------------|
| H1 | May a company have more than one active constitution? | **[HYP]** One active constitution per company (versioned and amended). The source does not specify cardinality. [INF] | **[INF] Excluded** — pure domain-model cardinality; the trust contract may assume one per company. | **[INF]** None. |
| H2 | May tasks exist outside projects? | **[HYP]** Tasks may exist outside projects (project FK nullable). Source §3.1 defines small work cycles [SRC] but does not mandate a project parent. [INF] | **[INF] Excluded** — pure FK/optionality decision. | **[INF]** None. |
| H3 | Are acceptance criteria mandatory per task? | **[HYP]** Recommended per §3.1, not mandatory. | **[INF] Excluded** — pure field-validation decision. | **[INF]** None. |
| H4 | Does delegation create or reference work? | **[ADR-0002]** May create OR reference via coordination contract. No aggregate sharing. **[INF]** Application-layer mechanism is design-deferred. | **[ADR-0002] Included as settled constraint** — the next contract MUST NOT encode aggregate sharing. Delegation authority scope is distinct from work execution authority. | **[ADR-0002] Direct** — authority scope, budget, and duration live in Delegation; work items must dereference these, not duplicate them. |
| H5 | How are actions classified as irreversible/critical before authority evaluation? | Source §2.1 enumerates five reserved categories never autonomously delegable. [SRC] Every other action is NOT automatically delegable and requires an explicit policy/contract grant, budget, scope, risk classification, and evidence. The operational definition of "irreversible action" and the classification mechanism are design-deferred. [INF] | **[INF] Included** — the next ports/trust contract MUST define: (a) how actions are classified as irreversible/critical before authority evaluation, (b) the deny-by-default delegation mechanism, (c) the policy/contract grant structure, and (d) risk classification and evidence requirements for delegable actions. | **[INF] Direct** — the reserved/enumerated boundary and the default-deny policy are the central authority invariants. |
| H6 | What is the delegation mechanism and default-deny policy? | Source §2.1 establishes five never-delegable categories. [SRC] Deny-by-default behavior for all other actions and the precise mechanism (policy rules, contract terms, grant lifecycle) are derived domain-design constraints tracked for the next contract. [INF] | **[INF] Included** — the next ports/trust contract MUST define the delegation mechanism and encode the default-deny policy. The mechanism spans policy/grants, approvals, budgets, and evidence. | **[INF] Direct** — delegation is the authority mechanism, and default-deny is the derived invariant. |

**Summary for next contract:**
- **Excluded (pure design):** H1, H2, H3. [INF]
- **Included (settled constraint to enforce):** H4 — no aggregate sharing between Delegation and Work. [ADR-0002]
- **Included (authority-definition gap):** H5 — operationalize "irreversible action" classification and action classification before authority evaluation. [INF]
- **Included (mechanism gap):** H6 — delegation mechanism and default-deny policy. [INF]
- Authority model: **DENY-BY-DEFAULT**. [INF] Five never-delegable categories (§2.1). [SRC] Everything else requires an explicit grant. [INF]

---

## 5. Acceptance Criteria

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| AC1 | All 30 packages classified exactly once. [INF] | [INF] §2: 8 core + 12 domain-capability + 10 tech-infra = 30. | ✅ |
| AC2 | Every substantive claim is labeled [SRC]/[ADR-0001]/[ADR-0002]/[INF]/[HYP]. [INF] | [INF] §1 separates source-prescribed technologies from inferred classification and non-binding mechanism candidates. §2 labels source-owned concepts, ADR decisions, inferred mechanisms, and inferred boundaries at claim or row level; the deny-by-default grant requirements are [INF], not [SRC]. §3 labels every map rule, including the inferred default-deny handoff. §4 labels status, scope, authority relevance, and summary claims. §6 labels every handoff assertion. | ✅ |
| AC3 | Human-reserved authority equals the exact source-enumerated set: purpose, capital, critical limits, irreversible actions, and constitutional modification. [SRC] All other actions are deny-by-default. [INF] | [INF] §2.1 labels the exact five-category set [SRC] and the grant requirement [INF]; §3.1 and §4 H5/H6 preserve the same distinction. | ✅ |
| AC4 | Temporary roles have bounded authority in every representation. [ADR-0001] | [INF] §2.1 includes bounded authority scope among temporary-role attributes; §3.2 repeats it. | ✅ |
| AC5 | Delegation and Work are separate commitments with no aggregate sharing, and work never grants ambient authority. [ADR-0002] | [INF] §3.6 keeps Delegation and Work separate, labels package placement as deferred [INF], maps their IDs through Application Coordination, and limits Communication to transport. | ✅ |
| AC6 | Non-circular ownership is preserved. [INF] | [INF] Organization=positions, Workforce=identity/roles, Contracts=terms/status with neutral IDs, Strategy=corporate direction, Portfolio=business units/capital, Work=execution, Process=definitions, Workflows=machinery, Competency=criteria, and Learning=journeys. The Communication↔Work cycle is absent because Delegation issues authority IDs, Work references them, Communication transports events, and Application Coordination maps IDs. All crossings use IDs-by-value or ports/interfaces. | ✅ |
| AC7 | Company is enterprise scope, not a global aggregate. [INF] | [INF] §2.1 states that company ID is enterprise identity scope, never a shared transactional aggregate; §3.1 confirms it. | ✅ |
| AC8 | Package layout is an initial directory structure, not a permanent bounded-context mandate. [INF] | [INF] §1 states this distinction from the source's §14 initial layout and §3.8 change-pressure rule. | ✅ |
| AC9 | The hypotheses table explicitly includes or excludes each item for the next contract. [INF] | [INF] §4 excludes H1/H2/H3, includes settled H4 and design gaps H5/H6, summarizes deny-by-default, and gives each inclusion/exclusion a rationale. | ✅ |
| AC10 | Source-prescribed technologies and surfaces are acknowledged as [SRC]. Inferred mechanisms are labeled [INF], remain non-binding pending later design/ADR, and do not finalize new tool or library selections. [INF] | [INF] §1 distinguishes source prescriptions/references from inferred classification and non-binding candidates. §2 labels cron, state machines, checkpoints, compensation, result parsing, middleware, and structured diagnostics as [INF], while PostgreSQL, DeepSeek, HTTP/PWA surfaces, migrations, and technical packages remain [SRC]. | ✅ |
| AC11 | Line count is within 180–320. [INF] | [INF] Structural count. | ✅ (223 lines) |

---

## 6. Handoff to Next Contract

Next phase (ports/trust) receives the following constraints. [INF]
- **Zero semantic cycles** — all crossings use IDs-by-value or ports/interfaces. Communication↔Work cycle resolved: Delegation issues authority IDs, Work references them, Communication transports events only, and Application Coordination maps IDs without aggregate ownership. [INF] [ADR-0002]
- **Deny-by-default authority model** — five never-delegable human categories. [SRC] Every other action requires an explicit policy/contract grant, budget, scope, risk classification, and evidence. [INF] Temporary roles are bounded. [ADR-0001] Delegation is separate from Work. [ADR-0002]
- **Delegation ownership** — Delegation is a conceptual domain capability separate from Communication and Work. [ADR-0002] Its package placement/aggregate owner is deferred to design. [INF]
- **Explicit hypothesis scope** — §4 defines what the next contract must enforce (H4, H5, H6) and may ignore (H1–H3). [INF]
- **Settled classification** — 30 packages by primary responsibility; §2.2 packages carry domain semantics and must not be reclassified as "pure infrastructure." [INF]
