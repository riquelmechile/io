import { describe, expect, it } from 'vitest';

import { LLM_FAKE_DISCLOSURE } from '../src/disclosure.js';

import { FakeLlmClient } from '../src/fakes.js';

import type { LlmResponse } from '../src/llm-client.js';

/**
 * FakeLlmClient (Req: FakeLlmClient Test Double). It returns configurable
 * canned LlmResponse values, preserves reasoningContent (so passthrough tests
 * can assert the worker replays it), and records every call for assertions. Its
 * methods return Promise using in-memory structures only — no network, no real
 * API, no API key required. It is NOT a real LLM and NOT network-backed.
 */
function cannedResponse(over: Partial<LlmResponse> = {}): LlmResponse {
  return {
    model: 'deepseek-v4-flash',
    content: 'canned answer',
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 6,
    },
    ...over,
  };
}

describe('FakeLlmClient (Req: FakeLlmClient Test Double)', () => {
  describe('returns canned response without network (scenario 1)', () => {
    it('complete() resolves the configured canned response', async () => {
      const response = cannedResponse({ content: 'hello from fake' });
      const fake = new FakeLlmClient({ responses: [response] });

      await expect(fake.complete(request())).resolves.toEqual(response);
    });

    it('complete() returns a Promise (matches the async port contract)', async () => {
      const fake = new FakeLlmClient({ responses: [cannedResponse()] });
      const result = fake.complete(request());

      expect(result).toBeInstanceOf(Promise);
      await result;
    });

    it('preserves reasoningContent for passthrough tests (Req: Thinking Mode)', async () => {
      const response = cannedResponse({ reasoningContent: 'chain-of-thought here' });
      const fake = new FakeLlmClient({ responses: [response] });

      const got = await fake.complete(request());

      expect(got.reasoningContent).toBe('chain-of-thought here');
    });

    it('records every request in call order for assertions', async () => {
      const fake = new FakeLlmClient({ responses: [cannedResponse(), cannedResponse()] });

      await fake.complete(request({ model: 'deepseek-v4-flash' }));
      await fake.complete(request({ model: 'deepseek-v4-pro' }));

      expect(fake.requests).toHaveLength(2);
      expect(fake.requests[0]?.model).toBe('deepseek-v4-flash');
      expect(fake.requests[1]?.model).toBe('deepseek-v4-pro');
    });

    it('cycles through canned responses when more are provided (triangulation)', async () => {
      const fake = new FakeLlmClient({
        responses: [cannedResponse({ content: 'first' }), cannedResponse({ content: 'second' })],
      });

      const first = await fake.complete(request());
      const second = await fake.complete(request());

      expect(first.content).toBe('first');
      expect(second.content).toBe('second');
    });

    it('reuses the last canned response once exhausted', async () => {
      const fake = new FakeLlmClient({ responses: [cannedResponse({ content: 'only' })] });

      await fake.complete(request());
      const again = await fake.complete(request());

      expect(again.content).toBe('only');
    });
  });

  describe('honest non-real disclosure (scenario 2; threat: honesty)', () => {
    it('carries the package LLM_FAKE_DISCLOSURE constant', () => {
      const fake = new FakeLlmClient({ responses: [cannedResponse()] });

      expect(fake.disclosure).toBe(LLM_FAKE_DISCLOSURE);
    });

    it('discloses it is NOT a real LLM and NOT network-backed', () => {
      const fake = new FakeLlmClient({ responses: [cannedResponse()] });

      expect(fake.disclosure.toLowerCase()).toContain('not a real llm');
      expect(fake.disclosure.toLowerCase()).toContain('not network-backed');
    });
  });
});

function request(over: Partial<{ model: 'deepseek-v4-flash' | 'deepseek-v4-pro' }> = {}): {
  model: 'deepseek-v4-flash' | 'deepseek-v4-pro';
  messages: readonly { role: 'user'; content: string }[];
} {
  return {
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hi' }],
    ...over,
  };
}
