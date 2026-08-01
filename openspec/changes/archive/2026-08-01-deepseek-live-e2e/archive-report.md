# Archive Report: deepseek-live-e2e

## Change Summary

**Change**: `deepseek-live-e2e` — DeepSeek Live End-to-End Worker Cycle  
**Status**: ARCHIVED  
**Date**: 2026-08-01  
**Store Mode**: Hybrid (filesystem + Engram)

This change implemented Paso 2 of the IO worker-cycle roadmap: production composition root (`buildWorkerDeps`), harness widening for injectable LLM clients, a recording LLM client for test-local response capture, and a double-gated live E2E test against the real DeepSeek V4 model with bounded retry and KV-cache economics surface. The milestone achieved was the first end-to-end worker cycle running against the **real DeepSeek V4 model + live PostgreSQL**.

## Verification Verdict

| Metric | Value |
|---|---:|
| Requirements compliant | 6/6 |
| Scenarios compliant | 14/14 |
| Gate total | 829 passed / 6 skipped |
| Gate exit code | 0 |
| Blockers | 0 |
| Critical findings | 0 |
| Verdict | **PASS** |

Focused live proof: 3/3 passing against real DeepSeek V4 (`deepseek-v4-flash`) + live PostgreSQL (preserved orchestrator final-state evidence).

## Implementation Commits

| Commit | Description | PR |
|--------|-------------|----|
| `b935511` | PR1: Production composition root — `buildWorkerDeps`, harness `LlmClient` widening, `RecordingLlmClient` | PR1 |
| `ff9a670` | PR2: Double-gated live E2E + bounded fresh-key retry helper | PR2 |

Both commits merged to `main`.

## Native Reviews

| Review ID | Lens | Result |
|-----------|------|--------|
| `review-67cbd3eff5a9b88f` | Review reliability (PR1) | APPROVED |
| `review-a8c466e31bce3ec7` | Review reliability (PR2) | APPROVED |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `worker-cycle` | MODIFIED | Appended 6 ADDED requirements to existing spec |

Requirements added:
1. Production Composition Root
2. Real-Model Live End-to-End Verification
3. Cost-Safe Double Gate
4. Structure-Not-Output Assertions
5. Bounded Reliability Retry
6. KV-Cache Economics Surface

Source-of-truth updated: `openspec/specs/worker-cycle/spec.md`

## Milestone Achieved

The full worker cycle runs end-to-end against the **real DeepSeek V4 model** (`deepseek-v4-flash`) and live PostgreSQL. KV-cache economics were confirmed real (hit/miss tokens observed; cohort forwarded). This completes Paso 2 ("DeepSeek live E2E") of the incremental build plan.

## Deferred Follow-ups

1. **Happy-path flakiness**: The live test is single-attempt and can flake against real-model non-determinism (occasional `invalid-plan`). The bounded-retry mechanism itself is proven (Req 5); hardening the happy path with a bounded retry is a future improvement.
2. **Biome warnings**: Three non-blocking import-style warnings in `packages/app/test/e2e/harness.ts`. Clean up during a later non-semantic pass.
3. **Pre-existing PG parallelism flake**: `business-pg-roundtrip` "two concurrent terminal closes" passes sequentially/in isolation. Run the gate with `--no-file-parallelism`.
4. **Transitional `processTokenFor`**: Currently a stand-in (`process <- authorityScope.scope`) until a process-domain package lands.
5. **No production entrypoint yet**: `buildWorkerDeps` is a reusable composition module but there is still no runnable production entrypoint/CLI. Deferred to later Paso 3 productionization.

## Bugs / Findings

No blocking bugs or critical findings. All suggestions are non-blocking.

## Next Steps

Paso 3 continues: BusinessEvent → one skill → heartbeats → roadmap. The composition root established by this change provides the foundation for wiring business-domain skills into the worker cycle.

## Archived Artifacts

| Artifact | Path |
|----------|------|
| exploration.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/exploration.md` |
| proposal.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/proposal.md` |
| design.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/design.md` |
| tasks.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/tasks.md` |
| apply-progress.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/apply-progress.md` |
| verify-report.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/verify-report.md` |
| specs/worker-cycle/spec.md | `openspec/changes/archive/2026-08-01-deepseek-live-e2e/specs/worker-cycle/spec.md` |

## Engram Topics

| Topic | Purpose |
|-------|---------|
| `sdd/deepseek-live-e2e/archive-report` | This archive report |
