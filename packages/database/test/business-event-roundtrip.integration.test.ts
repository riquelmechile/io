import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessEvent } from '@io/business-domain/src/index.js';

import { PgBusinessEventRepository } from '../src/business-event-adapter.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_006 = join(pkgRoot, 'sql', '006_business_events.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for the INSERT-only
 * `business_event` table (design §006; R4 insert-only persistence, R8 tenant
 * scoping, R7 single issuance). Applies the shipped 006 DDL, appends events via
 * `PgBusinessEventRepository.append`, and reads them back through
 * `listByCompany`, asserting every field survives the
 * `parseBusinessEventRow` guard byte-identically. Cross-tenant isolation: a
 * list for company A must never return company B events. Read order follows
 * `ORDER BY id ASC` (insertion order), matching the in-memory fake (R3).
 * State is isolated via TRUNCATE in beforeEach. The whole suite is SKIPPED when
 * no live PG is reachable, and MUST be run sequentially
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

describe.skipIf(!reachable)('integration: real PG business_event round-trip (R4, R7, R8)', () => {
  let conn!: PgDbConnection;
  let eventsRepo!: PgBusinessEventRepository;

  beforeAll(async () => {
    conn = new PgDbConnection(pgConnectionString());
    await conn.execute(readFileSync(SCHEMA_006, 'utf8'), []);
    eventsRepo = new PgBusinessEventRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute('TRUNCATE business_event RESTART IDENTITY', []);
  });

  afterAll(async () => {
    await conn?.close();
  });

  function sampleEvent(attemptId: string, companyId = 'acme'): BusinessEvent {
    return {
      eventId: `evt:${attemptId}`,
      companyId,
      aggregateKind: 'work',
      aggregateId: 'work-1',
      eventType: 'work.completed',
      occurredAt: 1750000000000,
      payload: {
        workId: 'work-1',
        state: 'completed',
        receiptId: `rcpt:${attemptId}`,
        terminalState: 'verified',
        evidenceId: `evid:${companyId}:${attemptId}`,
        attemptId,
        actor: 'principal-2',
      },
      source: 'worker',
    };
  }

  describe('append → listByCompany round-trip', () => {
    it('round-trips ALL fields through the guard byte-identically', async () => {
      const event = sampleEvent('attempt-1');
      const appended = await eventsRepo.append(event);
      expect(appended).toEqual(event);

      const listed = await eventsRepo.listByCompany('acme');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(event);
      expect(listed[0]?.payload).toEqual(event.payload);
      expect(listed[0]?.source).toBe('worker');
      expect(listed[0]?.occurredAt).toBe(1750000000000);
      expect(listed[0]?.eventType).toBe('work.completed');
    });

    it('returns events in insertion order (ORDER BY id ASC), matching the fake (R3)', async () => {
      await eventsRepo.append(sampleEvent('attempt-1'));
      await eventsRepo.append(sampleEvent('attempt-2'));
      await eventsRepo.append(sampleEvent('attempt-3'));

      const listed = await eventsRepo.listByCompany('acme');
      expect(listed.map((entry) => entry.eventId)).toEqual([
        'evt:attempt-1',
        'evt:attempt-2',
        'evt:attempt-3',
      ]);
    });
  });

  describe('cross-tenant isolation (R8)', () => {
    it('list for company A never returns company B events', async () => {
      await eventsRepo.append(sampleEvent('attempt-a1', 'company-a'));
      await eventsRepo.append(sampleEvent('attempt-b1', 'company-b'));
      await eventsRepo.append(sampleEvent('attempt-a2', 'company-a'));

      const forA = await eventsRepo.listByCompany('company-a');
      expect(forA.map((entry) => entry.eventId)).toEqual(['evt:attempt-a1', 'evt:attempt-a2']);
      for (const entry of forA) {
        expect(entry.companyId).toBe('company-a');
      }

      const forB = await eventsRepo.listByCompany('company-b');
      expect(forB.map((entry) => entry.eventId)).toEqual(['evt:attempt-b1']);
      expect(forB[0]?.companyId).toBe('company-b');
    });

    it('a company with no events resolves to an empty list', async () => {
      await eventsRepo.append(sampleEvent('attempt-1', 'company-a'));
      expect(await eventsRepo.listByCompany('company-b')).toEqual([]);
    });
  });

  describe('empty companyId guard (R8) — live PG mirrors the fake', () => {
    it('append rejects an empty companyId', async () => {
      await expect(eventsRepo.append(sampleEvent('attempt-1', ''))).rejects.toThrow(
        /non-empty companyId/i,
      );
      expect(await eventsRepo.listByCompany('acme')).toEqual([]);
    });

    it('listByCompany rejects an empty companyId', async () => {
      await expect(eventsRepo.listByCompany('')).rejects.toThrow(/non-empty companyId/i);
    });
  });

  describe('duplicate event_id — single issuance (R7, 006 UNIQUE)', () => {
    it('rejects a second append with the SAME event_id and preserves the ORIGINAL event', async () => {
      const original = sampleEvent('attempt-1');
      await eventsRepo.append(original);

      // Same eventId, different payload: UNIQUE(event_id) must reject — no
      // upsert, no overwrite (006 uq_business_event_event_id).
      const duplicate: BusinessEvent = {
        ...original,
        payload: { attemptId: 'attempt-1', tampered: true },
      };
      await expect(eventsRepo.append(duplicate)).rejects.toThrow(/duplicate key|unique/i);

      const stored = await eventsRepo.listByCompany('acme');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(original);
      expect(stored[0]?.payload).toEqual(original.payload);
    });

    it('allows DISTINCT event_ids for the same company (triangulation)', async () => {
      await expect(eventsRepo.append(sampleEvent('attempt-1'))).resolves.toEqual(
        sampleEvent('attempt-1'),
      );
      await expect(eventsRepo.append(sampleEvent('attempt-2'))).resolves.toEqual(
        sampleEvent('attempt-2'),
      );
      expect(await eventsRepo.listByCompany('acme')).toHaveLength(2);
    });
  });
});
