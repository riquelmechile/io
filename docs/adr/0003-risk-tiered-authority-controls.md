# ADR 0003: Risk-Tiered Authority Controls

## Status

Accepted

## Date

2026-07-29

## Context

IO needs deterministic risk classification and separation of duties before governed actions are evaluated for authority. Without a shared ordering and tier model, the same action could receive inconsistent controls, autonomous systems could influence their own constraints, and one principal could hold conflicting responsibilities.

The foundational architecture document reserves company purpose, capital, critical limits, irreversible actions, and constitutional modification for human authority. It also establishes bounded authority, budgets, evidence, and organizational controls, but it does not prescribe the exact risk-tier matrix or classification rules in this ADR.

This ADR records connected founder decisions that define those controls.

## Decision

Every governed action is assigned a deterministic risk class before authority is evaluated. The resulting tier determines the required separation among proposal, review, approval, execution, and verification.

The five source-reserved human categories are always critical: company purpose, capital, critical limits, irreversible actions, and constitutional modification. LLMs may provide context and evidence, but never determine the final risk class.

## Decision Rules / Invariants

### Risk classification

- Risk classification occurs before authority evaluation.
- The five source-reserved human categories are always classified as critical.
- An action is irreversible when deterministic criteria identify at least one of: destructive data loss without tested restoration; external side effects without reliable compensation; legal or financial commitments that cannot be automatically cancelled within policy; production, security, or secret changes with non-restorable impact; or configured rollback time or cost limits being exceeded.
- Other tiers are assigned by deterministic impact, reversibility, radius, budget, and sensitivity thresholds defined by policy.
- Humans may elevate an action's risk class.
- Lowering a machine-determined risk class requires an explicit, reasoned, auditable exception by authorized human authority.
- Source-reserved categories cannot be downgraded for autonomous execution.
- LLM output may support classification with context or evidence but is never the final classification decision.

### Separation of duties

- For critical- and high-risk actions, proposal, review, approval, execution, and verification must be performed by five distinct principals for the same governed action or work.
- For medium-risk actions, proposer, approver, executor, and verifier must be distinct. The reviewer may also be the approver only when policy explicitly permits it and the reviewer remains independent from the proposer and executor.
- For low-risk actions, functions may be combined when policy permits, but no principal may self-approve or self-verify.
- Authority, budget, and evidence checks apply at every risk tier.
- Every prohibited role overlap produces an explicit `DENY` at action time.

## Consequences

### Positive

- Authority evaluation receives a stable, explainable risk input before deciding whether an action may proceed.
- Critical and high-risk work has independent proposal, review, approval, execution, and verification.
- Lower-risk work can remain efficient without permitting self-approval or self-verification.
- Deterministic irreversibility criteria make reserved human control enforceable rather than interpretive.
- Auditable human exceptions preserve oversight without allowing silent risk reduction.

### Negative

- Critical and high-risk work requires five available principals and may take longer to complete.
- Policy must define and maintain measurable thresholds for non-reserved risk tiers.
- Identity, workflow, and audit systems must track principal independence and role assignment for each governed action.
- Human risk-reduction exceptions add review and evidence obligations.

## Rejected Alternatives

- **One separation model for every tier:** rejected because five-way separation would burden low-risk work, while weaker controls would be unsafe for critical and high-risk work.
- **Authority evaluation before classification:** rejected because required controls cannot be selected consistently without knowing the action's risk.
- **LLM-determined final classification:** rejected because probabilistic output cannot hold constitutional authority or provide deterministic enforcement.
- **Unrecorded human downgrade:** rejected because it would bypass policy without reason, authority evidence, or auditability.
- **Risk labels without deterministic irreversibility criteria:** rejected because reserved human control would depend on interpretation at action time.

## Scope / Follow-ups

This ADR defines governance ordering and business invariants, not implementation, storage, API, workflow engine, identity model, or threshold values.

Follow-up policy work must define deterministic thresholds for impact, reversibility, radius, budget, and sensitivity; authorized exception authorities; evidence requirements; principal-independence checks; and action-time denial behavior. Domain and application work must preserve the classification decision, authority evaluation, role assignments, exceptions, and verification evidence in auditable records.

## References

- [`../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md`](../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md), foundational architecture document and source of the five reserved human categories.
- Founder decisions recorded 2026-07-29.
