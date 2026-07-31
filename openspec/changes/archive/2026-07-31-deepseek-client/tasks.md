# Tasks: DeepSeek V4 Client

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | exception-ok |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure port + types + cost + fake | PR 1 | `pnpm --filter @io/llm-client test llm-client-port cost fakes` | N/A — pure/unit, no live service | `packages/llm-client/src/{llm-client,cost,fakes,disclosure}.ts` + tests |
| 2 | DeepSeek adapter + integration | PR 1 | `pnpm --filter @io/llm-client test deepseek-client` | `DEEPSEEK_API_KEY=... pnpm --filter @io/llm-client test deepseek-roundtrip.integration` | `packages/llm-client/src/deepseek-client.ts` + tests |

## Phase 1: Package Scaffold

- [x] 1.1 Create `packages/llm-client/package.json` (`@io/llm-client`, private, `type: module`, runtime dep `openai`, devDep `@types/node`)
- [x] 1.2 Create `packages/llm-client/src/index.ts` (empty public surface, filled in Phase 6)
- [x] 1.3 Add `packages/llm-client/**/*.ts` to root `tsconfig.json` `include`; run `pnpm install`

## Phase 2: Types + Port Interface (TDD)

- [x] 2.1 RED: write `test/llm-client-port.test.ts` — assert async `complete()` return, forbidden SDK/HTTP/network imports (mirror `connection-port.test.ts`), correct port shape
- [x] 2.2 GREEN: create `src/llm-client.ts` with `LlmClient` interface + all types (`LlmModel`, `LlmMessage`, `LlmTool`, `LlmToolCall`, `LlmRequest`, `LlmUsage`, `LlmResponse`, `LlmError`); make tests pass
- [x] 2.3 RED: write `test/llm-error.test.ts` — assert `LlmError` carries `state: 'failed' | 'unknown'` and message
- [x] 2.4 GREEN: add `LlmError` class to `src/llm-client.ts`; make tests pass

## Phase 3: computeCost Pure Function (TDD)

- [x] 3.1 RED: write `test/cost.test.ts` — Flash 1M miss + 1M output = $0.42; Pro all-cache-hit uses hit rate; zero-call; table-driven cases for both models × all token types
- [x] 3.2 GREEN: create `src/cost.ts` with pricing table + `computeCost(usage, model): number`; type-only import from `llm-client.ts`; make tests pass

## Phase 4: FakeLlmClient (TDD)

- [x] 4.1 Create `src/disclosure.ts` with honest non-real-LLM disclosure string
- [x] 4.2 RED: write `test/fakes.test.ts` — returns canned response, preserves `reasoningContent`, records calls, returns Promise, no network
- [x] 4.3 GREEN: create `src/fakes.ts` with `FakeLlmClient implements LlmClient`; make tests pass

## Phase 5: DeepSeekClient Adapter (TDD — mocked openai)

- [x] 5.1 RED: write `test/deepseek-client.test.ts` — lazy client lifecycle, request maps `model`/`messages`/`thinking`/`reasoningEffort`/`tools`/`user` to `chat.completions.create`, response maps to `LlmResponse` (content, reasoningContent, toolCalls, usage), `deepseekApiKey()` env-first, timeout → `LlmError('unknown')`, 4xx → `LlmError('failed')`, `close()` ends client (not on port)
- [x] 5.2 GREEN: create `src/deepseek-client.ts` (`DeepSeekClient implements LlmClient`, lazy `new OpenAI`, `complete()` mapping, `deepseekApiKey()`, `close()`); make tests pass
- [x] 5.3 RED: write `test/boundary.test.ts` — assert `openai` imported by exactly one src file (`deepseek-client.ts`); port stays driver-free (mirror `boundary.test.ts`)
- [x] 5.4 GREEN: ensure boundary holds; make tests pass

## Phase 6: Integration Test + Public Surface

- [x] 6.1 RED: write `test/deepseek-roundtrip.integration.test.ts` — live round-trip with thinking + tools; `skipIf` no `DEEPSEEK_API_KEY` (mirror `pg-roundtrip.integration.test.ts`)
- [x] 6.2 GREEN: confirm integration passes when key present, skips otherwise
- [x] 6.3 Fill `src/index.ts` public surface (`LlmClient` type, `DeepSeekClient`, `computeCost`, `FakeLlmClient`, `LlmError`, types, disclosure)
- [x] 6.4 Run `pnpm check` (tsc strict + biome + vitest) to confirm all gates GREEN
