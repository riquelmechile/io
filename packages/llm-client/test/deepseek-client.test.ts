import { describe, expect, expectTypeOf, it, vi, beforeEach } from 'vitest';

import type { LlmClient } from '../src/llm-client.js';
import { LlmError } from '../src/llm-client.js';

/**
 * DeepSeekClient (Req: complete() Returns Content, Usage, and Model; D6/D2 +
 * Thinking/Tools/Cost decisions). This is a UNIT test over a MOCKED `openai`
 * client — it asserts the lazy client lifecycle, the request→params mapping
 * (model, messages, thinking, reasoning_effort, tools, user), the response→
 * LlmResponse mapping (content, reasoningContent, toolCalls, usage), error
 * classification (§9.8), and that `close()` releases the client WITHOUT being
 * declared on the `LlmClient` port. No real DeepSeek API is touched here (the
 * real round-trip is the Phase 6 integration test).
 *
 * `openai` is mocked via vi.hoisted so the module factory (hoisted above
 * imports) shares the same vi.fn handles the assertions read (mirror of
 * pg-connection.test.ts).
 */
const openai = vi.hoisted(() => {
  const ctorCalls: Array<{ apiKey?: string; baseURL?: string }> = [];
  const createMock = vi.fn();
  class MockOpenAI {
    readonly options: { apiKey?: string; baseURL?: string };
    readonly chat = { completions: { create: createMock } };
    constructor(options: { apiKey?: string; baseURL?: string }) {
      this.options = options;
      ctorCalls.push(options);
    }
  }
  return { default: MockOpenAI, ctorCalls, createMock };
});

vi.mock('openai', () => openai);

