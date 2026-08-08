import type { WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/**
 * startWork (D3 + fencing-tokens): accepted → in_progress via get + CAS. The
 * claim CAS carries the `claim` FencingDirective, so the winner mints and
 * returns the NEXT server-side fencing token atomically in the SAME statement
 * (epoch 0 → 1 on the first claim); losers get `version-conflict` and never
 * mint. Resume WITHOUT a fresh claim retains the stored token (no increment).
 */
export async function startWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository },
): Promise<UseCaseResult<Work>> {
  return applyWorkTransition('in_progress', cmd, deps.work, undefined, { kind: 'claim' });
}
