import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileContext } from '@io/context/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finalizeInFlightWorkAtomically } from '../../src/worker/finalize.js';
import { attemptIdFor, processTokenFor } from '../../src/worker/intent.js';
import { runWorker } from '../../src/worker/worker.js';
import type { E2eHarness } from './harness.js';
import {
  createE2eHarness,
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  E2E_IDEMPOTENCY_KEY,
  E2E_REQUEST_HASH,
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

      // R5 structure: EXACTLY TWO business_event rows in the live database
      // after the full cycle — `work.completed` AND the composite
      // `work.skill-outcome` (business-event Atomic Worker Terminal Emission),
      // both appended inside T1.
      const eventCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(eventCount[0]?.count).toBe(2);
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
        {
          eventId: `evt:sk:${attemptId}`,
          eventType: 'work.skill-outcome',
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

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (4.1): stale-token close vs live PostgreSQL — T1 rolls back Work/journal/receipt/BOTH events atomically (worker-cycle "Stale-token close rolls back atomically")',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_worker_stale' });
      await seedAcceptedWork(harness);
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('a holder presenting the WRONG fencing token cannot close — the terminal CAS loses, T1 rolls back, and Work/journal/receipt/both event stores stay unchanged', async () => {
      // The harness MUST wire the finalize seam (C1): the repository factory
      // and the connection the terminal close runs on. Guards narrow the
      // optional WorkerDeps fields for the direct finalize call below.
      if (harness.deps.connection === undefined || harness.deps.repositories === undefined) {
        throw new Error('test setup: harness must wire the connection seam');
      }
      // Claim the accepted Work exactly like the worker's claim CAS: the
      // `claim` directive mints the fencing token 0 → 1 atomically.
      const current = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      if (current === undefined) throw new Error('test setup: work not seeded');
      const claimed = await harness.work.updateIfVersion(
        { ...current, state: 'in_progress' },
        current.version,
        { kind: 'claim' },
      );
      if (!claimed.ok) throw new Error('test setup: claim CAS failed');
      expect(claimed.ok && claimed.value.fencingToken).toBe(1);

      // The pre-effect in_flight journal row stores the MINTED token 1
      // (mirrors worker.ts insertInFlight after the claim).
      const attemptId = attemptIdFor(E2E_COMPANY, E2E_IDEMPOTENCY_KEY);
      const inserted = await harness.journal.insertInFlight({
        companyId: E2E_COMPANY,
        idempotencyKey: E2E_IDEMPOTENCY_KEY,
        requestHash: E2E_REQUEST_HASH,
        attemptId,
        fencingToken: 1,
      });
      expect(inserted.ok).toBe(true);

      // Apply the effect on the REAL sandbox (the zombie's own effect — the
      // reconcile must reverse it, then hit the claim-ownership gate).
      const effect = await harness.sandbox.execute(
        {
          type: 'create-document',
          relativePath: 'docs/stale-token.md',
          content: 'stale-token close attempt',
        },
        { idempotencyKey: E2E_IDEMPOTENCY_KEY },
      );

      // The holder presents token 0 — NOT the minted claim token 1. The T1
      // terminal CAS (token-checked) must NOT land; the whole close rolls back.
      const result = await finalizeInFlightWorkAtomically(
        {
          repositories: harness.deps.repositories,
          sandbox: harness.deps.sandbox,
          connection: harness.deps.connection,
          executor: harness.principals.executor,
        },
        {
          companyId: E2E_COMPANY,
          workId: E2E_WORK_ID,
          idempotencyKey: E2E_IDEMPOTENCY_KEY,
          requestHash: E2E_REQUEST_HASH,
          attemptId,
          fencingToken: 0, // STALE — the claim minted 1
          effect,
          activatedSkills: [],
        },
      );

      // T2 hits the CLAIM-OWNERSHIP GATE: the zombie's effect is undone, but
      // markRetryable(attemptId, 0) against the stored claim token 1 is REFUSED
      // → typed UNRESOLVED escalation (spec "Stale token cannot mark retryable").
      expect(result).toMatchObject({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });

      // Work UNCHANGED: still in_progress, still owned by token 1, version 2
      // (the claim landed; the terminal close did not).
      const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('in_progress');
      expect(stored?.version).toBe(2);
      expect(stored?.fencingToken).toBe(1);

      // Journal UNCHANGED: the in_flight row survives (committed in a DIFFERENT
      // tx before the effect) and stays owned by token 1 — the zombie's marker
      // write was refused, never a failure-complete.
      const row = await harness.journal.lookup(E2E_COMPANY, E2E_IDEMPOTENCY_KEY);
      expect(row?.status).toBe('in_flight');
      expect(row?.attemptId).toBe(attemptId);
      expect(row?.fencingToken).toBe(1);

      // Receipt store UNCHANGED: zero receipts persisted.
      const receipts = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receipts[0]?.count).toBe(0);

      // BOTH event stores UNCHANGED: neither `work.completed` NOR the composite
      // `work.skill-outcome` was persisted (R5 — no orphan fact survives the
      // rollback; Atomic Worker Terminal Emission is all-or-nothing).
      const events = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_event',
        [],
      );
      expect(events[0]?.count).toBe(0);

      // The zombie's own effect was reversed by the reconcile (undo ran).
      expect(existsSync(effect.absolutePath)).toBe(false);
    });
  },
);
