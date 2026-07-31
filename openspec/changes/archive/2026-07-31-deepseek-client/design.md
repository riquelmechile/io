# Design: DeepSeek V4 Client

## Technical Approach

New `packages/llm-client/` mirroring `packages/database/` (port + adapter + fake, driver isolated to one `package.json`, type-only port imports erased by tsc, `close()` adapter-only). The `LlmClient` port is a single async `complete(request)` seam over DeepSeek V4's OpenAI-compatible chat-completions API. A pure `computeCost` turns cache hit/miss tokens into USD with zero API calls. Non-streaming only — the worker needs deterministic complete reasoning.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|----------|--------|----------------------|-----------|
| Port shape | One async method `complete()` | Streaming, multi-method | Mirrors `DbConnection`'s minimal surface; worker needs complete reasoning, not progressive output |
| Port purity | Type-only imports, zero `openai` | Leaking SDK types into port | tsc erases `import type` → port importable by `packages/app` at zero runtime SDK cost (proven by `connection.ts`) |
| SDK isolation | `openai` confined to `deepseek-client.ts` | Inline in port | Boundary test asserts `openai` imported by exactly one file (mirrors `pg` → `pg-connection.ts`) |
| Cost function | Pure `computeCost(usage, model)` in `src/cost.ts` | Inside adapter | Zero deps, fully unit-testable without any API/network call |
| Error model | `LlmError` with `state: 'failed' \| 'unknown'` | Generic `Error` / throw raw | §9.8: timeout/disconnect → UNKNOWN (ambiguous), not a false failure. Reconciliation deferred to Change 3 |
| Fake | `FakeLlmClient`, canned responses | Live calls in unit tests | Unit tests run without network/API key; preserves `reasoningContent` for passthrough tests |

## Data Flow

```
worker ──complete(LlmRequest)──→ LlmClient (port)
                                    │
                    ┌───────────────┴───────────────┐
              FakeLlmClient                 DeepSeekClient (adapter)
              (canned resp)                         │
                                    map req → openai params → client.chat
                                    .completions.create({model,messages,thinking,
                                      reasoning_effort,tools,user})
                                              │
                                    map resp → LlmResponse (content,
                                      reasoningContent, toolCalls, usage)
                                    computeCost(usage, model) → USD (pure)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/llm-client/package.json` | Create | `@io/llm-client`, runtime dep `openai`, devDep `@types/node` |
| `packages/llm-client/src/llm-client.ts` | Create | Port interface `LlmClient` + all types (zero SDK imports) |
| `packages/llm-client/src/cost.ts` | Create | Pure `computeCost(usage, model): number` + pricing table |
| `packages/llm-client/src/deepseek-client.ts` | Create | `DeepSeekClient` adapter over `openai`, lazy client, `deepseekApiKey()`, `close()`, `LlmError` |
| `packages/llm-client/src/fakes.ts` | Create | `FakeLlmClient` — canned responses, preserves `reasoningContent` |
| `packages/llm-client/src/disclosure.ts` | Create | Honest non-real-LLM disclosure string (mirrors `disclosure.ts`) |
| `packages/llm-client/src/index.ts` | Create | Public surface exports |
| `packages/llm-client/test/llm-client-port.test.ts` | Create | Port purity: forbidden imports, async return, zero SDK types |
| `packages/llm-client/test/cost.test.ts` | Create | `computeCost` against pricing table |
| `packages/llm-client/test/fakes.test.ts` | Create | Fake contract: returns canned, preserves reasoningContent |
| `packages/llm-client/test/deepseek-client.test.ts` | Create | Adapter unit tests with mocked `openai` |
| `packages/llm-client/test/boundary.test.ts` | Create | `openai` confined to `deepseek-client.ts` only |
| `packages/llm-client/test/deepseek-roundtrip.integration.test.ts` | Create | Live API round-trip; `skipIf` no `DEEPSEEK_API_KEY` |
| `tsconfig.json` | Modify | Add `packages/llm-client/**/*.ts` to `include` |

## Interfaces / Contracts

```typescript
// src/llm-client.ts — PURE, zero openai imports
export type LlmModel = 'deepseek-v4-flash' | 'deepseek-v4-pro';
export type LlmReasoningEffort = 'low' | 'high' | 'max';

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly reasoningContent?: string;  // multi-turn passthrough (exploration risk #1)
  readonly toolCalls?: readonly LlmToolCall[];
  readonly toolCallId?: string;        // role: 'tool' results
}

export interface LlmTool {
  readonly type: 'function';
  readonly function: { readonly name: string; readonly description: string;
    readonly parameters: Record<string, unknown> };
}
export interface LlmToolCall {
  readonly id: string; readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface LlmRequest {
  readonly model: LlmModel;
  readonly messages: readonly LlmMessage[];
  readonly thinking?: { readonly type: 'enabled' | 'disabled' };
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly tools?: readonly LlmTool[];
  readonly user?: string;  // cache cohort (§7.3); MUST NOT contain PII
}

export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly promptCacheHitTokens: number;
  readonly promptCacheMissTokens: number;
}

export interface LlmResponse {
  readonly model: LlmModel;
  readonly content: string;
  readonly reasoningContent?: string;
  readonly toolCalls?: readonly LlmToolCall[];
  readonly usage: LlmUsage;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(readonly state: 'failed' | 'unknown', message: string,
    options?: { cause?: unknown }) { super(message, options); }
}
```

```typescript
// src/cost.ts — PURE, type-only import from llm-client.ts
export function computeCost(usage: LlmUsage, model: LlmModel): number
// cost = Σ(tokens × rate / 1_000_000) over {cacheHit, cacheMiss, completion}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Port purity (zero SDK imports, async return) | Static source scan (mirror `connection-port.test.ts`) |
| Unit | `computeCost` per pricing table | Pure function, table-driven assertions |
| Unit | `FakeLlmClient` returns canned + preserves reasoningContent | In-memory, no network |
| Unit | `DeepSeekClient` request/response mapping, error classification | `vi.hoisted` + `vi.mock('openai')` (mirror `pg-connection.test.ts`) |
| Integration | Live round-trip with thinking + tools | Real API; `skipIf` no `DEEPSEEK_API_KEY` (mirror `pg-roundtrip.integration.test.ts`) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The adapter makes an outbound HTTPS call to a fixed `baseURL` and throws `LlmError` on failure; it does not execute commands, route, or spawn processes.

## Migration / Rollout

No migration required. Rollback = delete `packages/llm-client/` and revert the one `tsconfig.json` include line. No existing code is modified — zero blast radius outside the new package.

## Open Questions

- [ ] None — exploration and proposal resolved all design questions.
