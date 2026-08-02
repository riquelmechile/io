import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorker } from '../../src/worker/worker.js';
import { evaluateHeartbeatForCompany } from '../../src/heartbeat/evaluate.js';
import type { E2eHarness } from '../e2e/harness.js';
import {
  createE2eHarness,
  E2E_COMPANY,
  E2E_WORK_ID,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from '../e2e/harness.js';

/**
 * Read-only heartbeat seam against LIVE PostgreSQL (heartbeat R6, R7 — tasks
 * 2.4): after a full `runWorker` cycle the company's REAL event stream holds
 * exactly one `work.completed` event, so the seam MUST return the Flash
 * activation decision for that company and `no-llm-heartbeat` for a fresh
 * company with no events — with ZERO writes to the live store.
 *
 * Honest 3-mode guard (copied from worker-e2e.integration.test.ts): SKIP
 * locally when PG is unreachable and IO_REQUIRE_PG is unset; RUN when PG is
 * reachable; FAIL LOUDLY in CI (IO_REQUIRE_PG=1) when PG is unreachable.
 *
 * SEQUENTIAL: this file must run with `--no-file-parallelism` (its own
 * scratch database; ordering within the file matters).
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'heartbeat R6: read-only evaluator against live PG after a worker cycle',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_heartbeat' });
      await seedAcceptedWork(harness);
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('post-cycle: the company stream ⇒ activate flash; fresh company ⇒ no-llm-heartbeat', async () => {
      // Full worker cycle over the REAL stack — the terminal close appends
      // exactly one `work.completed` business event to the live store.
      const result = await runWorker(workerInputFor(harness), harness.deps);
      expect(result.ok).toBe(true);
      if (!result.ok || 'replayed' in result) {
        throw new Error(
          `expected the fresh-key happy path to complete, got: ${JSON.stringify(result)}`,
        );
      }
      expect(result.work.state).toBe('completed');

      const liveEventCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(liveEventCount[0]?.count).toBe(1);

      // The seam reads the company's REAL stream (pool-bound adapter on deps)
      // and returns the PURE domain decision.
      const decision = await evaluateHeartbeatForCompany(
        { events: harness.deps.events },
        E2E_COMPANY,
      );
      expect(decision).toEqual({ kind: 'activate', model: 'flash' });

      // A fresh company has no events in the live store → no-llm-heartbeat.
      const fresh = await evaluateHeartbeatForCompany(
        { events: harness.deps.events },
        'fresh-co-unknown',
      );
      expect(fresh).toEqual({ kind: 'no-llm-heartbeat' });

      // The evaluation wrote NOTHING: the live event stream is unchanged
      // (still exactly the one event the cycle committed) and the work is
      // untouched by the read.
      const afterEval = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(afterEval[0]?.count).toBe(1);
      const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('completed');
    });
  },
);
