import { describe, expect, it } from 'vitest';

import type { LlmClient, LlmRequest, LlmResponse } from '@io/llm-client/src/index.js';

import { llmModelFor } from '../src/worker/model-tier.js';
import { runWorker } from '../src/worker/worker.js';
import { cannedPlan, harness, seed, workerInput } from './worker-helpers.js';

/**
 * App/LLM boundary model-tier mapper (WC Work-Bearing S2): the ONLY place the
 * domain tier (`flash` | `pro`) is mapped to an `LlmModel`. The worker threads
 * the domain tier unchanged; `prepareIntent` maps it here at the LLM boundary,
 * so `business-domain` never imports `LlmModel`.
 */
describe('llmModelFor (WC Work-Bearing S2)', () => {
  it('maps flash to the default deepseek-v4-flash model', () => {
    expect(llmModelFor('flash')).toBe('deepseek-v4-flash');
  });

  it('maps pro to the escalated deepseek-v4-pro model', () => {
    expect(llmModelFor('pro')).toBe('deepseek-v4-pro');
  });
});

/** Test-local echoing LlmClient (WC Assertions S1): the RESPONSE model echoes
 * the REQUEST model — the honest fake of a serving endpoint. Records requests
 * in call order like FakeLlmClient. */
class EchoingFakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    return {
      model: request.model,
      content: JSON.stringify(cannedPlan()),
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 1,
      },
    };
  }
}

describe('FakeLlm serving-model echo (WC Assertions S1 — both tiers)', () => {
  it('a flash tier is requested AND echoed as deepseek-v4-flash through the full cycle', async () => {
    const llm = new EchoingFakeLlmClient();
    const h = harness({ llm });
    await seed(h);

    const result = await runWorker(workerInput(), h, 'flash');

    expect(result.ok).toBe(true);
    expect(llm.requests[0]?.model).toBe('deepseek-v4-flash');
  });

  it('a pro tier is requested AND echoed as deepseek-v4-pro through the full cycle', async () => {
    const llm = new EchoingFakeLlmClient();
    const h = harness({ llm });
    await seed(h);

    const result = await runWorker(workerInput(), h, 'pro');

    expect(result.ok).toBe(true);
    expect(llm.requests[0]?.model).toBe('deepseek-v4-pro');
  });
});
