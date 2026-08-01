import { Pool, types as pgTypes } from 'pg';

import type { DbConnection } from './connection.js';

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

  /**
   * Run `fn` inside a real PostgreSQL transaction (D1; spec: PgDbConnection
   * Implementation). Acquires a dedicated client from the pool, issues `BEGIN`,
   * then runs `fn` against a transaction-scoped connection exposing the SAME
   * three port operations — but scoped to THIS client, so every statement is
   * part of the transaction. On success it `COMMIT`s; if `fn` throws it
   * `ROLLBACK`s and RETHROWS THE ORIGINAL error (no wrapper, no swallowing).
   * The client is released in all cases. Nested transactions are FORBIDDEN:
   * the tx-scoped `transaction` throws immediately, mirroring the port
   * contract (spec scenario: Nested transaction throws).
   *
   * Checked-out-client error safety (R4-001 parity): pg-pool removes the idle
   * 'error' listener on acquire and only re-adds it on release, so a checked-out
   * client has NO 'error' listener for the tx's lifetime. If the backend dies
   * mid-tx during a non-DB await, the client emits 'error' with no listener →
   * uncaughtException → process crash. R4-001's `pool.on('error')` only covers
   * IDLE clients, so for the tx's lifetime we attach our own error-capturing
   * listener (removed in `finally`). On a connection error the client is
   * released WITH the error so the pool discards the broken connection; the tx
   * promise still rejects (atomicity preserved) but WITHOUT any
   * uncaughtException. ROLLBACK is wrapped in its own try/catch so a rollback
   * failure (broken connection) can never replace fn's ORIGINAL error.
   */
  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    let connectionError: Error | undefined;
    const onClientError = (error: Error): void => {
      connectionError = error;
    };
    client.on('error', onClientError);
    const tx: DbConnection = {
      execute: (sql: string, params: readonly unknown[]) => client.query(sql, [...params]),
      query: async <TRow>(sql: string, params: readonly unknown[]): Promise<readonly TRow[]> => {
        const result = await client.query(sql, [...params]);
        return result.rows as readonly TRow[];
      },
      transaction: () =>
        // Nested transactions are forbidden (spec scenario). The port contract
        // is ASYNC-only (every operation returns a Promise — a sync throw would
        // lie about completion), so the guard rejects instead of throwing
        // synchronously; `await` surfaces it either way.
        Promise.reject(new Error('nested transactions are forbidden')),
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      // ROLLBACK can itself reject (broken connection); swallow that error and
      // ALWAYS rethrow the ORIGINAL error from fn (error fidelity). Atomicity is
      // unaffected — the tx is aborted either way.
      try {
        await client.query('ROLLBACK');
      } catch {
        // A failed rollback must never mask fn's original error.
      }
      throw error;
    } finally {
      client.removeListener('error', onClientError);
      // Release WITH the captured connection error (if any) so the pool discards
      // the broken client; a healthy client is released error-free (reusable).
      client.release(connectionError);
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
