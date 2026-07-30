/**
 * Transitional in-memory, persistence-free trust kernel — minimum authority
 * evaluation behavior. NOT a canonical package; see README.md for the boundary
 * and extraction map. This slice exposes only the transitional identity surface.
 */

/** Centralized transitional labels — single source of truth. */
const PACKAGE_ID = 'trust-kernel' as const;
const TRANSITIONAL = true as const;
const CANONICAL_PARTITION_EXCLUDED = true as const;
const EXTRACTION_TARGETS = [
  'organization',
  'policy',
  'approvals',
  'evidence',
  'receipts',
  'audit',
] as const;

export type ExtractionTarget = (typeof EXTRACTION_TARGETS)[number];

export interface TransitionalDescriptor {
  readonly packageId: typeof PACKAGE_ID;
  readonly transitional: typeof TRANSITIONAL;
  readonly canonicalPartitionExcluded: typeof CANONICAL_PARTITION_EXCLUDED;
  readonly extractionTargets: readonly ExtractionTarget[];
}

/**
 * Describe the transitional boundary of this package. Pure: returns a fresh,
 * independent value each call so no module-level mutable state leaks.
 */
export function transitionalDescriptor(): TransitionalDescriptor {
  return {
    packageId: PACKAGE_ID,
    transitional: TRANSITIONAL,
    canonicalPartitionExcluded: CANONICAL_PARTITION_EXCLUDED,
    extractionTargets: [...EXTRACTION_TARGETS],
  };
}
