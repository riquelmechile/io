# Delta for worker-cycle

## MODIFIED Requirements

### Requirement: Structure-Not-Output Assertions

The live E2E MUST assert terminal structure, one receipt, completed journal, requested-model echo, cache fields, and prompt accounting. Its default activation MUST request and echo `deepseek-v4-flash`. It MUST NOT assert exact generated output. Verification MUST use strict TDD via `PATH=/data/node24/bin:$PATH pnpm test`; live PostgreSQL tests MUST run sequentially via `pnpm vitest run --no-file-parallelism`. [REQ]

(Previously: Model echo was fixed to Flash without an explicit requested-tier contract.)

#### Scenario: Serving model echoes the requested tier
- GIVEN a completion requested with tier `flash` or `pro`
- WHEN its response is inspected
- THEN `model` MUST equal respectively `deepseek-v4-flash` or `deepseek-v4-pro`

#### Scenario: Live default remains Flash
- GIVEN a live completion without a produced Pro risk signal
- WHEN the response is inspected
- THEN `model` MUST equal `deepseek-v4-flash`

#### Scenario: Cache structure is asserted
- GIVEN a live completion
- WHEN usage is inspected
- THEN cache-hit and cache-miss fields MUST be present

#### Scenario: Generated output remains unconstrained
- GIVEN a valid terminal run
- WHEN assertions evaluate generated plan data
- THEN they MUST NOT require an exact path, content, or plan

#### Scenario: Live database verification is sequential
- GIVEN the worker-cycle verification suite
- WHEN live PostgreSQL tests execute
- THEN file parallelism MUST be disabled

### Requirement: Work-Bearing Cycle Preservation

The gate MUST remain outside the work-bearing path. `runWorker` MUST accept the selected tier and pass it unchanged to `prepareIntent`, which MUST map `flash` to `deepseek-v4-flash` and `pro` to `deepseek-v4-pro` at the app/LLM boundary. `business-domain` MUST NOT import `LlmModel`. Both tiers MUST use the SAME stable compiled context prefix. Apart from the model parameter, terminal-close, replay, and idempotency behavior MUST remain unchanged.

(Previously: `runWorker` was byte-identical and no model tier reached `prepareIntent`.)

#### Scenario: Work-bearing cycle bypasses the gate
- GIVEN actionable Work and a selected model tier
- WHEN `runWorker` executes
- THEN it MUST activate without evaluating the heartbeat boundary gate

#### Scenario: Selected tier reaches intent unchanged
- GIVEN `pro` was selected
- WHEN `runWorker` prepares intent
- THEN the request MUST use `deepseek-v4-pro` and the existing stable prefix

#### Scenario: Full cycle retains terminal close
- GIVEN a valid Work cycle with terminal dependencies
- WHEN `runWorker` completes successfully
- THEN CAS, one receipt, journal completion, and exactly one `work.completed` MUST commit as before

#### Scenario: Replay remains idempotent
- GIVEN closed Work replayed with the same idempotency key and request hash
- WHEN the cycle is replayed
- THEN it MUST return the recorded result without another effect, receipt, or `work.completed`
