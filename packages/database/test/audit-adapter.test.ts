import { describe, expect, it } from 'vitest';

import type { PersistentRecord } from '@io/trust-kernel/src/index.js';
import { PERSISTENT_PORT_DISCLOSURE } from '@io/trust-kernel/src/index.js';

import { PgAuditRepository } from '../src/audit-adapter.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * PgAuditRepository adapter (Req 3, R16). append() INSERTs one row then returns
 * a fresh getLog(); getLog() builds SELECT ... FROM audit ORDER BY id ASC. Append
 * preserves insertion order and MUST NOT mutate or drop prior entries.
 */

function entry(actionId: string, reason: string): PersistentRecord {
  return {
    actionId,
    principalId: 'principal-1',
    riskClass: 'medium',
    decision: 'DENY',
    reason,
    timestamp: 1000,
    persistent: true,
    disclosure: PERSISTENT_PORT_DISCLOSURE,
  };
}

function repo() {
  return new PgAuditRepository(new InMemoryDbConnection());
}

function lastSql(db: InMemoryDbConnection, prefix: string) {
  const matches = db.operations.filter((op) => op.sql.startsWith(prefix));
  return matches[matches.length - 1];
}

describe('PgAuditRepository (Req 3, R16)', () => {
  describe('append()/getLog() build parameterized SQL (threat: SQL shape)', () => {
    it('append() emits an INSERT INTO audit with $1..$8 in record-field order', () => {
      const db = new InMemoryDbConnection();
      const r = new PgAuditRepository(db);
      const record = entry('action-1', 'one');
      r.append(record);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO audit (action_id, principal_id, risk_class, decision, reason, timestamp, persistent, disclosure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
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

    it('getLog() emits SELECT ... FROM audit ORDER BY id ASC', () => {
      const db = new InMemoryDbConnection();
      const r = new PgAuditRepository(db);
      r.append(entry('action-1', 'one'));

      const select = lastSql(db, 'SELECT');
      expect(select?.sql).toBe(
        'SELECT action_id AS "actionId", principal_id AS "principalId", risk_class AS "riskClass", decision, reason, timestamp, persistent, disclosure FROM audit ORDER BY id ASC',
      );
    });
  });

  describe('getLog() preserves insertion order immutably (Req 3 scenario)', () => {
    it('returns entries in insertion order (prior entries first)', () => {
      const r = repo();
      r.append(entry('action-1', 'one'));
      r.append(entry('action-2', 'two'));
      r.append(entry('action-3', 'three'));

      expect(r.getLog().map((e) => e.actionId)).toEqual(['action-1', 'action-2', 'action-3']);
    });

    it('does not drop or reorder earlier entries on later appends', () => {
      const r = repo();
      r.append(entry('action-1', 'one'));
      r.append(entry('action-2', 'two'));
      r.append(entry('action-3', 'three'));

      expect(r.getLog().map((e) => e.reason)).toEqual(['one', 'two', 'three']);
    });

    it('a prior log reference is not mutated by a later append', () => {
      const r = repo();
      r.append(entry('action-1', 'one'));
      const firstLog = r.getLog();
      r.append(entry('action-2', 'two'));
      const secondLog = r.getLog();

      expect(firstLog).toHaveLength(1);
      expect(firstLog.map((e) => e.actionId)).toEqual(['action-1']);
      expect(secondLog).toHaveLength(2);
      expect(secondLog.map((e) => e.actionId)).toEqual(['action-1', 'action-2']);
    });

    it('append() returns the full log including the appended entry', () => {
      const r = repo();
      const log1 = r.append(entry('action-1', 'one'));
      const log2 = r.append(entry('action-2', 'two'));

      expect(log1).toHaveLength(1);
      expect(log2).toHaveLength(2);
      expect(log2[1]?.actionId).toBe('action-2');
    });
  });

  describe('honest disclosure (Req 5, scenario 1; threat: overclaim)', () => {
    it('carries the SAME PERSISTENT_PORT_DISCLOSURE as the kernel and does not claim R1-R17', () => {
      const r = repo();
      expect(r.disclosure).toBe(PERSISTENT_PORT_DISCLOSURE);
      expect(r.disclosure).not.toMatch(/satisf(?:y|ies)\s+(?:persistent\s+)?R1.?R17/i);
    });
  });
});
