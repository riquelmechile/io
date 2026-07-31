/**
 * Asynchronous, driver-free `LlmClient` port (Req: LlmClient Port Purity).
 *
 * This is the injectable seam between the worker process and a real DeepSeek V4
 * chat-completions endpoint. It is ASYNCHRONOUS: the `openai` SDK call is an
 * outbound HTTPS request, so a `Promise` return is the only honest completion
 * contract — a synchronous bridge would lie about completion. Both the in-memory
 * fake and the `DeepSeekClient` adapter resolve a `Promise`.
 *
 * The port carries ZERO provider/transport knowledge: the `openai` SDK, the
 * `api.deepseek.com` baseURL, `Bearer` auth, snake_case API fields
 * (`reasoning_content`, `prompt_tokens`, ...), and the chat-completions path
 * live ONLY in `deepseek-client.ts`. It imports NO SDK, HTTP client, framework,
 * or network module (design D2) and exposes only abstract request/response
 * types. `import type` is erased by tsc, so `packages/app` can import this port
 * at zero runtime SDK cost (proven by `packages/database/src/connection.ts`).
 */

/**
 * DeepSeek V4 model identifiers (Req: Model Selection Maps to API Model). The
 * adapter forwards the selected string verbatim to the API `model` field.
 */
export type LlmModel = 'deepseek-v4-flash' | 'deepseek-v4-pro';

/**
 * Reasoning effort for thinking mode: how much compute the model spends on its
 * chain-of-thought before answering. Mapped to the API `reasoning_effort` field.
 */
export type LlmReasoningEffort = 'low' | 'high' | 'max';

/**
 * One chat message (Req: Thinking Mode Passes reasoning_content Through).
 *
 * `reasoningContent` is the model's chain-of-thought from a PRIOR turn. DeepSeek
 * REQUIRES it to be forwarded on subsequent assistant messages when `tools` are
 * present, or the API returns 400 (dropped-chain error). Surfacing it on the
 * port lets the fake preserve it and the worker replay it verbatim.
 */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Prior-turn chain-of-thought; forwarded as `reasoning_content` (passthrough). */
  readonly reasoningContent?: string;
  /** Assistant tool invocations emitted by the model. */
  readonly toolCalls?: readonly LlmToolCall[];
  /** The tool-call id this result answers (role: 'tool' messages only). */
  readonly toolCallId?: string;
}

/** A function tool the model may invoke (OpenAI-compatible shape). */
export interface LlmTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

/** A tool invocation the model emitted, to be executed by the worker (Change 3). */
export interface LlmToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/**
 * One completion request (Req: complete() Returns Content, Usage, and Model).
 * `user` is the cache cohort identifier (architecture §7.3) and MUST NOT carry
 * PII — it groups requests that share a prompt prefix for KV-cache reuse.
 */
export interface LlmRequest {
  readonly model: LlmModel;
  readonly messages: readonly LlmMessage[];
  /** Enable/disable DeepSeek thinking mode (`reasoning_content`). */
  readonly thinking?: { readonly type: 'enabled' | 'disabled' };
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly tools?: readonly LlmTool[];
  /** Cache cohort; MUST NOT contain PII (§7.3). */
  readonly user?: string;
}

/**
 * Token accounting for one completion (Req: Cost Computation). All four
 * cache/token fields feed the pure `computeCost` so cost is derivable WITHOUT
 * any API/network call.
 */
export interface LlmUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Input tokens served from the KV cache (cheapest rate). */
  readonly promptCacheHitTokens: number;
  /** Input tokens that missed the cache and were re-processed. */
  readonly promptCacheMissTokens: number;
}

/**
 * One completion response (Req: complete() Returns Content, Usage, and Model).
 * `reasoningContent` and `toolCalls` are surfaced only when the model produced
 * them; `usage` and `model` are always present.
 */
export interface LlmResponse {
  readonly model: LlmModel;
  readonly content: string;
  /** Chain-of-thought, present when thinking mode is enabled and the API returns it. */
  readonly reasoningContent?: string;
  readonly toolCalls?: readonly LlmToolCall[];
  readonly usage: LlmUsage;
}

/**
 * Injectable asynchronous LLM client (Req: LlmClient Port Purity). Exactly one
 * operation: `complete()` runs a non-streaming chat completion and resolves the
 * full `LlmResponse`. The worker needs complete reasoning, not progressive
 * output, so streaming is deliberately out of scope.
 */
export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * Adapter failure, classified by ambiguity (Req: LlmError Distinguishes Failed
 * vs Unknown; §9.8).
 *
 * - `state: 'failed'` — a CONFIRMED server rejection (e.g. a 4xx). The request
 *   definitively did NOT succeed, so the worker treats it as a hard failure.
 * - `state: 'unknown'` — a timeout or disconnect where success is ambiguous:
 *   the request may have reached the model before the connection dropped, so a
 *   blind retry could double-charge or duplicate work. Reconciliation is the
 *   worker's responsibility (Change 3), not the adapter's.
 */
export class LlmError extends Error {
  readonly state: 'failed' | 'unknown';

  constructor(state: 'failed' | 'unknown', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
    this.state = state;
  }
}
