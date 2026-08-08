import type { ModelTier } from '@io/business-domain/src/index.js';
import type { LlmModel } from '@io/llm-client/src/index.js';

/**
 * App/LLM boundary model-tier mapper (WC Work-Bearing S2; design "Interfaces /
 * Contracts"): the ONLY site mapping the domain tier to an `LlmModel`. The
 * worker threads the domain tier (`flash` | `pro`) unchanged through
 * `runWorker` → `prepareIntent`, which maps it here at the LLM boundary — so
 * `business-domain` never imports `LlmModel`. `compileContext` receives the
 * SAME args for both tiers (the stable prefix is untouched; only the request
 * `model` field differs, so the KV cache prefix is intact).
 */
export function llmModelFor(tier: ModelTier): LlmModel {
  return tier === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
}
