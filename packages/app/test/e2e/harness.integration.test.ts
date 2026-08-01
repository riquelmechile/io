import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PgBusinessReceiptRepository,
  PgCompanyRepository,
  PgDelegationRepository,
  PgIdempotencyJournalRepository,
  PgWorkRepository,
} from '@io/database/src/index.js';
import { PgDbConnection } from '@io/database/src/pg-connection.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';
import type { LlmResponse } from '@io/llm-client/src/index.js';

import { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';
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
 * E2E harness smoke (Slice C, C1): proves the harness BOOTS against the live
 * io_pg container, applies migrations 001–005 into an ISOLATED scratch
 * database (created/dropped per run — io_dev is never polluted), and wires the
 * FULL real stack: PgDbConnection + the real PG repository adapters + the real
 * terminal transaction + the worker cycle + FakeLlmClient (canned
 * create-document plan) + the shipped FileDocumentSandbox over a tmp root.
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E harness (C1): boots vs live PG, applies 001–005, wires the real stack',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_smoke' });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('connects and applies migrations 001–005 (005 three-value journal CHECK present)', async () => {
      // 005 lands the three-value CHECK: 'aborted_retryable' is a valid status.
      // A two-value (004-era) CHECK would reject this row.
      await harness.conn.execute(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6)',
        ['smoke-co', 'smoke-key', 'smoke-hash', 'smoke-attempt', 'aborted_retryable', Date.now()],
      );
      const rows = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal WHERE attempt_id = $1',
        ['smoke-attempt'],
      );
      expect(rows).toEqual([{ status: 'aborted_retryable' }]);
      await harness.conn.execute('DELETE FROM idempotency_journal WHERE attempt_id = $1', [
        'smoke-attempt',
      ]);
    });

    it('wires the REAL adapters + FakeLlmClient + shipped FileDocumentSandbox (no fakes)', () => {
      // The scratch connection is the PLAIN PgDbConnection pool — the finalize
      // twin's T1 gets its own tx-scoped repos from the `repositories` factory
      // (mirrors completeWorkAtomically), so NO transaction-routing decorator is
      // involved: the atomic close is by construction, not by routing.
      expect(harness.conn).toBeInstanceOf(PgDbConnection);
      expect(harness.deps.work).toBeInstanceOf(PgWorkRepository);
      expect(harness.deps.delegation).toBeInstanceOf(PgDelegationRepository);
      expect(harness.deps.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(harness.deps.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
      expect(harness.deps.sandbox).toBeInstanceOf(FileDocumentSandbox);
      expect(harness.deps.llm).toBeInstanceOf(FakeLlmClient);
      expect(harness.company).toBeInstanceOf(PgCompanyRepository);
      // The atomicity wiring: `repositories(conn)` binds FRESH PG adapters to the
      // connection it is given — T1 hands it the transaction-scoped client, so
      // CAS + receipt + journal.complete share ONE real transaction with no
      // statement routing (the Slice C correction).
      const conn = harness.deps.connection;
      const txRepos = conn === undefined ? undefined : harness.deps.repositories?.(conn);
      expect(txRepos?.work).toBeInstanceOf(PgWorkRepository);
      expect(txRepos?.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(txRepos?.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
    });

    it('round-trips a trivial operation through real PG (company save → get)', async () => {
      const company = { companyId: 'smoke-company', purpose: 'E2E smoke round-trip' };
      await harness.company.save(company);
      expect(await harness.company.get(company.companyId)).toEqual(company);
    });
  },
);

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E harness widening (task 2.1): injected LlmClient + deps delegated to buildWorkerDeps',
  () => {
    const injectedPlan = JSON.stringify({
      steps: [
        {
          action: 'create-document',
          args: { relativePath: 'docs/injected.md', content: 'injected client plan' },
        },
      ],
      intent: 'create the injected document',
    });
    const injectedResponse: LlmResponse = {
      model: 'deepseek-v4-flash',
      content: injectedPlan,
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        promptCacheHitTokens: 0,
        promptCacheMissTokens: 1,
      },
    };

    it('accepts an injected LlmClient, wires it into deps, and drives the REAL cycle with it', async () => {
      const injected = new FakeLlmClient({ responses: [injectedResponse] });
      const h = await createE2eHarness({
        databaseName: 'io_dev_e2e_harness_llm',
        llm: injected,
      });
      try {
        await seedAcceptedWork(h, {
          companyId: 'widen-co',
          delegationId: 'widen-del',
          workId: 'work-widen',
        });

        // The injected client is the harness llm AND the composed deps llm.
        expect(h.llm).toBe(injected);
        expect(h.deps.llm).toBe(injected);

        // Deps are assembled by buildWorkerDeps: pool-bound adapters over the
        // live scratch connection + the repositories factory (terminal close).
        expect(h.deps.connection).toBe(h.conn);
        expect(h.deps.work).toBeInstanceOf(PgWorkRepository);
        expect(h.deps.delegation).toBeInstanceOf(PgDelegationRepository);
        expect(h.deps.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
        expect(h.deps.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
        expect(h.deps.sandbox).toBeInstanceOf(FileDocumentSandbox);
        expect(h.deps.repositories).toBeTypeOf('function');

        // The injected client drives the full cycle (FakeLlm path, behavior
        // unchanged): the worker called the injected client EXACTLY once and the
        // cycle reached a terminal state with exactly one receipt.
        const result = await runWorker(
          workerInputFor(h, {
            companyId: 'widen-co',
            workId: 'work-widen',
            idempotencyKey: 'widen-key',
            requestHash: 'hash-widen',
          }),
          h.deps,
        );
        expect(result.ok).toBe(true);
        expect(injected.requests).toHaveLength(1);
        const receipts = await h.conn.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM business_receipt',
          [],
        );
        expect(receipts[0]?.count).toBe(1);
      } finally {
        await h.close();
      }
    });

    it('keeps the default cannedLlm() path unchanged when no llm is injected', async () => {
      const h = await createE2eHarness({ databaseName: 'io_dev_e2e_harness_default_llm' });
      try {
        expect(h.llm).toBeInstanceOf(FakeLlmClient);
        expect(h.deps.llm).toBe(h.llm);
      } finally {
        await h.close();
      }
    });
  },
);
