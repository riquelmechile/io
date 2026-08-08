import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BusinessReceipt } from '@io/business-domain/src/index.js';
import { PgDbConnection } from '@io/database/src/pg-connection.js';

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

/**
 * E2E single receipt + atomic close (Slice C, C4 — WC-6 "One receipt per
 * terminal event" + IJ single-receipt-across-retry, against LIVE PostgreSQL
 * 18.4):
 *
 *   1. `UNIQUE(work_id, terminal_event_id)` is enforced by the REAL database:
 *      after a terminal close issued its receipt, a duplicate close for the
 *      same `(work_id, terminal_event_id)` is REJECTED even with a different
 *      receipt_id (uq_receipt_work_terminal, 004).
 *   2. The terminal close is ALL-OR-NOTHING: CAS + receipt + journal.complete
 *      run inside ONE real PostgreSQL transaction. A forced failure (the
 *      receipt INSERT hits the UNIQUE violation) rolls the WHOLE close back —
 *      the CAS does NOT survive, the journal is NOT completed, and no partial
 *      state remains: the Work stays `in_progress` at its pre-close version,
 *      the pre-committed `in_flight` journal row survives (it was committed in
 *      a DIFFERENT transaction before the effect — design "pre-committed
 *      in_flight SURVIVES"), and the receipt count is unchanged.
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (C4a): UNIQUE(work_id, terminal_event_id) enforced by live PostgreSQL',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_receipt_uniq' });
      await seedAcceptedWork(harness, {
        companyId: 'c4-co',
        delegationId: 'c4-del',
        workId: 'work-c4',
      });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('a duplicate close for the same (work_id, terminal_event_id) is rejected by real PG; no second receipt', async () => {
      // A full happy-path cycle issues EXACTLY ONE receipt in live PG.
      const result = await runWorker(
        workerInputFor(harness, {
          companyId: 'c4-co',
          workId: 'work-c4',
          idempotencyKey: 'c4-key',
          requestHash: 'hash-c4',
        }),
        harness.deps,
        'flash',
      );
      expect(result.ok).toBe(true);
      if (!result.ok || 'replayed' in result) {
        throw new Error(`expected the happy path to complete, got: ${JSON.stringify(result)}`);
      }
      expect(result.work.state).toBe('completed');
      expect(result.work.version).toBe(3);

      const receipts = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(1);

      // Re-attempt the SAME terminal close: same (work_id, terminal_event_id)
      // under a DIFFERENT receipt id. `UNIQUE(work_id, terminal_event_id)`
      // (uq_receipt_work_terminal, 004) MUST reject it at the database level.
      const attemptId = attemptIdFor('c4-co', 'c4-key');
      const duplicateClose: BusinessReceipt = {
        receiptId: 'rcpt:c4-duplicate-close',
        companyId: 'c4-co',
        workId: 'work-c4',
        delegationId: 'c4-del',
        actor: harness.principals.executor,
        policyHash: 'worker:low-risk-documents',
        evidenceRefs: ['ev:c4-co:c4-key'],
        terminalState: 'completed',
        terminalEventId: attemptId,
        artifactHash: 'worker:create-document',
        issuedAt: Date.now(),
      };
      await expect(harness.receipts.save(duplicateClose)).rejects.toThrow(
        /duplicate key value violates unique constraint/,
      );

      // Still EXACTLY ONE receipt — no second receipt was persisted.
      const after = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(after[0]?.count).toBe(1);
    });
  },
);

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (C4b): the terminal close is all-or-nothing — a forced failure rolls back everything',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_receipt_atomic' });
      await seedAcceptedWork(harness, {
        companyId: 'c4-co',
        delegationId: 'c4-del',
        workId: 'work-c4',
      });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('CAS + receipt + journal.complete share ONE real transaction: a UNIQUE-violation failure leaves NO partial state', async () => {
      const companyId = 'c4-co';
      const workId = 'work-c4';
      const idempotencyKey = 'c4-key';
      const attemptId = attemptIdFor(companyId, idempotencyKey);

      // The atomicity proof runs against the PRODUCTION wiring: the harness deps
      // carry the `repositories` factory (fresh PG adapters bound to whatever
      // connection it is given) and the connection is the PLAIN PgDbConnection
      // pool — NO TxRoutingConnection decorator. T1 binds its repos to the
      // transaction-scoped client, so the close is ONE real transaction BY
      // CONSTRUCTION, not by statement routing.
      expect(harness.deps.repositories).toBeTypeOf('function');
      expect(harness.conn).toBeInstanceOf(PgDbConnection);

      // Plant the CONFLICTING terminal close BEFORE the cycle: a receipt row
      // carrying the SAME (work_id, terminal_event_id) the close would issue. The
      // cycle's T1 receipt INSERT then hits uq_receipt_work_terminal INSIDE the
      // transaction — the forced failure that must roll the whole close back.
      await harness.receipts.save({
        receiptId: 'rcpt:c4-planted-other',
        companyId,
        workId,
        delegationId: 'c4-del',
        actor: harness.principals.executor,
        policyHash: 'worker:low-risk-documents',
        evidenceRefs: ['ev:c4-co:c4-key'],
        terminalState: 'completed',
        terminalEventId: attemptId,
        artifactHash: 'worker:create-document',
        issuedAt: Date.now(),
      });

      // The full cycle: claim → authority → intent → in_flight → effect → verify
      // → terminal close. The T1 receipt INSERT violates UNIQUE → the WHOLE
      // transaction rolls back → the error propagates (never a partial commit).
      await expect(
        runWorker(
          workerInputFor(harness, { companyId, workId, idempotencyKey, requestHash: 'hash-c4' }),
          harness.deps,
          'flash',
        ),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);

      // NO partial state:
      //   - the Work is STILL in_progress at its pre-close version — the T1 CAS
      //     was rolled back, NOT committed;
      const stored = await harness.work.get(companyId, workId);
      expect(stored?.state).toBe('in_progress');
      expect(stored?.version).toBe(2);
      //   - the journal row is STILL in_flight — the CAS-loss close never
      //     completed it, and the pre-committed row survived the rollback
      //     (committed in a different transaction before the effect);
      const entry = await harness.journal.lookup(companyId, idempotencyKey);
      expect(entry?.status).toBe('in_flight');
      expect(entry?.attemptId).toBe(attemptId);
      //   - the receipt count is UNCHANGED — only the planted row exists; the
      //     close's receipt INSERT rolled back with the transaction.
      const receipts = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(1);
      const planted = await harness.receipts.get(companyId, 'rcpt:c4-planted-other');
      expect(planted?.receiptId).toBe('rcpt:c4-planted-other');
    });
  },
);
