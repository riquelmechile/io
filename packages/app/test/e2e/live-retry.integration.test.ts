import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LlmResponse } from '@io/llm-client/src/index.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';

import { attemptIdFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import {
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  createE2eHarness,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from './harness.js';
import type { E2eHarness } from './harness.js';
import { runLiveCycleWithBoundedRetry } from './live-retry.js';

/**
 * GATE-CLOSED runtime proof of the TEST-ONLY bounded reliability retry (spec
 * Req 5) against LIVE PostgreSQL with a FakeLlmClient: the FIRST completion
 * returns an `invalid-plan` response, the retry resets the owned scratch Work
 * to accepted/v1 via raw SQL, and the SECOND completion (fresh idempotency key)
 * claims + completes the cycle. This proves the fresh-key + raw-SQL-reset
 * mechanism works end to end WITHOUT spending a token (the fake never touches
 * the network); the double-gated live E2E wires the SAME helper to the real
 * DeepSeekClient. Worker source is untouched — retry logic is test-local.
 *
 * Honest 3-mode guard (same as worker-e2e C2): skip locally without PG, run
 * against live PG when reachable, fail loudly under IO_REQUIRE_PG=1.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'test-only bounded retry against live PostgreSQL (Req 5 — FakeLlm, zero spend)',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      // FakeLlmClient serves responses in order: first an INVALID plan (empty
      // steps → prepareIntent rejects 'invalid-plan'), then the valid canned
      // create-document plan. Both echo the serving model + KV usage fields so
      // the recorder contract mirrors a real completion.
      const invalidResponse: LlmResponse = {
        model: 'deepseek-v4-flash',
        content: JSON.stringify({ steps: [], intent: 'no steps' }),
        usage: {
          promptTokens: 2,
          completionTokens: 1,
          promptCacheHitTokens: 0,
          promptCacheMissTokens: 2,
        },
      };
      const validResponse: LlmResponse = {
        model: 'deepseek-v4-flash',
        content: JSON.stringify({
          steps: [
            {
              action: 'create-document',
              args: { relativePath: 'docs/retry.md', content: 'retried close' },
            },
          ],
          intent: 'create the retry document',
        }),
        usage: {
          promptTokens: 2,
          completionTokens: 1,
          promptCacheHitTokens: 0,
          promptCacheMissTokens: 2,
        },
      };
      harness = await createE2eHarness({
        databaseName: 'io_dev_e2e_live_retry',
        llm: new FakeLlmClient({ responses: [invalidResponse, validResponse] }),
      });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('retries invalid-plan with a FRESH key + raw-SQL reset, bounded to 2 completions, and reaches terminal success (Req 5 all scenarios)', async () => {
      // Seed the company + active delegation (shared scope), then add the
      // retry-owned work row (accepted v1 — claimable by the fresh key).
      await seedAcceptedWork(harness);
      const retryWorkId = 'work-live-retry';
      await harness.work.save({
        workId: retryWorkId,
        companyId: E2E_COMPANY,
        delegationId: E2E_DELEGATION_ID,
        proposer: harness.principals.proposer,
        description: 'retry-scoped quarterly close document',
        state: 'accepted',
        version: 1,
        evidenceRefs: [],
      });

      const outcome = await runLiveCycleWithBoundedRetry({
        keyForAttempt: (attemptNumber) => `live-${attemptNumber}-${randomUUID()}`,
        runAttempt: async (idempotencyKey) =>
          runWorker(workerInputFor(harness, { workId: retryWorkId, idempotencyKey }), harness.deps),
        resetWork: async () => {
          await harness.conn.execute(
            'UPDATE work SET state = $1, version = $2 WHERE company_id = $3 AND work_id = $4',
            ['accepted', 1, E2E_COMPANY, retryWorkId],
          );
        },
      });

      // Bounded: exactly 2 attempts (first invalid-plan, second valid), fresh
      // distinct keys, and the work was reset to accepted/v1 between attempts.
      expect(outcome.attempts).toBe(2);
      expect(new Set(outcome.keys).size).toBe(2);
      expect(outcome.keys[0]).toMatch(/^live-1-/);
      expect(outcome.keys[1]).toMatch(/^live-2-/);

      // The retry reached terminal success through the SECOND (fresh-key)
      // attempt: the raw-SQL reset unblocked the re-claim.
      expect(outcome.result.ok).toBe(true);
      if (!outcome.result.ok || 'replayed' in outcome.result) {
        throw new Error(`expected retry to complete: ${JSON.stringify(outcome.result)}`);
      }
      expect(outcome.result.work.state).toBe('completed');
      expect(outcome.result.work.version).toBe(3);

      const stored = await harness.work.get(E2E_COMPANY, retryWorkId);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(3);

      // EXACTLY one business receipt for the retry work.
      const receiptCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt WHERE work_id = $1',
        [retryWorkId],
      );
      expect(receiptCount[0]?.count).toBe(1);

      // Journal: the FIRST (invalid-plan) attempt left NO row (prepareIntent
      // fails before reconcilePreEffect) — only the SECOND key is sealed
      // completed. Both keys are guaranteed present: attempts === 2 above.
      const firstKey = outcome.keys[0];
      const secondKey = outcome.keys[1];
      if (firstKey === undefined || secondKey === undefined) {
        throw new Error(`expected two retry keys, got: ${JSON.stringify(outcome.keys)}`);
      }
      const firstKeyJournal = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
        [E2E_COMPANY, firstKey],
      );
      expect(firstKeyJournal).toEqual([]);
      const secondKeyJournal = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
        [E2E_COMPANY, secondKey],
      );
      expect(secondKeyJournal).toEqual([{ status: 'completed' }]);

      // The receipt traces to the SECOND attempt (the one that finalized).
      const attemptId = attemptIdFor(E2E_COMPANY, secondKey);
      const receipt = await harness.receipts.get(E2E_COMPANY, `rcpt:${attemptId}`);
      expect(receipt).toBeDefined();
      expect(receipt?.workId).toBe(retryWorkId);
    });
  },
);
