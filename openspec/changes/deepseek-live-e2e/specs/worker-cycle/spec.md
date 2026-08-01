# Delta for worker-cycle

## ADDED Requirements

### Requirement: Production Composition Root

`buildWorkerDeps` MUST assemble PostgreSQL adapters, `connection`, sandbox, injected `LlmClient`, and a transaction-scoped `repositories` factory. The factory MUST mirror `completeWorkAtomically` so finalize T1 remains atomic. [INF]

#### Scenario: Wired worker finalizes atomically

- GIVEN dependencies built with PostgreSQL
- WHEN the worker runs through finalize
- THEN journal completion, Work CAS, and the single receipt MUST commit atomically

#### Scenario: LLM client remains injectable

- GIVEN a fake or real `LlmClient`
- WHEN `buildWorkerDeps` assembles dependencies
- THEN the supplied client MUST be used

### Requirement: Real-Model Live End-to-End Verification

A live E2E MUST run claim → authority → intent via real `DeepSeekClient.complete` → effect → reconcile → verify → atomic finalize against `deepseek-v4-flash` and live PostgreSQL. Context MUST produce a `parseLlmPlan`-valid `create-document` plan. [REQ]

#### Scenario: Real model produces an actionable plan

- GIVEN both gates and seeded Work
- WHEN compiled context is completed by the real model
- THEN the plan MUST contain `create-document` with non-empty `relativePath` and string `content`

#### Scenario: Full cycle reaches a reversible terminal outcome

- GIVEN a valid plan and PostgreSQL
- WHEN the full cycle completes
- THEN Work MUST be `completed`, exactly one `business_receipt` MUST exist, and the journal MUST be `completed`
- AND the sandbox effect MUST be applied and reversible

### Requirement: Cost-Safe Double Gate

The live E2E MUST require `DEEPSEEK_API_KEY` AND `IO_LIVE_LLM === '1'`; otherwise it MUST skip before model invocation. The secret MUST NOT be printed. [REQ]

#### Scenario: Both gates permit execution

- GIVEN the key exists and `IO_LIVE_LLM` equals `1`
- WHEN the live suite is evaluated
- THEN the live E2E MUST run

#### Scenario: Explicit opt-in is absent

- GIVEN the key exists but `IO_LIVE_LLM` is not `1`
- WHEN the live suite is evaluated
- THEN it MUST skip without invoking the real model

#### Scenario: API key is absent

- GIVEN `DEEPSEEK_API_KEY` is absent
- WHEN a plain test or CI run evaluates the suite
- THEN it MUST skip without invoking the real model

### Requirement: Structure-Not-Output Assertions

The live E2E MUST assert terminal structure, one receipt, completed journal, model echo, cache fields, and prompt accounting. It MUST NOT assert exact generated output. [REQ]

#### Scenario: Serving model is echoed

- GIVEN a live completion
- WHEN its response is inspected
- THEN `model` MUST equal `deepseek-v4-flash`

#### Scenario: Cache structure is asserted

- GIVEN a live completion
- WHEN usage is inspected
- THEN cache-hit and cache-miss fields MUST be present

#### Scenario: Generated output remains unconstrained

- GIVEN a valid terminal run
- WHEN assertions evaluate generated plan data
- THEN they MUST NOT require an exact path, content, or plan

### Requirement: Bounded Reliability Retry

The live E2E MAY retry only `invalid-plan`, MUST use a fresh idempotency key, and MUST stop after two attempts. Retry MUST remain test-only. [REQ]

#### Scenario: Invalid first plan retries safely

- GIVEN the first attempt returns `invalid-plan`
- WHEN the live E2E retries
- THEN the retry MUST use a fresh idempotency key

#### Scenario: Retry is bounded

- GIVEN repeated `invalid-plan`
- WHEN two total attempts have run
- THEN no third model completion MUST occur

#### Scenario: Worker behavior remains unchanged

- GIVEN live-E2E retry is required
- WHEN retry ownership is inspected
- THEN retry logic MUST exist only in test code and worker source MUST remain unchanged

### Requirement: KV-Cache Economics Surface

The live run MUST forward derived cohort `user` and surface `promptCacheHitTokens` and `promptCacheMissTokens`. Prompt tokens MUST equal their sum. [REQ]

#### Scenario: Cache accounting reflects the forwarded cohort

- GIVEN context with a derived cohort `user`
- WHEN the real completion returns usage
- THEN cache fields MUST be present and non-negative
- AND request `user` MUST equal the derived cohort
- AND prompt tokens MUST equal hit plus miss tokens
