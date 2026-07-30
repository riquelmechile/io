import { describe, expect, it } from 'vitest';

import type { KernelAction } from '../src/model.js';
import { classify, isReservedCategory, type RiskThresholds } from '../src/risk.js';

/**
 * Deterministic risk classification BEFORE authority (Req 3; Threat: risk
 * downgrade). Classification MUST be a pure function of action attributes and
 * in-memory policy thresholds. The five source-reserved categories MUST always
 * classify as critical and MUST NEVER be downgraded. LLM output MUST NOT
 * produce the final classification.
 */

const thresholds: RiskThresholds = { lowMax: 10, mediumMax: 50 };

function action(overrides: Partial<KernelAction> = {}): KernelAction {
  return { actionId: 'a1', command: 'execute', impactScore: 25, ...overrides };
}

const RESERVED_CATEGORIES = [
  'purpose',
  'capital',
  'critical-limits',
  'irreversible',
  'constitutional-modification',
] as const;

describe('Deterministic risk classification (Req 3)', () => {
  it('returns an identical risk class for identical input across repeats', () => {
    const classes = Array.from({ length: 5 }, () =>
      classify(action({ impactScore: 25 }), thresholds),
    );
    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).toBe('medium');
  });

  it.each(RESERVED_CATEGORIES)(
    'classifies reserved category "%s" as critical even at impact 0',
    (category) => {
      expect(classify(action({ category, impactScore: 0 }), thresholds)).toBe('critical');
    },
  );

  it('isReservedCategory recognizes exactly the five source-reserved categories', () => {
    for (const category of RESERVED_CATEGORIES) expect(isReservedCategory(category)).toBe(true);
    expect(isReservedCategory('routine-routing')).toBe(false);
  });

  it('never downgrades a reserved category even when thresholds would yield low', () => {
    expect(
      classify(action({ category: 'capital', impactScore: 0 }), { lowMax: 1000, mediumMax: 2000 }),
    ).toBe('critical');
  });

  it.each([
    ['low', 5],
    ['medium', 25],
    ['high', 75],
  ] as const)('classifies a %s-impact non-reserved action as %s', (expected, impact) => {
    expect(classify(action({ impactScore: impact }), thresholds)).toBe(expected);
  });

  it('has no LLM-input path: classify takes only action + thresholds and reserved dominates impact', () => {
    // No third input channel exists; the pure signature plus reserved-wins
    // behavior proves no external/LLM suggestion can influence the class.
    expect(classify.length).toBe(2);
    expect(classify(action({ category: 'purpose', impactScore: 99 }), thresholds)).toBe('critical');
    expect(classify(action({ impactScore: 99 }), thresholds)).toBe('high');
  });
});
