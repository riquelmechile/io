import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/** acceptWork (D3): proposed → accepted via get + CAS. */
export async function acceptWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  return applyWorkTransition('accepted', cmd, deps.work);
}
