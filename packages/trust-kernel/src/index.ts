/**
 * Transitional in-memory, persistence-free trust kernel — minimum authority
 * evaluation behavior. NOT a canonical package; see README.md for the boundary
 * and extraction map. The public evaluation surface is {@link evaluate}; the
 * re-exported types let a caller construct an {@link EvaluationInput} and read
 * an {@link EvaluationResult}. Slice-level check functions remain internal.
 */

// --- Public evaluation entry point + pipeline types (Req 5) ---
export { DEFERRED_STEPS, evaluate, NON_PERSISTENT_DISCLOSURE } from './pipeline.js';
export type {
  DeferredStep,
  EvaluationInput,
  EvaluationResult,
  StepResult,
} from './pipeline.js';

// --- Base neutral model types needed to build inputs / read outputs ---
export { isWindowActive } from './model.js';
export type {
  AuditEntry,
  Authority,
  CommandId,
  Decision,
  Evidence,
  InMemoryRecord,
  KernelAction,
  PersistentAuditEntry,
  PersistentEvidence,
  PersistentRecord,
  PositionId,
  PrincipalId,
  ReservedCategory,
  RiskClass,
  Role,
  Scope,
  TemporaryAssignment,
} from './model.js';

// --- Input builder types from each slice ---
export type { PrincipalIdentity } from './identity.js';
export type { Grant } from './grant.js';
export type { RiskThresholds } from './risk.js';
export type { SodAssignment, SodPolicy, SodRole } from './sod.js';

// --- Authority evaluation functions (worker-cycle: deny-at-action) ---
// The worker (Slice B) verifies authority at action time through these EXPORTED
// checks: `checkSod` enforces the ABSOLUTE_PAIRS (verifier≠executor,
// proposer≠approver) and `checkGrant` enforces deny-by-default command grants.
// `ABSOLUTE_PAIRS` itself stays module-private — no implied export.
export { checkSod } from './sod.js';
export { checkGrant } from './grant.js';

// --- Persistence port boundary (Increment 2, Req 1-5) ---
// Generic outbound port interfaces + honest disclosure + in-memory fakes.
// import type keeps the package dependency-free (D3/D4); the disclosure value
// is the only runtime export and is a plain string.
export type {
  AuditRepository,
  EvidenceRepository,
  PersistenceOutcome,
} from './ports/repositories.js';
export { PERSISTENT_PORT_DISCLOSURE } from './ports/repositories.js';
export { InMemoryAuditRepository, InMemoryEvidenceRepository } from './ports/fakes.js';

// --- Output honesty contracts (Req 7, Req 8) ---
export { RECEIPT_DISCLOSURE } from './receipt.js';
export type { UnsignedInMemoryReceipt } from './receipt.js';

// --- Centralized transitional labels — single source of truth. ---
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
