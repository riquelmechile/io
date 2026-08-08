# Design: Pro Escalation (§13.2 Model Tier)

## Technical Approach

Make `HeartbeatDecision.model` real: a pure domain escalation rule over novel material `payload.riskClass`, then thread the selected tier through the activation seam to `prepareIntent`, which maps tier→`LlmModel` at the app/LLM boundary. Matches proposal Approach 2 and the 7 requirements / 19 scenarios across `heartbeat`, `worker-cycle`, `work-dispatch`, `supervisor-timer`. Pro reuses the SAME `compileContext` prefix (KV-cache intact). No migration, no new runtime deps.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Rule shape | inside `evaluateHeartbeat` only / separate export | separate is unit-testable; single entry keeps callers stable | **`escalationModelFor` + call from `evaluateHeartbeat`** |
| Risk values | import trust-kernel / local set | zero `@io/*` forbids import | **Local `VALID_RISK_CLASSES` + rank** |
| Threshold | configurable / constant | cost auditability | **`PRO_ESCALATION_THRESHOLD = 'high'`** |
| Mapper home | domain / intent inline / small app module | domain must not know `LlmModel` | **`packages/app/src/worker/model-tier.ts`** |
| `runWorker` model | optional default flash / required 3rd arg | required forces honesty; few call sites | **Required 3rd arg `model: ModelTier`** |
| Delivery | one PR / two stacked | 400-line budget | **PR1 domain, PR2 app thread** |

## Data Flow

```
events+cursor → evaluateHeartbeat
                 ├─ !novelty → { kind:'no-llm-heartbeat' }
                 └─ novelty  → { kind:'activate', model: escalationModelFor(...) }
tickCompany: gate → [decision-event append if present] → onActivate(companyId, model)
  → dispatchCompanyActivation(companyId, deps, model)
  → runWorker(input, deps, model)
  → prepareIntent({ ..., model }) → llmModelFor(model) → LlmRequest.model
  → compileContext (UNCHANGED prefix) → llm.complete
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/business-domain/src/heartbeat.ts` | Modify | `ModelTier`, threshold, `escalationModelFor`, enriched decision |
| `packages/business-domain/src/index.ts` | Modify | Export new symbols |
| `packages/business-domain/test/heartbeat.test.ts` | Modify | Union + escalation scenarios |
| `packages/app/src/worker/model-tier.ts` | Create | `llmModelFor(tier): LlmModel` |
| `packages/app/src/supervisor/types.ts` | Modify | `OnActivate(companyId, model)` |
| `packages/app/src/supervisor/tick.ts` | Modify | Pass `decision.model` into seam |
| `packages/app/src/dispatch/dispatch.ts` | Modify | Accept + forward `model` |
| `packages/app/src/worker/worker.ts` | Modify | 3rd arg → `prepareIntent` |
| `packages/app/src/worker/intent.ts` | Modify | `IntentInput.model`; map via `llmModelFor` |
| `packages/app/src/composition/supervisor-dispatch.ts` | Modify | Close over `(companyId, model)` |
| App unit/integration tests | Modify | Threading + FakeLlm model assert |
| Live E2E | Touch only if needed | Default remains flash echo |

**Byte-identical (must not change):** `cycle.ts`, `evaluate.ts`, `supervisor.ts`, gate body, `authority.ts`, context-compiler, migrations, `llm-client` port/adapters.

## Interfaces / Contracts

```typescript
// packages/business-domain/src/heartbeat.ts
export type ModelTier = 'flash' | 'pro';
export type HeartbeatDecision =
  | { readonly kind: 'activate'; readonly model: ModelTier }
  | { readonly kind: 'no-llm-heartbeat' };

/** Declared threshold — pro iff novel material riskClass rank ≥ this. */
export const PRO_ESCALATION_THRESHOLD = 'high' as const;
export const VALID_RISK_CLASSES = ['low', 'medium', 'high', 'critical'] as const;
type RiskClassFact = (typeof VALID_RISK_CLASSES)[number];
const RISK_RANK: Record<RiskClassFact, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

/** Cursor index: absent→-1; found→i; missing→events.length (same as hasMaterialNovelty). */
function resolveCursorIndex(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): number { /* shared helper used by hasMaterialNovelty + escalationModelFor */ }

/**
 * Pure: pro iff ≥1 novel MATERIAL event has typeof payload.riskClass === 'string'
 * AND value ∈ VALID_RISK_CLASSES AND RISK_RANK[value] ≥ RISK_RANK[PRO_ESCALATION_THRESHOLD].
 * Absent/invalid/non-material/at-or-before-cursor → flash. Never clock/LLM/random.
 */
export function escalationModelFor(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): ModelTier;

export function evaluateHeartbeat(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): HeartbeatDecision {
  if (!hasMaterialNovelty(events, cursor)) return { kind: 'no-llm-heartbeat' };
  return { kind: 'activate', model: escalationModelFor(events, cursor) };
}
```

