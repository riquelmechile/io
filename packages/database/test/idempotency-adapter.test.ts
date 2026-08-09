import { describe, expect, it } from 'vitest';

import type { Work } from '@io/business-domain/src/index.js';

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

/** A well-formed Work — the shape `result_json` actually stores (guarded by
 * parseWorkRow on replay lookup, D7). */
function storedWork(): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the close',
    state: 'completed',
    version: 3,
    fencingToken: 0,
    evidenceRefs: ['evid-1'],
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
          'VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id, idempotency_key) DO NOTHING',
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

      await repo.complete('att:acme:key-1', storedWork());

      const done = await repo.lookup('acme', 'key-1');
      expect(done?.status).toBe('completed');
      expect(done?.resultJson).toEqual(storedWork());
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

  describe('markRetryable() SQL shape (IJ marker, adapter)', () => {
    it('emits UPDATE ... SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3 (in_flight guard)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.markRetryable('att:acme:key-1');

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('aborted_retryable');
      expect(params[2]).toBe('in_flight'); // only an in-flight attempt may be marked
      expect(params[3]).toBeNull(); // result_json cleared
    });

    it('round-trips in_flight → aborted_retryable with resultJson cleared', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());

      await repo.markRetryable('att:acme:key-1');

      const marked = await repo.lookup('acme', 'key-1');
      expect(marked?.status).toBe('aborted_retryable');
      expect(marked?.attemptId).toBe('att:acme:key-1');
      expect(marked?.resultJson).toBeUndefined();
    });

    it('throws when the attempt is missing (0 rows updated)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await expect(repo.markRetryable('att:never-recorded')).rejects.toThrow(/in_flight|attempt/i);
    });

    it('throws when the attempt is completed (0 rows updated — never regresses completed)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', storedWork());

      await expect(repo.markRetryable('att:acme:key-1')).rejects.toThrow(/in_flight|attempt/i);
      const done = await repo.lookup('acme', 'key-1');
      expect(done?.status).toBe('completed');
    });
  });

  describe('insertInFlight() reopen on aborted_retryable (acceptance note 1)', () => {
    async function seededRetryable(): Promise<{
      db: InMemoryDbConnection;
      repo: PgIdempotencyJournalRepository;
    }> {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.markRetryable('att:acme:key-1');
      return { db, repo };
    }

    it('reopens via a CONDITIONAL UPDATE (never a fresh INSERT), keeping the attemptId', async () => {
      const { db, repo } = await seededRetryable();

      await repo.insertInFlight(entry());

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      const reopenUpdate = db.operations.filter((op) => op.sql.startsWith('UPDATE')).at(-1);
      expect(inserts).toHaveLength(1); // the original insert only — reopen is NOT an INSERT
      expect(reopenUpdate?.sql).toBe(
        'UPDATE idempotency_journal SET status=$4, result_json=$5 WHERE company_id=$1 AND idempotency_key=$2 AND status=$3 AND request_hash=$6',
      );
      const params = reopenUpdate?.params ?? [];
      expect(params[0]).toBe('acme');
      expect(params[1]).toBe('key-1');
      expect(params[2]).toBe('aborted_retryable'); // status guard
      expect(params[3]).toBe('in_flight'); // new status
      expect(params[4]).toBeNull(); // result_json cleared
      expect(params[5]).toBe('hash-1'); // request hash guard

      const reopened = await repo.lookup('acme', 'key-1');
      expect(reopened?.status).toBe('in_flight');
      expect(reopened?.attemptId).toBe('att:acme:key-1'); // preserved
      expect(reopened?.resultJson).toBeUndefined();
    });

    it('a different request hash under the marker is a conflict (DENY)', async () => {
      const { repo } = await seededRetryable();

      await expect(
        repo.insertInFlight({ ...entry(), requestHash: 'hash-DIFFERENT' }),
      ).rejects.toThrow(/conflict|hash/i);

      const unchanged = await repo.lookup('acme', 'key-1');
      expect(unchanged?.status).toBe('aborted_retryable');
    });

    it('an existing in_flight row is a LOST CLAIM — typed attempt-in-flight (never a throw)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());
      await expect(repo.insertInFlight(entry())).resolves.toEqual({
        ok: false,
        reason: 'attempt-in-flight',
      });
    });

    it('an existing completed row is a LOST CLAIM — typed attempt-in-flight (replay/DENY only, never reopened)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', storedWork());
      await expect(repo.insertInFlight(entry())).resolves.toEqual({
        ok: false,
        reason: 'attempt-in-flight',
      });
    });
  });
});
