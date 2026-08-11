import { describe, expect, it } from 'vitest';

import type { Work } from '@io/business-domain/src/index.js';

import { PgIdempotencyJournalRepository } from '../src/idempotency-adapter.js';
import type { DbConnection } from '../src/connection.js';

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
    fencingToken: 0,
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
    it('emits INSERT INTO idempotency_journal with $1..$7 in field order (fencing_token at $6)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, fencing_token, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('acme');
      expect(params[1]).toBe('key-1');
      expect(params[2]).toBe('hash-1');
      expect(params[3]).toBe('att:acme:key-1');
      expect(params[4]).toBe('in_flight');
      expect(params[5]).toBe(0); // the claim fencing token (epoch 0 valid)
      expect(typeof params[6]).toBe('number'); // created_at
    });
  });

  describe('lookup() SQL shape', () => {
    it('emits a scoped SELECT with AS "camelCase" aliases (incl. fencing_token) WHERE company_id = $1 AND idempotency_key = $2', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.lookup('acme', 'key-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT company_id AS "companyId", idempotency_key AS "idempotencyKey", request_hash AS "requestHash", ' +
          'attempt_id AS "attemptId", status, fencing_token AS "fencingToken", result_json AS "resultJson" ' +
          'FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
      );
      expect(selects[0]?.params).toEqual(['acme', 'key-1']);
    });
  });

  describe('complete() SQL shape', () => {
    it('emits UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1 AND status=$4 (status guard, token-free)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', { state: 'completed', version: 3 });

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1 AND status=$4',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('completed');
      expect(params[2]).toBe(JSON.stringify({ state: 'completed', version: 3 }));
      expect(params[3]).toBe('in_flight'); // status guard — NO token
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
    it('emits UPDATE ... SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5 (in_flight + claim-ownership guard)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.markRetryable('att:acme:key-1', 0);

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('aborted_retryable');
      expect(params[2]).toBe('in_flight'); // only an in-flight attempt may be marked
      expect(params[3]).toBeNull(); // result_json cleared
      expect(params[4]).toBe(0); // the claim fencing token gate
    });

    it('round-trips in_flight → aborted_retryable with resultJson cleared', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());

      await repo.markRetryable('att:acme:key-1', 0);

      const marked = await repo.lookup('acme', 'key-1');
      expect(marked?.status).toBe('aborted_retryable');
      expect(marked?.attemptId).toBe('att:acme:key-1');
      expect(marked?.resultJson).toBeUndefined();
    });

    it('returns the TYPED stale-token failure when the attempt is missing (0 rows updated)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      expect(await repo.markRetryable('att:never-recorded', 0)).toEqual({
        ok: false,
        reason: 'stale-token',
      });
    });

    it('returns the TYPED stale-token failure when the attempt is completed (0 rows updated — never regresses completed)', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', storedWork());

      expect(await repo.markRetryable('att:acme:key-1', 0)).toEqual({
        ok: false,
        reason: 'stale-token',
        current: expect.objectContaining({ status: 'completed' }),
      });
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
      await repo.markRetryable('att:acme:key-1', 0);
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

  describe('fencing token on the journal (task 2.3) — token column, markRetryable gate, complete status guard', () => {
    it('insertInFlight emits the fencing_token column: $1..$7 in field order with the token at $6 (pre-effect store)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight({ ...entry(), fencingToken: 7 });

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, fencing_token, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('acme');
      expect(params[1]).toBe('key-1');
      expect(params[2]).toBe('hash-1');
      expect(params[3]).toBe('att:acme:key-1');
      expect(params[4]).toBe('in_flight');
      expect(params[5]).toBe(7); // the claim token
      expect(typeof params[6]).toBe('number'); // created_at
    });

    it('the insert SQL arbitrates BOTH unique indexes: ON CONFLICT DO NOTHING without a target (the known live-PG race flake fix)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      // NO conflict target — PostgreSQL's ON CONFLICT DO NOTHING handles a
      // conflict on ANY unique constraint, including UNIQUE(attempt_id) which
      // a targeted (company_id, idempotency_key) clause does NOT arbitrate.
      expect(inserts[0]?.sql).not.toContain('ON CONFLICT (');
      expect(inserts[0]?.sql).toContain('ON CONFLICT DO NOTHING');
    });

    it('markRetryable emits the claim-ownership gate: WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight({ ...entry(), fencingToken: 7 });
      await repo.markRetryable('att:acme:key-1', 7);

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('aborted_retryable');
      expect(params[2]).toBe('in_flight');
      expect(params[3]).toBeNull(); // result_json cleared
      expect(params[4]).toBe(7); // the claim token gate
    });

    it('a STALE token cannot mark retryable in PG: TYPED stale-token failure, status and token unchanged (spec "Stale token cannot mark retryable")', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight({ ...entry(), fencingToken: 7 });

      expect(await repo.markRetryable('att:acme:key-1', 3)).toEqual({
        ok: false,
        reason: 'stale-token',
        current: expect.objectContaining({ status: 'in_flight', fencingToken: 7 }),
      });

      const row = await repo.lookup('acme', 'key-1');
      expect(row?.status).toBe('in_flight');
      expect(row?.fencingToken).toBe(7);
    });

    it('a MATCHING token marks retryable in PG: aborted_retryable, token retained at N', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight({ ...entry(), fencingToken: 7 });

      await repo.markRetryable('att:acme:key-1', 7);

      const row = await repo.lookup('acme', 'key-1');
      expect(row?.status).toBe('aborted_retryable');
      expect(row?.fencingToken).toBe(7);
    });

    it('complete emits the STATUS GUARD without a token: WHERE attempt_id=$1 AND status=$4 (token-free by contract)', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', { state: 'completed', version: 3 });

      const updates = db.operations.filter((op) => op.sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0]?.sql).toBe(
        'UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1 AND status=$4',
      );
      const params = updates[0]?.params ?? [];
      expect(params[0]).toBe('att:acme:key-1');
      expect(params[1]).toBe('completed');
      expect(params[2]).toBe(JSON.stringify({ state: 'completed', version: 3 }));
      expect(params[3]).toBe('in_flight'); // status guard — NO token param
    });

    it('complete REJECTS a completed row (status guard): throws and leaves the row unchanged', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight(entry());
      await repo.complete('att:acme:key-1', storedWork());

      await expect(repo.complete('att:acme:key-1', { ok: true })).rejects.toThrow(
        /in_flight|attempt/i,
      );
      const done = await repo.lookup('acme', 'key-1');
      expect(done?.status).toBe('completed');
      expect(done?.resultJson).toEqual(storedWork());
    });

    it('lookup SELECT reads the token column: fencing_token AS "fencingToken"', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgIdempotencyJournalRepository(db);
      await repo.insertInFlight({ ...entry(), fencingToken: 7 });
      await repo.lookup('acme', 'key-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT company_id AS "companyId", idempotency_key AS "idempotencyKey", request_hash AS "requestHash", ' +
          'attempt_id AS "attemptId", status, fencing_token AS "fencingToken", result_json AS "resultJson" ' +
          'FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
      );
      const roundTrip = await repo.lookup('acme', 'key-1');
      expect(roundTrip?.fencingToken).toBe(7);
    });

    it('the token-free honest UNRESOLVED T2(ii) close lands in PG: complete(attemptId, sentinel) on an in_flight row succeeds WITHOUT a token', async () => {
      const repo = new PgIdempotencyJournalRepository(new InMemoryDbConnection());
      await repo.insertInFlight({ ...entry(), fencingToken: 3 });

      await repo.complete('att:acme:key-1', { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });

      const row = await repo.lookup('acme', 'key-1');
      expect(row?.status).toBe('completed');
      expect(row?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    });
  });

  describe('same-key insert race — deterministic arbitration of BOTH unique indexes (known live-PG flake fix, task 2.3)', () => {
    it('two concurrent same-key + same-attempt claims resolve TYPED: exactly one winner, one attempt-in-flight, NEVER a throw', async () => {
      const repo = new PgIdempotencyJournalRepository(
        new RaceArbitratingConnection(new InMemoryDbConnection()),
      );

      const [a, b] = await Promise.all([
        repo.insertInFlight(entry()),
        repo.insertInFlight(entry()),
      ]);

      const wins = [a, b].filter((r) => r.ok === true);
      const losses = [a, b].filter((r) => r.ok === false && r.reason === 'attempt-in-flight');
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
    });

    it('two concurrent same-key DIFFERENT-attempt claims resolve TYPED (the UNIQUE(attempt_id) race surface): never a throw', async () => {
      const repo = new PgIdempotencyJournalRepository(
        new RaceArbitratingConnection(new InMemoryDbConnection()),
      );

      const [a, b] = await Promise.all([
        repo.insertInFlight(entry()),
        repo.insertInFlight({ ...entry(), attemptId: 'att:acme:key-1-other' }),
      ]);

      const wins = [a, b].filter((r) => r.ok === true);
      const losses = [a, b].filter((r) => r.ok === false && r.reason === 'attempt-in-flight');
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
    });

    it('the re-read after a conflict classifies against the FRESH committed row: a completed winner → replay path, an in_flight winner → attempt-in-flight (no zombie, no throw)', async () => {
      const repo = new PgIdempotencyJournalRepository(
        new RaceArbitratingConnection(new InMemoryDbConnection()),
      );
      // First claim wins; the loser's conflict absorbs to a typed loss, then a
      // re-read sees the winner's committed row — the key is NOT poisoned.
      const [a, b] = await Promise.all([
        repo.insertInFlight(entry()),
        repo.insertInFlight(entry()),
      ]);
      const loser = [a, b].find((r) => !r.ok);
      expect(loser).toEqual({ ok: false, reason: 'attempt-in-flight' });
      const row = await repo.lookup('acme', 'key-1');
      expect(row?.status).toBe('in_flight');
    });
  });
});

