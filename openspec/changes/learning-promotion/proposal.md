# Proposal: Learning promotion (stages 2+3)

## Intent

Verified `work.skill-outcome` facts (Stage 1, delivered) create append-only `LearningCandidate` memory objects (§9.2 subset), promoted by a deterministic policy rule. Autonomous in-policy only; typed-escalated outside. `SkillState` stays `draft|active|retired`; `candidate` is memory validity, never Skill state.

## Scope

### In Scope
- Minimal `LearningCandidate` + guard: `candidate|active|needs_review|superseded`
- Deterministic aggregation of verified `work.skill-outcome`
- Versioned policy contract: threshold fields + semantics, fail-closed, no code-embedded values
- Append-only transitions: `supersedes` lineage, single-winner idempotency, no update/delete
- Typed escalation outside delegated policy or reserved/unresolved; no universal gate

### Out of Scope
- Stage 4 Skill creation (A6 follow-up); Memory OS; `SkillState.candidate`; fan-out; failure events; curricula/Gym; extraction; riskClass; backfill; roadmap docs

## Capabilities

### New Capabilities
- `learning`: lifecycle — creation from verified outcomes, policy evaluation, append-only promotion, escalation

### Modified Capabilities
- None — `skill`/`business-event` already exclude learning; no state or event change

## Approach

Approach B (stages 2+3): pure `business-domain` entity + rule (zero `@io/*`); append-only port; INSERT-only PG adapter (`UNIQUE(company_id, candidate_id, revision)`); read-only in-app aggregation (no event/T1 change). Company Bench quality only: versioned deterministic grader, gold/decoy/equivalent-variant/missing-evidence controls, catastrophic veto not averaged away, raw evidence for rescoring. Not its thresholds/L0–L3/chairs. Evidence is success-only (verified outcomes + explicit veto/conflict inputs); missing ≠ harmful; negative-evidence fields MAY come later. No applicable policy ⇒ fail closed.

## Decisions (A1–A6)

- A1 minimal subset, 4 states; A2 outcomes first, §9.3 later; A3 versioned policy, operator values; A4 append-only `supersedes`; A5 in-app seam; A6 named follow-up

## Policy fields

min positive observations; harmful cap or catastrophic veto; success-rate denominator; window/cohort scope; required linked outcomes; confidence/source authority; conflict behavior; identity/version/effective scope; delegated risk boundary (ADR-0003).

## Affected Areas

- NEW `packages/business-domain/src/learning-candidate.ts`
- NEW `packages/business-domain/src/promotion-evaluation.ts`
- MOD `packages/business-domain/src/ports/repositories.ts` + `fakes.ts`
- NEW `packages/database/src/learning-candidate-adapter.ts`, `sql/012_learning_candidates.sql`; MOD `row-guards.ts`
- NEW `packages/app/src/learning/evaluate.ts`
- NEW tests: domain, database, app parity

## Risks

- Memory OS creep (Med): entity shape = boundary
- Autonomy boundary (Med): ADR-0003 tiers; fail-closed; reserved escalate
- Append-only violation (Med): INSERT-only + uq-style suppression
- Success-only over-claim (Med): missing ≠ harmful
- Parity drift (Low): fakes + parity tests
- 400-line budget (High): chained stacked PRs via sdd-tasks
- Invented thresholds (Med): contract-only, operator values

## Rollback

Purely additive; no change to events, Skill registry, or T1. Revert by removing modules + tables; records have no consumers. Retiring policy fails closed at runtime.

## Dependencies

- `work.skill-outcome` events (delivered)
- ADR-0003 risk classification
- Operator-deployed versioned policy (data)

## Success Criteria

- Candidates from verified linked outcomes with provenance
- Promotion requires active applicable policy; else fail closed
- Transitions append-only, single-winner; no update/delete
- Reserved/unresolved conflicts typed-escalate
- Parity/purity/boundary tests green; `pnpm check` passes
- `SkillState`, `MATERIAL_EVENT_TYPES`, T1 unchanged
