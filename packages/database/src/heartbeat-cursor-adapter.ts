import type { HeartbeatCursor, HeartbeatCursorStore } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseHeartbeatCursorRow } from './row-guards.js';

/**
 * PostgreSQL-shaped adapter for the `HeartbeatCursorStore` port
 * (supervisor-timer, design migration 008). Implements the port over an
 * injected, ASYNC {@link DbConnection}: a tenant-scoped `get` (WHERE
 * company_id = $1) and an ATOMIC `upsert` — `INSERT ... ON CONFLICT
 * (company_id) DO UPDATE` — that creates-or-replaces EXACTLY ONE checkpoint for
 * that company and never touches another company's row (PRIMARY KEY
 * company_id, ADR-0002). An empty `companyId` is rejected BEFORE SQL (fake
 * parity). Only the supervisor writes cursors; the heartbeat gate/evaluator
 * remain read-only and unchanged. Rows read from PG are UNTRUSTED bytes: every
 * row passes {@link parseHeartbeatCursorRow} and a corrupt row throws loudly.
 */
export class PgHeartbeatCursorRepository implements HeartbeatCursorStore {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async get(companyId: string): Promise<HeartbeatCursor | undefined> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<HeartbeatCursor>(
      'SELECT last_event_id AS "lastEventId" FROM heartbeat_cursor WHERE company_id = $1',
      [companyId],
    );
    // At most one row (PRIMARY KEY company_id): no row → no checkpoint.
    if (rows.length === 0) return undefined;
    const parsed = parseHeartbeatCursorRow(rows[0]);
    if (!parsed.ok) {
      throw new Error(`corrupt heartbeat cursor row: ${parsed.reason}`);
    }
    return parsed.value;
  }

  async upsert(companyId: string, cursor: HeartbeatCursor): Promise<void> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    // Atomic create-or-replace for THIS company only (008 ON CONFLICT): one
    // row per company, always the latest cursor. updated_at is the write
    // timestamp, generated here (the port carries no clock).
    await this.conn.execute(
      'INSERT INTO heartbeat_cursor (company_id, last_event_id, updated_at) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (company_id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id, ' +
        'updated_at = EXCLUDED.updated_at',
      [companyId, cursor.lastEventId, Date.now()],
    );
  }
}
