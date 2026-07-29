# ADR 0002: Delegation as an Authority Commitment

## Status

Accepted

## Date

2026-07-29

## Context

IO needs to distinguish authorization from execution. Combining them would make it unclear whether assigning work grants authority, whether revoking authority cancels execution, and which record owns budgets, acceptance, evidence, and history. The foundational architecture document establishes explicit authority, bounded work, budgets, durable records, evidence, and organizational memory, but it does not prescribe this exact aggregate boundary.

This ADR records a founder decision that resolves that ambiguity.

## Decision

Delegation is a business authority commitment separate from Work.

Delegation owns the delegator, delegate, authority scope, budget, duration, escalation path, revocation rules and state, and expected outcome. Work owns execution state, tasks and projects, deliverables, acceptance, execution evidence, and outcomes.

Delegation may create or reference Work through application coordination, but Delegation and Work share no aggregate. Receiving a task or work item never grants ambient authority.

## Decision Rules / Invariants

- Delegation and Work have separate identities, lifecycles, histories, and aggregate boundaries.
- Every delegation identifies one delegator and one delegate through stable references.
- Authority scope, budget, duration, escalation, revocation, and expected outcome are explicit before a delegation becomes active.
- Work references the authority under which execution is attempted when authority is required.
- A task, project, message, or work assignment does not itself grant permission to act.
- Application coordination may create Work from a delegation or link existing Work to it without merging either aggregate.
- Revoking a delegation stops future use of its authority; its effect on active Work is decided explicitly by policy and coordination.
- Reassignment creates or selects valid authority for the new delegate; changing a Work assignee does not transfer authority implicitly.
- Historical delegation and work records remain independently auditable after completion, revocation, cancellation, or reassignment.

## Consequences

### Positive

- **Communication:** messages can propose or coordinate delegation and work without becoming the authoritative record for either.
- **Work:** execution state, tasks, projects, deliverables, acceptance, evidence, and outcomes remain coherent and independent of authority lifecycle changes.
- **Policy / Approvals:** authorization can be validated at action time, and approval policies can reason about scope, risk, duration, and revocation separately from task status.
- **Budgets:** delegated spending authority is distinct from work-cost accounting, while references preserve attribution and enforcement.
- **Evidence / Receipts:** receipts can identify both the executed work and the delegation or policy authority used, avoiding claims based only on task possession.
- **Memory:** organizational memory can preserve why authority existed separately from what execution occurred.
- **Evaluation / Learning:** the organization can evaluate delegation quality and execution quality independently, then correlate them through references.
- **Reassignment:** work can move between executors only after authority for the new delegate is established explicitly.
- **Revocation:** authority can end without erasing work state; policy determines whether affected work pauses, is reassigned, or is cancelled.
- **History:** immutable links preserve who authorized what, who executed it, under which limits, and with which result.

### Negative

- Separate aggregates require application coordination, cross-record references, and consistency handling.
- Users and agents must inspect both authority and execution records to understand the complete operational situation.
- Budget semantics must distinguish delegated authority from actual or forecast work cost.
- Revocation and reassignment require explicit policies for in-flight work and partially completed deliverables.
- Reporting and learning pipelines must correlate two histories without collapsing their ownership boundaries.

## Rejected Alternatives

- **Delegation inside Work:** rejected because authority lifecycle and execution lifecycle change for different reasons and obey different invariants.
- **Work inside Delegation:** rejected because one authority commitment may coordinate multiple work items, and work may outlive or change authority through explicit policy.
- **Task assignment grants authority:** rejected because it creates ambient permission without bounded scope, budget, duration, approval, or revocation semantics.
- **Shared Delegation/Work aggregate:** rejected because it couples authorization and execution state, increasing contention and obscuring ownership.
- **Communication as delegation:** rejected because conversation coordinates commitments but is not their authoritative business record.

## Scope / Follow-ups

This ADR defines business ownership and invariants, not implementation, storage, API, event, or package design.

Follow-up domain work must define delegation lifecycle states, authority validation, budget relationships, escalation and revocation policy, application coordination with Work, reassignment behavior, receipt references, history retention, and evaluation signals. Existing SDD exploration artifacts remain unchanged and must cite this ADR if they adopt the decision.

## References

- [`../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md`](../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md), foundational architecture document.
- Founder decision recorded 2026-07-29.
