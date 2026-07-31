# Exploration: DeepSeek V4 Client (Change 2 of Increment 4)

**Change:** `deepseek-client` · Project: io · Hybrid artifact store

## Current State

IO has completed Increment 4 Change 1 (`domain-foundation`): Company, Delegation,
Work, and BusinessReceipt domain types, lifecycle state machines, async repository
ports, and in-memory fakes now live in `packages/business-domain/` (`@io/business-domain`,
transitional). Four new specs are archived (`company-identity`, `delegation-lifecycle`,
`work-lifecycle`, `business-receipt`). No LLM integration exists yet — the worker process
(Change 3) needs an LLM adapter to reason.

The established hexagonal pattern (proven across Increments 1–3):

- **Port** = pure interface, async (`Promise`-returning), zero driver/SDK imports,
  type-only relative imports erased by `tsc` → zero runtime dependencies.
- **Adapter** = lives in a package whose `package.json` declares the driver
  (`pg` for database). Lazy initialization, env-based config, `close()` on the
  adapter ONLY (never on the port).
- **Fake** = in-memory, map/array-backed, returns `Promise`, carries an honest
  non-durable / non-real disclosure.

Exemplars to mirror:

| Role | Exemplar | Key trait |
|------|----------|-----------|
| Port | `packages/database/src/connection.ts` (`DbConnection`) | two methods, zero deps |
| Adapter | `packages/database/src/pg-connection.ts` (`PgDbConnection`) | lazy pool, `pgConnectionString()` reads env |
| Fake | `packages/database/test/connection-fake.ts` (`InMemoryDbConnection`) | records ops, round-trips data |

## DeepSeek V4 API Findings

Confirmed from api-docs.deepseek.com (fetched 2026-07-31).

- **OpenAI-compatible**: `baseURL: https://api.deepseek.com`. Uses the `openai`
  npm package directly — no proprietary SDK required.
- **Two models**: `deepseek-v4-flash` (1M context, 2500 concurrency) and
  `deepseek-v4-pro` (1M context, 500 concurrency, max output 384K).
- **Chat completions**:
  `client.chat.completions.create({ model, messages, thinking, reasoning_effort, tools, stream, user })`.
- **Thinking mode**: toggle `{ thinking: { type: 'enabled' | 'disabled' } }` plus
  effort `reasoning_effort: 'low' | 'high' | 'max'`. Chain-of-thought is returned
  in `message.reasoning_content` (same level as `content`).
  - **CRITICAL**: when `tools` is present, `reasoning_content` MUST be passed back
    to the API in ALL subsequent turns, or the API returns a **400 error**. Without
    tools, prior-turn `reasoning_content` is silently ignored by the API.
  - Thinking mode does NOT honor `temperature` / `top_p` / sampling params.
  - Effort mapping differs per model (Flash `low→low`; Pro `low→high`).
- **Tool calls**: OpenAI-compatible function format
  `{ type: 'function', function: { name, description, parameters } }`. Response
  carries `message.tool_calls[]`; results fed back as
  `{ role: 'tool', tool_call_id, content }`.
- **KV cache**: automatic prefix reuse (no opt-in). Cache hit is billed ~50×
  cheaper than miss (Flash: hit $0.0028 vs miss $0.14 per 1M). Architecture doc
  §7.2 mandates canonical prefix ordering: 9 stable blocks (protocol →
  constitution → policies → company → role → competencies → skills → process →
  baseline) then 4 dynamic blocks (memory → work → evidence → tool results). No
  dates/IDs/nonces in the prefix.
- **Cost tracking**: response `usage` carries `prompt_tokens`,
  `completion_tokens`, and DeepSeek-specific `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`. Cost = Σ(tokens × rate); a pure function computes
  USD from usage + model with zero API calls.
- **`user` field** enables KV-cache cohort isolation (architecture doc §7.3);
  MUST NOT contain PII.

Pricing per 1M tokens (architecture doc §7):

| Model | Cache hit | Cache miss | Output |
|-------|----------:|-----------:|-------:|
| Flash | $0.0028 | $0.14 | $0.28 |
| Pro | $0.003625 | $0.435 | $0.87 |

## Affected Areas

- `packages/llm-client/` (NEW) — port, adapter, fake, cost function.
- Root workspace — auto-discovers `packages/*` (no `pnpm-workspace.yaml` edit).
- `openspec/specs/llm-client-port/` — new capability spec (post-archive).
- `openspec/changes/deepseek-client/` — this change.

