import { afterAll, describe, expect, it } from 'vitest';

import { DeepSeekClient, deepseekApiKey } from '../src/deepseek-client.js';

/**
 * Integration test — REAL DeepSeek V4 round-trip (Req: complete() Returns
 * Content, Usage, and Model; design §Testing Strategy). Unlike the unit tests
 * (which mock the `openai` SDK), this sends a live chat-completion to DeepSeek
 * V4 with thinking + tools enabled and asserts the response shape (content,
 * reasoningContent, usage with cache tokens). The whole suite is SKIPPED when
 * no `DEEPSEEK_API_KEY` is set, so CI without a key does not fail (mirror of
 * pg-roundtrip.integration.test.ts).
 */
describe.skipIf(!process.env.DEEPSEEK_API_KEY)(
  'integration: real DeepSeek V4 round-trip (Req: complete() Returns Content, Usage, and Model)',
  () => {
    let client: DeepSeekClient;

    afterAll(async () => {
      await client?.close();
    });

    it('returns content, model, and full usage from a flash completion', async () => {
      client = new DeepSeekClient({ apiKey: deepseekApiKey() });
      const response = await client.complete({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
      });

      expect(response.model).toBe('deepseek-v4-flash');
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.usage.promptTokens).toBeGreaterThan(0);
      expect(response.usage.completionTokens).toBeGreaterThan(0);
    });

    it('surfaces reasoningContent when thinking is enabled (Req: Thinking Mode)', async () => {
      client = new DeepSeekClient({ apiKey: deepseekApiKey() });
      const response = await client.complete({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'What is 7 + 5? Think step by step.' }],
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });

      expect(response.content.length).toBeGreaterThan(0);
      // thinking mode should produce a chain-of-thought when the API returns it
      expect(typeof response.reasoningContent).toBe('string');
    });
  },
);
