# Archive Report: heartbeats

**Change**: `heartbeats`
**Date archived**: 2026-08-01
**Status**: PASS WITH WARNINGS (non-blocking)
**Mode**: Hybrid (OpenSpec + Engram)

## Intent

§13.2 gates every model activation behind a deterministic novelty filter that decides `no-llm-heartbeat | activate flash` from facts, never model judgment. This slice ships the pure business-domain rule plus a read-only evaluator seam over the existing BusinessEvent stream.

## Delivery — Two Stacked PRs (Committed & Pushed)

| PR | Scope | Commit | Branch | Status |
|----|-------|--------|--------|--------|
| PR1 | `packages/business-domain` heartbeat module (pure filter) | `b22e8c5` | `business-domain` | ✅ Committed & pushed |
| PR2 | `packages/app` read-only evaluator seam | `fb24258` | `app` (stacked on PR1) | ✅ Committed & pushed |

**HEAD at archive time**: `main@fb24258`

> **Correction of stale metadata**: Both PRs are committed and pushed. The earlier `apply-progress.md` stated PR2 was "uncommitted" — this was a stale process note at the time apply completed. The final state is both commits present at `fb24258`.

## Spec Sync

The delta spec added a **new capability** (`heartbeat`) with 8 requirements and 14 scenarios. No existing capability spec was modified.

| Domain | Action | Details |
|--------|--------|---------|
| `heartbeat` | Created | 8 ADDED requirements → canonical spec at `openspec/specs/heartbeat/spec.md` |

No changes to `business-event`, `worker-cycle`, `context-compiler`, or `skill` specs — verified untouched by this change.

## Requirements & Scenarios

| # | Requirement | Scenarios | Status |
|---|-------------|-----------|--------|
| R1 | Pure Heartbeat Decision | 1 (S1) | ✅ COMPLIANT |
| R2 | Declared Material Event Types | 2 (S2, S3) | ✅ COMPLIANT |
| R3 | Deterministic Novelty Filter | 2 (S4, S5) | ✅ COMPLIANT |
| R4 | Cursor-Defined Novelty | 3 (S6, S7, S8) | ✅ COMPLIANT |
| R5 | No-LLM Decision Guarantee | 1 (S9) | ✅ COMPLIANT |
| R6 | Read-Only Evaluator Seam | 2 (S10, S11) | ✅ COMPLIANT |
| R7 | Tenant-Scoped Evaluation | 2 (S12, S13) | ✅ COMPLIANT |
| R8 | Stable-Prefix Isolation | 1 (S14) | ✅ COMPLIANT |

**Total**: 8/8 requirements, 14/14 scenarios compliant.

## Verification Verdict

**PASS WITH WARNINGS** (non-blocking)

### Test Results

- **Sequential full suite**: 968 passed, 6 skipped (77 files, 974 total tests) — first-run pass, no retry needed.
- **Live-PG heartbeat integration**: 1/1 passed (not skipped). Post-cycle → `{ kind: 'activate', model: 'flash' }`; fresh company → `{ kind: 'no-llm-heartbeat' }`. Live event count unchanged (zero writes proven).
- **Quality stages**: format-check ✅, typecheck ✅, build ✅, lint ✅ — all green.

### Warnings (Non-Blocking)

1. **Pre-existing PG concurrency flake** — documented parallel-race in `business-pg-roundtrip.integration.test.ts` around `idempotency_journal_attempt_id_key`. Not candidate-caused; sequential suite unaffected.
2. **Stale apply-progress metadata** — `apply-progress.md` claimed PR2 was "uncommitted"; corrected here: both PRs are committed at `fb24258`. Process metadata only, no code impact.
3. **Redundant truthiness assertion** — one `expect(world).toBeTruthy()` in inverse-poison test is cosmetic; behavioral and structural companion assertions fully cover R5.

## Carried-Forward Follow-Ups (NOT part of this change)

The following items belong to subsequent slices / future increments and are explicitly out of scope for `heartbeats`:

1. **ACTING on the heartbeat decision** — worker-cycle branching (skip `prepareIntent`/`llm.complete` on `no-llm-heartbeat`), the actual Flash-activation gate, Pro escalation (§13.2/§13.3). NEXT slice.
2. **Timer/scheduler/cadence** — interval/cron/scheduler component; durable-recovery implications.
3. **Cursor persistence** — where the last-seen marker lives (journal? new table? in-memory?).
4. **openspec/config.yaml metadata** — stale fields pending update.
5. **Skill outcome BusinessEvents beyond `work.completed`**.
6. **Learning/promotion** (Increment 8).
7. **Memory OS**.
8. **Extraction of Skill to competency/**.

## Task Completion

All 10 tasks complete (PR1: 1.1–1.6; PR2: 2.1–2.4). Tasks artifact at observation #5928 shows all checkboxes checked.

## Source of Truth Updated

- `openspec/specs/heartbeat/spec.md` — new canonical capability spec (8 requirements, 14 scenarios)

## Engram Observations (Traceability)

| Artifact | Observation ID | Topic Key |
|----------|---------------|-----------|
| Exploration | #5924 | `sdd/heartbeats/explore` |
| Proposal | #5925 | `sdd/heartbeats/proposal` |
| Spec (delta) | #5926 | `sdd/heartbeats/spec` |
| Design | #5927 | `sdd/heartbeats/design` |
| Tasks | #5928 | `sdd/heartbeats/tasks` |
| Apply Progress | #5929 | `sdd/heartbeats/apply-progress` |
| Verify Report | #5932 | `sdd/heartbeats/verify-report` |

## Files Changed (Implementation)

| File | Action | PR |
|------|--------|-----|
| `packages/business-domain/src/heartbeat.ts` | Created | PR1 |
| `packages/business-domain/src/index.ts` | Modified (re-export) | PR1 |
| `packages/business-domain/test/heartbeat.test.ts` | Created | PR1 |
| `packages/app/src/heartbeat/evaluate.ts` | Created | PR2 |
| `packages/app/src/worker/types.ts` | Modified (`WorkerDeps.events`) | PR2 |
| `packages/app/src/composition/worker-deps.ts` | Modified (wiring) | PR2 |
| `packages/app/test/worker-helpers.ts` | Modified (`RecordingEvents.listCalls`) | PR2 |
| `packages/app/test/heartbeat/evaluate.test.ts` | Created | PR2 |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Created | PR2 |
| `packages/app/test/composition/worker-deps.test.ts` | Modified (assert) | PR2 |

## Archive Contents

- `proposal.md` ✅
- `exploration.md` ✅
- `specs/heartbeat/spec.md` (delta) ✅
- `design.md` ✅
- `tasks.md` ✅ (10/10 tasks complete)
- `apply-progress.md` ✅
- `verify-report.md` ✅
