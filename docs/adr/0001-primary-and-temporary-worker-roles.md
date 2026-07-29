# ADR 0001: Primary and Temporary Worker Roles

## Status

Accepted

## Date

2026-07-29

## Context

IO needs an unambiguous role-cardinality rule before Organization, Workforce, Contracts, authority, budgets, competency, and evaluation can share coherent domain contracts. The foundational architecture document describes explicit worker roles, authority, budgets, and organizational controls, but it does not mandate this exact role cardinality.

This ADR records a founder decision that resolves that ambiguity.

## Decision

Every worker has exactly one primary role. A worker may also hold zero or more compatible temporary roles.

A temporary role is a bounded assignment, not a second primary identity. It must define its duration, capacity allocation, budget, authority scope, separation-of-duties and conflict checks, and approval appropriate to its risk.

## Decision Rules / Invariants

- A worker has exactly one active primary role at any point in time.
- A worker may hold temporary roles only when they are compatible with the primary role and with each other.
- Every temporary role has explicit start and expiry conditions; indefinite temporary roles are invalid.
- Every temporary role reserves an explicit share of worker capacity and identifies the budget available to the assignment.
- Authority granted by a temporary role is explicit and bounded; no ambient authority is inherited from assignment alone.
- Separation-of-duties and conflict checks occur before activation and when relevant assignments or policies change.
- Approval strength and independence are proportional to risk. A worker cannot self-approve a conflicting assignment.
- Expiry or revocation removes temporary authority and capacity allocation without changing the worker's primary role.
- Role and agreement references cross domain boundaries through neutral principal and position identifiers rather than package-specific entity types.

## Consequences

### Positive

- **Organization:** each worker has one stable primary position and reporting line; temporary assignments can add scoped accountability without creating competing primary reporting structures.
- **Workforce:** worker identity remains distinct from assignments, and primary versus temporary assignments have explicit lifecycle state.
- **Contracts:** agreement status and parties can be recorded against neutral principal and position IDs without inferring contractual state from a Workforce assignment.
- **Policy / Approvals:** risk-based approval, compatibility, and separation-of-duties checks become enforceable invariants.
- **Budgets:** temporary assignments receive explicit budget and capacity envelopes, improving attribution and preventing silent over-allocation.
- **Competency:** eligibility for a temporary role can be checked against required competencies without redefining the worker's primary role.
- **Evaluation:** performance can be attributed separately to primary and temporary responsibilities while preserving a coherent worker history.
- **Revocation / Expiry:** temporary authority, budget access, and capacity allocation have deterministic termination points.

### Negative

- Assignment lifecycle, capacity accounting, compatibility rules, and approvals add operational complexity.
- Organization and Workforce views must distinguish stable reporting from temporary accountability.
- Contract, budget, evaluation, and audit records must retain assignment identifiers and effective dates.
- Poorly defined compatibility or risk policy can still permit conflicts or block useful temporary assignments.

## Rejected Alternatives

- **Multiple primary roles:** rejected because competing primary identity, reporting, capacity, and evaluation semantics remain ambiguous.
- **Primary roles only:** rejected because the organization needs controlled temporary coverage and cross-functional responsibility.
- **Informal or unbounded temporary roles:** rejected because they obscure authority, budget, accountability, conflicts, and termination.
- **Treating assignment as contract status:** rejected because workforce assignment and contractual agreement are separate concerns.

## Scope / Follow-ups

This ADR defines business invariants, not implementation, storage, API, or package design.

Follow-up domain work must define assignment lifecycle states, compatibility and separation-of-duties policies, risk-tier approvals, capacity accounting, budget reservation, competency checks, evaluation attribution, and expiry/revocation events. Existing SDD exploration artifacts remain unchanged and must cite this ADR if they adopt the decision.

## References

- [`../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md`](../IO_EMPRESA_AGENTICA_ARQUITECTURA_Y_MEMORIA_2026.md), foundational architecture document.
- Founder decision recorded 2026-07-29.
