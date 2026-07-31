import type { EvaluationInput, EvaluationResult } from '@io/trust-kernel/src/index.js';

import type { IdempotencyStore, WorkRepository } from '../ports/repositories.js';
import type { Work, WorkState } from '../types.js';

/**
 * Narrow transaction boundary used by use cases. Adapters bind this to
 * DbConnection.transaction without the domain importing infrastructure.
 */
export interface TransactionRunner {
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Dependencies injected into every work-transition use case. */
export interface WorkUseCaseDeps {
  readonly workRepo: WorkRepository;
  readonly tx: TransactionRunner;
  readonly idempotency?: IdempotencyStore;
  /** Optional authority evaluator (trust kernel). */
  readonly evaluate?: (input: EvaluationInput) => Promise<EvaluationResult>;
}

export interface ProposeWorkCommand {
  readonly companyId: string;
  readonly workId: string;
  readonly delegationId: string;
  readonly proposer: string;
  readonly description: string;
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
  readonly evaluation?: EvaluationInput;
}

export interface TransitionWorkCommand {
  readonly companyId: string;
  readonly workId: string;
  readonly principalId: string;
  readonly toState: WorkState;
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
  readonly evaluation?: EvaluationInput;
  readonly deliverable?: Work['deliverable'];
  readonly outcome?: Work['outcome'];
  readonly evidenceRefs?: readonly string[];
}

export type WorkUseCaseResult =
  | { readonly status: 'ok'; readonly work: Work }
  | { readonly status: 'replay'; readonly work: Work }
  | { readonly status: 'denied'; readonly reason: string };
