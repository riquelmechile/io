/**
 * Transition use cases (design D3): propose/accept/start/complete/verify/
 * reject. Each takes a command + repository PORTS ONLY (zero @io/*) and
 * returns a typed `UseCaseResult<Work>` — no throw-for-control-flow. State
 * changes go through get + CAS (updateIfVersion); raw save() is insert-only
 * (creating a new Work) and never the transition path.
 */

export type {
  CompleteWorkCommand,
  CompleteWorkDeps,
  ProposeWorkCommand,
  TransitionWorkCommand,
  UseCaseReason,
  UseCaseResult,
  WorkCommandBase,
} from './result.js';
export { IdempotentFlowAbortError, applyWorkTransition, dedupe } from './result.js';
export type { RequestRecoveryCommand, RequestRecoveryResult } from './request-recovery.js';
export { proposeWork } from './propose-work.js';
export { acceptWork } from './accept-work.js';
export { startWork } from './start-work.js';
export { completeWork } from './complete-work.js';
export { verifyWork } from './verify-work.js';
export { rejectWork } from './reject-work.js';
export { requestRecovery } from './request-recovery.js';
