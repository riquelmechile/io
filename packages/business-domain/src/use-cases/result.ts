import type { BusinessReceiptRepository, WorkRepository } from '../ports/repositories.js';
import type { IdempotencyJournalPort } from '../ports/idempotency.js';
import type { Deliverable, Work, WorkOutcome, WorkState } from '../types.js';
import { canTransitionWork } from '../transitions.js';

/**
 * Shared result contract and command envelope for the transition use cases
 * (design D3). Every use case returns a TYPED result
 * `{ ok: true; value } | { ok: false; reason; current? }` — failures are
 * VALUES, never thrown exceptions used for control flow. The command carries
 * the neutral tenant scope (`companyId`), the acting principal (`actor`), the
 * optional optimistic-concurrency expectation (`expectedVersion`), and the
 * optional idempotency fields (`idempotencyKey` + `requestHash`, D6).
 */

/** Every failure reason a use case can return (see each scenario in the specs). */
export type UseCaseReason =
  | 'not-found'
  | 'invalid-transition'
  | 'version-conflict'
  | 'work-already-exists'
  | 'invalid-command'
  | 'idempotency-conflict'
  | 'attempt-in-flight';

export type UseCaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: UseCaseReason; current?: T };

/** Shared command envelope for every Work use case (D3). */
export interface WorkCommandBase {
  readonly companyId: string;
  readonly actor: string;
  readonly workId?: string;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
}

export interface ProposeWorkCommand extends WorkCommandBase {
  readonly workId: string;
  readonly delegationId: string;
  readonly description: string;
  readonly evidenceRefs?: readonly string[];
  readonly deliverable?: Deliverable;
}

export interface TransitionWorkCommand extends WorkCommandBase {
  readonly workId: string;
}

export interface CompleteWorkCommand extends TransitionWorkCommand {
  readonly outcome?: WorkOutcome;
  readonly deliverable?: Deliverable;
  readonly evidenceRefs?: readonly string[];
  /** Required when the idempotent terminal close issues a receipt (D5/D6). */
  readonly policyHash?: string;
  readonly artifactHash?: string;
}

/** Repository PORTS ONLY (zero @io/*) needed by the complete-work use case. */
export interface CompleteWorkDeps {
  work: WorkRepository;
  receipts: BusinessReceiptRepository;
  journal: IdempotencyJournalPort;
}

/**
 * Thrown ONLY inside the atomic idempotent terminal flow (D6) when a
 * post-write failure (e.g. a concurrent CAS loss after the in_flight journal
 * row was inserted) requires aborting the surrounding transaction. This is NOT
 * control flow — every pre-write decision returns a `UseCaseResult`; this
 * exception exists so the enclosing `DbConnection.transaction` can roll back
 * and never leave a partial (zombie in_flight) record.
 */
export class IdempotentFlowAbortError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IdempotentFlowAbortError';
  }
}

/** Deduplicate an array while preserving first-seen order (used for evidenceRefs). */
export function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * Shared transition machinery (D3): `get` (scoped read) → validate the state
 * machine (`canTransitionWork`) → optimistic CAS (`updateIfVersion` with the
 * FRESH version from get — the caller's `expectedVersion`, when provided, is a
 * cheap early-out that never replaces the atomic CAS). Every failure is a
 * result, never a throw.
 */
export async function applyWorkTransition(
  target: WorkState,
  cmd: TransitionWorkCommand,
  workRepo: WorkRepository,
  buildNext: (current: Work) => Work = (current) => ({ ...current, state: target }),
): Promise<UseCaseResult<Work>> {
  if (!cmd.workId) return { ok: false, reason: 'invalid-command' };
  const current = await workRepo.get(cmd.companyId, cmd.workId);
  if (current === undefined) return { ok: false, reason: 'not-found' };
  if (!canTransitionWork(current.state, target)) {
    return { ok: false, reason: 'invalid-transition', current };
  }
  if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== current.version) {
    // The caller is provably stale; short-circuit before a doomed write.
    return { ok: false, reason: 'version-conflict', current };
  }
  const cas = await workRepo.updateIfVersion(buildNext(current), current.version);
  if (!cas.ok) {
    // The atomic CAS is authoritative: a concurrent writer won.
    return { ok: false, reason: 'version-conflict', current: cas.current };
  }
  return { ok: true, value: cas.value };
}
