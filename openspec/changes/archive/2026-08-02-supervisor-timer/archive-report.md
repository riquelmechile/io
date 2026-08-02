# Archive Report: supervisor-timer

**Change**: `supervisor-timer`
**Date archived**: 2026-08-02
**Status**: PASS (clean)
**Mode**: Hybrid (OpenSpec + Engram)

## Intent

§13.2 gates every model activation behind a deterministic novelty filter, but that filter is unreachable because its only material input, `work.completed`, is emitted by the worker's own finalize — so gating a work-bearing cycle deadlocks the first job. This change ships a polling supervisor in `@io/app` that wakes the heartbeat gate per company on a timer, making the §2 LLM-cost savings reachable. The loop is the enabler; dispatch wiring lands next slice.

## Delivery — Two Stacked PRs (Merged to Main)

| PR | Scope | Commit | Branch | Status |
|----|-------|--------|--------|--------|
| PR1 | `packages/business-domain` + `packages/database` (tailCursor, cursor port/fake/PG adapter, listCompanyIds, migration 008) | `da494ae` | `business-domain` | ✅ Merged & pushed |
| PR2 | `packages/app` supervisor module + composition wiring (`buildSupervisorDeps`) | `d04f974` | `app` (stacked on PR1) | ✅ Merged & pushed |

**HEAD at archive time**: `main@d04f974`

### R4-001 Correction Story (PR1 Review)

PR1 received a 4R review (risk, resilience, readability, reliability). The reviewer flagged **CRITICAL finding R4-001**: the design specified cursor checkpoint *before* the activation callback, which would violate at-least-once semantics (a crash during the callback would lose the activation, causing it to never retry). The fix was straightforward and correct: swap the order so `onActivate(companyId)` runs first, then cursor `upsert` only after the callback returns. PR1 was re-reviewed with this correction and approved. The corrected tick order (`await onActivate` → `cursors.upsert`) is verified in code (`tick.ts` line 35–38) and tests (throwing-callback test confirms cursor absence triggers re-evaluation).

## Spec Sync

Three domains were synced:

| Domain | Action | Details |
|--------|--------|---------|
| `supervisor-timer` | Created | New capability — 5 ADDED requirements + 11 scenarios → canonical spec at `openspec/specs/supervisor-timer/spec.md` |
| `heartbeat` | Modified | 3 ADDED requirements (Pure Tail Cursor, Per-Company Heartbeat Cursor Store, Pure Port and Supervisor-Only Writes) appended to existing spec |
| `business-event` | Modified | 1 ADDED (Read-Only Company Discovery) + 1 MODIFIED (Append-Only Repository Port now includes read-only `listCompanyIds()`) |

No changes to `worker-cycle`, `context-compiler`, or other capabilities — verified untouched.

## Requirements & Scenarios

| # | Capability / Requirement | Scenarios | Status |
|---|--------------------------|-----------|--------|
| ST1 | Periodic Discoverable Lifecycle | 2 (S1, S2) | ✅ COMPLIANT |
| ST2 | Sequential Checkpointed Tick | 4 (S3–S6) | ✅ COMPLIANT |
| ST3 | Durable Cursor Recovery | 2 (S7, S8) | ✅ COMPLIANT |
| ST4 | Non-Invasive Activation Seam | 2 (S9, S10) | ✅ COMPLIANT |
| ST5 | Single-Instance Operation | 1 (S11) | ✅ COMPLIANT |
| HB1 | Pure Tail Cursor | 2 (S1, S2) | ✅ COMPLIANT |
| HB2 | Per-Company Heartbeat Cursor Store | 2 (S3, S4) | ✅ COMPLIANT |
| HB3 | Pure Port and Supervisor-Only Writes | 1 (S5) | ✅ COMPLIANT |
| BE1 | Read-Only Company Discovery | 2 (S1, S2) | ✅ COMPLIANT |
| BE2 | Append-Only Repository Port | 1 (S1) | ✅ COMPLIANT (MODIFIED) |

