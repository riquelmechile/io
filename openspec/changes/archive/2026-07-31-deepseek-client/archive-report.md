# Change Archived: deepseek-client

- **Change**: deepseek-client
- **Project**: io
- **Mode**: hybrid (engram + openspec)
- **Date archived**: 2026-07-31
- **Archived to**: `openspec/changes/archive/2026-07-31-deepseek-client/`
- **Engram verify-report**: `sdd/deepseek-client/verify-report` (obs-5772)

## Final State

The change is COMPLETE at close: implemented, verified PASS, spec synced, folder archived. No stale claims carried forward — `verify-report` and the persisted `tasks.md` agree (20/20 tasks checked, 7/7 requirements, 12/12 scenarios, 0 critical).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| llm-client-port | Created (new) | Main spec did not exist; delta spec copied directly to `openspec/specs/llm-client-port/spec.md` (7 requirements, 12 scenarios) |

No merge conflicts — this was a brand-new capability spec, so the delta IS the full spec.

## Archive Contents

- proposal.md — intent, scope, approach, rollback
- exploration.md — pre-commit exploration (model selection, thinking mode, error model)
- specs/llm-client-port/spec.md — 7 requirements, 12 Given/When/Then scenarios
- design.md — technical approach, 6 architecture decisions, data flow, file changes
- tasks.md — 20/20 tasks complete (all `[x]`, 0 unchecked)
- verify-report.md — validated PASS (gentle-ai sdd-verify-validate: valid:true)

## Task Completion Gate

PASS — all 20 implementation tasks checked (`- [x]`) in the persisted `tasks.md`. No unchecked tasks. No exceptional stale-checkbox reconciliation was needed.

## Verify Report (terminal authority for this cycle)

- **Verdict**: PASS
- **Requirements**: 7/7 | **Scenarios**: 12/12
- **Build**: `pnpm build` exit 0 (tsc strict, clean)
- **Tests**: `pnpm test` exit 0 — 411 passed, 20 skipped (integration self-skips without `DEEPSEEK_API_KEY`)
- **Boundary**: `openai` confined to exactly `src/deepseek-client.ts`; port `llm-client.ts` has zero runtime imports
- **Critical/Warning/Suggestion**: 0 / 0 / 0

## Source of Truth Updated

The following spec now reflects the shipped behavior:
- `openspec/specs/llm-client-port/spec.md` — the canonical `LlmClient` port contract

## Implementation Summary

`packages/llm-client/` ships:
- `src/llm-client.ts` — pure async `LlmClient` port (zero SDK imports) + all types (`LlmModel`, `LlmRequest`, `LlmResponse`, `LlmUsage`, `LlmError`)
- `src/cost.ts` — pure `computeCost(usage, model)` with per-model pricing table (Flash: 0.0028/0.14/0.28; Pro: 0.003625/0.435/0.87 per 1M)
- `src/deepseek-client.ts` — `DeepSeekClient` adapter over `openai` SDK (lazy client, `complete()` mapping, thinking/reasoning_content passthrough, `LlmError` classification §9.8, `close()` off-port)
- `src/fakes.ts` — `FakeLlmClient` (canned responses, preserves reasoningContent, records calls)
- `src/disclosure.ts` — honest non-real-LLM disclosure
- `src/index.ts` — public surface exports

## SDD Cycle Complete

The change has been fully explored, proposed, specified, designed, task-planned, implemented (TDD), verified, and archived. Ready for the next change.
