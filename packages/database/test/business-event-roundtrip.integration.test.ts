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

  describe('appendIfAbsent — at-most-once conditional append (live PG, sequential)', () => {
    it('a double appendIfAbsent of the same event_id leaves EXACTLY ONE ORIGINAL row (ON CONFLICT DO NOTHING, no migration)', async () => {
      const original = sampleEvent('attempt-1');
      expect(await eventsRepo.appendIfAbsent(original)).toEqual(original);

      // Same eventId, DIFFERENT payload + occurredAt: ON CONFLICT (event_id)
      // DO NOTHING must no-op and the original row must stay byte-for-byte
      // unchanged — "PostgreSQL conditional append is single-issuance" (no
      // migration; the 006 DDL is unchanged).
      const duplicate: BusinessEvent = {
        ...sampleEvent('attempt-1'),
        occurredAt: 999,
        payload: { attemptId: 'attempt-1', tampered: true },
      };
      expect(await eventsRepo.appendIfAbsent(duplicate)).toEqual(original);

      const stored = await eventsRepo.listByCompany('acme');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(original);
      expect(stored[0]?.payload).toEqual(original.payload);
      expect(stored[0]?.occurredAt).toBe(1750000000000);
    });

    it('round-trips a supervisor heartbeat.decision-shaped event through appendIfAbsent (source + JSONB payload)', async () => {
      const decision: BusinessEvent = {
        eventId: 'evt:hb:2b9e2adf9e63deee',
        companyId: 'acme',
        aggregateKind: 'heartbeat',
        aggregateId: 'acme',
        eventType: 'heartbeat.decision',
        occurredAt: 1750000000000,
        payload: { decision: 'no-llm-heartbeat', cursor: 'evt:5' },
        source: 'supervisor',
      };
      expect(await eventsRepo.appendIfAbsent(decision)).toEqual(decision);

      const stored = await eventsRepo.listByCompany('acme');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(decision);
      expect(stored[0]?.source).toBe('supervisor');
      expect(stored[0]?.payload).toEqual({ decision: 'no-llm-heartbeat', cursor: 'evt:5' });
    });

    it('two CONCURRENT appendIfAbsent calls with the SAME event_id leave EXACTLY ONE original row (ON CONFLICT resolves the race)', async () => {
      const original = sampleEvent('race-1');
      // Same eventId, DIFFERENT payload + occurredAt (spec scenario GIVEN:
      // concurrent conditional appends with one event ID). The 006 UNIQUE
      // index uq_business_event_event_id makes exactly ONE INSERT the winner;
      // the loser's ON CONFLICT (event_id) DO NOTHING silently no-ops. The
      // winner resolves its input view, the loser SELECTs the stored original
      // — both MUST converge on the SAME single row, no migration.
      const racingDuplicate: BusinessEvent = {
        ...sampleEvent('race-1'),
        occurredAt: 999,
        payload: { attemptId: 'race-1', tampered: true },
      };

      const [first, second] = await Promise.all([
        eventsRepo.appendIfAbsent(original),
        eventsRepo.appendIfAbsent(racingDuplicate),
      ]);

      // The race winner is nondeterministic — assert convergence, never which
      // input won: whichever INSERT won, both calls resolve the same fact.
      expect(first).toEqual(second);

      const stored = await eventsRepo.listByCompany('acme');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(first);
      expect(stored[0]?.payload).toEqual(first.payload);
    });
  });

  describe('work.skill-outcome contract (Unit 4 — v1 payload, duplicate evt:sk: rejection, historical no-backfill)', () => {
    /** A skill-outcome event shaped exactly like `buildSkillOutcomeEvent`
     * output: `evt:sk:att:{company}:{key}` id, composite v1 payload. */
    function sampleSkillOutcome(attemptId: string, companyId = 'acme'): BusinessEvent {
      return {
        eventId: `evt:sk:att:${companyId}:${attemptId}`,
        companyId,
        aggregateKind: 'work',
        aggregateId: 'work-1',
        eventType: 'work.skill-outcome',
        occurredAt: 1750000000000,
        payload: {
          version: 1,
          activatedSkills: [
            { skillId: 'invoice-extraction', version: 1 },
            { skillId: 'ledger-reconcile', version: 2 },
          ],
        },
        source: 'worker',
      };
    }

    it('round-trips the v1 skill-outcome payload byte-identically through the guard (evt:sk: namespace)', async () => {
      const event = sampleSkillOutcome('attempt-1');
      const appended = await eventsRepo.append(event);
      expect(appended).toEqual(event);

      const listed = await eventsRepo.listByCompany('acme');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(event);
      expect(listed[0]?.eventId).toBe('evt:sk:att:acme:attempt-1');
      expect(listed[0]?.eventType).toBe('work.skill-outcome');
      expect(listed[0]?.payload).toEqual({
        version: 1,
        activatedSkills: [
          { skillId: 'invoice-extraction', version: 1 },
          { skillId: 'ledger-reconcile', version: 2 },
        ],
      });
      expect(listed[0]?.source).toBe('worker');
      expect(listed[0]?.occurredAt).toBe(1750000000000);
    });

    it('rejects a duplicate evt:sk: event_id via uq_business_event_event_id and preserves the ORIGINAL v1 payload', async () => {
      const original = sampleSkillOutcome('attempt-1');
      await eventsRepo.append(original);

      // Same evt:sk: id, DIFFERENT payload: the 006 UNIQUE index must reject —
      // no upsert, no overwrite (spec "Duplicate throwing append is rejected").
      const duplicate: BusinessEvent = {
        ...original,
        payload: { version: 1, activatedSkills: [{ skillId: 'tampered', version: 9 }] },
      };
      await expect(eventsRepo.append(duplicate)).rejects.toThrow(/duplicate key|unique/i);

      const stored = await eventsRepo.listByCompany('acme');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(original);
      expect(stored[0]?.payload).toEqual(original.payload);
    });

    it('historical pre-change rows are untouched: a completed replay does not append and no skill-outcome is synthesized (no backfill)', async () => {
      // GIVEN: pre-change persisted state — a historical `work.completed`
      // (eventId `evt:att:{company}:{key}`, NO skill-outcome sibling — the
      // pre-change contract). The skill delta MUST NOT synthesize an outcome
      // for that Work (skill "Historical Work remains untouched").
      const historical: BusinessEvent = {
        eventId: 'evt:att:acme:attempt-historical',
        companyId: 'acme',
        aggregateKind: 'work',
        aggregateId: 'work-historical',
        eventType: 'work.completed',
        occurredAt: 1700000000000,
        payload: {
          workId: 'work-historical',
          state: 'completed',
          receiptId: 'rcpt:att:acme:attempt-historical',
          terminalState: 'verified',
          evidenceId: 'evid:acme:attempt-historical',
          attemptId: 'att:acme:attempt-historical',
          actor: 'principal-2',
        },
        source: 'worker',
      };
      await eventsRepo.append(historical);

      // Reading the stream returns EXACTLY the stored historical row — the
      // adapter never synthesizes a skill-outcome for it (no backfill).
      const listed = await eventsRepo.listByCompany('acme');
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(historical);
      expect(listed[0]?.eventType).toBe('work.completed');
      expect(listed.map((entry) => entry.eventType)).not.toContain('work.skill-outcome');

      // A replay of the same attempt (rebuilt identical event) via
      // appendIfAbsent lands on the SAME event_id → ON CONFLICT DO NOTHING →
      // exactly ONE original row remains (spec "Completed replay does not
      // append"; no second worker event).
      expect(await eventsRepo.appendIfAbsent(historical)).toEqual(historical);
      const afterReplay = await eventsRepo.listByCompany('acme');
      expect(afterReplay).toHaveLength(1);
      expect(afterReplay[0]).toEqual(historical);
      expect(afterReplay[0]?.occurredAt).toBe(1700000000000);
    });
  });

  describe('listCompanyIds — read-only distinct company discovery (supervisor-timer)', () => {
    it('returns each company exactly once across interleaved events (DISTINCT)', async () => {
      await eventsRepo.append(sampleEvent('attempt-a1', 'company-a'));
      await eventsRepo.append(sampleEvent('attempt-b1', 'company-b'));
      await eventsRepo.append(sampleEvent('attempt-a2', 'company-a'));
      await eventsRepo.append(sampleEvent('attempt-a3', 'company-a'));
      await eventsRepo.append(sampleEvent('attempt-b2', 'company-b'));

      const ids = await eventsRepo.listCompanyIds();
      // DISTINCT selection: A and B each appear EXACTLY once (spec scenario).
      // The design leaves PG DISTINCT row order unspecified ("no ORDER required
      // by spec"; the fake guarantees insertion-first-seen) — assert set
      // membership, not order, so the test is deterministic on real PG.
      expect([...ids].sort()).toEqual(['company-a', 'company-b']);
      expect(ids).toHaveLength(2);
    });

    it('is read-only: the event snapshot stays unchanged (no mutation)', async () => {
      await eventsRepo.append(sampleEvent('attempt-a1', 'company-a'));
      await eventsRepo.append(sampleEvent('attempt-b1', 'company-b'));
      const beforeA = await eventsRepo.listByCompany('company-a');
      const beforeB = await eventsRepo.listByCompany('company-b');

      await eventsRepo.listCompanyIds();

      // Snapshot unchanged after discovery — terminal-close facts remain the
      // only worker-emitted events (spec: Discovery preserves event facts).
      expect(await eventsRepo.listByCompany('company-a')).toEqual(beforeA);
      expect(await eventsRepo.listByCompany('company-b')).toEqual(beforeB);
      const all = [...beforeA, ...beforeB];
      expect(all.every((entry) => entry.source === 'worker')).toBe(true);
      expect(all.every((entry) => entry.eventType === 'work.completed')).toBe(true);
    });

    it('a table with no events yields an empty list (DISTINCT over zero rows)', async () => {
      expect(await eventsRepo.listCompanyIds()).toEqual([]);
    });
  });
});
