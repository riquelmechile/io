import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runWorker } from '../../src/worker/worker.js';
import { evaluateHeartbeatGate } from '../../src/heartbeat/cycle.js';
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
 * Worker-boundary heartbeat gate against LIVE PostgreSQL (heartbeat-activation
 * R3, S3.1 — task 4.1): after a full `runWorker` cycle the company's REAL
 * event stream holds exactly one `work.completed` event, so the GATE MUST
 * return the Flash activation decision for that company and
 * `no-llm-heartbeat` for a fresh company with no events — with ZERO writes to
 * the live store. The gate is a thin delegate over the read-only evaluator
 * seam; the work-bearing cycle itself bypasses the gate (`worker.ts` is
 * untouched).
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
  'heartbeat-activation: worker-boundary gate against live PG after a worker cycle',
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
      // `work.completed` + the composite `work.skill-outcome` business events
      // to the live store (Atomic Worker Terminal Emission). The skill-outcome
      // is NON-MATERIAL: the heartbeat gate MUST ignore it and still activate.
      const result = await runWorker(workerInputFor(harness), harness.deps, 'flash');
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
      expect(liveEventCount[0]?.count).toBe(2);

      // The GATE reads the company's REAL stream (pool-bound adapter on deps)
      // and returns the PURE domain decision — the future supervisor's entry
      // point for choosing whether to run the work-bearing cycle. The extra
      // non-material event does NOT flip the decision (heartbeat unchanged).
      const decision = await evaluateHeartbeatGate({ events: harness.deps.events }, E2E_COMPANY);
      expect(decision).toEqual({ kind: 'activate', model: 'flash' });

      // A fresh company has no events in the live store → no-llm-heartbeat.
      const fresh = await evaluateHeartbeatGate(
        { events: harness.deps.events },
        'fresh-co-unknown',
      );
      expect(fresh).toEqual({ kind: 'no-llm-heartbeat' });

      // The evaluation wrote NOTHING: the live event stream is unchanged
      // (still exactly the two events the cycle committed) and the work is
      // untouched by the read.
      const afterEval = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(afterEval[0]?.count).toBe(2);
      const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('completed');
    });
  },
);
