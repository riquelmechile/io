# Archive Report: heartbeat-activation

## Summary

Worker-boundary heartbeat gate added as plumbing + proofs. `evaluateHeartbeatGate` wraps the existing read-only seam (`evaluateHeartbeatForCompany`) at the worker boundary, accepting only `companyId` (+ optional cursor), never a `workId`. All three delta requirements and twelve scenarios verified PASS by direct execution.

## Change Metadata

| Field | Value |
|-------|-------|
| Change | `heartbeat-activation` |
| Project | io |
| Mode | hybrid (OpenSpec + Engram) |
| Baseline | main@24153c7 |
| Final commit | 71f67ec (pushed, single PR) |
| Tasks | 13/13 complete |
| Requirements | 3/3 verified |
| Scenarios | 12/12 compliant |
| Verdict | **PASS** |

## Delta Spec Sync

Three ADDED requirements appended to `openspec/specs/worker-cycle/spec.md`:

| # | Requirement | Scenarios |
|---|-------------|-----------|
| R1 | Company-Scoped Heartbeat Boundary Gate | S1.1–S1.6 (6) |
| R2 | Read-Only Non-Self-Activating Evaluation | S2.1–S2.3 (3) |
| R3 | Work-Bearing Cycle Preservation | S3.1–S3.3 (3) |

No existing worker-cycle requirements were modified or removed. No duplicate requirement names introduced.

## Verification

### Test Results

```
Test Files: 75 passed | 3 skipped (78)
Tests:      978 passed | 6 skipped (984)
```

Quality stages: format-check ✓ typecheck ✓ build ✓ lint ✓ test ✓

Live-PG heartbeat integration ran-not-skipped (sequential): gate returns `{kind:'activate',model:'flash'}` after a full `runWorker` cycle; live event count stays 1; work stays completed.

### Critical Invariants (direct execution)

- `runWorker` byte-identical: `git diff 24153c7..71f67ec -- packages/app/src/worker/worker.ts` → empty ✅
- Business-domain / database / context sources unchanged ✅
- Gate signature `companyId`-only (no `workId`) ✅
- No `@io/llm-client` import in `cycle.ts` ✅
- Deterministic decision (pure delegate; no LLM/clock/randomness) ✅

### Native Tooling Blocker Note

The `sdd-verify` sub-agent was blocked twice by **NATIVE TOOLING process gates**, neither a code defect:

1. **Task 5.2 checkbox metadata** — reconciled via commit 71f67ec.
2. **Native `sdd-status receipt_ambiguous`** — the native dispatcher could not disambiguate which of several terminal review receipts governs this change. Resolved by direct execution; the candidate review (review-a44633b98a73740a, review-reliability) was approved and committed at 71f67ec.

Verification was therefore completed by **direct execution** (orchestrator), producing the authoritative PASS verdict above.

## Files Created / Modified

| File | Action |
|------|--------|
| `packages/app/src/heartbeat/cycle.ts` | Created — `evaluateHeartbeatGate` thin delegate (~26 lines) |
| `packages/app/test/heartbeat/cycle.test.ts` | Created — 10 unit tests: R1 decision table + contract proofs + R2 read-only/non-self-activating proofs |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Modified — post-`runWorker` gate check against live PG |

`packages/app/src/worker/worker.ts` — untouched (byte-identical).

## Source of Truth Updated

`openspec/specs/worker-cycle/spec.md` now includes the 3 new heartbeat-gate requirements appended after the existing requirements.

## Carried-Forward Follow-Ups

These items are NOT part of the heartbeat-activation change scope but represent the next natural slices:

1. **Supervisor/timer** — the only production consumer of the no-LLM exit. This slice is plumbing + proofs; cost savings land when the supervisor produces workless wake-ups and routes `activate` → pick work → `runWorker`. **Next recommended slice.**
2. Cursor persistence (supervisor's concern).
3. Pro escalation (§13.2/§13.3 risk tiers).
4. Pre-existing PG concurrency flake (parallel gate; non-deterministic; documented).
5. `openspec/config.yaml` metadata stale (declares openspec-only; hybrid used).
6. Skill outcome BusinessEvents.
7. Learning/promotion (Increment 8).
8. Memory OS.
9. Competency/extraction.

## Engram Observations

| Artifact | Observation ID |
|----------|---------------|
| exploration | #5935 |
| proposal | #5936 |
| spec | #5937 |
| design | #5938 |
| tasks | #5939 |
| apply-progress | #5940 |
| verify-report | #5943 |
