import type { IdempotencyRegisterResult, IdempotencyStore } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL adapter for the company-scoped {@link IdempotencyStore} port.
 * UNIQUE(company_id, operation, key) is enforced by the schema.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async register(
    companyId: string,
    op: string,
    key: string,
    hash: string,
  ): Promise<IdempotencyRegisterResult> {
    const existing = await this.conn.query<{
      requestHash: string;
      status: string;
      result: unknown;
    }>(
      'SELECT request_hash AS "requestHash", status, result ' +
        'FROM idempotency_journal WHERE company_id = $1 AND operation = $2 AND key = $3',
      [companyId, op, key],
    );
    const row = existing[0];
    if (row === undefined) {
      await this.conn.execute(
        'INSERT INTO idempotency_journal (company_id, operation, key, request_hash, status, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6)',
        [companyId, op, key, hash, 'in_progress', Date.now()],
      );
      return { status: 'proceed' };
    }
    if (row.requestHash !== hash) {
      return { status: 'conflict' };
    }
    if (row.status === 'completed') {
      return { status: 'replay', result: row.result };
    }
    return { status: 'proceed' };
  }

  async complete(
    companyId: string,
    op: string,
    key: string,
    hash: string,
    result: unknown,
  ): Promise<void> {
    await this.conn.execute(
      'UPDATE idempotency_journal SET status = $1, result = $2, completed_at = $3, request_hash = $4 ' +
        'WHERE company_id = $5 AND operation = $6 AND key = $7',
      ['completed', JSON.stringify(result), Date.now(), hash, companyId, op, key],
    );
  }
}
