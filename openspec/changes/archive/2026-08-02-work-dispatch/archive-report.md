# Archive Report: work-dispatch

**Change**: `work-dispatch`
**Date archived**: 2026-08-02
**Status**: PASS (clean)
**Mode**: Hybrid (OpenSpec + Engram)

## Intent

§13.2 gates every model activation behind a deterministic novelty filter, but that filter is unreachable because its only material input, `work.completed`, is emitted by the worker's own finalize — so gating a work-bearing cycle deadlocks the first job. The heartbeat supervisor solves discovery; dispatch closes execution. This change adds a deterministic dispatch module (`dispatch/keys.ts`, `dispatch/dispatch.ts`, `dispatch/types.ts`) composed through the existing `onActivate` seam, plus the actionable-work read port (`ACTIONABLE_WORK_STATES`, `listActionableByCompany`) and migration 009 that make it possible to select oldest-first accepted Work per company. Dispatch wiring is the missing half of the §2 LLM-cost loop; this ships both halves.

## Delivery — Two Stacked PRs + Remediation (Merged to Main)

| PR | Scope | Commit | Branch | Status |
|----|-------|--------|--------|--------|
| PR1 | `packages/business-domain` + `packages/database` (ACTIONABLE_WORK_STATES, WorkRepository.listActionableByCompany port/fake/PG adapter, migration 009) | `1339791` | `business-domain` | ✅ Merged & pushed |
| PR2 | `packages/app` dispatch module + `buildSupervisorDispatch` composition wiring | `65f1a04` | `app` (stacked on PR1) | ✅ Merged & pushed |
| Remediation | Guard rejects `:` delimiter in dispatch idempotency key components (CRITICAL-1 fix) | `4be8d9b` | main | ✅ Merged & pushed |

**HEAD at archive time**: `main@4be8d9b`

### R4-001 Correction Story (PR1 Review)

PR1 received a 4R review (risk, resilience, readability, reliability). The reviewer flagged **CRITICAL finding R4-001**: the design specified cursor checkpoint *before* the activation callback, which would violate at-least-once semantics (a crash during the callback would lose the activation, causing it to never retry). The fix was straightforward and correct: swap the order so `onActivate(companyId)` runs first, then cursor `upsert` only after the callback returns. The corrected tick order (`await onActivate` → `cursors.upsert`) is verified in code and tests.

### CRITICAL-1 Closure (Remediation)

PR2's `dispatchIdempencyKeyFor` accepted `companyId` or `workId` containing `:`, producing ambiguous keys like `wk:a:b:c` from both `('a:b','c')` and `('a','b:c')`. Remediation commit `4be8d9b` adds pre-serialization guards that reject `:` in either component with a component-specific error message, preserving the exact mandated `wk:${companyId}:${workId}` format for valid inputs. Focused regression suite 13/13 passes; both adversarial collision probes throw.

## Spec Sync

Two domains were synced:

| Domain | Action | Details |
|--------|--------|---------|
| `work-dispatch` | Created | New capability — 6 ADDED requirements + 10 scenarios → canonical spec at `openspec/specs/work-dispatch/spec.md` |
| `work-lifecycle` | Modified | 1 ADDED requirement (Tenant-Scoped Actionable Work Selection) + 3 scenarios appended to existing spec |

No changes to `supervisor-timer`, `worker-cycle`, `context-compiler`, `heartbeat`, `business-event`, or other capabilities — verified byte-identical.

## Requirements & Scenarios

| # | Capability / Requirement | Scenarios | Status |
|---|--------------------------|-----------|--------|
| WD1 | Deterministic Dispatch Identity | 2 (S1, S2) | ✅ COMPLIANT |
| WD2 | One Oldest-First Cycle per Activation | 2 (S3, S4) | ✅ COMPLIANT |
| WD3 | Non-Invasive Heartbeat Wiring | 2 (S5, S6) | ✅ COMPLIANT |
| WD4 | Journal Replay Safety | 1 (S7) | ✅ COMPLIANT |
| WD5 | Failure Settlement Controls Cursor Progress | 2 (S8, S9) | ✅ COMPLIANT |
| WD6 | Crash-Recovery Non-Guarantee | 1 (S10) | ✅ COMPLIANT |
| WL1 | Tenant-Scoped Actionable Work Selection | 3 (S1–S3) | ✅ COMPLIANT |

**Total**: 7/7 requirements, 13/13 scenarios compliant.

## Verification Verdict

**PASS** — zero blockers, zero critical findings, zero warnings. All 7 requirements and 13 scenarios covered by passing runtime tests.

