import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Work } from '@io/business-domain/src/index.js';

import { attemptIdFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import {
  createE2eHarness,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from './harness.js';
import type { E2eHarness } from './harness.js';

/** A well-formed completed Work — the shape the terminal close actually stores
 * in result_json (guarded by parseWorkRow on the replay lookup, D7). */
function recordedResult(companyId: string, delegationId: string, workId: string): Work {
  return {
    workId,
    companyId,
    delegationId,
    proposer: 'c3-proposer',
    description: 'c3 recorded terminal result',
    state: 'completed',
    version: 3,
    fencingToken: 0,
    evidenceRefs: ['c3-evid'],
  };
}

/**
 * E2E replay / DENY (Slice C, C3 — WC-6 "Atomic Terminal Close" + IJ
 * completed-replay / completed-deny, against LIVE PostgreSQL 18.4):
 *
 *   - same idempotency key + same request hash → the recorded result is
 *     REPLAYED (the journal is `completed` with the stored `result_json`);
 *     NO new effect runs and NO new receipt is issued.
 *   - same idempotency key + different request hash → DENY
 *     (`idempotency-conflict`); NO effect, NO receipt.
 *
 * The state under test is the WC-6 replay surface: the journal row for the key
 * is `completed` (the replay seal) with the stored result, seeded through the
 * REAL `PgIdempotencyJournalRepository` (insertInFlight → complete) so the row
 * round-trips through real PG. The claim (accepted → in_progress) succeeds and
 * the pre-effect journal reconciliation (B6) stops the cycle BEFORE the effect
 * — the recorded result is returned and nothing is re-run. Receipt count and
 * the journal row are asserted against the live database (unchanged on replay).
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (C3): replay / DENY against live PostgreSQL — WC-6 + IJ completed-replay/completed-deny',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_replay' });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('same key + same hash → REPLAY the recorded result: no new effect, no new receipt, journal unchanged', async () => {
      const companyId = 'c3-co';
      const workId = 'work-c3-replay';
      const idempotencyKey = 'c3-key';
      const requestHash = 'hash-c3';
      await seedAcceptedWork(harness, { companyId, delegationId: 'c3-del', workId });

      // Seed the WC-6 replay state through the REAL journal adapter: the key is
      // `completed` with a stored result — the replay seal — in live PG.
      const attemptId = attemptIdFor(companyId, idempotencyKey);
      await harness.journal.insertInFlight({
        companyId,
        idempotencyKey,
        requestHash,
        attemptId,
      });
      const recorded = recordedResult(companyId, 'c3-del', workId);
      await harness.journal.complete(attemptId, recorded);

      // The stored result round-trips through real PG (JSONB).
      const seeded = await harness.conn.query<{ status: string; resultJson: unknown }>(
        'SELECT status, result_json AS "resultJson" FROM idempotency_journal ' +
          'WHERE company_id = $1 AND idempotency_key = $2',
        [companyId, idempotencyKey],
      );
      expect(seeded).toEqual([{ status: 'completed', resultJson: recorded }]);

      // Re-attempt the SAME key + SAME hash: the cycle claims, then the pre-effect
      // reconciliation REPLAYS the recorded result and stops BEFORE any effect.
      const result = await runWorker(
        workerInputFor(harness, { companyId, workId, idempotencyKey, requestHash }),
        harness.deps,
        'flash',
      );

      expect(result.ok).toBe(true);
      if (!result.ok || !('replayed' in result)) {
        throw new Error(`expected the replay result, got: ${JSON.stringify(result)}`);
      }
      expect(result.replayed).toBe(true);
      expect(result.resultJson).toEqual(recorded);

      // NO new effect: the sandbox document was never created.
      expect(existsSync(join(harness.sandboxRoot, 'docs/quarterly-close.md'))).toBe(false);

      // NO new receipt: the live database still holds zero business receipts.
      const receipts = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(0);

      // The journal row is UNCHANGED: still `completed` with the stored result.
      const after = await harness.conn.query<{ status: string; resultJson: unknown }>(
        'SELECT status, result_json AS "resultJson" FROM idempotency_journal ' +
          'WHERE company_id = $1 AND idempotency_key = $2',
        [companyId, idempotencyKey],
      );
      expect(after).toEqual([{ status: 'completed', resultJson: recorded }]);
    });

    it('same key + different hash → DENY idempotency-conflict: no effect, no receipt, journal unchanged', async () => {
      const companyId = 'c3-co2';
      const workId = 'work-c3-deny';
      const idempotencyKey = 'c3-key2';
      await seedAcceptedWork(harness, { companyId, delegationId: 'c3-del2', workId });

      // Seed a COMPLETED journal row whose stored request hash differs from the
      // current attempt — the WC-6 DENY surface.
      const attemptId = attemptIdFor(companyId, idempotencyKey);
      await harness.journal.insertInFlight({
        companyId,
        idempotencyKey,
        requestHash: 'hash-c3-original',
        attemptId,
      });
      await harness.journal.complete(attemptId, recordedResult(companyId, 'c3-del2', workId));

      // Re-attempt with the SAME key but a DIFFERENT hash: DENY.
      const result = await runWorker(
        workerInputFor(harness, {
          companyId,
          workId,
          idempotencyKey,
          requestHash: 'hash-c3-different',
        }),
        harness.deps,
        'flash',
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('idempotency-conflict');

      // NO effect, NO receipt, journal row untouched.
      expect(existsSync(join(harness.sandboxRoot, 'docs/quarterly-close.md'))).toBe(false);
      const receipts = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(0);
      const row = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
        [companyId, idempotencyKey],
      );
      expect(row).toEqual([{ status: 'completed' }]);
    });
  },
);
