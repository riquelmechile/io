import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileContext } from '@io/context/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attemptIdFor, processTokenFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import type { E2eHarness } from './harness.js';
import {
  createE2eHarness,
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  E2E_IDEMPOTENCY_KEY,
  E2E_WORK_ID,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
  workerInputFor,
} from './harness.js';

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

      const result = await runWorker(input, harness.deps, 'flash');

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

      // R5 structure: EXACTLY ONE `work.completed` business_event row in the
      // live database after the full cycle — the append committed inside T1.
      const eventCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(eventCount[0]?.count).toBe(1);
      const eventRows = await harness.conn.query<{
        eventId: string;
        eventType: string;
        companyId: string;
        aggregateKind: string;
        aggregateId: string;
        source: string;
      }>(
        'SELECT event_id AS "eventId", event_type AS "eventType", company_id AS "companyId", ' +
          'aggregate_kind AS "aggregateKind", aggregate_id AS "aggregateId", source ' +
          'FROM business_event',
        [],
      );
      expect(eventRows).toEqual([
        {
          eventId: `evt:${attemptId}`,
          eventType: 'work.completed',
          companyId: E2E_COMPANY,
          aggregateKind: 'work',
          aggregateId: E2E_WORK_ID,
          source: 'worker',
        },
      ]);

      // R9 (structure-not-output): the business event NEVER feeds compileContext.
      // Compiling the SAME inputs the worker compiled yields UNCHANGED bytes —
      // the stable prefix still equals the frozen golden pin — and segment 12
      // (recent-evidence) stays ABSENT from the dynamic suffix.
      const delegation = await harness.delegation.get(E2E_COMPANY, E2E_DELEGATION_ID);
      if (stored === undefined || delegation === undefined) {
        throw new Error('test setup: stored work/delegation missing');
      }
      const compiled = compileContext({
        companyId: E2E_COMPANY,
        process: processTokenFor(delegation),
        delegation,
        work: stored,
      });
      const here = dirname(fileURLToPath(import.meta.url));
      const golden = readFileSync(
        join(here, '../../../context/test/fixtures/prefix.v1.golden.txt'),
        'utf8',
      );
      // Bytes UNCHANGED: the compiled stable prefix is byte-identical to the
      // frozen golden pin except for the cohort discriminator (the process
      // token legitimately differs from the context fixture's 'planning') —
      // every STABLE segment byte matches the pin, and NO event segment exists.
      const process = processTokenFor(delegation);
      expect(compiled.messages[0]?.content).toBe(
        golden.replace('Business process: planning.', `Business process: ${process}.`),
      );
      // Segment 12 (recent-evidence) ABSENT — no event/evidence leakage into
      // the dynamic suffix (and no event markers anywhere in the compiled bytes).
      const suffix = compiled.messages[1]?.content ?? '';
      expect(suffix).not.toContain('recent-evidence');
      expect(suffix).not.toContain('recovered-memory');
      expect(suffix).not.toContain('tool-results');
      expect(suffix).not.toContain('evt:');
      expect(compiled.messages[0]?.content).not.toContain('business_event');
      expect(compiled.messages[0]?.content).not.toContain('evt:');
      // The suffix still carries ONLY the current-work segment (11) bytes.
      expect(suffix).toContain(`Execute work ${E2E_WORK_ID} for company ${E2E_COMPANY}`);

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
