import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/** rejectWork (D3): proposed|completed → rejected via get + CAS. */
export async function rejectWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  return applyWorkTransition('rejected', cmd, deps.work);
}
