import { FakeLlmClient } from '@io/llm-client/src/index.js';
import type { LlmClient, LlmRequest, LlmResponse } from '@io/llm-client/src/index.js';
import { describe, expect, it } from 'vitest';

import { RecordingLlmClient } from './recording-llm-client.js';

/**
 * Test-local `RecordingLlmClient` (task 3.1 / Req 4 + Req 6 capture): proves
 * the recorder wraps any LlmClient, delegates `complete` unchanged, and stores
 * `lastRequest` / `lastResponse` / `callCount` for later model / usage / cohort
 * assertions (used by the PR2 live E2E).
 */
function cannedResponse(content: string): LlmResponse {
  return {
    model: 'deepseek-v4-flash',
    content,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1,
    },
  };
}

const baseRequest: LlmRequest = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'compile the quarterly close context' }],
};

describe('RecordingLlmClient (test-local recorder)', () => {
  it('delegates complete() to the wrapped client and returns its response unchanged', async () => {
    const inner = new FakeLlmClient({ responses: [cannedResponse('plan-a')] });
    const recorder = new RecordingLlmClient(inner);

    const response = await recorder.complete(baseRequest);

    expect(response.content).toBe('plan-a');
    expect(response.model).toBe('deepseek-v4-flash');
    // Delegation: the inner client received the exact request.
    expect(inner.requests).toEqual([baseRequest]);
  });

  it('records lastRequest / lastResponse / callCount across calls', async () => {
    const inner = new FakeLlmClient({
      responses: [cannedResponse('first'), cannedResponse('second')],
    });
    const recorder = new RecordingLlmClient(inner);

    expect(recorder.callCount).toBe(0);
    expect(recorder.lastRequest).toBeUndefined();
    expect(recorder.lastResponse).toBeUndefined();

    const firstRequest = { ...baseRequest, user: 'cohort-acme' };
    await recorder.complete(firstRequest);
    expect(recorder.callCount).toBe(1);
    expect(recorder.lastRequest).toEqual(firstRequest);
    expect(recorder.lastResponse?.content).toBe('first');

    const secondRequest = { ...baseRequest, user: 'cohort-globex' };
    await recorder.complete(secondRequest);
    expect(recorder.callCount).toBe(2);
    expect(recorder.lastRequest).toEqual(secondRequest);
    expect(recorder.lastResponse?.content).toBe('second');
  });

  it('works with ANY LlmClient implementation (injectable port)', async () => {
    const custom: LlmClient = {
      complete: async (request: LlmRequest) => ({
        model: 'deepseek-v4-pro' as const,
        content: `echo:${request.messages[0]?.content ?? 'none'}`,
        usage: {
          promptTokens: 2,
          completionTokens: 2,
          promptCacheHitTokens: 1,
          promptCacheMissTokens: 1,
        },
      }),
    };
    const recorder = new RecordingLlmClient(custom);

    const response = await recorder.complete(baseRequest);

    expect(response.model).toBe('deepseek-v4-pro');
    expect(response.content).toBe('echo:compile the quarterly close context');
    expect(recorder.callCount).toBe(1);
    expect(recorder.lastRequest).toEqual(baseRequest);
    expect(recorder.lastResponse?.model).toBe('deepseek-v4-pro');
    expect(recorder.lastResponse?.usage.promptCacheHitTokens).toBe(1);
  });
});
