# Delta for supervisor-timer

## MODIFIED Requirements

### Requirement: Non-Invasive Activation Seam

`onActivate(companyId, model)` MUST remain injectable and MAY be a recorded no-op. On `activate`, the supervisor MUST pass the exact heartbeat-selected tier through the seam to dispatch and `runWorker`; `runWorker` MAY gain only that model parameter. Decision-event appends and cursor writes MUST remain supervisor-owned and decision appends MUST occur only in the supervisor tick. `cycle.ts`, `evaluate.ts`, and the read-only gate MUST remain byte-identical.

(Previously: The post-heartbeat seam appended decisions but did not thread a model tier, and `runWorker` was byte-identical.)

#### Scenario: Recorded no-op receives the selected model
- GIVEN an activation callback that only records its arguments
- WHEN the gate activates with model `pro`
- THEN the callback MUST receive the company and `pro` without starting Work

#### Scenario: Existing paths preserve composed boundaries
- GIVEN decision-event emission and model threading are present
- WHEN sources are compared with their baselines
- THEN `cycle.ts`, `evaluate.ts`, and the gate MUST be byte-identical
- AND `runWorker` MUST differ only by model-parameter threading