### Test Results

- **Sequential full suite**: **1071 passed, 6 skipped** (live PG reachable) — all quality stages green.
- **Quality stages**: format-check ✅, typecheck ✅, build ✅, lint ✅ — all green. `pnpm check` exit 0.
- **Related changed tests**: 12 files, 284 tests passed.
- **Live PostgreSQL**: 2 files, 44 tests passed sequentially.

### Warnings

None.

## Correctness Verified

| Invariant | Result |
|-----------|--------|
| Deterministic dispatch identity (delimiter guard) | ✅ Keys test 13/13; both collision vectors throw |
| One oldest-first cycle per activation | ✅ dispatch.ts selects index 0; empty queue returns before worker |
| Non-invasive heartbeat wiring (byte-identity) | ✅ 8 protected files byte-identical to baseline |
| Journal replay safety (UNIQUE constraint) | ✅ Re-activation replays once |
| Typed failures settle / thrown errors propagate | ✅ Policy table in dispatch.ts; no catch around runWorker |
| Crash-recovery non-guarantee tested | ✅ Orphaned in_progress excluded, not auto-resumed |
| Tenant-scoped actionable selection | ✅ In-memory + PG parity; empty scope rejects pre-read |
| Business-domain purity (zero @io/* imports) | ✅ Import scan returned no matches |
| openai confined to deepseek-client.ts | ✅ Only production import match is llm-client/src/deepseek-client.ts |
| No new runtime dependencies | ✅ Manifest/lockfile diff exited 0 |
| Cursor writes remain supervisor-only | ✅ Only tick.ts:38 writes cursors |
| Heartbeat evaluation remains read-only | ✅ Protected heartbeat/supervisor files byte-identical |

## Task Completion

All 13 tasks complete (PR1: 1.1–1.6; PR2: 2.1–2.7). Tasks artifact shows all checkboxes checked.

## Source of Truth Updated

- `openspec/specs/work-dispatch/spec.md` — **new** canonical capability spec (6 requirements, 10 scenarios)
- `openspec/specs/work-lifecycle/spec.md` — **modified** (1 new requirement added: Tenant-Scoped Actionable Work Selection, +3 scenarios)

## Documented Scope Gap — Crash Recovery

The crash-recovery non-guarantee is intentional and tested: a post-claim failure may leave excluded `in_progress` Work orphaned until a separate recovery capability exists. `FileDocumentSandbox` lacks `snapshotUndoLog`, so automatic resumption cannot be implemented without a new foundation. Supervisor-driven `recoverInFlightWork` is deferred follow-up work. This is NOT a verification blocker — the requirement explicitly states the non-guarantee and the implementation conforms.

## Follow-Ups

1. **Crash recovery** — Implement `recoverInFlightWork` when `FileDocumentSandbox.snapshotUndoLog` becomes available. Until then, orphaned `in_progress` Work must be detected manually and re-enqueued.
2. **Formal TDD-table traceability** — Not all 13 tasks have complete formal RED→GREEN tables; narrative claims are backed by real passing tests. Consider completing formal tables in a cleanup pass.

## Engram Observations (Traceability)

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Exploration | pending | `sdd/work-dispatch/explore` |
| Proposal | pending | `sdd/work-dispatch/proposal` |
| Spec (delta) | pending | `sdd/work-dispatch/spec` |
| Design | pending | `sdd/work-dispatch/design` |
| Tasks | pending | `sdd/work-dispatch/tasks` |
| Apply Progress | pending | `sdd/work-dispatch/apply-progress` |
| Verify Report | pending | `sdd/work-dispatch/verify-report` |
| Archive Report | pending | `sdd/work-dispatch/archive-report` |

## Files Changed (Implementation)

See PR commits:
- PR1 `1339791`: business-domain + database foundation — ACTIONABLE_WORK_STATES, WorkRepository port/fake/PG, migration 009 (idx_work_company_state), parity + live-PG roundtrip
- PR2 `65f1a04`: app dispatch module + composition wiring — dispatch/keys.ts, dispatch/types.ts, dispatch/dispatch.ts, composition/supervisor-dispatch.ts
- Remediation `4be8d9b`: delimiter guard in dispatch idempotency key components — reject `:` in companyId/workId

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/work-dispatch/spec.md` (delta) ✅
- `specs/work-lifecycle/spec.md` (delta) ✅
- `design.md` ✅
- `tasks.md` ✅ (13/13 tasks complete)
- `apply-progress.md` ✅
- `verify-report.md` ✅