```typescript
// packages/app — threading
export type OnActivate = (
  companyId: string,
  model: ModelTier,
) => void | Promise<void>;

// tick.ts (activate branch only)
await onActivate?.(companyId, decision.model);

export async function dispatchCompanyActivation(
  companyId: string,
  deps: DispatchDeps,
  model: ModelTier,
): Promise<DispatchResult>;
// → runWorker(command, deps.worker, model)

export async function runWorker(
  input: unknown,
  deps: WorkerDeps,
  model: ModelTier,
): Promise<WorkerResult>;
// → prepareIntent({ ..., model })  // domain tier, not LlmModel

// IntentInput gains: readonly model: ModelTier
// prepareIntent: request.model = llmModelFor(input.model)  // ONLY mapping site
// compileContext args UNCHANGED — same stable prefix for both tiers

// packages/app/src/worker/model-tier.ts
import type { ModelTier } from '@io/business-domain/src/index.js';
import type { LlmModel } from '@io/llm-client/src/index.js';
export function llmModelFor(tier: ModelTier): LlmModel {
  return tier === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
}

// buildSupervisorDispatch
onActivate: async (companyId, model) => {
  await dispatchCompanyActivation(companyId, dispatchDeps, model);
};
```

**Exports (index):** `ModelTier`, `PRO_ESCALATION_THRESHOLD`, `VALID_RISK_CLASSES`, `escalationModelFor`, plus existing heartbeat exports. `business-domain` never imports `LlmModel` / `@io/*`.

**Construction sites for `model`:** only `evaluateHeartbeat` (via `escalationModelFor`). Tests/fixtures that build `{kind:'activate', model:'flash'}` remain valid; pro fixtures added. `heartbeat-decision-events` factory must emit `decision.model` (not hardcoded `'flash'`) when that change lands.

## Testing Strategy

| Req / Scenario | Test | Layer |
|----------------|------|-------|
| Escalation: high/critical → pro | `heartbeat.test.ts` synthetic novel material + riskClass | Domain unit |
| Escalation: low/medium/absent/invalid/non-material/seen → flash | same | Domain unit |
| Escalation: ambient nondeterminism inert | Date/Math spies (extend R3 suite) | Domain unit |
| Pure decision union `'flash'\|'pro'` + zero `@io/*` | type + boundary tests (extend R1/R8) | Domain unit |
| Threshold constant = `'high'` boundary | unit at exact threshold | Domain unit |
| Work-bearing bypasses gate; tier reaches intent | `runWorker(..., 'pro')` + FakeLlm `requests[0].model` | App unit |
| Full cycle terminal close / replay idempotent | existing worker tests + model arg `'flash'` | App unit |
| Dispatch one oldest Work with model | `dispatch.test.ts` records model to runWorker | App unit |
| Empty queue cost-free | existing + model unused | App unit |
| Heartbeat decline no dispatch | supervisor/dispatch tests | App unit |
| Byte-identity allowed set | source inspect (cycle/evaluate/supervisor/gate unchanged) | App unit |
| Recorded no-op receives model | supervisor manual pump records `(companyId, model)` | App unit |
| Serving model echoes tier | FakeLlm integration both tiers | Integration |
| Live default flash | `deepseek-live.integration.test.ts` echo | Live E2E PG |
| Live PG sequential | `--no-file-parallelism` | Live E2E PG |
| Cache structure / unconstrained output | existing live asserts | Live E2E PG |

Runner: `PATH=/data/node24/bin:$PATH pnpm test`. Gate: `PATH=/data/node24/bin:$PATH pnpm check`. Live PG: `pnpm vitest run --no-file-parallelism`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Stacked PRs to main:

- **PR1 (Slice 1, ~150–220):** domain rule + `ModelTier` union + exports + domain tests. Standalone-green; `model` still unused by app.
- **PR2 (Slice 2, ~200–280, stacks on PR1):** types/tick/dispatch/runWorker/intent/mapper/composition + app tests + FakeLlm integration. Direct `runWorker` call sites pass `'flash'`.

## Coordination: `heartbeat-decision-events`

That unapplied change also edits `tick.ts` (append decision event between gate and `onActivate`) and hardcodes `model: 'flash'` in its factory. **Land heartbeat-decision-events first** (per proposal). PR2 then becomes: `onActivate?.(companyId, decision.model)` beside the existing append — no redesign. Factory must switch to `decision.model` once `ModelTier` exists (one-line; either in that change if after PR1, or a tiny follow-up). Identity preimage stays `kind`-only (model does not affect eventId).

## Open Questions

- None blocking. Residual: dormant pro until a `riskClass` producer exists (by design, cost-safe).
