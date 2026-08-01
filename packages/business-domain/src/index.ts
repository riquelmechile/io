/**
 * Public surface of @io/business-domain — transitional pure domain types for
 * the business vertical. Exports the four domain aggregates (Company,
 * Delegation, Work, BusinessReceipt) and their state machine guards. Zero
 * runtime dependencies, zero cross-aggregate imports.
 */

export { evidenceId } from './evidence-id.js';
export type { JournalFakePersistence } from './ports/fakes.js';
export {
  DurableJournalFake,
  InMemoryBusinessEventRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryIdempotencyJournalRepository,
  InMemorySkillRepository,
  InMemoryWorkRepository,
} from './ports/fakes.js';
export type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  JournalStatus,
  NewJournalEntry,
} from './ports/idempotency.js';
export { isUnresolvedJournalResult } from './ports/idempotency.js';
export type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  CasResult,
  CompanyRepository,
  DelegationRepository,
  SkillRepository,
  WorkRepository,
} from './ports/repositories.js';
export type { SkillCohort } from './skill-activation.js';
export {
  activeSkillsFor,
  isSkillState,
} from './skill-activation.js';
export { canTransitionDelegation, canTransitionWork, isDelegationActive } from './transitions.js';
export type {
  AuthorityScope,
  Budget,
  BusinessEvent,
  BusinessReceipt,
  Company,
  Delegation,
  DelegationState,
  Deliverable,
  Skill,
  SkillScope,
  SkillState,
  Work,
  WorkOutcome,
  WorkState,
} from './types.js';

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
