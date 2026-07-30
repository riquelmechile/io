# io-domain-contract Specification

## Purpose

Constraints on package responsibilities, context boundaries, and authority handoff from the approved `io-domain-contract-v2` exploration (inventory: §2). Labels `[SRC §]`, `[ADR-0001]`, `[ADR-0002]`, `[INF]`, `[HYP]` are normative, cited once per requirement.

## Requirements

### Requirement: Primary-Responsibility Classification

Each of the 30 packages MUST be classified exactly once into Core Business (8), Platform-Enabled Domain (12), or Technical Infrastructure (10), with no overlap or omission. [INF]

| Classification | Packages |
|---|---|
| Core Business (8) | `company/`, `strategy/`, `portfolio/`, `organization/`, `workforce/`, `contracts/`, `process/`, `work/` |
| Platform-Enabled Domain (12) | `communication/`, `competency/`, `learning/`, `budgets/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/`, `evaluation/`, `incidents/`, `memory/` |
| Technical Infrastructure (10) | `runtime/`, `scheduler/`, `workflows/`, `deepseek/`, `context/`, `tools/`, `database/`, `http/`, `ui/`, `observability/` |

#### Scenario: Exact partition

- GIVEN the 30 packages listed in this requirement
- WHEN classified by primary responsibility
- THEN each MUST occupy exactly one group, totals MUST equal 8+12+10=30, and a second classification MUST be rejected

### Requirement: Context Boundary, Crossing, and Delegation-Work Separation

Crossings MUST use IDs-by-value or ports; no context MAY share a transactional aggregate. The Communication↔Work cycle MUST route via Delegation authority IDs and an Application Coordination Layer over event-only transport; Communication MUST NOT own the Delegation record. Delegation is an authority-commitment capability separate from Work (placement deferred to design); Work MAY reference a Delegation authority ID but MUST NOT own, import, or duplicate it, and receiving work MUST NEVER grant ambient authority. Contracts MUST expose a neutral status port with no workforce aggregate. Process owns definitions, Work owns execution, Workflows carry NO business semantics. Work, contracts, approvals, memory, and results MUST declare explicit valid states. Company ID is tenant scope; the layout is initial, change-pressure-revalidated, not permanent. [SRC §3.3/§3.5/§4.3/§4.6/§12.2] [ADR-0001] [ADR-0002] [INF]

#### Scenario: Crossings and routing

- GIVEN collaborating contexts, communication-work coordination, or work needing authority
- WHEN a crossing or authority is considered
- THEN crossings MUST use IDs/ports with no shared aggregate, the comms-work path MUST route through a Delegation ID, and received work MUST grant no ambient authority

### Requirement: Deny-by-Default Authority

Five categories MUST NEVER be autonomously delegated: purpose, capital, critical limits, irreversible actions, constitutional modification. Every other action MUST require an explicit grant with budget, scope, risk classification, and evidence; the mechanism and default-deny policy are deferred to the next ports/trust contract. [SRC §2.1] [INF]

#### Scenario: Reserved refused

- GIVEN an action in a reserved category, or a non-reserved action without a grant
- WHEN autonomous delegation is requested
- THEN reserved actions MUST be refused (human-only) and others MUST be denied absent an explicit bounded grant

### Requirement: Bounded Temporary Roles

A worker MUST hold one primary role plus temporary roles. Each temporary role MUST declare duration, capacity, budget, bounded authority scope, separation-of-duties checks, and risk approval; expiry/revocation MUST remove temporary authority without changing the primary role; money/secret/production-access roles MUST require human approval. [ADR-0001] [SRC §11]

#### Scenario: Bounded and expiring

- GIVEN a temporary role that is created then expires
- WHEN its fields are inspected and expiry is applied
- THEN it MUST carry duration, capacity, budget, scope, SOD checks, and risk approval, and expiry MUST remove temporary authority while preserving the primary role

### Requirement: Platform-Enabled Semantics

The 12 platform-enabled packages MUST retain source-defined domain concepts, lifecycles, and invariants despite platform implementation, MUST NOT be reclassified as pure infrastructure, and their domain rules MUST survive model/API/DB/interface changes. [SRC §2.2/§3.2] [INF]

#### Scenario: Semantics survive

- GIVEN a platform-enabled package whose implementation changes
- WHEN reviewed
- THEN its domain concepts, lifecycles, and invariants MUST be preserved and it MUST remain domain-classified, never pure infrastructure

### Requirement: Contract Meta-Handoff

Every substantive claim MUST carry a traceability label. Inferred mechanism candidates (cron, state machines, checkpoints, compensation, middleware) MUST stay non-binding and MUST NOT finalize any tool or library. The next ports/trust contract MUST exclude H1–H3 as pure design, enforce H4 (no-aggregate-sharing), and resolve H5 (classification before authority) and H6 (mechanism, default-deny). [INF] [ADR-0002]

#### Scenario: Labels and hypotheses

- GIVEN any claim, inferred candidate, or hypotheses H1–H6
- WHEN inspected or the next contract is authored
- THEN claims MUST be labeled, inferred candidates MUST NOT be finalized without design/ADR, H1–H3 ignored, H4 enforced, H5/H6 resolved
