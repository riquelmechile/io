import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attemptIdFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import {
  createE2eHarness,
  e2eRequirePg,
  openFreshWorkerStack,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from './harness.js';
import type { E2eHarness } from './harness.js';

/**
 * E2E marker durability + restart (Slice C, C5 — IJ marker-survives-restart +
 * retry-after-marker-succeeds + single-receipt-across-retry, against LIVE
 * PostgreSQL 18.4):
 *
 *   1. A finalize CAS-loss writes the durable `aborted_retryable` marker (the
 *      T2(i) aftermath: Work left `in_progress`, journal row marked retryable,
 *      NO receipt — the effect was reversed).
 *   2. RESTART: a FRESH connection / FRESH worker instance (a brand-new
 *      PgDbConnection pool + fresh adapters + fresh worker deps) reads the
 *      row — it SURVIVES with status `aborted_retryable`, attempt_id kept.
 *      This is NON-VACUOUS: a different TCP connection reads the persisted row
 *      written by the crashed instance.
 *   3. The controlled retry through the PUBLIC entry point wins the CAS and
 *      completes: resume (no re-claim) → pre-effect reopen (conditional
 *      UPDATE, same attempt_id) → effect → verify → T1 close → `completed`
 *      with EXACTLY ONE receipt in live PG. The marker does NOT brick the key.
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (C5): marker durability across restart + controlled retry wins on live PostgreSQL',
  () => {
    let harness: E2eHarness;
    let fresh: ReturnType<typeof openFreshWorkerStack>;

    const companyId = 'c5-co';
    const workId = 'work-c5';
    const delegationId = 'c5-del';
    const idempotencyKey = 'c5-key';
    const requestHash = 'hash-c5';
    const attemptId = attemptIdFor(companyId, idempotencyKey);

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_marker' });
      await seedAcceptedWork(harness, { companyId, delegationId, workId });
    });

    afterAll(async () => {
      await fresh?.close();
      await harness?.close();
    });

    it('the aborted_retryable marker survives a restart (fresh connection) and the retry wins the CAS with exactly one receipt', async () => {
      // ── 1. Finalize CAS-loss aftermath (T2(i)), driven through the REAL
      //        adapters: the Work was claimed (in_progress) and the journal row
      //        was marked retryable — no receipt was ever issued.
      const seeded = await harness.work.get(companyId, workId);
      if (seeded === undefined) throw new Error('test setup: work not seeded');
      expect(seeded.state).toBe('accepted');
      const claimed = await harness.work.updateIfVersion(
        { ...seeded, state: 'in_progress' },
        seeded.version,
      );
      if (!claimed.ok) throw new Error('test setup: claim failed');
      await harness.journal.insertInFlight({ companyId, idempotencyKey, requestHash, attemptId });
      await harness.journal.markRetryable(attemptId);

      // The marker is durable in live PG: status aborted_retryable, attempt kept,
      // NO receipt issued by the lost close.
      const marked = await harness.journal.lookup(companyId, idempotencyKey);
      expect(marked?.status).toBe('aborted_retryable');
      expect(marked?.attemptId).toBe(attemptId);
      const receiptsBefore = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptsBefore[0]?.count).toBe(0);

      // ── 2. RESTART: a FRESH connection + FRESH worker instance over the SAME
      //        scratch database. The row written above MUST survive — a different
      //        TCP connection reads the persisted marker.
      fresh = openFreshWorkerStack(harness);
      const restarted = await fresh.deps.journal.lookup(companyId, idempotencyKey);
      expect(restarted?.status).toBe('aborted_retryable');
      expect(restarted?.attemptId).toBe(attemptId);

      // ── 3. Controlled retry through the PUBLIC entry point on the fresh
      //        instance: the resume-aware claim skips re-claiming, the pre-effect
      //        reconcile reopens the key (conditional UPDATE, same attempt_id),
      //        and the T1 close wins the CAS: completed, EXACTLY ONE receipt.
      const retry = await runWorker(
        workerInputFor(harness, { companyId, workId, idempotencyKey, requestHash }),
        fresh.deps,
        'flash',
      );

      expect(retry.ok).toBe(true);
      if (!retry.ok || 'replayed' in retry) {
        throw new Error(`expected the controlled retry to complete, got: ${JSON.stringify(retry)}`);
      }
      expect(retry.work.state).toBe('completed');
      expect(retry.work.version).toBe(3);
      expect(retry.receipt?.receiptId).toBe(`rcpt:${attemptId}`);
      expect(retry.receipt?.terminalEventId).toBe(attemptId);

      // The journal closed `completed` with the stored result (the replay seal).
      const completed = await fresh.deps.journal.lookup(companyId, idempotencyKey);
      expect(completed?.status).toBe('completed');
      expect(completed?.attemptId).toBe(attemptId);
      expect(completed?.resultJson).toBeDefined();

      // EXACTLY ONE receipt across the whole scenario (the lost close issued
      // none; the retry issued exactly one) — real PG receipt count.
      const receiptsAfter = await fresh.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptsAfter[0]?.count).toBe(1);

      // The retry's effect was re-applied on the fresh instance (the prior
      // effect was reversed by the CAS-loss undo — no duplicate document).
      expect(existsSync(join(harness.sandboxRoot, 'docs/quarterly-close.md'))).toBe(true);
    });
  },
);
