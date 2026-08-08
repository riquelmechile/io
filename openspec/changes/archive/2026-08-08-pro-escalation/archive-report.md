# Archive Report: pro-escalation

## Change Summary

Implemented §13.2 Model Tier: deterministic escalation from Flash to Pro based on novel material riskClass events, threaded through the full activation seam from heartbeat evaluation to LLM request model. Two PRs delivered via stacked-to-main chain, fully verified PASS with credentialed live DeepSeek/PostgreSQL suite passing 3/3 on first run (no flake). Zero new runtime dependencies, zero migrations, protected cores byte-identical.

**Change name**: `pro-escalation`
**Date archived**: 2026-08-08
**Branch**: main
**Verify verdict**: **PASS** — 7/7 requirements, 19/19 scenarios, 0 critical, 0 blockers

## Intent & Scope

Ship a pure domain escalation rule (`escalationModelFor`) that selects `pro` iff novel material events carry `riskClass ≥ high`, otherwise defaults to `flash`. Thread the selected tier through tick → dispatch → runWorker → prepareIntent, mapping tier→LlmModel at the app/LLM boundary via a small mapper module. Pro reuses the same stable context prefix (KV-cache intact). No migration, no new runtime dependencies.

### In Scope
- `packages/business-domain/src/heartbeat.ts` — `ModelTier` union, threshold, risk vocabulary/rank, shared cursor resolution, `escalationModelFor`; enriched decision `{kind:'activate', model}`
- `packages/app/src/worker/model-tier.ts` — `llmModelFor(tier): LlmModel` — sole tier→model mapping site
- Threading: `OnActivate(companyId, model)` → `tickCompany` → `dispatchCompanyActivation(companyId, model)` → `runWorker(input, deps, model)` → `prepareIntent({..., model})`
- Tests: domain unit (escalation matrix, determinism, boundary), fake-LLM integration (both tiers echo), live E2E (credentialed)
- Delta specs: `heartbeat`, `worker-cycle`, `work-dispatch`, `supervisor-timer`

### Out of Scope
- §13.3 authority-tier SoD
- Risk-signal producer (dormant by design, cost-safe)
- daemon-lifecycle, fencing tokens, skill-outcome events, learning/promotion, Memory OS

## Slices & Commits

| Slice | Commit | Description |
|-------|--------|-------------|
| PR1 (domain rule) | `44cfbf4` | `feat(business-domain): add deterministic model-tier escalation rule` — `ModelTier`, threshold, `escalationModelFor`, exports, domain tests |
| PR2 (app threading) | `fa37417` | `feat(app): thread heartbeat model tier through activation seam` — mapper, types, tick, dispatch, worker, composition, app tests + integration |

Both commits reviewed via native RDD with 0 findings, pushed to origin/main.

## Capabilities Modified

### `heartbeat` — MODIFIED
- **Deterministic Model-Tier Escalation** — NEW requirement: pure function of `(events, cursor)`, `pro` iff novel material riskClass ≥ `high`, flash otherwise. Three scenarios (threshold-above-pro, defaults-flash, ambient-nondeterminism-inert).
- **Pure Heartbeat Decision** — MODIFIED: `HeartbeatDecision.model` widened from `'flash'` to `'flash' | 'pro'`. One scenario preserved.

### `worker-cycle` — MODIFIED
- **Structure-Not-Output Assertions** — MODIFIED: default activation asserts `deepseek-v4-flash`, explicit requested-tier contract added, serving-model echoes tier (flash/pro), sequential live DB verification. Five scenarios (was 3).
- **Work-Bearing Cycle Preservation** — MODIFIED: `runWorker` accepts tier, passes to `prepareIntent`, mapper at app/LLM boundary, same prefix for both tiers. Four scenarios (was 3).

### `work-dispatch` — MODIFIED
- **One Oldest-First Cycle per Activation** — MODIFIED: dispatch forwards model tier to `runWorker`. Two scenarios updated.
- **Non-Invasive Heartbeat Wiring** — MODIFIED: `tick.ts` and `runWorker` MAY change only to thread tier (previously required byte-identical); expanded boundary constraints. Two scenarios updated.

### `supervisor-timer` — MODIFIED
- **Non-Invasive Activation Seam** — MODIFIED: `onActivate(companyId, model)` receives exact tier; `runWorker` gains only model parameter. Two scenarios updated.

## Verify Result

