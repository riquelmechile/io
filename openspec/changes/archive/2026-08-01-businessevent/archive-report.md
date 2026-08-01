# Archive Report — businessevent

**Change**: `businessevent`  
**Date Archived**: 2026-08-01  
**Author**: sdd-archive sub-agent (orchestrator-led cycle)  
**Mode**: Hybrid (OpenSpec + Engram)  
**Delivery Strategy**: Stacked-to-main auto-chain (3 PRs)

---

## Executive Summary

Implemented a deterministic append-only business-fact log (`BusinessEvent`) emitted atomically at worker terminal close. The change defines a pure domain type, an append-only repository port with in-memory fake, an INSERT-only PostgreSQL adapter, and wires emission into the worker's T1 transaction alongside CAS, receipt save, and journal completion. All 9 requirements and 12 scenarios verified compliant. Effective verification verdict: **PASS**.

## Change Artifacts (Engram Observation IDs)

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Exploration | #5888 | `sdd/businessevent/explore` |
| Proposal | #5889 | `sdd/businessevent/proposal` |
| Spec | #5890 | `sdd/businessevent/spec` |
| Design | #5891 | `sdd/businessevent/design` |
| Tasks | #5892 | `sdd/businessevent/tasks` |
| Apply Progress | #5893 | `sdd/businessevent/apply-progress` |
| Verify Report | #5897 | `sdd/businessevent/verify-report` |

## Commits & PRs

| PR | Commit | Scope | Files Changed |
|----|--------|-------|---------------|
| PR1 | `794f009` | `packages/business-domain` | types.ts, ports/repositories.ts, ports/fakes.ts, index.ts, test/business-event.test.ts |
| PR2 | `eef6efc` | `packages/database` | sql/006_business_events.sql, business-event-adapter.ts, row-guards.ts, index.ts, test/business-event-roundtrip.integration.test.ts, test/sql-migrations.test.ts, test/row-guards.test.ts, test/boundary.test.ts |
| PR3 | `11050db` | `packages/app` | worker/types.ts, worker/finalize.ts, composition/worker-deps.ts, test/worker-helpers.ts, test/composition/worker-deps.test.ts, test/worker-finalize.test.ts, test/parity.test.ts, test/app-boundary.test.ts, test/worker-reconcile.test.ts, test/e2e/harness.ts, test/e2e/worker-e2e.integration.test.ts |

Baseline: main@b1662e5 (~829 tests). HEAD at archive: main@11050db.

## Requirements & Scenarios

| Req | Requirement | Scenarios | Status |
|-----|-------------|-----------|--------|
| R1 | Pure Deterministic BusinessEvent | 2 (deterministic isolation, no @io/* imports) | ✅ COMPLIANT |
| R2 | Append-Only Repository Port | 1 (port surface prevents mutation) | ✅ COMPLIANT |
| R3 | Ordered In-Memory Repository | 1 (fake preserves append order) | ✅ COMPLIANT |
| R4 | Insert-Only PostgreSQL Persistence | 2 (PG round-trip guarded, mutation SQL prohibited) | ✅ COMPLIANT |
| R5 | Atomic Worker Terminal Emission | 2 (terminal close commits one event, CAS loss leaves no orphan) | ✅ COMPLIANT |
| R6 | Model-Independent Event Facts | 1 (model output cannot change the event) | ✅ COMPLIANT |
| R7 | Idempotent Single Emission | 2 (completed replay does not append, duplicate identity rejected) | ✅ COMPLIANT |
| R8 | Tenant-Scoped Event Log | 1 (cross-tenant events are isolated) | ✅ COMPLIANT |
| R9 | Stable-Prefix Isolation | 1 (context remains unchanged) | ✅ COMPLIANT |

**Total**: 9/9 requirements, 12/12 scenarios verified compliant.

## Verification Verdict

**Effective verdict: PASS**

The sdd-verify phase initially returned FAIL because the parallel `pnpm check` gate hit the documented pre-existing PG parallelism flake (`business-pg-roundtrip` → `idempotency_journal_attempt_id_key`). The orchestrator independently re-ran the FULL suite sequentially: **868 passed | 6 skipped** (69 files passed | 3 skipped), exit code 0. The flake is pre-existing (project methodology #5882, deferred follow-up #3) and NOT candidate-caused. The verify report was updated with an Orchestrator Addendum reclassifying the CRITICAL to a pre-existing WARNING.

All quality stages green: format-check ✅, typecheck ✅, build ✅, lint ✅.

## Delta Spec Sync

The delta spec (`openspec/changes/businessevent/specs/business-event/spec.md`, 9 ADDED requirements) was synced to the canonical spec:

**Synced to**: `openspec/specs/business-event/spec.md`

This is a new capability — no existing spec was modified. The worker-cycle, business-receipt, and context-compiler specs remain unchanged.

## Archive Contents

| Artifact | Path | Status |
|----------|------|--------|
| exploration.md | `openspec/changes/archive/2026-08-01-businessevent/explo...` | ✅ |
| proposal.md | `openspec/changes/archive/2026-08-01-businessevent/proposal.md` | ✅ |
| design.md | `openspec/changes/archive/2026-08-01-businessevent/design.md` | ✅ |
| tasks.md | `openspec/changes/archive/2026-08-01-businessevent/tasks.md` | ✅ (18/18 complete) |
| verify-report.md | `openspec/changes/archive/2026-08-01-businessevent/verify-r...` | ✅ |
| apply-progress.md | `openspec/changes/archive/2026-08-01-businessevent/apply-pr...` | ✅ |
| specs/ | `openspec/changes/archive/2026-08-01-businessevent/specs/` | ✅ |

Archived tasks.md has all 18 implementation tasks checked.

## Carried-Forward Follow-Ups

These are NOT part of this change scope:

1. **Pre-existing PG parallelism flake** — run gate with `--no-file-parallelism` or isolate the concurrent test (deferred follow-up #3, project methodology #5882).
2. **`openspec/config.yaml` testing.e2e:false is stale** — this change ships a live PostgreSQL worker E2E test that runs successfully; config metadata is outdated.
3. **Domain-use-case parity emission (Option B)** — candidate for future slice per proposal out-of-scope list.
4. **Happy-path live test single-attempt flake** — noted during implementation.
5. **processTokenFor transitional** — noted during implementation.
6. **No production CLI entrypoint yet** — noted during implementation.

## Source of Truth

The following specs now reflect the new behavior:

- `openspec/specs/business-event/spec.md` (new — 9 requirements, 12 scenarios)

## SDD Cycle Complete

The change has been fully planned (explore → proposal → spec → design → tasks), implemented (PR1+PR2+PR3, 18/18 tasks, strict TDD), verified (9/9 requirements, 12/12 scenarios, effective PASS), and archived.
