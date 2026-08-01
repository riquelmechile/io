import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/** startWork (D3): accepted → in_progress via get + CAS. */
export async function startWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  return applyWorkTransition('in_progress', cmd, deps.work);
}
