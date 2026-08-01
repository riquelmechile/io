import { existsSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attemptIdFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import {
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  E2E_IDEMPOTENCY_KEY,
  E2E_WORK_ID,
  createE2eHarness,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from './harness.js';
import type { E2eHarness } from './harness.js';

/**
 * E2E happy path (Slice C, C2 — WC-6 "End-to-end happy path against live
 * PostgreSQL"): runs the FULL worker cycle against the REAL PostgreSQL 18.4
 * stack wired by the C1 harness — claim → authority → intent → effect (OUTSIDE
 * the terminal tx, §9.8) → reconcile → verify → terminal transaction — with
 * FakeLlmClient standing in for DeepSeek and the shipped FileDocumentSandbox
 * over a tmp root. The cycle MUST reach a terminal state with EXACTLY ONE
 * business receipt persisted in the live database, the journal `completed`,
 * the sandbox effect applied (and reversible), and four DISTINCT principals
 * (proposer/approver/executor/verifier).
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 * Replay / DENY / marker durability are C3/C5 — NOT part of this batch.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (C2): full worker cycle against live PostgreSQL — WC-6 happy path',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_worker' });
      await seedAcceptedWork(harness);
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('runs claim → authority → intent → effect → reconcile → verify → terminal; exactly one receipt in live PG', async () => {
      const input = workerInputFor(harness);

      const result = await runWorker(input, harness.deps);

      expect(result.ok).toBe(true);
      if (!result.ok || 'replayed' in result) {
        throw new Error(
          `expected the fresh-key happy path to complete, got: ${JSON.stringify(result)}`,
        );
      }

      // The cycle result itself is terminal, with the single receipt attached.
      expect(result.work.state).toBe('completed');
      expect(result.work.version).toBe(3);
      expect(result.receipt).toBeDefined();
      expect(result.effect.applied).toBe(true);

      // The Work reached a terminal state in the LIVE database.
      const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3);

      // EXACTLY ONE business receipt persisted in the live database (WC-6).
      const receiptCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptCount[0]?.count).toBe(1);
      const attemptId = attemptIdFor(E2E_COMPANY, E2E_IDEMPOTENCY_KEY);
      const receipt = await harness.receipts.get(E2E_COMPANY, `rcpt:${attemptId}`);
      expect(receipt).toBeDefined();
      expect(receipt?.terminalEventId).toBe(attemptId);
      expect(receipt?.workId).toBe(E2E_WORK_ID);

      // The journal closed `completed` (the replay seal — WC-6).
      const journal = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal',
        [],
      );
      expect(journal).toEqual([{ status: 'completed' }]);

      // The sandbox effect was applied to the real filesystem…
      expect(existsSync(result.effect.absolutePath)).toBe(true);
      expect(await harness.sandbox.wasApplied(result.effect.undo.handleId)).toBe(true);
      // …and is reversible via the shipped FileDocumentSandbox inverse (unlink).
      await harness.sandbox.undo(result.effect.undo);
      expect(existsSync(result.effect.absolutePath)).toBe(false);

      // Four DISTINCT principals across the whole cycle (SoD, WC authority).
      const { proposer, approver, executor, verifier } = harness.principals;
      expect(new Set([proposer, approver, executor, verifier]).size).toBe(4);
      expect(stored?.proposer).toBe(proposer);
      expect(receipt?.actor).toBe(executor);
      expect((await harness.delegation.get(E2E_COMPANY, E2E_DELEGATION_ID))?.delegate).toBe(
        executor,
      );
    });
  },
);