## Approaches

### Approach A: Dedicated `packages/llm-client/` (Recommended)

New package mirroring `packages/database/`: port + adapter + fake co-located.
Port module imports zero SDK types (type-only, erased by tsc). Adapter imports
`openai`.

- **Pros**: exact mirror of the proven database pattern; `openai` isolated to one
  `package.json`; port importable by `packages/app` (worker) with zero runtime
  SDK cost; clean fake for unit tests; `close()` stays adapter-only.
- **Cons**: new package scaffolding (tsconfig, package.json, index.ts).
- **Effort**: Medium (~300–350 lines).

### Approach B: Port in `business-domain`, adapter in a separate package

Port (`LlmClient`) lives with domain types; adapter (`DeepSeekClient`) in
`packages/deepseek/`.

- **Pros**: port co-located with the domain it serves.
- **Cons**: `business-domain` would gain LLM types though it is "pure domain
  objects"; splits port and adapter across packages unlike the database
  precedent; more cross-package coordination.
- **Effort**: Medium-High.

### Approach C: Inline into the worker package

No separate package; LLM code lives in `packages/app`.

- **Pros**: fewer packages.
- **Cons**: violates single responsibility; couples the adapter to orchestration;
  harder to test in isolation; `openai` pollutes the app package.
- **Effort**: Medium but creates debt.

## Recommendation

**Approach A — dedicated `packages/llm-client/`.** It is the faithful mirror of
`packages/database/` (port + adapter + fake, driver isolated to one
`package.json`, type-only port imports erased by tsc, `close()` adapter-only).
Transitional like `business-domain` until the canonical package map (architecture
doc §14) is consolidated.

## Port Interface Design (preliminary)

```
LlmClient.complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>
```

- **Request**: `model` (`'deepseek-v4-flash' | 'deepseek-v4-pro'`), `messages`,
  `thinking` (`enabled`/`disabled`), `reasoningEffort` (`low`/`high`/`max`),
  optional `tools`, optional `user` (cache cohort).
- **Response**: `content`, `reasoningContent?`, `toolCalls?`, `usage`
  (`promptTokens`, `completionTokens`, `promptCacheHitTokens`,
  `promptCacheMissTokens`).
- **Single non-streaming method** — mirrors `DbConnection`'s minimal two-method
  surface. Streaming deferred (the worker needs deterministic, complete
  reasoning, not progressive output).
- **Error handling**: adapter throws a typed `LlmError` with
  `state: 'failed' | 'unknown'` (architecture doc §9.8: timeout/disconnect →
  UNKNOWN, not a false failure). Reconciliation logic is Change 3.
- **Cost**: pure `computeCost(usage, model): number` in the port module (zero
  deps, fully unit-testable without any API call).

## Risks

1. **`reasoning_content` passthrough** — forgetting it with `tools` present → 400
   errors. The port types MUST surface it; the fake MUST preserve it; a test
   MUST assert round-trip passthrough.
2. **Port purity vs DeepSeek specifics** — `reasoning_content`, cache hit/miss
   tokens, and model names are DeepSeek-shaped. Acceptable: the architecture
   explicitly optimizes for DeepSeek (doc §7); types are generic enough to map
   another provider later.
3. **Streaming omission** — non-streaming only. If the worker later needs
   streaming (progressive UI), the port gains a method. Acceptable for the first
   vertical.
4. **UNKNOWN state handling** — timeout/disconnect is ambiguous (the request may
   have succeeded server-side). The adapter classifies; reconciliation is
   deferred to the worker (Change 3). This change defines the error type only.
5. **400-line budget** — port + types + adapter + fake + cost + tests may
   approach it. If exceeded, split into `llm-port` (port + fake + cost, unit) and
   `deepseek-adapter` (adapter, integration).

## Ready for Proposal

**Yes.** Proceed to `sdd-propose` for `deepseek-client`. The proposal should
define:

- **Intent:** DeepSeek V4 LLM adapter behind a pure hexagonal port, enabling the
  worker to reason via Flash/Pro models with thinking mode, tool calls, and cost
  tracking.
- **Scope:** `LlmClient` port + types, `DeepSeekClient` adapter (openai SDK),
  model/thinking/tool selection, cost tracking, in-memory fake. NO worker
  process, NO tool execution, NO streaming.
- **Rollback:** Delete `packages/llm-client/`. No existing code is modified —
  zero blast radius outside the new package.
