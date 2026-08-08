# Exploration: Pro Escalation (§13.2/§13.3 risk tiers)

## Current State

**Intended semantics (architecture doc §13, exact):**

§13.2 Heartbeats:
```
evento o timer
→ filtro determinístico
→ ¿existe novedad material?
   no → heartbeat sin LLM
   sí → activar Flash
         → escalar a Pro solo por complejidad/riesgo
```
"Escalar a Pro solo por complejidad/riesgo" — escalate to Pro ONLY for complexity/risk. The deterministic novelty filter decides *whether* to activate; a SECOND deterministic gate decides *which model*: Flash by default, Pro only when the situation's complexity/risk justifies the higher cost.

§13.3 Autoridad proporcional al riesgo:
- The five source-reserved categories (finalidad, capital, límites críticos, acciones irreversibles, modificación constitucional) are ALWAYS critical.
- LLMs provide context but NEVER set the final risk classification.
- Critical/high risk: five distinct principals (proposal, review, approval, execution, verification).
- Medium: proposer/approver/executor/verifier distinct; reviewer may coincide with approver only when policy permits.
- Low: policy may combine functions, but nobody self-approves or self-verifies.
- Any prohibited overlap → `DENY` at action time. Authority denied by default without an explicit, current, command-bound grant.

ADR-0003 (accepted): risk classification is DETERMINISTIC and happens BEFORE authority evaluation. Reserved categories always classify critical and can never be downgraded. Humans may elevate risk class; lowering a machine-determined class requires an explicit, reasoned, auditable human exception. LLM output never produces the final classification.

**What exists in code today:**

- `packages/business-domain/src/heartbeat.ts` — `HeartbeatDecision = { kind:'activate', model:'flash' } | { kind:'no-llm-heartbeat' }`; `evaluateHeartbeat(events, cursor)` pure; `MATERIAL_EVENT_TYPES = ['work.completed']`; `hasMaterialNovelty`; `tailCursor`. The `model: 'flash'` literal is currently DECORATIVE — no consumer reads it.
- `packages/app/src/heartbeat/evaluate.ts` + `cycle.ts` — read-only evaluator seam (`evaluateHeartbeatForCompany`, `evaluateHeartbeatGate`), byte-identical guarantees.
- `packages/app/src/supervisor/tick.ts` — `tickCompany`: gate → `onActivate(companyId)` → cursor upsert. Only `decision.kind` is consumed; `model` is ignored.
- `packages/app/src/dispatch/dispatch.ts` — `dispatchCompanyActivation`: picks oldest actionable Work, runs exactly one `runWorker`. No model parameter.
- `packages/app/src/worker/intent.ts` — `prepareIntent` HARDCODES `model: 'deepseek-v4-flash'` (line 65). This is the only place the LLM model is chosen.
- `packages/llm-client/src/llm-client.ts` — `LlmModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'` — the `pro` model ALREADY EXISTS at the port level, forward-able verbatim to the API.
- `packages/llm-client/src/cost.ts` — `computeCost(usage, model)`; `deepseek-v4-pro` pricing exists: output $0.87/M vs flash $0.28/M (~3.1x); cache-miss input $0.435 vs $0.14 (~3.1x); cache-hit $0.003625 vs $0.0028 (~1.3x).
- `packages/trust-kernel/src/risk.ts` — `classify(action, thresholds): RiskClass` — deterministic risk classification ALREADY EXISTS (pure, thresholds-based, reserved categories → critical). `RiskClass = 'low'|'medium'|'high'|'critical'` (model.ts:94).
- `packages/app/src/worker/authority.ts` — `checkAuthority` hardcodes `risk: 'low'` for SoD. `WORK_EXECUTE_COMMAND = 'work.execute'`. `WorkerPrincipals` = exactly four principals (proposer/approver/executor/verifier), no reviewer.
- `packages/trust-kernel/src/pipeline.ts` — 16-step pipeline: classify BEFORE authority (Step 1), then authority/identity/assignment/bounded-scope/SOD/expiry/action-scope.
- `packages/business-domain/src/types.ts` — `Work` has NO risk field; `BusinessEvent.payload` = terminal-close facts only (workId, state, receiptId, terminalState, evidenceId, attemptId, actor). NO risk/complexity signal in the event stream today.

**What is missing:**
- Any escalation rule or function; the `model` field never flows anywhere.
- Any `pro` selection in `app` or `business-domain` (pro exists only in `llm-client` types/pricing/tests).
- A deterministic risk signal ON the event stream / Work (nothing records risk today; `checkAuthority` hardcodes low).
- A 5th principal (reviewer) for high/critical SoD, and delegation/approvals support for it.

## Affected Areas

