import { describe, expect, it } from 'vitest';

import { PERSISTENT_PORT_DISCLOSURE } from '../src/disclosure.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * InMemoryDbConnection test double (Req 4). It records every execute/query as
 * `{ sql, params }` AND stores rows so query round-trips data written by execute
 * — all synchronously, in-memory only. It is NOT durable and NOT real PostgreSQL.
 */

describe('InMemoryDbConnection test double (Req 4)', () => {
  describe('records every operation and round-trips data (scenario 1)', () => {
    it('records execute and query calls as { sql, params } in call order', () => {
      const db = new InMemoryDbConnection();
      db.execute('INSERT INTO evidence (action_id, principal_id) VALUES ($1,$2)', ['a1', 'p1']);
      db.query('SELECT action_id AS "actionId" FROM evidence WHERE action_id = $1', ['a1']);

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

    it('round-trips data written via execute through query synchronously', () => {
      const db = new InMemoryDbConnection();
      db.execute('INSERT INTO evidence (action_id, principal_id, risk_class) VALUES ($1,$2,$3)', [
        'a1',
        'p1',
        'high',
      ]);

      const rows = db.query<{ actionId: string; principalId: string; riskClass: string }>(
        'SELECT action_id AS "actionId", principal_id AS "principalId", risk_class AS "riskClass" FROM evidence WHERE action_id = $1',
        ['a1'],
      );

      expect(rows).toEqual([{ actionId: 'a1', principalId: 'p1', riskClass: 'high' }]);
    });

    it('returns an empty array synchronously when no stored row matches', () => {
      const db = new InMemoryDbConnection();
      db.execute('INSERT INTO evidence (action_id) VALUES ($1)', ['a1']);

      const rows = db.query('SELECT action_id AS "actionId" FROM evidence WHERE action_id = $1', [
        'missing',
      ]);

      expect(rows).toEqual([]);
    });

    it('maps each SELECT column only through its AS alias (snake_case -> camelCase)', () => {
      const db = new InMemoryDbConnection();
      db.execute('INSERT INTO t (snake_name) VALUES ($1)', ['v']);

      const rows = db.query<{ snakeName: string }>(
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
});
