# Archive Report: harden-first-enterprise-vertical-foundation

## Change Summary

Enterprise vertical foundation hardening — tenant scoping, optimistic concurrency, transactional database port, use-case transitions, idempotency journal, and runtime validation gates.

## Verification Verdict

**pass_with_warnings** — 18/18 requirements, 61/61 scenarios, 0 blockers, 0 critical.
`gentle-ai sdd-verify-validate` → valid:true (evidence_revision sha256:6c9674c2...).

## Implementation Commits

| Slice | Commit | Description |
|-------|--------|-------------|
| Planning | 8840bd4 | Tasks, proposal, design committed |
| Slice A | c4b4d7e | Authority + scope (SoD, window gate, pipeline DEFERRED marker, companyId) |
| Slice A fix | 69c4959 | Coherence fix for live PG column additions |
| Slice B | 6a645c1 | Persistence + concurrency (transaction port, CAS, receipt terminalEventId) |
| Slice C | c23a6ff | Use cases + idempotency + validation |

## Test Results

- **604 passed / 3 skipped** (2 DeepSeek external-API + 1 local CI guard)
- **PG 18.4 integration: 38/38 ran** (not skipped) against live PostgreSQL

## Specs Synced

| Capability | Action | Details |
|------------|--------|---------|
| trust-kernel | MODIFIED (2) + ADDED (1) | SOD hardened (proposer≠approver absolute pair, low-risk combo rules), pipeline deferred steps non-ALLOW marker; Activation Window Gate added |
| company-identity | ADDED (1) | Tenant-Scoped Operations with empty companyId rejection |
| delegation-lifecycle | MODIFIED (1) + ADDED (1) | companyId field added; Window-Active Delegation (validFrom/validUntil) |
| work-lifecycle | MODIFIED (1) + ADDED (2) | companyId + version fields; Optimistic Concurrency via CAS; Transition Use Cases replace raw save |
| business-receipt | MODIFIED (2) | companyId + terminalEventId fields; UNIQUE(work_id, terminal_event_id) constraint |
| db-connection-port | MODIFIED (2) | DbConnection port gains `transaction<T>()`; PgDbConnection implements BEGIN/COMMIT/ROLLBACK/nested-throws |
| runtime-validation | NEW (1 capability) | Typed Guard Result Contract, Command Guard, LLM Plan Guard, PostgreSQL Row Guards |

## Deferred Follow-ups (Non-Blocking)

Recorded in apply-progress.md "Slice C Correction":

1. **Journal result_json replay row-guard** — guard replay against stale/future result_json entries
2. **Same-key race loser typed result** — ensure CAS loser returns properly typed conflict result
3. **Document IdempotencyJournalPort transaction-boundary assumption** — clarify whether the port assumes or enforces transaction boundaries

## Forbidden-Coupling Invariants Confirmed

- Business domain has zero `@io/*` imports
- `openai` confined to deepseek-client.ts only
- llm-plan guard has no `@io/llm-client` import
- No new dependencies introduced

## Bugs Found & Fixed During Cycle

| Bug | Fix | Slice |
|-----|-----|-------|
| CAS version used expectedVersion+1 as base | Corrected to use stored version as comparison baseline | Slice A (69c4959) |
| Transaction checked-out client error listener leak | Proper cleanup on transaction error path | Slice B (folded into 6a645c1) |
| ROLLBACK error fidelity lost | Original error rethrown after rollback | Slice B |
| Company empty-companyId parity missing | PG/fake validation parity achieved | Slice B (2.11) |
| proposeWork empty-companyId mislabel | Corrected labeling | Slice C (folded into c23a6ff) |

## Adversarial Reviews

Each slice passed an independent adversarial review with VERDICT CLEAN (no BLOCKER/CRITICAL).

## Files Archived

- `proposal.md`
- `exploration.md`
- `design.md`
- `tasks.md` (all tasks complete)
- `apply-progress.md`
- `verify-report.md`
- `specs/trust-kernel/spec.md`
- `specs/company-identity/spec.md`
- `specs/delegation-lifecycle/spec.md`
- `specs/work-lifecycle/spec.md`
- `specs/business-receipt/spec.md`
- `specs/db-connection-port/spec.md`
- `specs/runtime-validation/spec.md`

## Source of Truth Updated

The following specs now reflect the new behavior:

- `openspec/specs/trust-kernel/spec.md` — 2 MODIFIED + 1 ADDED requirement
- `openspec/specs/company-identity/spec.md` — 1 ADDED requirement
- `openspec/specs/delegation-lifecycle/spec.md` — 1 MODIFIED + 1 ADDED requirement
- `openspec/specs/work-lifecycle/spec.md` — 1 MODIFIED + 2 ADDED requirements
- `openspec/specs/business-receipt/spec.md` — 2 MODIFIED requirements
- `openspec/specs/db-connection-port/spec.md` — 2 MODIFIED requirements
- `openspec/specs/runtime-validation/spec.md` — NEW capability (4 requirements)
