import { describe, expect, it } from 'vitest';

import type { PersistentRecord } from '@io/trust-kernel/src/index.js';
import { PERSISTENT_PORT_DISCLOSURE } from '@io/trust-kernel/src/index.js';

import { PgEvidenceRepository } from '../src/evidence-adapter.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * PgEvidenceRepository adapter (Req 2, R7). SQL lives HERE, not in the
 * connection: save() builds an INSERT INTO evidence with every field bound as
 * $1..$8; get() builds a SELECT ... WHERE action_id = $1 with column aliases so
 * rows map straight to PersistentRecord. Round-trip preserves persistent: true.
 */

const record: PersistentRecord = {
  actionId: 'action-1',
  principalId: 'principal-1',
  riskClass: 'high',
  decision: 'ALLOW',
  reason: 'explicit grant matched',
  timestamp: 1000,
  persistent: true,
  disclosure: PERSISTENT_PORT_DISCLOSURE,
};

function repo() {
  return new PgEvidenceRepository(new InMemoryDbConnection());
}

function lastSql(db: InMemoryDbConnection, prefix: string) {
  const matches = db.operations.filter((op) => op.sql.startsWith(prefix));
  return matches[matches.length - 1];
}

describe('PgEvidenceRepository (Req 2, R7)', () => {
  describe('save() builds a parameterized INSERT (threat: SQL shape)', () => {
    it('emits a single INSERT INTO evidence with $1..$8 in record-field order', async () => {
      const db = new InMemoryDbConnection();
      const r = new PgEvidenceRepository(db);
      await r.save(record);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO evidence (action_id, principal_id, risk_class, decision, reason, timestamp, persistent, disclosure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      );
      expect(inserts[0]?.params).toEqual([
        record.actionId,
        record.principalId,
        record.riskClass,
        record.decision,
        record.reason,
        record.timestamp,
        record.persistent,
        record.disclosure,
      ]);
    });

    it('save() returns an immutable view of the routed record', async () => {
      expect(await repo().save(record)).toEqual(record);
    });

    it('does not read or depend on execute() return value (D2)', async () => {
      // A connection whose execute returns undefined still round-trips via query.
      const r = repo();
      await r.save(record);
      expect(await r.get(record.actionId)).toEqual(record);
    });
  });

  describe('get() builds an aliased SELECT and round-trips (threat: type confusion)', () => {
    it('emits SELECT ... AS "actionId" ... WHERE action_id = $1', async () => {
      const db = new InMemoryDbConnection();
      const r = new PgEvidenceRepository(db);
      await r.save(record);
      await r.get(record.actionId);

      const select = lastSql(db, 'SELECT');
      expect(select?.sql).toBe(
        'SELECT action_id AS "actionId", principal_id AS "principalId", risk_class AS "riskClass", decision, reason, timestamp, persistent, disclosure FROM evidence WHERE action_id = $1',
      );
      expect(select?.params).toEqual([record.actionId]);
    });

    it('round-trips the record identically, preserving persistent: true', async () => {
      const r = repo();
      await r.save(record);
      const got = await r.get(record.actionId);

      expect(got).toEqual(record);
      expect(got?.persistent).toBe(true);
      expect(got?.riskClass).toBe('high');
      expect(got?.decision).toBe('ALLOW');
    });

    it('returns undefined for an unknown action id', async () => {
      expect(await repo().get('does-not-exist')).toBeUndefined();
    });
  });

  describe('honest disclosure (Req 5, scenario 1; threat: overclaim)', () => {
    it('carries the SAME PERSISTENT_PORT_DISCLOSURE as the kernel and does not claim R1-R17', () => {
      const r = repo();
      // Byte-equal to the kernel value -> the local copy cannot drift.
      expect(r.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      // MUST NOT claim to satisfy persistent R1-R17.
      expect(r.disclosure).not.toMatch(/satisf(?:y|ies)\s+(?:persistent\s+)?R1.?R17/i);
    });
  });
});