- `packages/business-domain/src/heartbeat.ts` — `HeartbeatDecision` model becomes `'flash' | 'pro'`; new pure escalation rule; MODIFIED capability.
- `packages/app/src/worker/intent.ts` — `prepareIntent` gains a model parameter (replaces hardcoded flash).
- `packages/app/src/dispatch/dispatch.ts` + `types.ts` — thread model through dispatch.
- `packages/app/src/worker/types.ts` — `WorkerDeps`/dispatch inputs gain the model (or a model selector).
- `packages/app/src/composition/supervisor-dispatch.ts` + `worker-deps.ts` — wiring the model through.
- `packages/app/src/supervisor/types.ts` + `tick.ts` — `OnActivate`/`tickCompany` surface the decision's model (or dispatch re-derives it).
- `packages/app/src/worker/authority.ts` — UNTOUCHED for the model-tier slice (risk stays low); reviewed later for SoD tiers.
- `packages/trust-kernel/src/risk.ts` — read-only reference; business-domain must NOT import it (zero `@io/*` rule).
- `openspec/specs/heartbeat/spec.md` — R1 decision shape + scenarios MODIFIED; escalation requirement ADDED.
- `openspec/specs/worker-cycle/spec.md` — "Serving model is echoed" + Flash-activation scenarios MODIFIED.
- `openspec/specs/work-dispatch/spec.md` — MAY gain model-threading scenario (MODIFIED or NEW).
- `packages/llm-client` — UNCHANGED (`LlmModel`/`computeCost`/`DeepSeekClient` already support pro).

## Approaches

1. **Pure domain escalation rule only (no threading)** — Extend `HeartbeatDecision.model` to `'flash'|'pro'`; add `evaluateEscalation(events, cursor, thresholds?)` in `business-domain` reading a deterministic `payload.riskClass` fact, defaulting to flash. Tests prove the pro branch with synthetic high-risk events.
   - Pros: Pure, strict-TDD in `business-domain`; zero new deps; keeps heartbeat purity; smallest diff.
   - Cons: The `model` field stays decorative end-to-end — the worker still hardcodes flash, so cost economics are NOT realized. Producer of `riskClass` doesn't exist yet (rule would be dormant in production).
   - Effort: Small (~120–180 lines incl. tests).

2. **Domain rule + full model threading (recommended core)** — Approach 1 PLUS: dispatch/`prepareIntent` receive the chosen model; `tickCompany`/`OnActivate` surface `decision.model`; `LlmModel` mapping `'flash'→'deepseek-v4-flash'`, `'pro'→'deepseek-v4-pro'` at the app boundary. The escalation decision becomes REAL: flash stays the cheap default, pro runs only when the deterministic rule says so.
   - Pros: Makes the §13.2 escalation observable (worker actually calls pro); cost economics become real; complete vertical slice; still no new runtime deps; heartbeat purity untouched (rule reads only events+cursor).
   - Cons: Touches app layer (supervisor types, dispatch, worker, composition) + their tests; `OnActivate` signature change ripples; sits at the 400-line budget → split into 2 chained PRs under `stacked-to-main`.
   - Effort: Medium (~350–500 lines total across 2 chained slices).

3. **Authority-tier SoD escalation (§13.3)** — Introduce risk classification into the worker cycle (`checkAuthority` with real `RiskClass` from Work/delegation), 5th reviewer principal, approvals for high/critical, SoD per tier.
   - Pros: Implements the full §13.3 intent; aligns with ADR-0003.
   - Cons: Requires Work risk field + migration + delegation/approvals + 5th principal + policy; LARGE; touches persistence and the worker's authority core; not needed to make model-tier escalation valuable. Belongs in a LATER slice.
   - Effort: Large (way over 400 lines).

4. **Harden-only (defer everything)** — No code; just document the escalation rule and wait for a risk producer.
   - Pros: Zero risk.
   - Cons: No value delivered; roadmap item stays open.
   - Effort: Trivial but not a slice.

## Recommendation

**Approach 2, delivered as TWO chained stacked PRs (auto-chain, stacked-to-main):**

