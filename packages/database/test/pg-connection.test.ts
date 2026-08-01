import { describe, expect, expectTypeOf, it, vi, beforeEach } from 'vitest';

import type { DbConnection } from '../src/connection.js';

/**
 * PgDbConnection (Req: PgDbConnection Implementation; D2/D6). This is a UNIT
 * test over a MOCKED `pg.Pool` — it asserts the lazy lifecycle, the
 * execute/query delegation shape, error propagation, and that `close()` ends the
 * pool WITHOUT being declared on the `DbConnection` port. No real PostgreSQL is
 * touched here (the real round-trip is the Slice-3 integration test).
 *
 * `pg` is mocked via vi.hoisted so the module factory (hoisted above imports)
 * shares the same vi.fn handles the assertions read.
 */
const pg = vi.hoisted(() => {
  const ctorCalls: Array<{ connectionString: string }> = [];
  const queryMock = vi.fn();
  const endMock = vi.fn().mockResolvedValue(undefined);
  // Per-connection client the Pool yields to transaction() (pool.connect()).
  const clientQueryMock = vi.fn();
  const releaseMock = vi.fn();
  // A real pg Client extends EventEmitter; transaction() relies on
  // on('error')/removeListener('error') for the checked-out-client safety net
  // (R4-001 parity). Mirror that contract — including Node's rule that an
  // 'error' event with NO listener throws — so the tests exercise the real
  // crash path the production code must prevent.
  class MockClient {
    query = clientQueryMock;
    release = releaseMock;
    private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    on(event: string, listener: (...args: unknown[]) => void): this {
      const existing = this.listeners[event];
      if (existing === undefined) {
        this.listeners[event] = [listener];
      } else {
        existing.push(listener);
      }
      return this;
    }
    removeListener(event: string, listener: (...args: unknown[]) => void): this {
      this.listeners[event] = (this.listeners[event] ?? []).filter((l) => l !== listener);
      return this;
    }
    listenerCount(event: string): number {
      return (this.listeners[event] ?? []).length;
    }
    emit(event: string, ...args: unknown[]): boolean {
      const ls = this.listeners[event] ?? [];
      if (ls.length === 0) {
        if (event === 'error') {
          throw args[0] instanceof Error ? args[0] : new Error('Unhandled error event');
        }
        return false;
      }
      for (const l of ls) l(...args);
      return true;
    }
  }
  const connectMock = vi.fn().mockImplementation(() => new MockClient());
  class MockPool {
    readonly options: { connectionString: string };
    query = queryMock;
    end = endMock;
    on = vi.fn();
    connect = connectMock;
    constructor(options: { connectionString: string }) {
      this.options = options;
      ctorCalls.push(options);
    }
  }
  return {
    Pool: MockPool,
    ctorCalls,
    queryMock,
    endMock,
    clientQueryMock,
    releaseMock,
    connectMock,
  };
});

vi.mock('pg', () => ({ Pool: pg.Pool }));

const CONN = 'postgresql://io:io_dev@localhost:5432/io_dev';

