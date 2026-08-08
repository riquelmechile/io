import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import type { ProposeWorkCommand, UseCaseResult } from './result.js';

/**
 * proposeWork (D3): CREATES a new Work in state `proposed` at version 1 with
 * the actor as proposer. This is the ONE place raw `save()` is legitimate —
 * save is INSERT-only (creating a new Work); every subsequent state change
 * goes through get + CAS (updateIfVersion), never through save. A duplicate
 * workId is a conflict result (`work-already-exists`), not a throw.
 */
export async function proposeWork(
  cmd: ProposeWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  if (!cmd.companyId || !cmd.workId || !cmd.delegationId || !cmd.description) {
    return { ok: false, reason: 'invalid-command' };
  }
  const work: Work = {
    workId: cmd.workId,
    companyId: cmd.companyId,
    delegationId: cmd.delegationId,
    proposer: cmd.actor,
    description: cmd.description,
    state: 'proposed',
    version: 1,
    fencingToken: 0,
    evidenceRefs: cmd.evidenceRefs ?? [],
    deliverable: cmd.deliverable,
  };
  try {
    const saved = await deps.work.save(work);
    return { ok: true, value: saved };
  } catch {
    // save() is insert-only (uq_work_work_id / fake parity): the duplicate is
    // a conflict the caller must resolve, not a thrown control-flow exception.
    return { ok: false, reason: 'work-already-exists' };
  }
}