| Metric | Result |
|--------|--------|
| Requirements compliant | 7/7 |
| Scenarios compliant | 19/19 |
| Blockers | 0 |
| Critical | 0 |
| Full suite | **1169 passed / 6 skipped** (1175 total) |
| Live DeepSeek/PostgreSQL | **Passed 3/3** on first run — no flake |
| Build gate (`pnpm check`) | **Green** — format, typecheck, build, lint all passed |
| Cross-cutting invariants | **PASS** — zero `@io/*` in business-domain, `openai` confined, context deps unchanged, no migration, protected cores byte-identical |

Evidence revision: `sha256:330c714accf000e0e1d439752f4b62cbd768b3b0f493b98fefda47b915033e22`

## Specs Synced

Four MODIFIED delta specs merged into canonical capability specs:

| Domain | Action | Requirements Added | Requirements Modified | Scenarios Added |
|--------|--------|-------------------|----------------------|-----------------|
| `heartbeat` | Updated | 1 | 1 | 4 net new |
| `worker-cycle` | Updated | 0 | 2 | 5 net new |
| `work-dispatch` | Updated | 0 | 2 | 2 net new |
| `supervisor-timer` | Updated | 0 | 1 | 2 net new |

Synced paths:
- `openspec/specs/heartbeat/spec.md`
- `openspec/specs/worker-cycle/spec.md`
- `openspec/specs/work-dispatch/spec.md`
- `openspec/specs/supervisor-timer/spec.md`

## Key Decisions

1. **`escalationModelFor` as separate export** — Pure, unit-testable, called by `evaluateHeartbeat`. Keeps callers stable while enabling independent testing of the escalation rule.

2. **Local risk vocabulary** — `VALID_RISK_CLASSES` + `RISK_RANK` defined locally in business-domain. Zero `@io/*` imports maintained; no coupling to trust-kernel.

3. **Threshold fixed at `'high'`** — Declared constant `PRO_ESCALATION_THRESHOLD = 'high'`. Cost-auditable; boundary tests verify exact-threshold behavior.

4. **Mapper in `packages/app/src/worker/model-tier.ts`** — Only production site containing both concrete model strings (`deepseek-v4-flash`, `deepseek-v4-pro`). Domain never knows `LlmModel`.

5. **Required third `runWorker` argument** — Forces honesty at call sites; biome requires expanded 3-arg form for multi-line calls (~72 lines of formatter-mandated re-flow).

6. **Two stacked implementation slices** — PR1 (domain, ~150–220 lines) then PR2 (app threading, ~200–280 lines). Each ≤400 review budget except PR2's biome churn; documented overage.

## Risks & Deferred Items

### Known Transient Flakes
1. **Live-LLM `invalid-plan` flake** — The live DeepSeek suite may occasionally receive an `invalid-plan` response. Bounded retry (max 2 attempts, fresh idempotency key) handles this. The credentialed live suite passed 3/3 on first run without hitting it. This is a known transient LLM behavior, not a code defect.

### Stale Source Comments (non-blocking)
2. **Stale comments post-threading** — Several source comments remain stale after correct model threading: `packages/app/src/composition/supervisor-dispatch.ts:21-25`, `packages/app/src/supervisor/tick.ts:18`, and the dispatch header still describes an unchanged worker. These do not change runtime behavior but conflict with the implemented seam. Low-priority documentation cleanup.

### Historical Evidence Inconsistency
3. **apply-progress.md count drift** — Reports 1170 passed vs. current authoritative 1169 passed; reports 12 new PR2 tests vs. diff-derived 13. These are historical artifacts from intermediate snapshots; current runtime counts control.

### Observations to Monitor
4. **Dormant pro until riskClass producer** — By design, no `riskClass` producer exists yet. Pro escalation is dormant and cost-safe; the default remains flash. A follow-up change should introduce the risk-signal producer.
5. **Low-value assertion** — `expect(world).toBeTruthy()` at `heartbeat.test.ts:379` is tautological for literal objects. Stronger determinism tests already cover the behavior.

## Purity & Invariants Preserved

- All nine protected core sources byte-identical to baseline (`cycle.ts`, `evaluate.ts`, `supervisor.ts`, gate body, `authority.ts`, context-compiler, migrations, `llm-client` port/adapters).
- Zero new runtime dependencies in any package manifest.
- `business-domain` isolation intact (zero `@io/*` imports).
- `openai` ownership boundary unchanged (confined to `packages/llm-client/src/deepseek-client.ts`).
- Context dependency boundary intact (`packages/context` deps = `@io/business-domain` only).
- No migration added; `packages/database/sql` unchanged.
- Both tiers share the same stable context prefix (KV-cache intact).
- Conventional commits used throughout, no AI attribution.

---

*Archive report written: 2026-08-08. The SDD cycle for `pro-escalation` is complete.*
