# Delta for work-dispatch

## MODIFIED Requirements

### Requirement: One Oldest-First Cycle per Activation

`activate` MUST invoke `runWorker` once for the first actionable Work and MUST pass the activation's model tier unchanged. An empty queue MUST settle without worker or LLM invocation.

(Previously: Dispatch invoked `runWorker` without a model tier.)

#### Scenario: Activation dispatches one oldest Work with its model
- GIVEN multiple accepted Work items and selected tier `pro`
- WHEN activation runs
- THEN exactly one cycle MUST run for the oldest item with model `pro`

#### Scenario: Empty actionable queue is cost-free
- GIVEN no accepted Work
- WHEN activation runs
- THEN it MUST settle with zero worker and LLM invocations

### Requirement: Non-Invasive Heartbeat Wiring

`tickCompany` MUST pass `onActivate(companyId, model)` to `dispatchCompanyActivation(companyId, model)`; `no-llm-heartbeat` MUST NOT dispatch. Cursor and decision-event writes MUST remain supervisor-only and heartbeat evaluation read-only. `supervisor.ts`, `cycle.ts`, `evaluate.ts`, and the gate MUST remain byte-identical; `tick.ts` and `runWorker` MAY change only to thread the tier. Business-domain MUST keep zero `@io/*` imports, `openai` MUST remain confined to `packages/llm-client/src/deepseek-client.ts`, `packages/context` runtime dependencies MUST remain exactly `@io/business-domain`, and no runtime dependency or migration MAY be added.

(Previously: `tick.ts` and `runWorker` were required to remain byte-identical.)

#### Scenario: Heartbeat decline performs no dispatch
- GIVEN a `no-llm-heartbeat` decision
- WHEN the tick runs
- THEN no actionable read, worker cycle, or LLM invocation MUST occur

#### Scenario: Existing boundaries preserve allowed byte changes
- GIVEN model threading is added
- WHEN sources, manifests, and dependency boundaries are inspected
- THEN only `tick.ts` and `runWorker` MAY differ among the named paths
- AND all forbidden-coupling and no-migration constraints MUST hold
