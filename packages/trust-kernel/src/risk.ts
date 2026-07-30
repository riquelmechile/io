import type { KernelAction, ReservedCategory, RiskClass } from './model.js';

/** Impact-score bands for classifying NON-reserved actions (Req 3). */
export interface RiskThresholds {
  /** impact < lowMax classifies as low. */
  readonly lowMax: number;
  /** lowMax <= impact < mediumMax classifies as medium. */
  readonly mediumMax: number;
}

/** The five source-reserved categories — single source of truth (Req 3). */
const RESERVED_CATEGORIES: readonly ReservedCategory[] = [
  'purpose',
  'capital',
  'critical-limits',
  'irreversible',
  'constitutional-modification',
];

const RESERVED_CATEGORY_SET: ReadonlySet<string> = new Set(RESERVED_CATEGORIES);

/** True when `category` is one of the five source-reserved categories. */
export function isReservedCategory(category: string): category is ReservedCategory {
  return RESERVED_CATEGORY_SET.has(category);
}

/**
 * Deterministically classify an action's risk BEFORE authority is evaluated
 * (Req 3). Pure: a function of action attributes and in-memory thresholds only.
 * Reserved categories ALWAYS classify as critical and can NEVER be downgraded.
 * No LLM output influences the result — no such input exists.
 */
export function classify(action: KernelAction, thresholds: RiskThresholds): RiskClass {
  const { category } = action;
  if (category !== undefined && isReservedCategory(category)) {
    return 'critical';
  }

  const impact = action.impactScore ?? 0;
  if (impact < thresholds.lowMax) return 'low';
  if (impact < thresholds.mediumMax) return 'medium';
  return 'high';
}
