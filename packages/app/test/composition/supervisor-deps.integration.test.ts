import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BusinessEvent } from '@io/business-domain/src/types.js';
import { PgBusinessEventRepository, PgHeartbeatCursorRepository } from '@io/database/src/index.js';
import { PgDbConnection, pgConnectionString } from '@io/database/src/pg-connection.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildSupervisorDeps } from '../../src/composition/supervisor-deps.js';
import { startSupervisor } from '../../src/supervisor/supervisor.js';
import { tickCompany } from '../../src/supervisor/tick.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..');
const DATABASE_SQL_DIR = join(appRoot, '..', 'database', 'sql');
const SCHEMA_006 = join(DATABASE_SQL_DIR, '006_business_events.sql');
const SCHEMA_008 = join(DATABASE_SQL_DIR, '008_heartbeat_cursor.sql');

/**
 * Composition root over REAL PostgreSQL (task 4.1 — `buildSupervisorDeps`):
 * the pool-bound `PgBusinessEventRepository` + `PgHeartbeatCursorRepository`
 * wired over ONE `DbConnection`, driven through the REAL supervisor module
 * (`tickCompany` / `startSupervisor`). Proves the full supervisor→PG path:
 * append a `work.completed` event → one tick → the cursor checkpoint row is
 * PERSISTED with the tail event id → a second tick with no new event does NOT
 * re-activate (the checkpoint consumed the novelty). `buildSupervisorDeps` is
 * pool-bound only and is NOT called by `buildWorkerDeps` (worker-deps.ts stays
 * untouched — verified structurally at the source level, not here).
 *
 * Follows the database package's integration pattern: `describe.skipIf(!reachable)`,
 * TRUNCATE isolation in beforeEach, and MUST run sequentially
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

/** A material `work.completed` event for a tenant (mirrors the supervisor unit test). */
function workCompletedEvent(eventId: string, companyId: string): BusinessEvent {
  return {
    eventId,
    companyId,
    aggregateKind: 'work',
    aggregateId: 'work-1',
    eventType: 'work.completed',
    occurredAt: 1750000000000,
    payload: { workId: 'work-1' },
    source: 'worker',
  };
}

/** Injectable schedule: a manual pump the test drives (zero real timers). */
function manualPump() {
  let current: (() => void | Promise<void>) | undefined;
  return {
    schedule: (tick: () => void | Promise<void>, _intervalMs: number) => {
      current = tick;
      return { stop: () => {} };
    },
    pump: async (): Promise<void> => {
      await current?.();
    },
  };
}

describe.skipIf(!reachable)(
  'integration: buildSupervisorDeps over real PG — pool-bound repos + supervisor tick advances a cursor (task 4.1)',
  () => {
    let conn!: PgDbConnection;

    beforeAll(async () => {
      conn = new PgDbConnection(pgConnectionString());
      await conn.execute(readFileSync(SCHEMA_006, 'utf8'), []);
      await conn.execute(readFileSync(SCHEMA_008, 'utf8'), []);
    });

    beforeEach(async () => {
      await conn.execute('TRUNCATE business_event, heartbeat_cursor', []);
    });

    afterAll(async () => {
      await conn?.close();
    });

    it('wires pool-bound PgBusinessEventRepository + PgHeartbeatCursorRepository over the DbConnection', () => {
      const deps = buildSupervisorDeps(conn);
      expect(deps.events).toBeInstanceOf(PgBusinessEventRepository);
      expect(deps.cursors).toBeInstanceOf(PgHeartbeatCursorRepository);
    });

    it('one tick advances a REAL cursor in PG: work.completed append → tick → checkpoint row persisted', async () => {
      const deps = buildSupervisorDeps(conn);
      await deps.events.append(workCompletedEvent('evt:sup-1', 'acme'));

      const activated: string[] = [];
      await tickCompany(deps, 'acme', (companyId) => {
        activated.push(companyId);
      });

      // The activation side effect ran exactly once, BEFORE the checkpoint.
      expect(activated).toEqual(['acme']);

      // The supervisor's cursor row is PERSISTED in live PG with the tail event id.
      expect(await deps.cursors.get('acme')).toEqual({ lastEventId: 'evt:sup-1' });
      const rows = await conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM heartbeat_cursor WHERE company_id = $1',
        ['acme'],
      );
      expect(rows[0]?.count).toBe(1);
    });

    it('second tick with NO new event → no re-activation (cursor consumed the novelty)', async () => {
      const deps = buildSupervisorDeps(conn);
      await deps.events.append(workCompletedEvent('evt:sup-2', 'acme'));

      const activated: string[] = [];
      await tickCompany(deps, 'acme', (companyId) => {
        activated.push(companyId);
      });
      expect(activated).toEqual(['acme']);

      // No new material event: the unchanged stream is consumed by the
      // checkpoint, so the second tick must NOT re-activate.
      await tickCompany(deps, 'acme', (companyId) => {
        activated.push(companyId);
      });
      expect(activated).toEqual(['acme']);
      expect(await deps.cursors.get('acme')).toEqual({ lastEventId: 'evt:sup-2' });
    });

    it('startSupervisor with an injected schedule drives ticks through the composition root', async () => {
      const deps = buildSupervisorDeps(conn);
      await deps.events.append(workCompletedEvent('evt:sup-3', 'acme'));

      const pump = manualPump();
      const activated: string[] = [];
      const supervisor = startSupervisor(deps, {
        intervalMs: 1_000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activated.push(companyId);
        },
      });

      await pump.pump();
      expect(activated).toEqual(['acme']);
      expect(await deps.cursors.get('acme')).toEqual({ lastEventId: 'evt:sup-3' });

      // A second pump sees no new event → no re-activation.
      await pump.pump();
      expect(activated).toEqual(['acme']);

      supervisor.stop();
    });
  },
);
