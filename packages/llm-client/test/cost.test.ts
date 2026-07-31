import { describe, expect, it } from 'vitest';

import type { LlmModel, LlmUsage } from '../src/llm-client.js';

import { computeCost } from '../src/cost.js';

/**
 * computeCost (Req: Cost Computation From Usage Tokens). A PURE function:
 * cost = Σ(tokens × rate / 1_000_000) over cache-hit input, cache-miss input,
 * and completion output, using the per-model rates in architecture §7. It makes
 * ZERO network/API calls and is fully unit-testable. All scenarios below come
 * straight from the spec's table-driven cases.
 */
const ONE_MILLION = 1_000_000;

function usage(over: Partial<LlmUsage> = {}): LlmUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    promptCacheHitTokens: 0,
    promptCacheMissTokens: 0,
    ...over,
  };
}

describe('computeCost (Req: Cost Computation From Usage Tokens)', () => {
  describe('Flash — spec scenario: Flash cost from known usage', () => {
    // Flash: hit $0.0028, miss $0.14, output $0.28 per 1M (§7).
    it('1M cache-miss input + 1M output = $0.42 (0.14 + 0.28)', () => {
      const cost = computeCost(
        usage({
          promptCacheMissTokens: ONE_MILLION,
          completionTokens: ONE_MILLION,
        }),
        'deepseek-v4-flash',
      );

      expect(cost).toBeCloseTo(0.42, 10);
    });

    it('1M cache-hit input uses the $0.0028 hit rate, NOT the $0.14 miss rate', () => {
      const cost = computeCost(usage({ promptCacheHitTokens: ONE_MILLION }), 'deepseek-v4-flash');

      expect(cost).toBeCloseTo(0.0028, 10);
    });
  });

  describe('Pro — spec scenario: Pro cost respects cache hit discount', () => {
    // Pro: hit $0.003625, miss $0.435, output $0.87 per 1M (§7).
    it('all-cache-hit input uses the $0.003625 hit rate', () => {
      const cost = computeCost(usage({ promptCacheHitTokens: ONE_MILLION }), 'deepseek-v4-pro');

      expect(cost).toBeCloseTo(0.003625, 10);
    });

    it('1M cache-miss input + 1M output = $1.305 (0.435 + 0.87)', () => {
      const cost = computeCost(
        usage({
          promptCacheMissTokens: ONE_MILLION,
          completionTokens: ONE_MILLION,
        }),
        'deepseek-v4-pro',
      );

      expect(cost).toBeCloseTo(1.305, 10);
    });
  });

  describe('table-driven — both models × all token types (triangulation)', () => {
    const cases: ReadonlyArray<{
      name: string;
      model: LlmModel;
      usage: LlmUsage;
      expected: number;
    }> = [
      {
        name: 'Flash mixed: 0.5M hit + 0.5M miss + 0.25M output',
        model: 'deepseek-v4-flash',
        usage: usage({
          promptCacheHitTokens: 500_000,
          promptCacheMissTokens: 500_000,
          completionTokens: 250_000,
        }),
        expected: (500_000 * 0.0028 + 500_000 * 0.14 + 250_000 * 0.28) / ONE_MILLION,
      },
      {
        name: 'Pro output only: 300k completion tokens',
        model: 'deepseek-v4-pro',
        usage: usage({ completionTokens: 300_000 }),
        expected: (300_000 * 0.87) / ONE_MILLION,
      },
      {
        name: 'Flash hit + output: 2M hit + 1M output',
        model: 'deepseek-v4-flash',
        usage: usage({
          promptCacheHitTokens: 2_000_000,
          completionTokens: ONE_MILLION,
        }),
        expected: (2_000_000 * 0.0028 + ONE_MILLION * 0.28) / ONE_MILLION,
      },
    ];

    for (const { name, model, usage: u, expected } of cases) {
      it(`${name} = $${expected.toFixed(6)}`, () => {
        expect(computeCost(u, model)).toBeCloseTo(expected, 10);
      });
    }
  });

  describe('zero-call and partial usage', () => {
    it('a zero-usage request costs exactly $0', () => {
      expect(computeCost(usage(), 'deepseek-v4-flash')).toBe(0);
      expect(computeCost(usage(), 'deepseek-v4-pro')).toBe(0);
    });

    it('promptTokens alone do NOT add cost (only cache hit/miss feed the rate)', () => {
      // promptTokens is informational; the priced inputs are hit + miss.
      const cost = computeCost(usage({ promptTokens: ONE_MILLION }), 'deepseek-v4-flash');

      expect(cost).toBe(0);
    });
  });
});
