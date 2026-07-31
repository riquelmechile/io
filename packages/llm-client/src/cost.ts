import type { LlmModel, LlmUsage } from './llm-client.js';

/**
 * Pure USD pricing table per 1M tokens (architecture §7; Req: Cost Computation).
 * Rates are PRICE PER 1,000,000 TOKENS. `computeCost` divides by 1_000_000.
 *
 * DeepSeek V4 prices its INPUT tokens by cache state: tokens served from the KV
 * cache (cache-hit) are ~50–100x cheaper than cache-miss tokens that had to be
 * re-processed, and output tokens carry their own rate. This is why the worker
 * must compile a stable prompt prefix (Change 3) — cache hits dominate the cost.
 */
interface ModelPricing {
  /** Cache-hit input per 1M tokens. */
  readonly cacheHitPerMillion: number;
  /** Cache-miss input per 1M tokens. */
  readonly cacheMissPerMillion: number;
  /** Completion output per 1M tokens. */
  readonly outputPerMillion: number;
}

const PRICING: Readonly<Record<LlmModel, ModelPricing>> = {
  'deepseek-v4-flash': {
    cacheHitPerMillion: 0.0028,
    cacheMissPerMillion: 0.14,
    outputPerMillion: 0.28,
  },
  'deepseek-v4-pro': {
    cacheHitPerMillion: 0.003625,
    cacheMissPerMillion: 0.435,
    outputPerMillion: 0.87,
  },
};

const PER_MILLION = 1_000_000;

/**
 * Compute USD cost from token usage for a model (Req: Cost Computation; PURE).
 *
 * cost = (cacheHit × hitRate + cacheMiss × missRate + completion × outputRate)
 *        / 1_000_000
 *
 * `promptTokens` is informational only — the PRICED inputs are the cache-hit and
 * cache-miss breakdown, because DeepSeek charges input by cache state, not by
 * raw prompt length. This function makes ZERO network/API calls.
 */
export function computeCost(usage: LlmUsage, model: LlmModel): number {
  const rate = PRICING[model];
  const inputCost =
    (usage.promptCacheHitTokens * rate.cacheHitPerMillion +
      usage.promptCacheMissTokens * rate.cacheMissPerMillion) /
    PER_MILLION;
  const outputCost = (usage.completionTokens * rate.outputPerMillion) / PER_MILLION;
  return inputCost + outputCost;
}
