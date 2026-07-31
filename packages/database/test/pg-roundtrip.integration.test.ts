import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PersistentRecord } from '@io/trust-kernel/src/index.js';
import { PERSISTENT_PORT_DISCLOSURE } from '@io/trust-kernel/src/index.js';

import { PgAuditRepository } from '../src/audit-adapter.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';
import { PgEvidenceRepository } from '../src/evidence-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_PATH = join(pkgRoot, 'sql', '001_create_tables.sql');

/**
 * Integration test — REAL PostgreSQL round-trip (Req: Integration Test Round-Trip
 * Against Real PostgreSQL; design §Integration Test Strategy). Unlike the unit
 * tests (which use the in-memory fake), this connects to a live PG 18.4 via
 * PgDbConnection, applies the shipped schema DDL, and round-trips a
 * PersistentRecord through BOTH adapters (evidence save→get; audit append ×N
 * →getLog), asserting durable persistence and insertion order. State is isolated
 * via TRUNCATE in beforeEach. The whole suite is SKIPPED when no live PG is
 * reachable (spec scenario 3), so CI without a container does not fail.
 */

/** Probe once; skip the suite (not fail) when PG is unreachable (spec scenario 3). */
async function pgReachable(): Promise<boolean> {
  const probe = new PgDbConnection(pgConnectionString());
  try {
    await probe.execute('SELECT 1', []);
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

/** Apply the shipped schema through the connection port (design §Schema, D3). */
async function applySchema(conn: PgDbConnection): Promise<void> {
  await conn.execute(readFileSync(SCHEMA_PATH, 'utf8'), []);
}

const reachable = await pgReachable();

describe.skipIf(!reachable)('integration: real PostgreSQL round-trip (Req: Integration)', () => {
  let conn!: PgDbConnection;
  let evidenceRepo!: PgEvidenceRepository;
  let auditRepo!: PgAuditRepository;

  beforeAll(async () => {
    conn = new PgDbConnection(pgConnectionString());
    await applySchema(conn);
    evidenceRepo = new PgEvidenceRepository(conn);
    auditRepo = new PgAuditRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute('TRUNCATE evidence, audit RESTART IDENTITY', []);
  });

  afterAll(async () => {
    await conn?.close();
  });

  function record(actionId: string, reason: string): PersistentRecord {
    return {
      actionId,
      principalId: 'principal-1',
      riskClass: 'high',
      decision: 'ALLOW',
      reason,
      timestamp: 1700000000000,
      persistent: true,
      disclosure: PERSISTENT_PORT_DISCLOSURE,
    };
  }

  describe('evidence save → get round-trips byte-identically', () => {
    it('a saved record is re-read with every field intact', async () => {
      const saved = record('evidence-1', 'explicit grant matched');
      await evidenceRepo.save(saved);
      const got = await evidenceRepo.get(saved.actionId);
      expect(got).toEqual(saved);
    });

    it('round-trips a second, distinct record (triangulation)', async () => {
      const saved: PersistentRecord = {
        actionId: 'evidence-2',
        principalId: 'principal-2',
        riskClass: 'low',
        decision: 'DENY',
        reason: 'a different reason',
        timestamp: 999999,
        persistent: true,
        disclosure: PERSISTENT_PORT_DISCLOSURE,
      };
      await evidenceRepo.save(saved);
      const got = await evidenceRepo.get(saved.actionId);
      expect(got).toEqual(saved);
      expect(got?.decision).toBe('DENY');
      expect(got?.riskClass).toBe('low');
      expect(got?.timestamp).toBe(999999);
    });

    it('get() returns undefined for an unsaved action id', async () => {
      expect(await evidenceRepo.get('never-saved')).toBeUndefined();
    });
  });

  describe('audit append ×N → getLog preserves insertion order & immutability', () => {
    it('returns appended entries in insertion order', async () => {
      await auditRepo.append(record('audit-1', 'one'));
      await auditRepo.append(record('audit-2', 'two'));
      await auditRepo.append(record('audit-3', 'three'));
      const log = await auditRepo.getLog();
      expect(log.map((e) => e.actionId)).toEqual(['audit-1', 'audit-2', 'audit-3']);
      expect(log.map((e) => e.reason)).toEqual(['one', 'two', 'three']);
    });

    it('each entry round-trips its full PersistentRecord', async () => {
      const appended = record('audit-full', 'payload');
      await auditRepo.append(appended);
      const [got] = await auditRepo.getLog();
      expect(got).toBeDefined();
      expect(got).toEqual(appended);
    });

    it('a prior log reference is not mutated by a later append', async () => {
      await auditRepo.append(record('audit-1', 'one'));
      const firstLog = await auditRepo.getLog();
      await auditRepo.append(record('audit-2', 'two'));
      const secondLog = await auditRepo.getLog();
      expect(firstLog).toHaveLength(1);
      expect(firstLog.map((e) => e.actionId)).toEqual(['audit-1']);
      expect(secondLog).toHaveLength(2);
      expect(secondLog.map((e) => e.actionId)).toEqual(['audit-1', 'audit-2']);
    });
  });

  describe('TRUNCATE isolation in beforeEach (spec scenario: Test isolation)', () => {
    it('starts each test with empty tables (no cross-test bleed)', async () => {
      // No rows added in this test body; beforeEach already truncated.
      expect(await auditRepo.getLog()).toEqual([]);
      // An action id used by another test must be absent here.
      expect(await evidenceRepo.get('evidence-1')).toBeUndefined();
    });
  });
});
