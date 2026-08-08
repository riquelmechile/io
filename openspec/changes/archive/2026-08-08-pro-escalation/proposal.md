# Proposal: Pro Escalation (§13.2 Model Tier)

## Intent

§13.2 mandates a second deterministic gate: Flash by default, Pro only for complexity/risk. Today `prepareIntent` hardcodes `deepseek-v4-flash`; `HeartbeatDecision.model` is decorative.

## Decisions

(a) **Escalation rule** — pure function of `(events, cursor)` in `business-domain`: `pro` iff any novel material event after cursor carries `payload.riskClass` ≥ `PRO_ESCALATION_THRESHOLD='high'`; else `flash`. Absent/invalid fact → `flash` (default-flash). Never reads clock, LLM, or randomness (inverse-poison). No `riskClass` producer yet → dormant, cost-safe.

(b) **Threading** — `OnActivate(companyId, model)` → `tickCompany` → `dispatchCompanyActivation(companyId, model)` → `runWorker(deps, work, model)` → `prepareIntent(..., model)`. Tier→`LlmModel` mapping (`flash→deepseek-v4-flash`, `pro→deepseek-v4-pro`) at the app/llm boundary; `business-domain` never imports `LlmModel`.

(c) **Delivery** — `auto-chain` + `stacked-to-main`: PR1 Slice 1 (~150–220); PR2 stacked on PR1 (~200–280); each ≤400.

## Scope

### In Scope
- `HeartbeatDecision.model: 'flash'|'pro'` + pure escalation rule (MODIFIED `heartbeat`)
- Threading tick→dispatch→runWorker→prepareIntent (MODIFIED `worker-cycle`, `work-dispatch`, `supervisor-timer`)
- Tests: purity unit; fake-LLM asserts requested model; live E2E stays flash

### Out of Scope
- §13.3 authority-tier SoD (5th reviewer principal, per-tier SoD, approvals, Work risk field + migration)
- Risk-signal producer; heartbeat-decision-events; daemon-lifecycle; fencing tokens; skill-outcome events; learning/promotion; Memory OS; competency extraction; supervisor recovery
- New runtime deps; `openai` confinement; `packages/context` deps unchanged

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `heartbeat`: R1 shape `'flash'|'pro'` + ADDED escalation requirement
- `worker-cycle`: model threading + model-echo scenarios
- `work-dispatch`: threading scenario; "Non-Invasive Heartbeat Wiring" byte-identity list updated
- `supervisor-timer`: amend "Non-Invasive Activation Seam" to permit threading model tier through seam + `runWorker` (semantics preserved); byte-identity scenario updated — `cycle.ts`/`evaluate.ts`/gate byte-identical, `runWorker` gains only the model parameter

## Approach

Approach 2: domain rule (PR1), then threading (PR2). Pro reuses the SAME stable prefix — KV-cache intact.

## Affected Areas

- `packages/business-domain/src/heartbeat.ts` — model union + rule
- `packages/app/src/supervisor/{types,tick}.ts` — surface model
- `packages/app/src/dispatch/`, `worker/{intent,types}.ts`, `composition/` — threading

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Governance gap: pro without high-risk SoD | Med | §13.3 deferred; `checkAuthority` stays `risk:'low'` byte-identical |
| Dormancy (no `riskClass` producer yet) | High, by design | Default flash; producer follow-up |
| Cost blow-up via wrong threshold | Low | Declared constant `high`; boundary unit tests |

## Rollback Plan

Revert PR2 → flash hardcoded; revert PR1 → prior type. No migration/state — code revert.

## Dependencies

Sequencing: `heartbeat-decision-events` (also amends `supervisor-timer`) must apply+archive FIRST; this delta amends its post-heartbeat text. Both blocked on the same unrelated tool defect, so ordering holds.

## Success Criteria

- [ ] `pro` only for novel material events with `riskClass ≥ high`; flash otherwise
- [ ] `pnpm check` green; zero `@io/*` in business-domain
- [ ] Fake-LLM asserts requested model; live E2E echoes flash
