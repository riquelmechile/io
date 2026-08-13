import type { TransitionWorkCommand, UseCaseResult, Work } from '@io/business-domain/src/index.js';
import { acceptWork } from '@io/business-domain/src/index.js';

import { PgBusinessEventRepository } from './business-event-adapter.js';
import type { DbConnection } from './connection.js';
import { PgWorkRepository } from './work-adapter.js';

/**
 * The atomic acceptance wiring (design D2 / Atomic Acceptance Fact): runs the
 * accept-work use case with PG adapters bound to ONE `DbConnection.transaction`
 * — mirroring `completeWorkAtomically` (complete-work-flow.ts):
 *
 *   get (scoped) → state check → CAS (updateIfVersion) → append work.accepted
 *
 * The Work and event repositories share the transaction-scoped connection, so
 * the CAS and the event append commit TOGETHER or not at all:
 *   - `ok:true`  ⇒ COMMIT — Work@vN+1 AND exactly one `work.accepted` row
 *     persist atomically;
 *   - `ok:false` ⇒ COMMIT of an EMPTY transaction — every typed failure
 *     (`version-conflict`/`invalid-transition`/`not-found`/`invalid-command`)
 *     resolves PRE-WRITE inside `applyWorkTransition`, so NEITHER the Work
 *     mutation NOR any event persists (D6 commit-on-resolved);
 *   - a THROW (e.g. a post-CAS duplicate-event `append` rejection on
 *     `uq_business_event_event_id`) ⇒ ROLLBACK — NEITHER the accepted Work NOR
 *     the event persists (D2).
 * Decision logic stays in business-domain (acceptWork) over pure ports.
 */
export async function acceptWorkAtomically(
  conn: DbConnection,
  cmd: TransitionWorkCommand,
): Promise<UseCaseResult<Work>> {
  return conn.transaction(async (tx) => {
    const deps = {
      work: new PgWorkRepository(tx),
      events: new PgBusinessEventRepository(tx),
    };
    return acceptWork(cmd, deps);
  });
}
