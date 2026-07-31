# Delta for trust-kernel

## MODIFIED Requirements

### Requirement: Transitional In-Memory Boundary

The trust kernel MUST be a single transitional `packages/trust-kernel/` module of pure TypeScript functions and in-memory records with NO real persistence, NO concrete adapters, NO HTTP/database/daemon/LLM, and NO agentic/business framework INSIDE the package itself. No state MUST survive process memory. The kernel MAY define a `ports/` directory of outbound PORT INTERFACES (generic, no driver types) and MAY accept OPTIONAL async repository injection, as specified by the `persistence-port-boundary` capability — these repositories MAY be backed by real PostgreSQL downstream while the kernel package itself imports no driver. Because the injected repositories are async, the kernel's evaluation entry point MUST be async (`evaluate` returns `Promise<EvaluationResult>`). The package MUST be documented as transitional and MUST NOT be treated as a canonical package; planned extraction targets are `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/`. [INF]

(Previously: permitted optional repository injection but the kernel entry point was synchronous and only in-memory repositories were contemplated; now repositories are async and MAY be backed by real PostgreSQL, so `evaluate()` returns a Promise while the kernel package itself stays driver-free and transitional.)

#### Scenario: No persistence or adapter inside the kernel

- GIVEN the trust kernel evaluating an action
- WHEN its dependencies are inspected
- THEN it MUST NOT import a real storage driver, network, daemon, LLM, or framework, though generic outbound PORT INTERFACES and OPTIONAL async repositories (including pg-backed ones downstream) are permitted

#### Scenario: Transitional, not canonical

- GIVEN `packages/trust-kernel/`
- WHEN classified
- THEN it MUST be marked transitional with documented extraction targets and MUST NOT be treated as a canonical package

#### Scenario: Ports permitted; drivers and frameworks still forbidden

- GIVEN the trust kernel with the `ports/` boundary opened
- WHEN the boundary test runs
- THEN `ports/` generic interfaces MUST be permitted and real drivers (`pg`), ORMs, and business/agentic frameworks MUST still be rejected inside the kernel

### Requirement: Scoped In-Memory Evaluation Pipeline

The trust kernel MUST evaluate actions through the persistence-free subset of the 16-step pipeline: classification → authority → identity → assignment → bounded scope → evidence → SOD → expiry/revocation → action scope → final check. The `evaluate()` function MUST be async and MUST return `Promise<EvaluationResult>`; its `finalize()` step MUST `await` any injected repository operations (evidence `save`, audit `append`) so a real downstream's completion is honored. Delegation lifecycle, policy version, budget reservation, real approvals, and persistent records MUST be treated as no-op pass-through stubs explicitly deferred to downstream hardening and MUST NOT be silently implemented. The kernel MUST DENY on ANY failed enforced step. [ADR-0003] [INF]

(Previously: `evaluate()` and `finalize()` were synchronous; `finalize` now awaits async repository ops and `evaluate()` returns a Promise.)

#### Scenario: Pass-through steps documented

- GIVEN the trust kernel pipeline
- WHEN delegation/policy-version/budget/approval/records steps are reached
- THEN they MUST execute as documented no-op pass-throughs and MUST NOT be implemented as real behavior

#### Scenario: Any failure denies

- GIVEN an action failing one enforced step
- WHEN the pipeline runs
- THEN the final decision MUST be DENY

#### Scenario: Callers must await evaluate

- GIVEN any caller invoking `evaluate()`
- WHEN it consumes the result
- THEN it MUST `await` the returned `Promise<EvaluationResult>` or the decision is not obtained (the compiler MUST surface a missing `await`)

### Requirement: In-Memory Evidence and Audit

Each evaluation MUST capture one evidence record and append one audit entry recording principal, action, risk class, decision, and reason. By default these records are in-memory `InMemoryRecord` with `persistent: false` and MUST disclose their non-persistent nature. The pipeline MAY route evidence and audit through OPTIONAL async evidence/audit repository ports defined by the `persistence-port-boundary` capability, in which case the pipeline MUST `await` the store/append operations and the routed records become durable-capable (`persistent: true`); even with a real PostgreSQL-backed adapter wired downstream, the records MUST NOT be claimed to satisfy persistent R1–R17 durability obligations until downstream hardening (transactions, idempotency, append-only enforcement) lands. [INF]

(Previously: routing was synchronous and predicated on a real durable adapter not yet existing; now routing is async and MAY target a real pg-backed adapter, while R1–R17 satisfaction stays deferred.)

#### Scenario: Audit entry per evaluation

- GIVEN any evaluation
- WHEN it completes
- THEN one audit entry MUST be appended (awaited if a repo is present) and the DEFAULT in-memory entry MUST declare it is non-persistent

#### Scenario: Optional repository routes records

- GIVEN an evaluation with evidence and audit repositories injected
- WHEN it finalizes
- THEN records MUST route through the repository ports (awaited) as durable-capable (`persistent: true`) while an evaluation WITHOUT repositories MUST keep records non-persistent
