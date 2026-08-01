import { describe, expect, it } from 'vitest';

import { PgIdempotencyJournalRepository } from '../src/idempotency-adapter.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * PG adapter unit tests for the idempotency journal (design D6, 004 table).
 * Uses {@link InMemoryDbConnection} which records SQL+params and stores rows
 * for round-trip. Asserts exact SQL shape ($N binding order, AS "camelCase"
 * aliases) and the in_flight → completed lifecycle through the fake connection,
 * including the stored result_json for replay. Empty-companyId guards match the
 * fake's requireCompanyId parity contract (task 2.11 pattern).
 */

function entry() {
  return {
    companyId: 'acme',
    idempotencyKey: 'key-1',
    requestHash: 'hash-1',
    attemptId: 'att:acme:key-1',
  };
}

describe('PgIdempotencyJournalRepository', () => {
  describe('insertInFlight() SQL shape', () => {
    it('emits INSERT INTO idempotency_journal with $1..$6 in field order', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6)',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('acme');
      expect(params[1]).toBe('key-1');
      expect(params[2]).toBe('hash-1');
      expect(params[3]).toBe('att:acme:key-1');
      expect(params[4]).toBe('in_flight');
      expect(typeof params[5]).toBe('number'); // created_at
    });
  });

  describe('lookup() SQL shape', () => {
    it('emits a scoped SELECT with AS "camelCase" aliases WHERE company_id = $1 AND idempotency_key = $2', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.lookup('acme', 'key-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT company_id AS "companyId", idempotency_key AS "idempotencyKey", request_hash AS "requestHash", ' +
          'attempt_id AS "attemptId", status, result_json AS "resultJson" ' +
          'FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
      );
      expect(selects[0]?.params).toEqual(['acme', 'key-1']);
    });
  });

  describe('complete() SQL shape', () => {
    it('emits UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', { state: 'completed', version: 3 });

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('completed');
      expect(params[2]).toBe(JSON.stringify({ state: 'completed', version: 3 }));
    });
  });

  describe('round-trip via the fake connection', () => {
    it('insertInFlight → lookup (in_flight) → complete → lookup (completed with stored resultJson)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());

      const inFlight = await repo.lookup('acme', 'key-1');
      expect(inFlight?.status).toBe('in_flight');
      expect(inFlight?.requestHash).toBe('hash-1');
      expect(inFlight?.attemptId).toBe('att:acme:key-1');
      expect(inFlight?.resultJson).toBeUndefined();

      await repo.complete('att:acme:key-1', { state: 'completed', version: 3 });

      const done = await repo.lookup('acme', 'key-1');
      expect(done?.status).toBe('completed');
      expect(done?.resultJson).toEqual({ state: 'completed', version: 3 });
    });

    it('lookup for an unknown key returns undefined', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      expect(await repo.lookup('acme', 'never-recorded')).toBeUndefined();
    });
  });

  describe('empty/missing input guards (fake parity)', () => {
    it('lookup rejects an empty companyId', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await expect(repo.lookup('', 'key-1')).rejects.toThrow(/companyId/i);
    });

    it('lookup rejects an empty idempotencyKey', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await expect(repo.lookup('acme', '')).rejects.toThrow(/idempotencyKey/i);
    });

    it('insertInFlight rejects an empty companyId', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await expect(repo.insertInFlight({ ...entry(), companyId: '' })).rejects.toThrow(
        /companyId/i,
      );
    });

    it('insertInFlight rejects an empty attemptId', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await expect(repo.insertInFlight({ ...entry(), attemptId: '' })).rejects.toThrow(
        /attemptId/i,
      );
    });
  });
});
