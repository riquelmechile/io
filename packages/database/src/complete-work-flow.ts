import type {
  CompleteWorkCommand,
  CompleteWorkDeps,
  UseCaseResult,
  Work,
} from '@io/business-domain/src/index.js';
import { completeWork } from '@io/business-domain/src/index.js';

import { PgBusinessReceiptRepository } from './business-receipt-adapter.js';
import type { DbConnection } from './connection.js';
import { PgIdempotencyJournalRepository } from './idempotency-adapter.js';
import { PgWorkRepository } from './work-adapter.js';

/**
 * The atomic terminal close wiring (design D6 / Atomic Terminal Flow): runs the
 * complete-work use case with PG adapters bound to ONE `DbConnection.transaction`:
 *
 *   journal.lookup → replay | DENY | continue
 *   → insert(in_flight) → updateIfVersion (CAS) → receipt(terminal_event_id = attempt_id)
 *   → journal.complete
 *
 * Every step shares the transaction-scoped connection, so ANY throw rolls the
 * WHOLE flow back — no partial journal row, no half-applied CAS, no orphan
 * receipt. This is the idempotency demonstration called by the live-PG
 * integration suite; the decision logic itself stays in business-domain
 * (completeWork) over pure ports.
 */
export async function completeWorkAtomically(
  conn: DbConnection,
  cmd: CompleteWorkCommand,
): Promise<UseCaseResult<Work>> {
  return conn.transaction(async (tx) => {
    const deps: CompleteWorkDeps = {
      work: new PgWorkRepository(tx),
      receipts: new PgBusinessReceiptRepository(tx),
      journal: new PgIdempotencyJournalRepository(tx),
    };
    return completeWork(cmd, deps);
  });
}
