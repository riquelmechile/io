import { describe, expect, it } from 'vitest';

import { PERSISTENT_PORT_DISCLOSURE } from '../src/disclosure.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * InMemoryDbConnection test double (Req 4). It records every execute/query as
 * `{ sql, params }` AND stores rows so query round-trips data written by execute
 * — all in-memory only (methods return Promise, instant resolution). It is NOT
 * durable and NOT real PostgreSQL.
 */

describe('InMemoryDbConnection test double (Req 4)', () => {
  describe('records every operation and round-trips data (scenario 1)', () => {
    it('records execute and query calls as { sql, params } in call order', async () => {
      const db = new InMemoryDbConnection();
      await db.execute('INSERT INTO evidence (action_id, principal_id) VALUES ($1,$2)', [
        'a1',
        'p1',
      ]);
      await db.query('SELECT action_id AS "actionId" FROM evidence WHERE action_id = $1', ['a1']);

      expect(db.operations).toEqual([
        {
          sql: 'INSERT INTO evidence (action_id, principal_id) VALUES ($1,$2)',
          params: ['a1', 'p1'],
        },
        {
          sql: 'SELECT action_id AS "actionId" FROM evidence WHERE action_id = $1',
          params: ['a1'],
        },
      ]);
    });

    it('round-trips data written via execute through query', async () => {
      const db = new InMemoryDbConnection();
      await db.execute(
        'INSERT INTO evidence (action_id, principal_id, risk_class) VALUES ($1,$2,$3)',
        ['a1', 'p1', 'high'],
      );

      const rows = await db.query<{ actionId: string; principalId: string; riskClass: string }>(
        'SELECT action_id AS "actionId", principal_id AS "principalId", risk_class AS "riskClass" FROM evidence WHERE action_id = $1',
        ['a1'],
      );

      expect(rows).toEqual([{ actionId: 'a1', principalId: 'p1', riskClass: 'high' }]);
    });

    it('returns an empty array when no stored row matches', async () => {
      const db = new InMemoryDbConnection();
      await db.execute('INSERT INTO evidence (action_id) VALUES ($1)', ['a1']);

      const rows = await db.query(
        'SELECT action_id AS "actionId" FROM evidence WHERE action_id = $1',
        ['missing'],
      );

      expect(rows).toEqual([]);
    });

    it('maps each SELECT column only through its AS alias (snake_case -> camelCase)', async () => {
      const db = new InMemoryDbConnection();
      await db.execute('INSERT INTO t (snake_name) VALUES ($1)', ['v']);

      const rows = await db.query<{ snakeName: string }>(
        'SELECT snake_name AS "snakeName" FROM t WHERE snake_name = $1',
        ['v'],
      );

      expect(rows).toEqual([{ snakeName: 'v' }]);
    });
  });

  describe('honest non-durable disclosure (scenario 2; threat: honesty)', () => {
    it('reuses the package PERSISTENT_PORT_DISCLOSURE and defers durability to the adapter', () => {
      const db = new InMemoryDbConnection();

      // Reuses the SAME disclosure the adapters and kernel use (D6).
      expect(db.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      // Honestly conveys it is NOT durable: durability depends on the adapter.
      expect(db.disclosure.toLowerCase()).toContain('depends on the adapter');
      // Makes NO false claim of being durable in real PostgreSQL.
      expect(db.disclosure.toLowerCase()).not.toContain('durable in postgresql');
    });
  });

  describe('fake transaction commit keeps and error restores (scenario 3)', () => {
    it('a successful transaction commits: its writes persist after it resolves', async () => {
      const db = new InMemoryDbConnection();

      await db.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['committed']);
      });

      const rows = await db.query<{ a: string }>('SELECT a FROM t WHERE a = $1', ['committed']);
      expect(rows).toEqual([{ a: 'committed' }]);
    });

    it('a failed transaction restores the prior snapshot and rethrows the ORIGINAL error', async () => {
      const db = new InMemoryDbConnection();
      await db.execute('INSERT INTO t (a) VALUES ($1)', ['before-tx']);
      const boom = new Error('boom inside tx');

      await expect(
        db.transaction(async (tx) => {
          await tx.execute('INSERT INTO t (a) VALUES ($1)', ['partial']);
          throw boom;
        }),
      ).rejects.toBe(boom); // identity: the original error, not a wrapper

      // No partial write survived the rollback…
      const after = await db.query<{ a: string }>('SELECT a FROM t', []);
      expect(after).toEqual([{ a: 'before-tx' }]);
      // …and the pre-transaction state is fully intact.
      const pre = await db.query<{ a: string }>('SELECT a FROM t WHERE a = $1', ['before-tx']);
      expect(pre).toEqual([{ a: 'before-tx' }]);
    });

    it('a nested transaction on the tx-scoped connection throws', async () => {
      const db = new InMemoryDbConnection();

      await db.transaction(async (tx) => {
        await expect(tx.transaction(async () => 'nested')).rejects.toThrow(/nested/i);
        // The outer transaction is unaffected by the rejected nested attempt.
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['outer-continues']);
      });

      const rows = await db.query<{ a: string }>('SELECT a FROM t', []);
      expect(rows).toEqual([{ a: 'outer-continues' }]);
    });
  });

  describe('fake mirrors PostgreSQL transaction semantics (scenario 4)', () => {
    it('produces the same observable outcomes real PG produces (commit persists, error leaves no partial write, nesting throws)', async () => {
      const db = new InMemoryDbConnection();

      // PG-observable contract, mirrored exactly by the fake (D1):
      // 1) COMMIT persists the write for later reads outside the transaction.
      await db.transaction(async (tx) => {
        await tx.execute('INSERT INTO t (a) VALUES ($1)', ['mirror-commit']);
      });
      const committed = await db.query<{ a: string }>('SELECT a FROM t WHERE a = $1', [
        'mirror-commit',
      ]);
      expect(committed).toEqual([{ a: 'mirror-commit' }]);

      // 2) ROLLBACK leaves NO partial write behind.
      const boom = new Error('mirror rollback');
      await expect(
        db.transaction(async (tx) => {
          await tx.execute('INSERT INTO t (a) VALUES ($1)', ['mirror-partial']);
          throw boom;
        }),
      ).rejects.toBe(boom);
      const rolledBack = await db.query<{ a: string }>('SELECT a FROM t WHERE a = $1', [
        'mirror-partial',
      ]);
      expect(rolledBack).toEqual([]);

      // 3) Nesting throws on the transaction-scoped connection.
      await db.transaction(async (tx) => {
        await expect(tx.transaction(async () => 1)).rejects.toThrow(/nested/i);
      });
    });
  });
});
