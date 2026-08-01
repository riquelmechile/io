import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/** verifyWork (D3): completed → verified via get + CAS. */
export async function verifyWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  return applyWorkTransition('verified', cmd, deps.work);
}
