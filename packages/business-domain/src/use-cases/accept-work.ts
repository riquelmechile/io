import type { BusinessEventRepository, WorkRepository } from '../ports/repositories.js';
import type { Work } from '../types.js';
import { buildWorkAcceptedEvent } from '../work-accepted-event.js';
import { applyWorkTransition } from './result.js';
import type { TransitionWorkCommand, UseCaseResult } from './result.js';

/** acceptWork (D1/D3/D6): proposed → accepted via get + CAS. On `ok:true`,
 * appends EXACTLY ONE deterministic `work.accepted` event (cold-start delta:
 * Atomic Acceptance Fact) built from the accepted Work. Every typed failure
 * (`version-conflict`, `invalid-transition`, `not-found`, `invalid-command`)
 * resolves PRE-WRITE inside `applyWorkTransition` — a `{ok:false}` VALUE,
 * never a thrown exception for control flow — so a failure appends NOTHING.
 * A post-CAS failure (e.g. a duplicate `append` rejection) propagates so the
 * enclosing transaction rolls back (D2/D6): that is a real post-write failure,
 * not typed-failure control flow. Zero `@io/*` imports — ports + local
 * modules only. */
export async function acceptWork(
  cmd: TransitionWorkCommand,
  deps: { work: WorkRepository; events: BusinessEventRepository; now?: () => number },
): Promise<UseCaseResult<Work>> {
  const result = await applyWorkTransition('accepted', cmd, deps.work);
  if (!result.ok) return result;
  await deps.events.append(buildWorkAcceptedEvent(result.value, deps.now));
  return result;
}
