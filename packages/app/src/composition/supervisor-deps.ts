import type { DbConnection } from '@io/database/src/connection.js';
import { PgBusinessEventRepository, PgHeartbeatCursorRepository } from '@io/database/src/index.js';

import type { SupervisorDeps } from '../supervisor/types.js';

/**
 * Supervisor composition root (supervisor-timer, design "Composition"): a
 * SIBLING of {@link buildWorkerDeps} that assembles the pool-bound supervisor
 * deps over one {@link DbConnection} — the append-only event log (company
 * discovery + stream reads) and the durable per-company heartbeat cursor
 * store. Both adapters bind the SAME pool connection (pool-bound only, no tx
 * twin): the supervisor writes ONLY cursors; the heartbeat gate/evaluator
 * remain read-only and unchanged. NOT called by `buildWorkerDeps` — the worker
 * root stays worker-only and this root stays supervisor-only.
 */
export function buildSupervisorDeps(connection: DbConnection): SupervisorDeps {
  return {
    events: new PgBusinessEventRepository(connection),
    cursors: new PgHeartbeatCursorRepository(connection),
  };
}
