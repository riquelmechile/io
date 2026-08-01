import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTEXT_SCHEMA_VERSION, deriveCohort } from '@io/context/src/index.js';
import { DeepSeekClient } from '@io/llm-client/src/index.js';

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
import { runLiveCycleWithBoundedRetry } from './live-retry.js';
import { RecordingLlmClient } from './recording-llm-client.js';

/**
 * Live DeepSeek V4 end-to-end worker cycle (design "Live E2E Design"; spec
 * worker-cycle Reqs 2–6): the FULL worker cycle — claim → authority → intent
 * via the REAL `DeepSeekClient.complete` → effect → reconcile → verify →
 * atomic finalize — against `deepseek-v4-flash` and live PostgreSQL, wired
 * through the production composition root `buildWorkerDeps`.
 *
 * COST-SAFE DOUBLE GATE (spec Req 3, mandatory): the suite is evaluated FIRST
 * against `DEEPSEEK_API_KEY` AND `IO_LIVE_LLM === '1'`. Without BOTH, the
 * entire suite skips BEFORE any model client is constructed or invoked — a
 * plain `pnpm test` / CI run never spends a token. The key value is referenced
 * ONLY through this boolean guard: it is never read into a variable, never
 * logged, never printed, never committed. CI has no key → always skip. Never
 * add the key to a workflow.
 *
 * Opt-in live run (real model + live PG):
 *   IO_LIVE_LLM=1 DEEPSEEK_API_KEY=… pnpm vitest run packages/app/test/e2e/deepseek-live.integration.test.ts
 *
 * Assertions are STRUCTURE-NOT-OUTPUT (spec Req 4): terminal state, exactly one
 * business receipt, completed journal, reversible effect, model echo, KV-cache
 * usage accounting and the forwarded cohort — NEVER the exact plan path, plan
 * content, or plan JSON (the real model is non-deterministic). The bounded
 * reliability retry (spec Req 5) lives ONLY in this test file: fresh
 * idempotency key per attempt, raw-SQL work reset, hard cap of 2 completions.
 * Worker source (`packages/app/src/worker/*`) is untouched.
 */
const reachable = await pgReachable();