describe('PgDbConnection (Req: PgDbConnection Implementation; D2/D6)', () => {
  beforeEach(() => {
    pg.ctorCalls.length = 0;
    pg.queryMock.mockReset();
    pg.endMock.mockReset().mockResolvedValue(undefined);
    pg.clientQueryMock.mockReset().mockResolvedValue({ rows: [] });
    pg.releaseMock.mockReset();
    // Clear (not reset) so the mockImplementation stays but call/results are
    // scoped to THIS test — connectMock.mock.results[0] is then the client the
    // current transaction actually checked out.
    pg.connectMock.mockClear();
  });

  describe('lazy pool lifecycle (D6)', () => {
    it('does NOT construct a pg.Pool at construction (lazy)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      new PgDbConnection(CONN);
      expect(pg.ctorCalls).toHaveLength(0);
    });

    it('constructs the Pool on the first execute, carrying the connection string', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [], rowCount: 1 });
      const conn = new PgDbConnection(CONN);
      await conn.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
      expect(pg.ctorCalls).toHaveLength(1);
      expect(pg.ctorCalls[0]?.connectionString).toBe(CONN);
    });

    it('reuses ONE Pool across repeated calls (lazy singleton)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [] });
      const conn = new PgDbConnection(CONN);
      await conn.execute('SELECT 1', []);
      await conn.query<{ n: number }>('SELECT 2', []);
      await conn.execute('SELECT 3', []);
      expect(pg.ctorCalls).toHaveLength(1);
    });
  });

  describe('execute() delegates to pool.query', () => {
    it('awaits pool.query(sql, [...params]) and resolves its result', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const result = { rows: [], rowCount: 1 };
      pg.queryMock.mockResolvedValue(result);
      const conn = new PgDbConnection(CONN);
      await expect(conn.execute('UPDATE t SET a = $1 WHERE b = $2', ['x', true])).resolves.toBe(
        result,
      );
      expect(pg.queryMock).toHaveBeenCalledWith('UPDATE t SET a = $1 WHERE b = $2', ['x', true]);
    });

    it('spreads a readonly params array into a fresh mutable array', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      const conn = new PgDbConnection(CONN);
      const params: readonly unknown[] = ['a', 1, true];
      await conn.execute('INSERT INTO t VALUES ($1,$2,$3)', params);
      const passed = pg.queryMock.mock.calls[0]?.[1];
      expect(passed).toEqual(['a', 1, true]);
      expect(Array.isArray(passed)).toBe(true);
    });
  });

  describe('query<T>() returns result.rows as a readonly array', () => {
    it('returns the rows pool.query resolved with', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }] });
      const conn = new PgDbConnection(CONN);
      const rows = await conn.query<{ n: number }>('SELECT n FROM t', []);
      expect(rows).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    it('passes the sql and spread params to pool.query', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [] });
      const conn = new PgDbConnection(CONN);
      await conn.query('SELECT a FROM t WHERE id = $1', [42]);
      expect(pg.queryMock).toHaveBeenCalledWith('SELECT a FROM t WHERE id = $1', [42]);
    });
  });

  describe('errors propagate (D6 error mapping — no swallowing)', () => {
    it('rejects when pool.query rejects (execute)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockRejectedValue(new Error('syntax error'));
      const conn = new PgDbConnection(CONN);
      await expect(conn.execute('BOGUS', [])).rejects.toThrow('syntax error');
    });

    it('rejects when pool.query rejects (query)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockRejectedValue(new Error('relation missing'));
      const conn = new PgDbConnection(CONN);
      await expect(conn.query('SELECT 1 FROM nope', [])).rejects.toThrow('relation missing');
    });
  });

  describe('close() ends the pool but is NOT on the port', () => {
    it('ends the underlying pool once created', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      pg.queryMock.mockResolvedValue({ rows: [] });
      const conn = new PgDbConnection(CONN);
      await conn.execute('SELECT 1', []); // force pool creation
      await conn.close();
      expect(pg.endMock).toHaveBeenCalledTimes(1);
    });

    it('is a safe no-op when no pool was ever created', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);
      await expect(conn.close()).resolves.toBeUndefined();
      expect(pg.endMock).not.toHaveBeenCalled();
    });

    it('the DbConnection port declares execute/query/transaction — close() is extra', () => {
      expectTypeOf<keyof DbConnection>().toEqualTypeOf<'execute' | 'query' | 'transaction'>();
    });

    it('PgDbConnection is assignable to DbConnection (implements the port)', () => {
      expectTypeOf<
        import('../src/pg-connection.js').PgDbConnection
      >().toMatchTypeOf<DbConnection>();
    });
  });

  describe('transaction() — BEGIN/COMMIT/ROLLBACK lifecycle over a pooled client (D1)', () => {
    it('acquires a client via pool.connect(), BEGINs, runs fn on the client, COMMITs, releases, resolves fn result', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);

      const result = await conn.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
        const rows = await tx.query<{ n: number }>('SELECT n FROM t', []);
        return { rows, marker: 'from-fn' };
      });

      expect(result).toEqual({ rows: [], marker: 'from-fn' });
      // The transaction's statements went to the CLIENT (BEGIN → fn → COMMIT),
      // not to the pool-level query path.
      const clientCalls = pg.clientQueryMock.mock.calls.map((call) => call[0]);
      expect(clientCalls).toEqual([
        'BEGIN',
        'INSERT INTO t (a) VALUES ($1)',
        'SELECT n FROM t',
        'COMMIT',
      ]);
      expect(pg.queryMock).not.toHaveBeenCalled();
      expect(pg.connectMock).toHaveBeenCalledTimes(1);
      expect(pg.releaseMock).toHaveBeenCalledTimes(1);
    });

    it('spreads readonly params into a mutable array on the client', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);
      const params: readonly unknown[] = ['a', 1];

      await conn.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a, b) VALUES ($1, $2)', params);
      });

      const passed = pg.clientQueryMock.mock.calls[1]?.[1];
      expect(passed).toEqual(['a', 1]);
      expect(Array.isArray(passed)).toBe(true);
    });

    it('fn throw → ROLLBACK + release + rethrow of the ORIGINAL error', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);
      const boom = new Error('boom from fn');

      await expect(
        conn.transaction(async (tx) => {
          await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
          throw boom;
        }),
      ).rejects.toBe(boom); // identity: the ORIGINAL error, not a wrapper

      const clientCalls = pg.clientQueryMock.mock.calls.map((call) => call[0]);
      expect(clientCalls).toEqual(['BEGIN', 'INSERT INTO t (a) VALUES ($1)', 'ROLLBACK']);
      expect(pg.clientQueryMock.mock.calls.map((call) => call[0])).not.toContain('COMMIT');
      expect(pg.releaseMock).toHaveBeenCalledTimes(1);
    });

    it('a transaction call on the tx-scoped connection throws (nesting forbidden)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);

      await conn.transaction(async (tx) => {
        await expect(tx.transaction(async () => 'nested')).rejects.toThrow(/nested/i);
        // The outer transaction is unaffected by the rejected nested attempt.
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['outer-continues']);
      });

      const clientCalls = pg.clientQueryMock.mock.calls.map((call) => call[0]);
      expect(clientCalls).toEqual(['BEGIN', 'INSERT INTO t (a) VALUES ($1)', 'COMMIT']);
    });
  });

  describe('transaction() — checked-out-client error safety + rollback error fidelity (R4-001 parity)', () => {
    // pg-pool removes the idle 'error' listener on acquire and only re-adds it
    // on release, so a checked-out client has NO 'error' listener for the tx's
    // lifetime. A backend death mid-tx (during a non-DB await) would emit an
    // unhandled 'error' → uncaughtException → process crash. R4-001's
    // pool.on('error') only covers IDLE clients; these tests pin the same
    // guarantee for the CHECKED-OUT client, plus rollback error fidelity.
    type Client = {
      emit: (event: string, ...args: unknown[]) => boolean;
      listenerCount: (event: string) => number;
    };
    const checkedOutClient = (): Client =>
      pg.connectMock.mock.results[0]?.value as unknown as Client;

    it('attaches an error listener to the checked-out client during the tx and removes it in finally', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);

      let listenerCountDuringTx = -1;
      await conn.transaction(async (tx) => {
        listenerCountDuringTx = checkedOutClient().listenerCount('error');
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
      });

      expect(listenerCountDuringTx).toBe(1); // safety net present mid-tx
      expect(checkedOutClient().listenerCount('error')).toBe(0); // removed after
    });

    it('captures a client error mid-tx (NO uncaughtException) and releases the client WITH the error so the pool discards it', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);
      const connectionError = new Error('connection terminated unexpectedly');

      const uncaught = vi.fn();
      process.on('uncaughtException', uncaught);
      try {
        // The backend dies during fn's INSERT: the client emits the
        // connection-break 'error' event (handled ONLY if the tx attached a
        // listener) and the awaited query rejects, so the tx rejects cleanly.
        pg.clientQueryMock.mockImplementation(async (sql: string) => {
          if (sql === 'INSERT INTO t (a) VALUES ($1)') {
            checkedOutClient().emit('error', connectionError);
            throw connectionError;
          }
          return { rows: [] }; // BEGIN / ROLLBACK / COMMIT
        });

        await expect(
          conn.transaction(async (tx) => {
            await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
          }),
        ).rejects.toBe(connectionError); // atomicity: the tx still rejects
      } finally {
        process.removeListener('uncaughtException', uncaught);
      }

      // Released WITH the captured error → the pool discards the broken client.
      expect(pg.releaseMock).toHaveBeenCalledWith(connectionError);
      expect(uncaught).not.toHaveBeenCalled(); // no process crash
    });

    it('releases a healthy client without an error on success (pool may reuse it)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);

      await conn.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
      });

      expect(pg.releaseMock).toHaveBeenCalledTimes(1);
      expect(pg.releaseMock).toHaveBeenCalledWith(undefined); // no error → reusable
    });

    it('when ROLLBACK itself rejects, the ORIGINAL fn error still propagates (rollback error swallowed)', async () => {
      const { PgDbConnection } = await import('../src/pg-connection.js');
      const conn = new PgDbConnection(CONN);
      const fnError = new Error('boom from fn');
      const rollbackError = new Error('rollback failed: connection gone');

      pg.clientQueryMock.mockImplementation(async (sql: string) => {
        if (sql === 'ROLLBACK') throw rollbackError;
        return { rows: [] };
      });

      await expect(
        conn.transaction(async (tx) => {
          await tx.execute('INSERT INTO t (a) VALUES ($1)', ['x']);
          throw fnError;
        }),
      ).rejects.toBe(fnError); // identity: the ORIGINAL fn error, NOT the rollback error

      expect(pg.releaseMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('pgConnectionString() — env-first factory', () => {
    it('defaults to the local io/io_dev string when DATABASE_URL is unset', async () => {
      const { pgConnectionString } = await import('../src/pg-connection.js');
      const saved = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        expect(pgConnectionString()).toBe('postgresql://io:io_dev@localhost:5432/io_dev');
      } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
      }
    });

    it('prefers DATABASE_URL when set', async () => {
      const { pgConnectionString } = await import('../src/pg-connection.js');
      const saved = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://prod:secret@db.example:5432/io';
      try {
        expect(pgConnectionString()).toBe('postgresql://prod:secret@db.example:5432/io');
      } finally {
        if (saved !== undefined) process.env.DATABASE_URL = saved;
        else delete process.env.DATABASE_URL;
      }
    });
  });
});