describe('DeepSeekClient (Req: DeepSeek adapter; D6/D2)', () => {
  beforeEach(() => {
    openai.ctorCalls.length = 0;
    openai.createMock.mockReset();
  });

  describe('lazy client lifecycle (D6)', () => {
    it('does NOT construct an OpenAI client at construction (lazy)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      new DeepSeekClient({ apiKey: 'k' });
      expect(openai.ctorCalls).toHaveLength(0);
    });

    it('constructs the client on the first complete, carrying apiKey + baseURL', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete(flashRequest());
      expect(openai.ctorCalls).toHaveLength(1);
      expect(openai.ctorCalls[0]?.apiKey).toBe('k');
      expect(openai.ctorCalls[0]?.baseURL).toBe('https://api.deepseek.com');
    });

    it('reuses ONE client across repeated calls (lazy singleton)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete(flashRequest());
      await client.complete(flashRequest());
      await client.complete(flashRequest());
      expect(openai.ctorCalls).toHaveLength(1);
    });
  });

  describe('complete() maps request → chat.completions.create params', () => {
    it('forwards model and messages verbatim', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const params = openai.createMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.model).toBe('deepseek-v4-pro');
      expect(params.messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('enables thinking + reasoning_effort when thinking.type is enabled', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });
      const params = openai.createMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.thinking).toEqual({ type: 'enabled' });
      expect(params.reasoning_effort).toBe('high');
    });

    it('omits thinking/reasoning_effort when not requested', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete(flashRequest());
      const params = openai.createMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.thinking).toBeUndefined();
      expect(params.reasoning_effort).toBeUndefined();
    });

    it('forwards tools and user (cache cohort) when present', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [
          {
            type: 'function',
            function: { name: 'get_weather', description: 'd', parameters: { type: 'object' } },
          },
        ],
        user: 'cohort-42',
      });
      const params = openai.createMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(params.tools).toEqual([
        {
          type: 'function',
          function: { name: 'get_weather', description: 'd', parameters: { type: 'object' } },
        },
      ]);
      expect(params.user).toBe('cohort-42');
    });

    it('forwards prior-turn reasoning_content when tools are present (Req: Thinking passthrough)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'user', content: 'use the tool' },
          {
            role: 'assistant',
            content: '',
            reasoningContent: 'prior chain-of-thought',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'x', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', content: 'result', toolCallId: 'call_1' },
        ],
        tools: [
          {
            type: 'function',
            function: { name: 'x', description: 'd', parameters: { type: 'object' } },
          },
        ],
      });
      const params = openai.createMock.mock.calls[0]?.[0] as { messages: unknown[] };
      const assistant = params.messages[1] as Record<string, unknown>;
      expect(assistant.reasoning_content).toBe('prior chain-of-thought');
      expect(assistant.tool_calls).toEqual([
        { id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } },
      ]);
      const toolMsg = params.messages[2] as Record<string, unknown>;
      expect(toolMsg.tool_call_id).toBe('call_1');
    });
  });

  describe('response → LlmResponse mapping', () => {
    it('maps content, model, and all four usage fields', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(
        chatCompletion({
          model: 'deepseek-v4-flash',
          content: 'the answer',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 20,
          },
        }),
      );
      const client = new DeepSeekClient({ apiKey: 'k' });
      const response = await client.complete(flashRequest());

      expect(response.model).toBe('deepseek-v4-flash');
      expect(response.content).toBe('the answer');
      expect(response.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        promptCacheHitTokens: 80,
        promptCacheMissTokens: 20,
      });
    });

    it('surfaces reasoningContent when the API returns it (Req: Thinking Mode)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion({ reasoningContent: 'because of x' }));
      const client = new DeepSeekClient({ apiKey: 'k' });
      const response = await client.complete({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'why?' }],
        thinking: { type: 'enabled' },
      });

      expect(response.reasoningContent).toBe('because of x');
    });

    it('maps tool_calls when the model emits them (triangulation)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(
        chatCompletion({
          content: '',
          toolCalls: [{ id: 'call_9', type: 'function', function: { name: 'f', arguments: '{}' } }],
        }),
      );
      const client = new DeepSeekClient({ apiKey: 'k' });
      const response = await client.complete(flashRequest());

      expect(response.toolCalls).toEqual([
        { id: 'call_9', type: 'function', function: { name: 'f', arguments: '{}' } },
      ]);
    });

    it('reads cache tokens from prompt_tokens_details.cached_tokens (DeepSeek shape)', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue({
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 116,
          completion_tokens: 12,
          prompt_tokens_details: { cached_tokens: 116 },
        },
      });
      const client = new DeepSeekClient({ apiKey: 'k' });
      const response = await client.complete(flashRequest());

      expect(response.usage.promptCacheHitTokens).toBe(116);
      expect(response.usage.promptCacheMissTokens).toBe(0);
      expect(response.usage.promptTokens).toBe(116);
    });
  });

  describe('error classification (Req: LlmError; §9.8)', () => {
    it('classifies a timeout/disconnect (no HTTP status) as LlmError unknown', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockRejectedValue(Object.assign(new Error('ETIMEDOUT'), {}));
      const client = new DeepSeekClient({ apiKey: 'k' });

      await expect(client.complete(flashRequest())).rejects.toSatisfy((err: unknown) => {
        return err instanceof LlmError && err.state === 'unknown';
      });
    });

    it('classifies a 4xx API error (status 400) as LlmError failed', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      const apiError = Object.assign(new Error('Bad Request'), { status: 400 });
      openai.createMock.mockRejectedValue(apiError);
      const client = new DeepSeekClient({ apiKey: 'k' });

      await expect(client.complete(flashRequest())).rejects.toSatisfy((err: unknown) => {
        return err instanceof LlmError && err.state === 'failed';
      });
    });

    it('preserves the original error as cause', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      const root = new Error('connection reset');
      openai.createMock.mockRejectedValue(root);
      const client = new DeepSeekClient({ apiKey: 'k' });

      await expect(client.complete(flashRequest())).rejects.toSatisfy((err: unknown) => {
        return err instanceof LlmError && err.cause === root;
      });
    });
  });

  describe('deepseekApiKey() — env-first factory', () => {
    it('defaults to undefined when DEEPSEEK_API_KEY is unset', async () => {
      const { deepseekApiKey } = await import('../src/deepseek-client.js');
      const saved = process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_API_KEY;
      try {
        expect(deepseekApiKey()).toBeUndefined();
      } finally {
        if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
      }
    });

    it('reads DEEPSEEK_API_KEY when set', async () => {
      const { deepseekApiKey } = await import('../src/deepseek-client.js');
      const saved = process.env.DEEPSEEK_API_KEY;
      process.env.DEEPSEEK_API_KEY = 'sk-test-key';
      try {
        expect(deepseekApiKey()).toBe('sk-test-key');
      } finally {
        if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
        else delete process.env.DEEPSEEK_API_KEY;
      }
    });

    it('constructor falls back to DEEPSEEK_API_KEY when no apiKey is passed', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      const saved = process.env.DEEPSEEK_API_KEY;
      process.env.DEEPSEEK_API_KEY = 'env-key';
      try {
        openai.createMock.mockResolvedValue(chatCompletion());
        const client = new DeepSeekClient();
        await client.complete(flashRequest());
        expect(openai.ctorCalls[0]?.apiKey).toBe('env-key');
      } finally {
        if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
        else delete process.env.DEEPSEEK_API_KEY;
      }
    });
  });

  describe('close() releases the client but is NOT on the port', () => {
    it('is a safe no-op when no client was ever created', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      const client = new DeepSeekClient({ apiKey: 'k' });
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('releases the client so the next complete() constructs a fresh one', async () => {
      const { DeepSeekClient } = await import('../src/deepseek-client.js');
      openai.createMock.mockResolvedValue(chatCompletion());
      const client = new DeepSeekClient({ apiKey: 'k' });
      await client.complete(flashRequest());
      expect(openai.ctorCalls).toHaveLength(1);
      await client.close();
      await client.complete(flashRequest());
      expect(openai.ctorCalls).toHaveLength(2);
    });

    it('the LlmClient port declares ONLY complete — close() is extra', () => {
      expectTypeOf<keyof LlmClient>().toEqualTypeOf<'complete'>();
    });

    it('DeepSeekClient is assignable to LlmClient (implements the port)', () => {
      expectTypeOf<import('../src/deepseek-client.js').DeepSeekClient>().toMatchTypeOf<LlmClient>();
    });
  });
});

function flashRequest() {
  return {
    model: 'deepseek-v4-flash' as const,
    messages: [{ role: 'user' as const, content: 'hi' }],
  };
}

function chatCompletion(
  over: Partial<{
    model: string;
    content: string;
    reasoningContent: string;
    toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    usage: Record<string, unknown>;
  }> = {},
) {
  return {
    model: over.model ?? 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: over.content ?? 'ok',
          ...(over.reasoningContent ? { reasoning_content: over.reasoningContent } : {}),
          ...(over.toolCalls ? { tool_calls: over.toolCalls } : {}),
        },
        finish_reason: over.toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: over.usage ?? {
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 6,
    },
  };
}
