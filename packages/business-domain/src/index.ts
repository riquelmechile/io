/**
 * Public surface of @io/business-domain — transitional pure domain types for
 * the business vertical. Exports the four domain aggregates (Company,
 * Delegation, Work, BusinessReceipt), state machine guards, ports, fakes,
 * validation, and transition use cases.
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

export { canTransitionDelegation, canTransitionWork } from './transitions.js';

export type {
  CompanyRepository,
  DelegationRepository,
  WorkRepository,
  BusinessReceiptRepository,
  IdempotencyStore,
  IdempotencyRegisterResult,
} from './ports/repositories.js';

export {
  VersionConflictError,
  NotFoundError,
  IdempotencyConflictError,
} from './ports/repositories.js';

export {
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryWorkRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyStore,
} from './ports/fakes.js';

export { ValidationError } from './validation/errors.js';
export {
  assertValidCommand,
  assertValidWorkRow,
  assertValidDelegationRow,
  assertValidReceiptRow,
  assertValidWorkTransition,
  assertValidDelegationTransition,
  assertValidLlmPlan,
  isDelegationWindowActive,
  isDelegationActive,
} from './validation/guards.js';
export type { TransitionCommand, LlmPlan } from './validation/guards.js';

export { proposeWork } from './use-cases/propose-work.js';
export {
  acceptWork,
  startWork,
  completeWork,
  verifyWork,
  rejectWork,
  transitionWork,
} from './use-cases/transition-work.js';
export type {
  WorkUseCaseDeps,
  ProposeWorkCommand,
  TransitionWorkCommand,
  WorkUseCaseResult,
  TransactionRunner,
} from './use-cases/types.js';