// COST-SAFE DOUBLE GATE (spec Req 3, mandatory — evaluated FIRST, before any
// model/client construction that could spend): without BOTH `DEEPSEEK_API_KEY`
// AND `IO_LIVE_LLM === '1'` the entire suite skips and the model is never
// invoked. The key value is referenced ONLY through this boolean guard — never
// read into a variable, logged, printed, or committed.
describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')(
  'live DeepSeek V4 E2E (opt-in — double-gated: DEEPSEEK_API_KEY + IO_LIVE_LLM=1)',
  () => {
    describe.skipIf(!reachable && !e2eRequirePg)(
      'full worker cycle against the real model and live PostgreSQL',
      () => {
        let harness: E2eHarness;
        let recorder: RecordingLlmClient;

        beforeAll(async () => {
          // The recorder wraps the REAL DeepSeekClient; the harness builds its
          // deps ONCE through `buildWorkerDeps` with this injected llm (single
          // wiring path — design "prefer single path"). The SDK client is lazy
          // (D6): construction is side-effect free; the first `complete()` is
          // the first HTTP call, which only happens when BOTH gates are open.
          recorder = new RecordingLlmClient(new DeepSeekClient());
          harness = await createE2eHarness({
            databaseName: 'io_dev_e2e_deepseek_live',
            llm: recorder,
          });
          await seedAcceptedWork(harness);
        });

        afterAll(async () => {
          await harness?.close();
        });

        it('runs the full live cycle to a terminal, reversible outcome (Req 2 — structure, not output)', async () => {
          const result = await runWorker(workerInputFor(harness), harness.deps);

          expect(result.ok).toBe(true);
          if (!result.ok || 'replayed' in result) {
            throw new Error(`expected the live happy path to complete: ${JSON.stringify(result)}`);
          }

          // Terminal state on the cycle result AND in the live database.
          expect(result.work.state).toBe('completed');
          expect(result.work.version).toBe(3);
          expect(result.receipt).toBeDefined();
          expect(result.effect.applied).toBe(true);
          const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
          expect(stored?.state).toBe('completed');
          expect(stored?.version).toBe(3);

          // EXACTLY ONE business receipt for this work (scoped — the retry
          // test owns a second work row).
          const receiptCount = await harness.conn.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM business_receipt WHERE work_id = $1',
            [E2E_WORK_ID],
          );
          expect(receiptCount[0]?.count).toBe(1);
          const attemptId = attemptIdFor(E2E_COMPANY, E2E_IDEMPOTENCY_KEY);
          const receipt = await harness.receipts.get(E2E_COMPANY, `rcpt:${attemptId}`);
          expect(receipt).toBeDefined();
          expect(receipt?.terminalEventId).toBe(attemptId);
          expect(receipt?.workId).toBe(E2E_WORK_ID);

          // Journal completed for the happy-path key (scoped by key — the
          // retry test adds its own journal rows).
          const journal = await harness.conn.query<{ status: string }>(
            'SELECT status FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
            [E2E_COMPANY, E2E_IDEMPOTENCY_KEY],
          );
          expect(journal).toEqual([{ status: 'completed' }]);

          // The sandbox effect was applied to the real filesystem…
          expect(existsSync(result.effect.absolutePath)).toBe(true);
          expect(await harness.sandbox.wasApplied(result.effect.undo.handleId)).toBe(true);
          // …and is reversible via the shipped FileDocumentSandbox inverse.
          await harness.sandbox.undo(result.effect.undo);
          expect(existsSync(result.effect.absolutePath)).toBe(false);

          // PLAN SHAPE ONLY — never the exact path/content/plan (Req 4
          // "Generated output remains unconstrained"; the real model is
          // non-deterministic). The executed action is the single reversible
          // create-document effect with a non-empty relativePath and string
          // content.
          expect(result.plan.steps.length).toBeGreaterThan(0);
          expect(result.effect.action.type).toBe('create-document');
          expect(result.effect.action.relativePath.length).toBeGreaterThan(0);
          expect(typeof result.effect.action.content).toBe('string');
        }, 60_000);

        it('echoes the serving model and surfaces KV-cache usage + forwarded cohort (Req 4 echo/cache, Req 6)', async () => {
          // Runs AFTER the happy-path test above (vitest executes `it` blocks
          // in order); the recorder captured that completion's request and
          // response. The live run is one happy-path completion — echo, cache
          // and cohort all describe that single real call.
          const response = recorder.lastResponse;
          const request = recorder.lastRequest;
          expect(recorder.callCount).toBeGreaterThan(0);
          expect(response).toBeDefined();
          expect(request).toBeDefined();

          // Serving model is echoed (Req 4 "Serving model is echoed").
          expect(response?.model).toBe('deepseek-v4-flash');

          // KV-cache structure: both fields present and non-negative (Req 4
          // "Cache structure is asserted"; presence + accounting asserted, NOT
          // hit > 0 — a fresh cohort legitimately starts with miss-only).
          expect(response?.usage.promptCacheHitTokens).toBeGreaterThanOrEqual(0);
          expect(response?.usage.promptCacheMissTokens).toBeGreaterThanOrEqual(0);
          // Prompt accounting: prompt = hit + miss (Req 6).
          expect(response?.usage.promptTokens).toBe(
            (response?.usage.promptCacheHitTokens ?? 0) +
              (response?.usage.promptCacheMissTokens ?? 0),
          );

          // Forwarded cohort: request user === deriveCohort(...) — the derived
          // cache cohort (never caller-supplied), matching the seed delegation's
          // authority scope 'low-risk-documents' and the current schema version.
          expect(request?.user).toBe(
            deriveCohort({
              companyId: E2E_COMPANY,
              process: 'low-risk-documents',
              schemaVersion: CONTEXT_SCHEMA_VERSION,
            }),
          );
        });

        it('retries invalid-plan with a fresh idempotency key, bounded to 2 completions, test-only (Req 5)', async () => {
          // A retry-owned work row (the happy-path work is already terminal).
          // `save` is INSERT-only and `work_id` is UNIQUE, so a fresh id is
          // required — this row belongs to THIS test only.
          const retryWorkId = 'work-live-retry';
          await harness.work.save({
            workId: retryWorkId,
            companyId: E2E_COMPANY,
            delegationId: E2E_DELEGATION_ID,
            proposer: harness.principals.proposer,
            description: 'live retry-scoped quarterly close document',
            state: 'accepted',
            version: 1,
            evidenceRefs: [],
          });

          // TEST-ONLY bounded retry (design "Bounded reliability retry",
          // shared helper `live-retry.ts`): a FRESH idempotency key per attempt
          // (`live-${n}-${uuid}`), retry ONLY `invalid-plan`, hard cap of 2
          // model completions — a third is impossible by construction. The
          // helper resets the owned scratch Work to accepted/v1 via raw SQL
          // between attempts (`save` is INSERT-only; `updateIfVersion` only
          // increments; invalid-plan leaves NO journal row — prepareIntent
          // fails before reconcilePreEffect — and no sandbox effect). NO retry
          // logic exists in worker source — this helper is test-local.
          const completionsBefore = recorder.callCount;
          const outcome = await runLiveCycleWithBoundedRetry({
            keyForAttempt: (attemptNumber) => `live-${attemptNumber}-${randomUUID()}`,
            runAttempt: async (idempotencyKey) =>
              runWorker(
                workerInputFor(harness, { workId: retryWorkId, idempotencyKey }),
                harness.deps,
              ),
            resetWork: async () => {
              await harness.conn.execute(
                'UPDATE work SET state = $1, version = $2 WHERE company_id = $3 AND work_id = $4',
                ['accepted', 1, E2E_COMPANY, retryWorkId],
              );
            },
          });

          // Bounded: ≤ 2 attempts, fresh (distinct) keys, no third completion.
          expect(outcome.attempts).toBeLessThanOrEqual(2);
          expect(new Set(outcome.keys).size).toBe(outcome.keys.length);
          expect(recorder.callCount - completionsBefore).toBeLessThanOrEqual(2);

          // Terminal success — or fail loudly (never a silent retry loss).
          const result = outcome.result;
          expect(result.ok).toBe(true);
          if (!result.ok || 'replayed' in result) {
            throw new Error(
              `expected the retried live cycle to complete: ${JSON.stringify(result)}`,
            );
          }
          expect(result.work.state).toBe('completed');
          expect(result.work.version).toBe(3);
          const retryReceipts = await harness.conn.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM business_receipt WHERE work_id = $1',
            [retryWorkId],
          );
          expect(retryReceipts[0]?.count).toBe(1);
        }, 60_000);
      },
    );
  },
);
