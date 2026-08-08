import { afterEach, describe, expect, it } from 'vitest';

import { dispatchCompanyActivation } from '../../src/dispatch/dispatch.js';
import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../../src/dispatch/keys.js';
import type { DispatchDeps } from '../../src/dispatch/types.js';
import { buildSupervisorDispatch } from '../../src/composition/supervisor-dispatch.js';
import { attemptIdFor } from '../../src/worker/intent.js';
import {
  createE2eHarness,
  E2E_PRINCIPALS,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
} from '../e2e/harness.js';
import type { E2eHarness } from '../e2e/harness.js';

/**
 * Dispatch integration against LIVE PostgreSQL 18.4 (work-dispatch R2/R4,
 * task 2.6): one activation dispatches the oldest accepted Work through the
 * UNCHANGED worker cycle over the REAL adapters — claim, intent (FakeLlm),
 * effect, verify, ATOMIC terminal close (CAS + receipt + journal.complete +
 * work.completed event in one transaction). Live assertions:
 *
 *   - a dispatched Work reaches `completed` with EXACTLY ONE business receipt
 *     and EXACTLY ONE work.completed event (atomic close);
 *   - re-activating the same company afterwards settles `{ok:true,
 *     dispatched:false}` — the completed Work is no longer actionable, so the
 *     receipt count stays EXACTLY ONE (R4: no second effect/receipt);
 *   - an empty actionable queue settles cost-free with zero rows written;
 *   - the composed `buildSupervisorDispatch` root dispatches the full cycle
 *     through its `onActivate` seam over the same live database (R3 wiring).
 *
 * Each test boots its OWN scratch database (io_dev_e2e_dispatch_N) + OWN
 * sandbox root: the canned plan always writes `docs/quarterly-close.md`, so a
 * shared sandbox root would collide across full-cycle tests (EEXIST). The
 * per-run scratch database is created, migrated and DROPPED by
 * `createE2eHarness` — isolated, never touches io_dev. MUST run sequentially
 * (`--no-file-parallelism`): the shared io_pg server is TRUNCATE-isolated per
 * scratch database, and the known parallelism flake (duplicate-key on
 * concurrent terminal closes) is avoided by isolation.
 */
const reachable = await pgReachable();
let harnessCounter = 0;

describe.skipIf(!reachable && !e2eRequirePg)(
  'dispatch integration against live PostgreSQL (R2/R4 + R3 wiring)',
  () => {
    let harness: E2eHarness | undefined;

    afterEach(async () => {
      await harness?.close();
      harness = undefined;
    });

    async function bootHarness(): Promise<E2eHarness> {
      harnessCounter += 1;
      harness = await createE2eHarness({ databaseName: `io_dev_e2e_dispatch_${harnessCounter}` });
      return harness;
    }

    function dispatchDeps(h: E2eHarness): DispatchDeps {
      return { work: h.work, worker: h.deps, actor: h.principals.executor };
    }

    it('dispatches the oldest accepted Work to completion: work completed v3, EXACTLY ONE receipt + ONE event', async () => {
      const h = await bootHarness();
      const companyId = 'dispatch-co-1';
      const workId = 'work-dispatch-1';
      await seedAcceptedWork(h, {
        companyId,
        workId,
        delegationId: 'del-dispatch-1',
      });
      // The seeded identity snapshot: the hash is derived from the ACCEPTED
      // Work's identity fields (state/version are excluded from the hash, so
      // the stored completed Work hashes identically).
      const seeded = await h.work.get(companyId, workId);
      if (seeded === undefined) throw new Error('test setup: seeded work missing');
      const expectedHash = dispatchRequestHashFor(seeded);

      const result = await dispatchCompanyActivation(companyId, dispatchDeps(h), 'flash');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.dispatched).toBe(true);
      if (!result.dispatched) return;
      expect(result.workId).toBe(workId);

      // The full cycle ran over live PG: work completed at version 3
      // (accepted 1 → in_progress 2 → completed 3), receipt issued, journal
      // closed under the derived dispatch key+hash.
      const stored = await h.work.get(companyId, workId);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3);

      // EXACTLY ONE business receipt (atomic T1 close).
      const receipts = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(1);

      // Journal closed completed under the derived key + attemptIdFor scheme.
      const key = dispatchIdempotencyKeyFor(companyId, workId);
      const entry = await h.journal.lookup(companyId, key);
      expect(entry?.status).toBe('completed');
      expect(entry?.attemptId).toBe(attemptIdFor(companyId, key));
      expect(entry?.requestHash).toBe(expectedHash);

      // EXACTLY ONE work.completed event appended (R5 atomic emission).
      const events = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event WHERE aggregate_id = $1',
        [workId],
      );
      expect(events[0]?.count).toBe(1);
    });

    it('re-activation after completion settles dispatched:false — no second receipt (R4)', async () => {
      const h = await bootHarness();
      const companyId = 'dispatch-co-2';
      const workId = 'work-dispatch-2';
      await seedAcceptedWork(h, {
        companyId,
        workId,
        delegationId: 'del-dispatch-2',
      });

      const first = await dispatchCompanyActivation(companyId, dispatchDeps(h), 'flash');
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.dispatched).toBe(true);

      // Second activation: the completed Work is NOT actionable anymore.
      const second = await dispatchCompanyActivation(companyId, dispatchDeps(h), 'flash');
      expect(second).toEqual({ ok: true, dispatched: false });

      // Receipt count for this company stayed EXACTLY ONE — no second receipt.
      const receipts = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt WHERE company_id = $1',
        [companyId],
      );
      expect(receipts[0]?.count).toBe(1);
    });

    it('empty actionable queue settles cost-free: zero worker rows written (R2 empty scope)', async () => {
      const h = await bootHarness();
      const companyId = 'dispatch-co-3';

      const result = await dispatchCompanyActivation(companyId, dispatchDeps(h), 'flash');

      expect(result).toEqual({ ok: true, dispatched: false });

      // Nothing claimed, no journal attempt, no receipts, no events.
      const receipts = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt WHERE company_id = $1',
        [companyId],
      );
      expect(receipts[0]?.count).toBe(0);
      const attempts = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM idempotency_journal WHERE company_id = $1',
        [companyId],
      );
      expect(attempts[0]?.count).toBe(0);
    });

    it('the composed buildSupervisorDispatch root dispatches the full cycle via onActivate over live PG (R3)', async () => {
      const h = await bootHarness();
      const companyId = 'dispatch-co-4';
      const workId = 'work-dispatch-4';
      await seedAcceptedWork(h, {
        companyId,
        workId,
        delegationId: 'del-dispatch-4',
      });

      const composed = buildSupervisorDispatch({
        connection: h.conn,
        llm: h.llm,
        sandboxRoot: h.sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // The onActivate seam (actor = principals.executor) drives dispatch →
      // runWorker → atomic close over the live connection.
      await composed.onActivate(companyId, 'flash');

      const stored = await h.work.get(companyId, workId);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3);

      const receipts = await h.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt WHERE company_id = $1',
        [companyId],
      );
      expect(receipts[0]?.count).toBe(1);
    });
  },
);
