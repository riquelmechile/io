import type { AuditRepository, PersistentRecord } from '@io/trust-kernel/src/index.js';

import type { DbConnection } from './connection.js';
import { PERSISTENT_PORT_DISCLOSURE } from './disclosure.js';
import { insertPersistentRecord, persistentRecordParams, selectPersistentRecords } from './sql.js';

/**
 * PostgreSQL-shaped adapter for the audit port (Req 3, R16). Implements the
 * kernel `AuditRepository<PersistentRecord>` over an injected, ASYNC
 * {@link DbConnection}. append() INSERTs one row then returns a FRESH getLog();
 * getLog() builds `SELECT ... FROM audit ORDER BY id ASC`. Because every read
 * reflects the committed store, append preserves insertion order and can never
 * mutate or drop a prior log reference (immutability, Req 3). Methods are ASYNC
 * (D1): they `await` the connection's execute/query.
 *
 * Honest disclosure (D6/Req 5): carries {@link PERSISTENT_PORT_DISCLOSURE}; this
 * slice does NOT satisfy persistent R1-R17.
 */
export class PgAuditRepository implements AuditRepository<PersistentRecord> {
  private readonly conn: DbConnection;
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async append(record: PersistentRecord): Promise<readonly PersistentRecord[]> {
    await this.conn.execute(insertPersistentRecord('audit'), persistentRecordParams(record));
    return this.getLog();
  }

  async getLog(): Promise<readonly PersistentRecord[]> {
    return this.conn.query<PersistentRecord>(
      selectPersistentRecords('audit', 'ORDER BY id ASC'),
      [],
    );
  }
}
