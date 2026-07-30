# Delta for trust-kernel

## MODIFIED Requirements

### Requirement: Transitional In-Memory Boundary

The trust kernel MUST be a single transitional `packages/trust-kernel/` module of
pure TypeScript functions and in-memory records with NO real persistence, NO
concrete adapters, NO HTTP/database/daemon/LLM, and NO agentic/business
framework. No state MUST survive process memory. The kernel MAY define a `ports/`
directory of outbound PORT INTERFACES (generic, no driver types) and MAY accept
OPTIONAL repository injection, as specified by the `persistence-port-boundary`
capability. The package MUST be documented as transitional and MUST NOT be
treated as a canonical package; planned extraction targets are
`organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/`.
[INF]

(Previously: prohibited any persistence, adapters, or framework unconditionally; now permits a `ports/` directory of generic port interfaces and optional repository injection while still forbidding real persistence, concrete adapters, drivers, and frameworks.)

#### Scenario: No persistence or adapter

- GIVEN the trust kernel evaluating an action
- WHEN its dependencies are inspected
- THEN it MUST NOT touch real storage, network, daemon, LLM, or any framework, though generic outbound PORT INTERFACES and OPTIONAL in-memory repositories are permitted

#### Scenario: Transitional, not canonical

- GIVEN `packages/trust-kernel/`
- WHEN classified
- THEN it MUST be marked transitional with documented extraction targets and MUST NOT be treated as a canonical package

#### Scenario: Ports permitted; drivers and frameworks still forbidden

- GIVEN the trust kernel with the `ports/` boundary opened
- WHEN the boundary test runs
- THEN `ports/` generic interfaces MUST be permitted and real drivers (`pg`), ORMs, and business/agentic frameworks MUST still be rejected

### Requirement: In-Memory Evidence and Audit

Each evaluation MUST capture one evidence record and append one audit entry
recording principal, action, risk class, decision, and reason. By default these
records are in-memory `InMemoryRecord` with `persistent: false` and MUST disclose
their non-persistent nature. The pipeline MAY route evidence and audit through
OPTIONAL evidence/audit repository ports defined by the
`persistence-port-boundary` capability, in which case the routed records become
durable-capable (`persistent: true`); until a real durable adapter exists, the
records MUST NOT be claimed to satisfy persistent R1–R17 obligations. [INF]

(Previously: stated evidence and audit MUST NOT be persisted and MUST NOT satisfy R1–R17 obligations unconditionally; now permits optional repository routing while the default path remains non-persistent and R1–R17 satisfaction stays deferred.)

#### Scenario: Audit entry per evaluation

- GIVEN any evaluation
- WHEN it completes
- THEN one audit entry MUST be appended and the DEFAULT in-memory entry MUST declare it is non-persistent

#### Scenario: Optional repository routes records

- GIVEN an evaluation with evidence and audit repositories injected
- WHEN it finalizes
- THEN records MUST route through the repository ports as durable-capable (`persistent: true`) while an evaluation WITHOUT repositories MUST keep records non-persistent
