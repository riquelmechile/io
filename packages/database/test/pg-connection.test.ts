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
  class MockPool {
    readonly options: { connectionString: string };
    query = queryMock;
    end = endMock;
    on = vi.fn();
    constructor(options: { connectionString: string }) {
      this.options = options;
      ctorCalls.push(options);
    }
  }
  return { Pool: MockPool, ctorCalls, queryMock, endMock };
});

vi.mock('pg', () => ({ Pool: pg.Pool }));

const CONN = 'postgresql://io:io_dev@localhost:5432/io_dev';

describe('PgDbConnection (Req: PgDbConnection Implementation; D2/D6)', () => {
  beforeEach(() => {
    pg.ctorCalls.length = 0;
    pg.queryMock.mockReset();
    pg.endMock.mockReset().mockResolvedValue(undefined);
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

    it('the DbConnection port declares ONLY execute/query — close() is extra', () => {
      expectTypeOf<keyof DbConnection>().toEqualTypeOf<'execute' | 'query'>();
    });

    it('PgDbConnection is assignable to DbConnection (implements the port)', () => {
      expectTypeOf<
        import('../src/pg-connection.js').PgDbConnection
      >().toMatchTypeOf<DbConnection>();
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
