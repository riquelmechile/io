import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DbConnection } from '@io/database/src/connection.js';
import {
  PgBusinessEventRepository,
  PgBusinessReceiptRepository,
  PgDelegationRepository,
  PgIdempotencyJournalRepository,
  PgWorkRepository,
} from '@io/database/src/index.js';
import type { LlmClient, LlmRequest, LlmResponse } from '@io/llm-client/src/index.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorkerDeps } from '../../src/composition/worker-deps.js';
import { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';
import type { WorkerDeps } from '../../src/worker/types.js';
import { runWorker } from '../../src/worker/worker.js';
import type { E2eHarness } from '../e2e/harness.js';
import {
  createE2eHarness,
  E2E_PRINCIPALS,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from '../e2e/harness.js';

/**
 * Composition root (task 1.1 / Req 1 "Production Composition Root"): proves
 * `buildWorkerDeps` wires the pool-bound PG adapters, the connection seam, the
 * sandbox over the supplied root, and the INJECTED LlmClient — with zero PG
 * required (the PG adapter constructors bind a connection without connecting;
 * only the sandbox touches the filesystem, via a tmp root).
 */
function connectionDouble(): DbConnection {
  return {
    async execute() {
      throw new Error('unexpected execute on the connection double');
    },
    async query() {
      throw new Error('unexpected query on the connection double');
    },
    async transaction() {
      throw new Error('unexpected transaction on the connection double');
    },
  };
}

function cannedResponse(content: string): LlmResponse {
  return {
    model: 'deepseek-v4-flash',
    content,
    usage: {
      promptTokens: 1,
      completionTokens: 1,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 1,
    },
  };
}

const reachable = await pgReachable();

describe('buildWorkerDeps — composition root wiring + injectivity (task 1.1)', () => {
  it('assembles pool-bound PG adapters + sandbox + connection + principals', () => {
    const conn = connectionDouble();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const deps = buildWorkerDeps({
        connection: conn,
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      expect(deps.work).toBeInstanceOf(PgWorkRepository);
      expect(deps.delegation).toBeInstanceOf(PgDelegationRepository);
      expect(deps.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(deps.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
      expect(deps.sandbox).toBeInstanceOf(FileDocumentSandbox);
      expect(deps.connection).toBe(conn);
      expect(deps.principals).toBe(E2E_PRINCIPALS);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('uses the SUPPLIED LlmClient — injectable (identity + behavior)', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const injected: LlmClient = {
        complete: async (request: LlmRequest) =>
          cannedResponse(`echo:${request.messages[0]?.content ?? 'none'}`),
      };
      const deps = buildWorkerDeps({
        connection: connectionDouble(),
        llm: injected,
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      // Identity: the composed deps carry the EXACT supplied client.
      expect(deps.llm).toBe(injected);
      // Behavior: complete() on the composed deps routes to the supplied client.
      const response = await deps.llm.complete({
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(response.content).toBe('echo:hello');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('wires the sandbox over the supplied root — the effect lands under it', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const deps = buildWorkerDeps({
        connection: connectionDouble(),
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      const effect = await deps.sandbox.execute({
        type: 'create-document',
        relativePath: 'docs/quarterly-close.md',
        content: 'closed for Q3 2026',
      });
      expect(effect.applied).toBe(true);
      expect(effect.absolutePath.startsWith(sandboxRoot)).toBe(true);
      expect(readFileSync(join(sandboxRoot, 'docs/quarterly-close.md'), 'utf8')).toBe(
        'closed for Q3 2026',
      );
      expect(await deps.sandbox.wasApplied(effect.undo.handleId)).toBe(true);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('defaults now() to a timestamp and honors an injected now()', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const now = () => 1_234_567_890;
      const withInjectedNow = buildWorkerDeps({
        connection: connectionDouble(),
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
        now,
      });
      expect(withInjectedNow.now?.()).toBe(1_234_567_890);
      const defaulted = buildWorkerDeps({
        connection: connectionDouble(),
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      expect(defaulted.now?.()).toBeGreaterThan(1_700_000_000_000);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});

describe('buildWorkerDeps — repositories factory + atomic finalize (task 1.2)', () => {
  it('repositories(conn) binds FRESH PG adapters to the given connection (mirrors completeWorkAtomically)', () => {
    const conn = connectionDouble();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const deps = buildWorkerDeps({
        connection: conn,
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      const txRepos = deps.repositories?.(conn);
      expect(txRepos?.work).toBeInstanceOf(PgWorkRepository);
      expect(txRepos?.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(txRepos?.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
      // FRESH adapters bound to the given conn — NOT the pool-bound instances
      // (T1 would otherwise autocommit on the pool, breaking atomicity).
      expect(txRepos?.work).not.toBe(deps.work);
      expect(txRepos?.receipts).not.toBe(deps.receipts);
      expect(txRepos?.journal).not.toBe(deps.journal);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('repositories(conn) binds a FRESH PgBusinessEventRepository for events (R5 atomic emission wiring)', () => {
    const conn = connectionDouble();
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-worker-deps-'));
    try {
      const deps = buildWorkerDeps({
        connection: conn,
        llm: new FakeLlmClient({ responses: [cannedResponse('x')] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });
      const txRepos = deps.repositories?.(conn);
      // The terminal-close factory binds the PG event adapter so T1's append
      // joins the CAS + receipt + journal.complete transaction (R5).
      expect(txRepos?.events).toBeInstanceOf(PgBusinessEventRepository);
      // A FRESH adapter per factory call — a tx-bound events repo, NOT a
      // shared pool instance (the append must not autocommit on the pool).
      const second = deps.repositories?.(conn);
      expect(second?.events).toBeInstanceOf(PgBusinessEventRepository);
      expect(second?.events).not.toBe(txRepos?.events);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  describe.skipIf(!reachable && !e2eRequirePg)(
    'full worker cycle via buildWorkerDeps (FakeLlm + live PG)',
    () => {
      let harness: E2eHarness;
      let deps: WorkerDeps;

      beforeAll(async () => {
        harness = await createE2eHarness({ databaseName: 'io_dev_e2e_worker_deps' });
        await seedAcceptedWork(harness, {
          companyId: 'deps-co',
          delegationId: 'deps-del',
          workId: 'work-deps',
        });
        deps = buildWorkerDeps({
          connection: harness.conn,
          llm: harness.llm,
          sandboxRoot: harness.sandboxRoot,
          principals: harness.principals,
        });
      });

      afterAll(async () => {
        await harness?.close();
      });

      it('finalizes atomically through the composition root: one receipt, journal completed, work completed v3', async () => {
        const companyId = 'deps-co';
        const workId = 'work-deps';
        const idempotencyKey = 'deps-key';
        const result = await runWorker(
          workerInputFor(harness, { companyId, workId, idempotencyKey, requestHash: 'hash-deps' }),
          deps,
        );

        expect(result.ok).toBe(true);
        if (!result.ok || 'replayed' in result) {
          throw new Error(`expected the full cycle to complete, got: ${JSON.stringify(result)}`);
        }

        // The cycle result is terminal with the single receipt attached.
        expect(result.work.state).toBe('completed');
        expect(result.work.version).toBe(3);
        expect(result.receipt?.receiptId).toBe(`rcpt:${result.attemptId}`);

        // EXACTLY ONE business receipt committed in live PG (atomic close).
        const receipts = await harness.conn.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM business_receipt',
          [],
        );
        expect(receipts[0]?.count).toBe(1);

        // Journal closed `completed` with the SAME attempt (replay seal).
        const entry = await harness.journal.lookup(companyId, idempotencyKey);
        expect(entry?.status).toBe('completed');
        expect(entry?.attemptId).toBe(result.attemptId);

        // Work stored `completed` at version 3 (accepted 1 → in_progress 2 → completed 3).
        const stored = await harness.work.get(companyId, workId);
        expect(stored?.state).toBe('completed');
        expect(stored?.version).toBe(3);
      });
    },
  );
});
