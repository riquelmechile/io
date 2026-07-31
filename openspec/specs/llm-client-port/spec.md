# llm-client-port Specification

## Purpose

Injectable ASYNC `LlmClient` port plus the DeepSeek V4 adapter and in-memory fake, in `packages/llm-client/`. The port is pure (zero SDK imports, `import type` erased by tsc), mirroring `db-connection-port`. A single async `complete()` seam exposes DeepSeek V4 chat completions — model selection, thinking mode (`reasoning_content`), tool calls, cache-cohort `user` — over the `openai` SDK. A pure `computeCost` turns cache hit/miss tokens into USD. A fake enables unit testing without network or API key.

## Requirements

### Requirement: LlmClient Port Purity

The package MUST define a `LlmClient` port with exactly one operation: `complete(request)` -> `Promise<LlmResponse>`. The port MUST be ASYNCHRONOUS (return `Promise`). The port interface module MUST NOT import any LLM SDK (`openai`, `anthropic`, etc.), HTTP/network, or filesystem module — it carries zero SDK/driver types and zero table/schema or API-shape knowledge beyond the abstract request/response types. [INF]

#### Scenario: Asynchronous complete

- GIVEN any `LlmClient` implementation
- WHEN `complete(request)` is called
- THEN it MUST return a `Promise` resolving to `LlmResponse` (no synchronous return)

#### Scenario: No SDK imports or driver coupling

- GIVEN the `llm-client.ts` interface module
- WHEN its imports and surface are inspected
- THEN it MUST NOT import `openai`/SDK/HTTP/network and MUST expose only abstract request/response types

### Requirement: complete() Returns Content, Usage, and Model

`complete()` MUST resolve an `LlmResponse` carrying `content` (string), a `usage` object (all four cache/token fields per design), and the `model` that served the request. Optional `reasoningContent` and `toolCalls` MUST be surfaced when present. [INF]

#### Scenario: Response carries content, usage, model

- GIVEN a `complete()` call succeeds
- WHEN the resolved response is inspected
- THEN it MUST expose non-empty `content`, a `usage` object with all four token fields, and the `model` used

### Requirement: Thinking Mode Passes reasoning_content Through

When `thinking.type` is `'enabled'`, the adapter MUST enable DeepSeek thinking mode and the response MUST surface `reasoningContent` (chain-of-thought). When `tools` are present, prior-turn `reasoningContent` MUST be carried in subsequent request messages or the API returns 400. [INF]

#### Scenario: Thinking response surfaces reasoningContent

- GIVEN a request with `thinking: { type: 'enabled' }`
- WHEN the response resolves
- THEN `reasoningContent` MUST be present on the response when the API returns it

#### Scenario: reasoningContent multi-turn passthrough with tools

- GIVEN a request that includes `tools` and a prior assistant `reasoningContent`
- WHEN `complete()` is called
- THEN the prior `reasoningContent` MUST be forwarded to the API (no 400 dropped-chain error)

### Requirement: Model Selection Maps to API Model

`LlmModel` MUST be `'deepseek-v4-flash' | 'deepseek-v4-pro'`. The adapter MUST forward the selected model string verbatim to the API `model` field. [INF]

#### Scenario: Flash and Pro map correctly

- GIVEN requests selecting `deepseek-v4-flash` and `deepseek-v4-pro`
- WHEN each is sent through the adapter
- THEN each MUST target the corresponding model on the API and the response `model` MUST echo the requested model

### Requirement: Cost Computation From Usage Tokens

A pure `computeCost(usage, model)` MUST compute USD as `Σ(tokens × rate / 1_000_000)` over cache-hit input, cache-miss input, and completion output, using the per-model rates in architecture doc §7 (Flash: hit $0.0028, miss $0.14, output $0.28; Pro: hit $0.003625, miss $0.435, output $0.87 per 1M). The function MUST make zero network/API calls. [INF]

#### Scenario: Flash cost from known usage

- GIVEN `computeCost` with Flash usage of 1M cache-miss input + 1M output
- WHEN computed
- THEN the result MUST be `$0.42` (`0.14 + 0.28`)

#### Scenario: Pro cost respects cache hit discount

- GIVEN `computeCost` with Pro usage where input is entirely cache-hit
- WHEN computed
- THEN the input cost MUST use the hit rate (`$0.003625/1M`), NOT the miss rate

### Requirement: LlmError Distinguishes Failed vs Unknown

The adapter MUST throw an `LlmError` with `state: 'failed'` for confirmed server errors / 4xx (excluding timeouts) and `state: 'unknown'` for timeouts and disconnects where success is ambiguous (§9.8: UNKNOWN, not a false failure). Reconciliation is deferred to the worker (Change 3). [INF]

#### Scenario: Timeout classifies as unknown

- GIVEN a request that times out or disconnects mid-flight
- WHEN the adapter throws
- THEN `LlmError.state` MUST be `'unknown'`

#### Scenario: Confirmed API error classifies as failed

- GIVEN a request rejected by the API with a non-timeout error
- WHEN the adapter throws
- THEN `LlmError.state` MUST be `'failed'`

### Requirement: FakeLlmClient Test Double

The package MUST provide a `FakeLlmClient` satisfying the async `LlmClient` port: it returns configurable canned `LlmResponse` values, preserves `reasoningContent`, and records calls for assertions. Its methods MUST return `Promise` using in-memory structures only — no network, no real API, no API key required. [INF]

#### Scenario: Returns canned response without network

- GIVEN a `FakeLlmClient` configured with a canned response
- WHEN `complete()` is awaited
- THEN it MUST resolve the canned response with no network call and record the request

#### Scenario: Honest non-real disclosure

- GIVEN the `FakeLlmClient`
- WHEN classified
- THEN it MUST disclose that it is NOT a real LLM and NOT network-backed
