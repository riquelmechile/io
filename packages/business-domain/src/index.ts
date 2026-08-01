/**
 * Public surface of @io/business-domain — transitional pure domain types for
 * the business vertical. Exports the four domain aggregates (Company,
 * Delegation, Work, BusinessReceipt) and their state machine guards. Zero
 * runtime dependencies, zero cross-aggregate imports.
 */

export type {
  AuthorityScope,
  Budget,
  BusinessReceipt,
  Company,
  Delegation,
  DelegationState,
  Deliverable,
  Work,
  WorkOutcome,
  WorkState,
} from './types.js';

export { canTransitionDelegation, canTransitionWork, isDelegationActive } from './transitions.js';

export { evidenceId } from './evidence-id.js';

export type {
  CompanyRepository,
  DelegationRepository,
  WorkRepository,
  BusinessReceiptRepository,
  CasResult,
} from './ports/repositories.js';

export type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  JournalStatus,
  NewJournalEntry,
} from './ports/idempotency.js';
export { isUnresolvedJournalResult } from './ports/idempotency.js';

export {
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryWorkRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyJournalRepository,
  DurableJournalFake,
} from './ports/fakes.js';
export type { JournalFakePersistence } from './ports/fakes.js';

export type {
  CompleteWorkCommand,
  CompleteWorkDeps,
  ProposeWorkCommand,
  TransitionWorkCommand,
  UseCaseReason,
  UseCaseResult,
  WorkCommandBase,
} from './use-cases/index.js';
export {
  acceptWork,
  completeWork,
  proposeWork,
  rejectWork,
  startWork,
  verifyWork,
} from './use-cases/index.js';
