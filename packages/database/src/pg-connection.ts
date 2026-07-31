import { Pool, types as pgTypes } from 'pg';

import { NestedTransactionError, type DbConnection } from './connection.js';

/**
 * Live PostgreSQL adapter for the ASYNC {@link DbConnection} port (Req: PgDbConnection
 * Implementation; D2/D6). Wraps a `pg.Pool`: `execute`/`query` delegate to
 * `pool.query`, returning a `Promise` (D1 — the `pg` driver is TCP-based and
 * fundamentally async, so a `Promise` is the only honest completion contract).
 *
 * - **Lazy pool (D6)**: no `Pool` is constructed until the first query runs, and
 *   one pool is reused thereafter. Construction is therefore side-effect free.
 * - **`close()` is NOT on the port**: pool lifecycle (sizing, health checks,
 *   teardown) stays outside `DbConnection`, so in-memory fakes stay close-free.
 *   `close()` ends the pool; calling it before any query is a safe no-op.
 * - **Error mapping**: `pg` rejections propagate as-is (caught by `await` in the
 *   adapters). No swallowing, no classification (deferred to hardening).
 */
export class PgDbConnection implements DbConnection {
  private pool?: Pool;

  constructor(private readonly connectionString: string) {}

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        // pg returns int8 (BIGINT, OID 20) as a STRING by default because a
        // BIGINT can overflow a JS number. PersistentRecord.timestamp is an
        // epoch-millis value that always fits within Number.MAX_SAFE_INTEGER, so
        // coerce int8 -> number at the pool level to keep the round-trip
        // type-faithful (Req: Schema round-trip survives intact). This is pool /
        // driver config (D6), confined to the driver owner (D4) — the port and
        // adapters stay schema- and driver-agnostic; other OIDs and the binary
        // protocol fall through to pg's default parsers.
        types: {
          getTypeParser(oid, format) {
            if (oid === 20 && format !== 'binary') {
              return (value: string) => Number(value);
            }
            return pgTypes.getTypeParser(oid, format);
          },
        },
      });
      // R4-001 fix: an idle client whose underlying TCP connection breaks
      // (PG restart, network partition) makes the Pool emit 'error'. Per the
      // Node.js EventEmitter contract, an unhandled 'error' event throws and
      // terminates the process. Attach a no-op handler so idle-client errors
      // do not crash; query-path errors still propagate via the awaited
      // pool.query() rejection in execute()/query() above.
      this.pool.on('error', () => {});
    }
    return this.pool;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    // INSERT/UPDATE — the statement result is surfaced as `unknown` (D2). Callers
    // that route a record via save() never read it, but returning it (rather than
    // discarding) keeps the declared `Promise<unknown>` return honest under TS
    // strict (TS2355) and lets a future caller read a row count if needed.
    return await this.getPool().query(sql, [...params]);
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    const result = await this.getPool().query(sql, [...params]);
    return result.rows as readonly T[]; // SELECT — columns aliased to shape rows to T (D7)
  }

  async transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    const txConn: DbConnection = {
      execute: async (sql, params) => client.query(sql, [...params]),
      query: async <R>(sql: string, params: readonly unknown[]) => {
        const result = await client.query(sql, [...params]);
        return result.rows as readonly R[];
      },
      transaction: async () => {
        throw new NestedTransactionError();
      },
    };
    try {
      await client.query('BEGIN');
      const result = await fn(txConn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors; surface the original
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

/**
 * Env-first PostgreSQL connection string (design code block). `DATABASE_URL` wins
 * when set; otherwise the local io/io_dev default is used. Zero secrets in code.
 */
export function pgConnectionString(): string {
  return process.env.DATABASE_URL ?? 'postgresql://io:io_dev@localhost:5432/io_dev';
}
