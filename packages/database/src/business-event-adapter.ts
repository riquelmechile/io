import type { BusinessEvent } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseBusinessEventRow } from './row-guards.js';

/**
 * PostgreSQL-shaped adapter for the BusinessEvent repository port (design §006,
 * R4 insert-only persistence). Implements `BusinessEventRepository` over an
 * injected, ASYNC {@link DbConnection}. Business events are immutable facts
 * (append-only log): `append()` INSERTs and there is NO update/delete/overwrite
 * method — the port and the adapter surface are exactly `append` + `listByCompany`.
 *
 * `company_id` (tenant scope, ADR-0002) is written on append and every read is
 * SCOPED: `listByCompany` is `WHERE company_id = $1 ORDER BY id ASC` so a list
 * under one tenant can never return another tenant's events (R8). Single
 * issuance is enforced by the 006 UNIQUE index `uq_business_event_event_id`:
 * a duplicate `event_id` (evt:{attemptId}) is REJECTED at the database level —
 * no upsert — and the ORIGINAL row is preserved (R7).
 *
 * Like the receipt adapter, the same construction works for a pool connection
 * OR a transaction-scoped connection: the worker binds `new
 * PgBusinessEventRepository(conn)` inside `connection.transaction` (PR3) so the
 * append commits atomically with the Work CAS + receipt + journal.complete.
 * Rows read from PG are UNTRUSTED bytes: every row passes
 * {@link parseBusinessEventRow} (D7) and a corrupt row throws loudly. Methods
 * are ASYNC (D1).
 */
export class PgBusinessEventRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async append(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    if (!event.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    await this.conn.execute(
      'INSERT INTO business_event (event_id, company_id, aggregate_kind, aggregate_id, ' +
        'event_type, occurred_at, payload, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        event.eventId,
        event.companyId,
        event.aggregateKind,
        event.aggregateId,
        event.eventType,
        event.occurredAt,
        JSON.stringify(event.payload),
        event.source,
        Date.now(),
      ],
    );
    return event;
  }

  async listByCompany(companyId: string): Promise<readonly BusinessEvent[]> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<BusinessEvent>(
      'SELECT event_id AS "eventId", company_id AS "companyId", aggregate_kind AS "aggregateKind", ' +
        'aggregate_id AS "aggregateId", event_type AS "eventType", occurred_at AS "occurredAt", ' +
        'payload, source FROM business_event WHERE company_id = $1 ORDER BY id ASC',
      [companyId],
    );
    // Rows read from PG are untrusted bytes: validate at runtime before use
    // (D7). A corrupt row is an integrity violation — fail loudly.
    return rows.map((row) => {
      const parsed = parseBusinessEventRow(row);
      if (!parsed.ok) {
        throw new Error(`corrupt business event row: ${parsed.reason}`);
      }
      return parsed.value;
    });
  }
}
