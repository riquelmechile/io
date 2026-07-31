import { IdempotencyConflictError, NotFoundError } from '../ports/repositories.js';
import { assertValidWorkTransition } from '../validation/guards.js';
import { ValidationError } from '../validation/errors.js';
import type { Work, WorkState } from '../types.js';
import type { TransitionWorkCommand, WorkUseCaseDeps, WorkUseCaseResult } from './types.js';

/**
 * Shared path for accept/start/complete/verify/reject: load scoped work, check
 * transition legality, optional authority/SoD, CAS-update version inside a
 * transaction, close idempotency key.
 */
export async function transitionWork(
  deps: WorkUseCaseDeps,
  command: TransitionWorkCommand,
  operation: string,
): Promise<WorkUseCaseResult> {
  if (!command.companyId || !command.workId || !command.principalId) {
    throw new ValidationError('invalid or missing field: companyId/workId/principalId');
  }

  const op = operation;
  if (deps.idempotency && command.idempotencyKey && command.requestHash) {
    const reg = await deps.idempotency.register(
      command.companyId,
      op,
      command.idempotencyKey,
      command.requestHash,
    );
    if (reg.status === 'conflict') {
      throw new IdempotencyConflictError();
    }
    if (reg.status === 'replay') {
      return { status: 'replay', work: reg.result as Work };
    }
  }

  if (deps.evaluate && command.evaluation) {
    const decision = await deps.evaluate(command.evaluation);
    if (decision.decision === 'DENY') {
      return { status: 'denied', reason: decision.reason };
    }
  }

  const updated = await deps.tx.runInTransaction(async () => {
    const current = await deps.workRepo.get(command.workId, command.companyId);
    if (current === undefined) {
      throw new NotFoundError(`work not found: ${command.workId}`);
    }
    assertValidWorkTransition(current.state, command.toState);
    const next: Work = {
      ...current,
      state: command.toState,
      deliverable: command.deliverable ?? current.deliverable,
      outcome: command.outcome ?? current.outcome,
      evidenceRefs: command.evidenceRefs ?? current.evidenceRefs,
    };
    return deps.workRepo.updateWithVersion(next, current.version);
  });

  if (deps.idempotency && command.idempotencyKey && command.requestHash) {
    await deps.idempotency.complete(
      command.companyId,
      op,
      command.idempotencyKey,
      command.requestHash,
      updated,
    );
  }

  return { status: 'ok', work: updated };
}

function transitionTo(toState: WorkState, operation: string) {
  return (deps: WorkUseCaseDeps, command: Omit<TransitionWorkCommand, 'toState'>) =>
    transitionWork(deps, { ...command, toState }, operation);
}

export const acceptWork = transitionTo('accepted', 'acceptWork');
export const startWork = transitionTo('in_progress', 'startWork');
export const completeWork = transitionTo('completed', 'completeWork');
export const verifyWork = transitionTo('verified', 'verifyWork');
export const rejectWork = transitionTo('rejected', 'rejectWork');
