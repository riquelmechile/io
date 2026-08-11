/**
 * Public surface of @io/business-domain — transitional pure domain types for
 * the business vertical. Exports the four domain aggregates (Company,
 * Delegation, Work, BusinessReceipt) and their state machine guards. Zero
 * runtime dependencies, zero cross-aggregate imports.
 */

export { evidenceId } from './evidence-id.js';
export { buildHeartbeatDecisionEvent } from './heartbeat-decision-event.js';
export type { JournalFakePersistence } from './ports/fakes.js';
export {
  DurableJournalFake,
  InMemoryBusinessEventRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryHeartbeatCursorStore,
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
export type { HeartbeatCursorStore } from './ports/cursors.js';
export type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  CasResult,
  CompanyRepository,
  DelegationRepository,
  FencingDirective,
  SkillRepository,
  WorkRepository,
} from './ports/repositories.js';
export type { SkillCohort } from './skill-activation.js';
export {
  activeSkillsFor,
  isSkillState,
} from './skill-activation.js';
export type { HeartbeatCursor, HeartbeatDecision, ModelTier } from './heartbeat.js';
export {
  escalationModelFor,
  evaluateHeartbeat,
  hasMaterialNovelty,
  isMaterialEvent,
  MATERIAL_EVENT_TYPES,
  PRO_ESCALATION_THRESHOLD,
  tailCursor,
  VALID_RISK_CLASSES,
} from './heartbeat.js';
export {
  ACTIONABLE_WORK_STATES,
  canTransitionDelegation,
  canTransitionWork,
  isDelegationActive,
} from './transitions.js';
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
  RequestRecoveryCommand,
  RequestRecoveryResult,
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
  requestRecovery,
  startWork,
  verifyWork,
} from './use-cases/index.js';
