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

export type {
  CompanyRepository,
  DelegationRepository,
  WorkRepository,
  BusinessReceiptRepository,
  CasResult,
} from './ports/repositories.js';

export {
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryWorkRepository,
  InMemoryBusinessReceiptRepository,
} from './ports/fakes.js';