**Total**: 10/10 requirements, 19/19 scenarios compliant.

## Verification Verdict

**PASS** — zero blockers, zero critical findings. All 10 requirements and 19 scenarios covered by passing runtime tests.

### Test Results

- **Sequential full suite**: **1025 passed, 6 skipped** (live PG reachable) — re-ran after orchestrator restarted `io_pg` container. WARNING #1 (live-PG skip) RESOLVED.
- **Quality stages**: format-check ✅, typecheck ✅, build ✅, lint ✅ — all green. `pnpm check` exit 0.

### Warnings (Non-Blocking)

1. **Formal per-task TDD-table traceability incomplete** — formal cycle rows exist for only 2/7 tasks; the remaining 5 have narrative RED→GREEN claims and real passing tests, but not the complete formal table. Non-blocking: all 7 tasks have concrete test files and passing tests.

### Suggestions (Deliberately Deferred)

1. **Stale comment in `PgBusinessEventRepository`** and database boundary-test description still say `append + listByCompany`; production correctly includes read-only `listCompanyIds()`. Deliberately NOT fixed this change to avoid invalidating the approved PR2 review receipt for a trivial comment. Next slice should update these.

## Correctness Verified

| Invariant | Result |
|-----------|--------|
| Corrected at-least-once tick order (`onActivate` before cursor upsert) | ✅ Verified in code + tests |
| Sequential per-company evaluation (no `Promise.all`) | ✅ Verified |
| Protected worker/gate sources byte-identical | ✅ Git blob IDs match baseline |
| Gate remains companyId-only (arity === 3) | ✅ Verified |
| Business-domain purity (zero `@io/*` imports) | ✅ Boundary tests passed |
| Supervisor-only cursor writes | ✅ Only `tick.ts:38` writes cursors |
| Composition remains separate (`buildSupervisorDeps` not called by `buildWorkerDeps`) | ✅ Verified |
| No new runtime dependencies | ✅ Lockfile unchanged |
| Read-only company discovery (`SELECT DISTINCT company_id`) | ✅ Live PG verified |
| Durable cursor adapter (migration 008, ON CONFLICT upsert) | ✅ Live PG verified |

## Task Completion

All 7 tasks complete (Batch 1: 1.1–1.3; Batch 2: 2.1–2.2; Batch 3: 3.1; Batch 4: 4.1). Tasks artifact shows all checkboxes checked.

## Source of Truth Updated

- `openspec/specs/supervisor-timer/spec.md` — **new** canonical capability spec (5 requirements, 11 scenarios)
- `openspec/specs/heartbeat/spec.md` — **modified** (3 new requirements appended: HB1–HB3)
- `openspec/specs/business-event/spec.md` — **modified** (1 new requirement added: BE1; 1 requirement modified: BE2 now includes `listCompanyIds()`)

## Engram Observations (Traceability)

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Exploration | pending | `sdd/supervisor-timer/explore` |
| Proposal | pending | `sdd/supervisor-timer/proposal` |
| Spec (delta) | pending | `sdd/supervisor-timer/spec` |
| Design | pending | `sdd/supervisor-timer/design` |
| Tasks | pending | `sdd/supervisor-timer/tasks` |
| Apply Progress | pending | `sdd/supervisor-timer/apply-progress` |
| Verify Report | pending | `sdd/supervisor-timer/verify-report` |
| Archive Report | pending | `sdd/supervisor-timer/archive-report` |

## Files Changed (Implementation)

See PR commits:
- PR1 `da494ae`: business-domain + database foundation (19 files)
- PR2 `d04f974`: app supervisor + composition wiring (5 files)

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/supervisor-timer/spec.md` (delta) ✅
- `specs/heartbeat/spec.md` (delta) ✅
- `specs/business-event/spec.md` (delta) ✅
- `design.md` ✅
- `tasks.md` ✅ (7/7 tasks complete)
- `verify-report.md` ✅
