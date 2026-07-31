import { IdempotencyConflictError } from '../ports/repositories.js';
import { assertValidCommand } from '../validation/guards.js';
import type { Work } from '../types.js';
import type { ProposeWorkCommand, WorkUseCaseDeps, WorkUseCaseResult } from './types.js';

/**
 * Create a Work in `proposed` at version 0 inside a transaction.
 * Validates command shape; optional trust-kernel evaluation; idempotency pre-effect.
 */
export async function proposeWork(
  deps: WorkUseCaseDeps,
  command: ProposeWorkCommand,
): Promise<WorkUseCaseResult> {
  assertValidCommand({
    companyId: command.companyId,
    workId: command.workId,
    delegationId: command.delegationId,
    principalId: command.proposer,
    action: 'propose',
  });

  const op = 'proposeWork';
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

  const work: Work = {
    workId: command.workId,
    companyId: command.companyId,
    delegationId: command.delegationId,
    proposer: command.proposer,
    description: command.description,
    state: 'proposed',
    version: 0,
    evidenceRefs: [],
  };

  const saved = await deps.tx.runInTransaction(async () => {
    return deps.workRepo.save(work);
  });

  if (deps.idempotency && command.idempotencyKey && command.requestHash) {
    await deps.idempotency.complete(
      command.companyId,
      op,
      command.idempotencyKey,
      command.requestHash,
      saved,
    );
  }

  return { status: 'ok', work: saved };
}