- **Slice 1 (domain, ~150–220 lines):** `HeartbeatDecision.model: 'flash'|'pro'` + pure escalation rule in `business-domain` (defaults to flash; escalates to pro only when a material event's deterministic `payload.riskClass` ≥ configured threshold, e.g. `high`). Delta spec MODIFIES `heartbeat` R1/R4/R5 scenarios and ADDED escalation requirement. No threading yet — but the type change is the contract the worker will consume.
- **Slice 2 (app threading, ~200–280 lines):** thread `decision.model` through `tickCompany`/`OnActivate` → dispatch → `runWorker` → `prepareIntent`; map tier → `LlmModel` at the boundary; MODIFIED `worker-cycle` + `work-dispatch` scenarios; integration tests with a fake LLM client asserting the requested model.

Each slice stays ≤400 lines. Slice 1 is independently valuable (the rule IS the §13.2 "escalar a Pro solo por complejidad/riesgo" gate and is testable with synthetic events); Slice 2 makes it real.

**Determination:** Pro escalation is a HEARTBEAT/MODEL-SELECTION concern (§13.2) for the first slice. The §13.3 authority-tier SoD is a SEPARATE, later concern: escalating the model for high-risk work must eventually ALSO escalate SoD (5 principals), but the two must NOT be coupled in one slice — the model tier is safe to ship first (pro reasoning never self-classifies risk; the rule is deterministic). The risk SIGNAL PRODUCER (who records `riskClass` — Work field, proposal-time classification, or delegation-based) is a follow-up slice; the rule reads an optional fact and defaults to flash, so absence is cost-safe by design.

The escalation rule MUST reuse the existing deterministic pattern (thresholds + declared facts), NOT the LLM. Per §13.3/ADR-0003, LLMs never set risk class — the rule is pure domain logic over event payload facts only.

## Risks

- **Heartbeat purity (CRITICAL):** `evaluateHeartbeat`/new escalation must remain a pure function of `(events, cursor)` — never clock, LLM, randomness, or generated identifiers (inverse-poison guarantee, spec R4/R5). The rule reads ONLY deterministic payload facts; `occurredAt` must not participate. Type-only change to `HeartbeatDecision` must not smuggle imports into `business-domain` (zero `@io/*`).
- **Cost economics:** pro is ~3.1x flash on output and cache-miss input. Escalation must be conservative (threshold `high`), default flash, and the threshold must be a declared constant so cost stays auditable. Wrong threshold = silent cost blow-up; the rule must be unit-tested for the boundary value.
- **KV-cache:** pro benefits from the same compiled stable prefix (unchanged context-compiler), so cache-hit cost stays low; no context change needed. Do NOT let pro force a different prefix (would break cache economics and byte-stability tests).
- **MATERIAL_EVENT_TYPES interaction:** the escalation signal must be part of MATERIAL event payloads (or a new declared material type), never `heartbeat.decision` (which must remain non-material, per the planned heartbeat-decision-events change — it's OUT of scope here and must NOT renew novelty).
- **No producer yet:** if the first slice ships only the rule, pro is dormant in production (absent risk fact → flash). That is CORRECT cost-safety, not a bug — but the proposal must state it explicitly so reviewers don't expect live pro behavior.
- **SoD/tier drift (§13.3):** high-risk model tier without high-risk SoD (5 principals) is a governance gap. Explicitly OUT of scope for this slice and flagged as the follow-up; the worker's `checkAuthority` stays `risk:'low'` and byte-identical.
- **`OnActivate` signature ripple:** changing the seam signature touches `supervisor/types.ts`, `tick.ts`, `supervisor-dispatch.ts`, daemon wiring + tests. Keep it a backward-compatible optional parameter or a single coherent change inside Slice 2.
- **Spec breakage:** heartbeat spec R1 currently pins `model: 'flash'`; worker-cycle "Serving model is echoed" pins `deepseek-v4-flash` (live E2E default — stays flash, so no live test change needed unless a pro live E2E is added, which is out of scope).

## Scope Boundary (for proposal phase)

### In scope (slice 1 + slice 2)
- `HeartbeatDecision` gains `model: 'pro'` variant + pure escalation rule + exports (MODIFIED `heartbeat`).
- Model threading: supervisor `OnActivate`/`tick` → dispatch → `runWorker` → `prepareIntent` (MODIFIED `worker-cycle`, `work-dispatch`; boundary mapping tier→`LlmModel`).
- Tests: business-domain unit (pure rule, purity assertions), app unit/integration (fake LLM asserts requested model; live E2E default still flash).
- Delta specs: MODIFIED `heartbeat` (R1 shape + scenarios), MODIFIED `worker-cycle` (model echo/activation scenarios), MODIFIED or NEW scenario in `work-dispatch`.

### Out of scope (explicit non-goals)
- §13.3 authority-tier SoD: 5th reviewer principal, per-tier SoD in the worker, approvals for high/critical, Work risk field + migration. (Follow-up slice; keep `checkAuthority` byte-identical.)
- Risk signal PRODUCER (proposal-time risk classification / Work field) — follow-up; rule consumes an optional fact.
- `heartbeat.decision` events (separate blocked change), daemon-lifecycle (blocked), fencing tokens, skill-outcome events, learning/promotion, Memory OS, supervisor recovery.
- New runtime dependencies; `openai` stays confined; `business-domain` zero `@io/*`; `packages/context` deps unchanged.

### Capabilities: MODIFIED vs NEW
- MODIFIED: `heartbeat` (decision shape + escalation rule + scenarios), `worker-cycle` (model threading + echo scenarios), `work-dispatch` (model threading scenario).
- NEW: none (or a single NEW requirement inside `heartbeat` for the escalation rule — no new capability/domain folder).

## Size Estimate

**Small-to-Medium total.** Two chained PRs: Slice 1 ~150–220 lines, Slice 2 ~200–280 lines. Each comfortably ≤400 changed lines; combined ~350–500. Forecast guard: `Decision needed before apply: No` (auto-chain resolves), `Chained PRs recommended: Yes` (2 stacked slices), `400-line budget risk: Low` per slice.

## Ready for Proposal

**Yes.** The orchestrator should tell the user: exploration confirms Pro escalation is first a HEARTBEAT/MODEL-SELECTION concern (§13.2) — a pure escalation rule defaulting to flash and escalating to pro only for deterministic high risk — delivered as two stacked slices (domain rule, then app threading). The §13.3 authority-tier SoD is explicitly deferred to a later slice. Proceed to `propose` for change `pro-escalation`.
