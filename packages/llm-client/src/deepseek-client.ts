import OpenAI from 'openai';

import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  LlmUsage,
} from './llm-client.js';

import { LlmError } from './llm-client.js';

/**
 * DeepSeek V4 chat-completions endpoint, OpenAI-compatible (Req: complete()
 * Returns Content, Usage, and Model; design D2/D6). Over the `openai` SDK:
 * `new OpenAI({ baseURL: https://api.deepseek.com, apiKey })` then
 * `client.chat.completions.create({model, messages, thinking, reasoning_effort,
 * tools, user})`. Non-streaming only — the worker needs complete reasoning.
 *
 * - **Lazy client (D6)**: no SDK client is constructed until the first
 *   `complete()`, and one is reused thereafter. Construction is side-effect
 *   free. `close()` is NOT on the `LlmClient` port: the OpenAI client is
 *   stateless HTTP (no persistent connection to end), so `close()` just drops
 *   the reference so a later `complete()` builds a fresh one. Calling `close()`
 *   before any request is a safe no-op.
 * - **SDK isolation (D4)**: this is the ONLY file that imports `openai`; the
 *   boundary test asserts that. The port stays driver-free.
 * - **Error mapping (§9.8)**: a confirmed 4xx rejection → `LlmError('failed')`;
 *   a timeout/disconnect (no HTTP status, ambiguous success) →
 *   `LlmError('unknown')`. The original error is preserved as `cause`.
 */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export class DeepSeekClient implements LlmClient {
  private client?: OpenAI;
  private readonly apiKey?: string;

  constructor(options?: { apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey ?? deepseekApiKey(),
        baseURL: DEEPSEEK_BASE_URL,
      });
    }
    return this.client;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const completion = await this.getClient().chat.completions.create(buildParams(request));
      return mapResponse(completion, request);
    } catch (error) {
      throw toLlmError(error);
    }
  }
  async close(): Promise<void> {
    this.client = undefined;
  }
}

/**
 * Env-first DeepSeek API key (design code block). Reads `DEEPSEEK_API_KEY` when
 * set; otherwise returns `undefined` (the SDK will then reject — surfaced as
 * `LlmError('failed')` if a request is attempted without a key). Zero secrets
 * in code.
 */
export function deepseekApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

/** DeepSeek-augmented chat message — `reasoning_content` is a provider extension. */
interface DeepSeekApiMessage {
  readonly role: string;
  readonly content: string;
  readonly reasoning_content?: string;
  readonly tool_calls?: readonly {
    readonly id: string;
    readonly type: 'function';
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
  readonly tool_call_id?: string;
}

/** DeepSeek usage — cache tokens may arrive as direct fields or under details. */
interface DeepSeekApiUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly prompt_cache_hit_tokens?: number;
  readonly prompt_cache_miss_tokens?: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
}

/**
 * Map an {@link LlmRequest} to the params object `chat.completions.create`
 * expects. snake_case fields (`reasoning_content`, `reasoning_effort`,
 * `tool_calls`, `tool_call_id`) are the provider's wire shape and live ONLY
 * here — never on the port. Forwarding prior-turn `reasoning_content` on
 * assistant messages when tools are present prevents the dropped-chain 400.
 */
function buildParams(request: LlmRequest): OpenAI.ChatCompletionCreateParamsNonStreaming {
  const messages = request.messages.map((message) => toApiMessage(message));
  return {
    model: request.model,
    messages,
    ...(request.thinking ? { thinking: request.thinking } : {}),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.user ? { user: request.user } : {}),
  } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming;
}

function toApiMessage(message: LlmMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.reasoningContent !== undefined) {
    out.reasoning_content = message.reasoningContent;
  }
  if (message.toolCalls !== undefined) {
    out.tool_calls = message.toolCalls;
  }
  if (message.toolCallId !== undefined) {
    out.tool_call_id = message.toolCallId;
  }
  return out;
}

/** Map the SDK completion response to the driver-free {@link LlmResponse}. */
function mapResponse(completion: OpenAI.ChatCompletion, request: LlmRequest): LlmResponse {
  const message = (completion.choices[0]?.message ?? {}) as DeepSeekApiMessage;
  const usage = extractUsage((completion.usage ?? {}) as DeepSeekApiUsage);
  const toolCalls = message.tool_calls;
  return {
    model: request.model,
    content: message.content ?? '',
    usage,
    ...(message.reasoning_content !== undefined
      ? { reasoningContent: message.reasoning_content }
      : {}),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls: toolCalls.map(toToolCall) } : {}),
  };
}

function toToolCall(call: {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}): LlmToolCall {
  return { id: call.id, type: 'function', function: call.function };
}

/**
 * Extract the four cache/token fields. DeepSeek returns cache tokens either as
 * direct `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` fields or as
 * `prompt_tokens_details.cached_tokens` (cache hits only; miss is then
 * `prompt_tokens - cached`).
 */
function extractUsage(usage: DeepSeekApiUsage): LlmUsage {
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  let cacheHit: number;
  let cacheMiss: number;
  if (usage.prompt_cache_hit_tokens !== undefined || usage.prompt_cache_miss_tokens !== undefined) {
    cacheHit = usage.prompt_cache_hit_tokens ?? 0;
    cacheMiss = usage.prompt_cache_miss_tokens ?? 0;
  } else {
    cacheHit = usage.prompt_tokens_details?.cached_tokens ?? 0;
    cacheMiss = Math.max(0, promptTokens - cacheHit);
  }
  return {
    promptTokens,
    completionTokens,
    promptCacheHitTokens: cacheHit,
    promptCacheMissTokens: cacheMiss,
  };
}

/**
 * Classify an adapter failure (§9.8). A confirmed 4xx (we received an HTTP
 * response that definitively rejected us) → 'failed'. Anything without a 4xx
 * status — timeout, disconnect, 5xx, or unknown — → 'unknown', because success
 * is ambiguous (the request may have been processed before the connection
 * dropped) and a blind retry could double-charge or duplicate work.
 */
function toLlmError(error: unknown): LlmError {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new LlmError('failed', errorMessage(error), { cause: error });
  }
  return new LlmError('unknown', errorMessage(error), { cause: error });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'deepseek request failed';
}
