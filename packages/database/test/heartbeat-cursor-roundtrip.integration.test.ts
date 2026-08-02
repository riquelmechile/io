import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PgHeartbeatCursorRepository } from '../src/heartbeat-cursor-adapter.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_008 = join(pkgRoot, 'sql', '008_heartbeat_cursor.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for the `heartbeat_cursor`
 * table (design migration 008; supervisor-timer). Applies the shipped 008 DDL
 * and drives `PgHeartbeatCursorRepository` — the PG-shaped adapter for the
 * `HeartbeatCursorStore` port: tenant-scoped `get` (WHERE company_id = $1) and
 * an ATOMIC `upsert` (`INSERT ... ON CONFLICT (company_id) DO UPDATE`) that
 * creates-or-replaces EXACTLY ONE checkpoint per company, mirroring the
 * in-memory fake. Cross-tenant isolation: upserting company A must never touch
 * company B's checkpoint. An empty `companyId` is rejected PRE-SQL (fake
 * parity). State is isolated via TRUNCATE in beforeEach. The whole suite is
 * SKIPPED when no live PG is reachable, and MUST be run sequentially
 * (`--no-file-parallelism`): the shared io_dev database is TRUNCATE-isolated.
 */

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

const reachable = await pgReachable();

describe.skipIf(!reachable)(
  'integration: real PG heartbeat_cursor round-trip (008, tenant-scoped upsert)',
  () => {
    let conn!: PgDbConnection;
    let cursors!: PgHeartbeatCursorRepository;

    beforeAll(async () => {
      conn = new PgDbConnection(pgConnectionString());
      await conn.execute(readFileSync(SCHEMA_008, 'utf8'), []);
      cursors = new PgHeartbeatCursorRepository(conn);
    });

    beforeEach(async () => {
      await conn.execute('TRUNCATE heartbeat_cursor', []);
    });

    afterAll(async () => {
      await conn?.close();
    });

    describe('upsert → get round-trip', () => {
      it('get resolves to undefined for a company with no checkpoint (missing row)', async () => {
        expect(await cursors.get('acme')).toBeUndefined();
      });

      it('round-trips the cursor after an upsert', async () => {
        await cursors.upsert('acme', { lastEventId: 'evt:attempt-1' });
        expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:attempt-1' });
      });

      it('upsert REPLACES the previous checkpoint (ON CONFLICT DO UPDATE)', async () => {
        await cursors.upsert('acme', { lastEventId: 'evt:attempt-1' });
        await cursors.upsert('acme', { lastEventId: 'evt:attempt-2' });
        // The second upsert wins: exactly ONE row per company, always the latest.
        expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:attempt-2' });
      });
    });

    describe('cross-tenant isolation (ADR-0002 parity)', () => {
      it('upserting company A never touches company B checkpoint', async () => {
        await cursors.upsert('company-a', { lastEventId: 'evt:a1' });
        expect(await cursors.get('company-b')).toBeUndefined();

        await cursors.upsert('company-b', { lastEventId: 'evt:b1' });
        // Each company keeps exactly its own latest checkpoint.
        expect(await cursors.get('company-a')).toEqual({ lastEventId: 'evt:a1' });
        expect(await cursors.get('company-b')).toEqual({ lastEventId: 'evt:b1' });
      });
    });

    describe('empty companyId guard — rejected PRE-SQL, mirrors the fake', () => {
      it('get rejects an empty companyId', async () => {
        await expect(cursors.get('')).rejects.toThrow(/non-empty companyId/i);
      });

      it('upsert rejects an empty companyId and writes NOTHING', async () => {
        await expect(cursors.upsert('', { lastEventId: 'evt:attempt-1' })).rejects.toThrow(
          /non-empty companyId/i,
        );
        expect(await cursors.get('acme')).toBeUndefined();
      });
    });

    describe('008 DDL', () => {
      it('applies idempotently (IF NOT EXISTS — re-apply safe, no migration runner)', async () => {
        // The beforeAll already applied 008 once; a second application must not
        // throw, mirroring how 001-007 are re-applied via PgDbConnection.execute().
        await expect(conn.execute(readFileSync(SCHEMA_008, 'utf8'), [])).resolves.toBeDefined();
        await cursors.upsert('acme', { lastEventId: 'evt:attempt-1' });
        expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:attempt-1' });
      });
    });
  },
);
