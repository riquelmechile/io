import type { EvidenceRepository, PersistentRecord } from '@io/trust-kernel/src/index.js';

import type { DbConnection } from './connection.js';
import { PERSISTENT_PORT_DISCLOSURE } from './disclosure.js';
import { insertPersistentRecord, persistentRecordParams, selectPersistentRecords } from './sql.js';

/**
 * PostgreSQL-shaped adapter for the evidence port (Req 2, R7). Implements the
 * kernel `EvidenceRepository<PersistentRecord>` over an injected, SYNCHRONOUS
 * {@link DbConnection}. SQL lives HERE, never in the connection (D5): save()
 * binds every field as `$1..$8`; get() aliases columns so rows map straight to
 * PersistentRecord. The optional session/transaction context is accepted and
 * ignored (DbSession shape is deferred to the live-PG slice, D2).
 *
 * Honest disclosure (D6/Req 5): carries {@link PERSISTENT_PORT_DISCLOSURE}; this
 * slice does NOT satisfy persistent R1-R17 (the connection is still an in-memory
 * fake, not real PostgreSQL).
 */
export class PgEvidenceRepository implements EvidenceRepository<PersistentRecord> {
  private readonly conn: DbConnection;
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  save(record: PersistentRecord, _session?: unknown): Readonly<PersistentRecord> {
    this.conn.execute(insertPersistentRecord('evidence'), persistentRecordParams(record));
    return record;
  }

  get(actionId: string): PersistentRecord | undefined {
    const rows = this.conn.query<PersistentRecord>(
      selectPersistentRecords('evidence', 'WHERE action_id = $1'),
      [actionId],
    );
    return rows[0];
  }
}
