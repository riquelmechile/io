# Proposal: DeepSeek V4 Client

## Intent

Build a DeepSeek V4 LLM adapter behind a pure hexagonal port (`LlmClient`),
enabling the worker process (Change 3) to reason via `deepseek-v4-flash` /
`deepseek-v4-pro` with thinking mode, tool calls, and cost tracking. This is
Change 2 of 3 for Increment 4's first enterprise vertical.

## Scope

### In Scope
- `LlmClient` port interface + request/response/usage types (pure, zero SDK deps)
- `DeepSeekClient` adapter using the `openai` npm package (`baseURL: https://api.deepseek.com`)
- Model selection: `deepseek-v4-flash` / `deepseek-v4-pro`
- Thinking mode (`reasoning_content` support + multi-turn passthrough)
- Tool calls (OpenAI-compatible function format)
- Cost tracking (cache hit/miss tokens → USD via pure function)
- API key from `DEEPSEEK_API_KEY` env var
- In-memory fake for unit tests
- `LlmError` type with `failed` / `unknown` classification (architecture doc §9.8)

### Out of Scope
- Worker process / orchestration, tool execution (Change 3)
- Streaming responses, UNKNOWN-state reconciliation, KV-cache prefix compilation (Change 3)

## Capabilities

### New Capabilities
- `llm-client-port`: Injectable async `LlmClient` port (pure, zero SDK deps), DeepSeek V4 adapter over the `openai` SDK, model/thinking/tool selection, cost tracking, and in-memory fake. Mirrors the `db-connection-port` pattern.

### Modified Capabilities
- None.

## Approach

New `packages/llm-client/` mirroring `packages/database/`:

- `src/llm-client.ts` — port + types (zero `openai` imports; type-only, erased by tsc)
- `src/deepseek-client.ts` — adapter (`new OpenAI({ baseURL, apiKey })`, lazy client like `PgDbConnection`'s lazy pool)
- `src/fakes.ts` — `InMemoryLlmClient` (canned responses, preserves `reasoningContent`)
- `src/cost.ts` — pure `computeCost(usage, model): number`
- `deepseekApiKey()` reads `DEEPSEEK_API_KEY` (mirrors `pgConnectionString()`); `close()` adapter-only

Strict TDD: port + fake + cost unit-tested; adapter integration-tested against live API when `DEEPSEEK_API_KEY` is set (skipped otherwise, like PG tests).

## Affected Areas

- `packages/llm-client/` (NEW) — port, adapter, fake, cost
- `openai` — new runtime dep of `llm-client` only; root workspace auto-discovers `packages/*` (no edit)

## Risks

- `reasoning_content` forgotten with tools → 400 (Medium) — port surfaces it; fake preserves it; test asserts passthrough
- Exceeds 400-line budget (Low) — split port+fake from adapter if needed
- DeepSeek API shape changes (Low) — adapter isolates SDK; port stays stable

## Rollback Plan

Delete `packages/llm-client/`. No existing package is modified — zero blast radius outside the new package.

## Dependencies

- `openai` npm package (added to `packages/llm-client/package.json` only)
- `DEEPSEEK_API_KEY` env var for integration tests (optional; unit tests use the fake)

## Success Criteria

- [ ] `LlmClient` port imports zero SDK types (tsc + grep verified)
- [ ] `DeepSeekClient` produces correct Flash/Pro responses with thinking + tools
- [ ] `computeCost` returns correct USD from cache hit/miss tokens
- [ ] In-memory fake passes all port contract tests
- [ ] Integration test round-trips against live DeepSeek when key present; skips otherwise
