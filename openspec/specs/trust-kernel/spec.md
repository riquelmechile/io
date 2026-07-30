# trust-kernel Specification

## Purpose

Minimum in-memory, persistence-free authority-evaluation behavior for roadmap
Increment 2: neutral identity, deterministic risk classification, deny-by-default
grant checks, separation of duties, evidence/audit capture, and honest in-memory
receipts. Hosted in the transitional `packages/trust-kernel/`. Explicitly EXCLUDES
persistence, adapters, real approval chains, budget reservation, policy-version
store, persistent R1–R17 records, and cryptographic receipts. Labels
`[ADR-0001]`, `[ADR-0002]`, `[ADR-0003]`, `[INF]` are normative, cited once per
requirement.

## Requirements

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

### Requirement: Neutral Identity and Bounded Roles

Identity MUST use neutral `principal_id` / `position_id` and MUST NOT reference
package-specific entities. A principal MUST hold exactly one active primary role
plus zero or more compatible temporary roles. A temporary role MUST declare an
assignment ID, explicit bounded scope, and start/expiry (indefinite is INVALID);
its authority MUST be explicit with NO ambient authority. Expiry/revocation MUST
remove temporary authority while the primary role is unchanged. [ADR-0001] [INF]

#### Scenario: Indefinite temporary role rejected

- GIVEN a temporary role with no expiry
- WHEN it is evaluated
- THEN it MUST be rejected as invalid and MUST grant no authority

#### Scenario: Expiry preserves primary role

- GIVEN an expired or revoked temporary role
- WHEN expiry/revocation is applied
- THEN temporary authority MUST be removed while the primary role is unchanged

### Requirement: Deterministic Risk Classification Before Authority

Every action MUST receive a deterministic risk class BEFORE authority is
evaluated. Classification MUST be a pure function of action attributes and
in-memory policy thresholds. The five source-reserved categories (purpose,
capital, critical limits, irreversible actions, constitutional modification)
MUST always classify as critical and MUST NEVER be downgraded for autonomous
execution. LLM output MUST NOT produce the final classification. [ADR-0003] [INF]

#### Scenario: Same input, same class

- GIVEN identical action attributes and policy thresholds
- WHEN classified repeatedly
- THEN the risk class MUST be identical each time

#### Scenario: Reserved category always critical

- GIVEN an action in a source-reserved category
- WHEN classified
- THEN it MUST be critical and MUST NOT be downgraded

### Requirement: Deny-by-Default Explicit Grant

Every action MUST be DENIED unless an explicit, bounded, in-memory grant exists.
Holding a step, task, or temporary role MUST grant NO ambient authority. The
grant MUST be command-bound and re-evaluated for every action. Any required
enforced step that fails MUST produce a terminal DENY. [SRC §2.1] [ADR-0001] [INF]

#### Scenario: No grant denied

- GIVEN an action with no explicit grant
- WHEN evaluated
- THEN the decision MUST be DENY

### Requirement: Scoped In-Memory Evaluation Pipeline

The trust kernel MUST evaluate actions through the persistence-free subset of the
16-step pipeline: classification → authority → identity → assignment → bounded
scope → evidence → SOD → expiry/revocation → action scope → final check.
Delegation lifecycle, policy version, budget reservation, real approvals, and
persistent records MUST be treated as no-op pass-through stubs explicitly
deferred to downstream hardening and MUST NOT be silently implemented. The kernel
MUST DENY on ANY failed enforced step. [ADR-0003] [INF]

#### Scenario: Pass-through steps documented

- GIVEN the trust kernel pipeline
- WHEN delegation/policy-version/budget/approval/records steps are reached
- THEN they MUST execute as documented no-op pass-throughs and MUST NOT be implemented as real behavior

#### Scenario: Any failure denies

- GIVEN an action failing one enforced step
- WHEN the pipeline runs
- THEN the final decision MUST be DENY

### Requirement: In-Memory Separation of Duties

SOD MUST be enforced per risk tier. No principal MAY self-approve or self-verify
at ANY tier. Medium-risk proposer/approver/executor/verifier MUST be mutually
distinct; critical and high-risk MUST use five distinct principals; low-risk MAY
combine roles only when policy permits. Every prohibited role overlap MUST
produce a DENY. [ADR-0003]

#### Scenario: Self-approval denied

- GIVEN one principal acting as both approver and executor
- WHEN SOD is checked
- THEN the action MUST be DENIED

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

### Requirement: Honest In-Memory Receipt

A granted decision MUST produce one honest receipt that is unsigned and
non-persistent, identifying the work/action ID plus the authority reference used,
the risk class, evidence summary, and terminal state. The receipt MUST explicitly
disclose that it is unsigned and non-persistent and MUST NOT imply cryptographic
or durable guarantee. [ADR-0002] [INF]

#### Scenario: Receipt honesty disclosure

- GIVEN a granted action
- WHEN its receipt is produced
- THEN it MUST carry work/action ID, authority reference, risk class, evidence summary, terminal state, AND an explicit unsigned/non-persistent disclosure