/** Faithful model of PostgreSQL's ON CONFLICT arbitration for the journal's TWO
 * unique indexes — UNIQUE(company_id, idempotency_key) AND UNIQUE(attempt_id).
 * Live PG checks each unique index INDEPENDENTLY (order unspecified): a
 * conflict on the arbiter target is absorbed by DO NOTHING (0 rows), but a
 * conflict on a NON-arbiter index RAISES the duplicate-key error even when the
 * arbiter also conflicts — the probabilistic source of the observed live-PG
 * flake. This double models the WORST case deterministically: a non-arbiter
 * conflict ALWAYS throws. The failing pre-fix SQL (`ON CONFLICT (company_id,
 * idempotency_key) DO NOTHING`) lets the attempt_id conflict throw here, so the
 * RED is deterministic; the fixed no-target `ON CONFLICT DO NOTHING` absorbs
 * ANY index and both claims resolve typed. The journal SELECT is BLIND (no
 * rows) so both concurrent claims see the empty pre-commit window — the race
 * window live PG serializes at the index. */
class RaceArbitratingConnection implements DbConnection {
  constructor(private readonly inner: InMemoryDbConnection) {}

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    const insert = /^INSERT\s+INTO\s+idempotency_journal/i.test(sql);
    if (!insert) return this.inner.execute(sql, params);
    const candidate = {
      companyId: params[0],
      idempotencyKey: params[1],
      attemptId: params[3],
    };
    const rows = this.inner.tableRows('idempotency_journal');
    const keyConflict = rows.some(
      (r) => r.company_id === candidate.companyId && r.idempotency_key === candidate.idempotencyKey,
    );
    const attemptConflict = rows.some((r) => r.attempt_id === candidate.attemptId);
    if (!keyConflict && !attemptConflict) {
      return this.inner.execute(sql, params);
    }
    const target = /ON CONFLICT\s*\(([^)]+)\)/i.exec(sql);
    const targetCols = target?.[1];
    if (targetCols === undefined) {
      // No target: ON CONFLICT DO NOTHING handles conflicts with ANY usable
      // unique constraint (PG docs) — both indexes absorb to 0 rows.
      return { rowCount: 0 };
    }
    const keyCovered = targetCols.includes('company_id') && targetCols.includes('idempotency_key');
    const attemptCovered = targetCols.includes('attempt_id');
    if (attemptConflict && !attemptCovered) {
      // UNIQUE(attempt_id) is NOT the arbiter → PG raises, even though the
      // arbiter also conflicts (independent index checks, order unspecified).
      throw new Error(
        'duplicate key value violates unique constraint "uq_idempotency_journal_attempt_id"',
      );
    }
    if (keyConflict && !keyCovered) {
      throw new Error(
        'duplicate key value violates unique constraint "uq_idempotency_journal_key"',
      );
    }
    return { rowCount: 0 };
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    // Blind ONLY while the table is empty — the pre-commit race window where
    // both concurrent claims read nothing. Once the winner's row is committed,
    // lookups delegate to the real (inner) state: the final re-read classifies
    // against the FRESH committed row.
    if (
      /FROM\s+idempotency_journal/i.test(sql) &&
      this.inner.tableRows('idempotency_journal').length === 0
    ) {
      return [];
    }
    return this.inner.query<T>(sql, params);
  }

  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    return this.inner.transaction(fn);
  }
}
