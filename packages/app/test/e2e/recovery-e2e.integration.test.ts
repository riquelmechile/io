import type { Company, Delegation, Work } from '@io/business-domain/src/types.js';
import type { FakeLlmClient } from '@io/llm-client/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSupervisorDispatch } from '../../src/composition/supervisor-dispatch.js';
import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../../src/dispatch/keys.js';
import { attemptIdFor } from '../../src/worker/intent.js';
import type { OnRecovery } from '../../src/supervisor/types.js';
import type { E2eHarness } from './harness.js';
import {
  createE2eHarness,
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  E2E_WORK_ID,
  e2eRequirePg,
  pgReachable,
} from './harness.js';

/**
 * E2E capstone (supervisor-recovery task 5.3 — spec "Recovery Matrix", E2E
 * proof): the FULL designated-recovery flow against live PostgreSQL 18.4.
 * An operator-designated orphaned `in_progress` Work in the W2 crash window
 * (the attempt is durably `in_flight` with NO applied effect) is recovered by
 * the PRODUCTION composition root's `onRecovery` seam — discover → W2
 * reconcile (token-matched `markRetryable`, NO undo) → `dispatchRecovery`
 * resume through the claim-gate-free claimed-work cycle → effect → verify →
 * atomic finalize — and MUST reach `completed` with EXACTLY ONE business
 * receipt and the journal `completed`. This is the slice-4 wiring test
 * (supervisor-recovery-wiring.test.ts) live-PG twin: the in-memory DB
 * connection fake is replaced by the REAL scratch PostgreSQL database
 * (migrations 001 → 011 applied by the harness), everything else is the same
 * production stack (real PG adapters, real FileDocumentSandbox, FakeLlmClient
 * canned plan).
 *
 * Honest 3-mode guard (mirrors worker-e2e, C6): SKIP locally when PG is
 * unreachable and IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL
 * LOUDLY in CI (IO_REQUIRE_PG=1) when PG is unreachable.
 */
const reachable = await pgReachable();

/** Seed the company + active delegation + a claimed orphan whose attempt is
 * durably `in_flight` with NO applied effect — the W2 crash window: the worker
 * died after `insertInFlight`, before the effect. The journal identity is the
 * deterministic function of the Work row (`wk:` key + SHA-256 hash), exactly
 * what the supervisor's recovery derives — so the W2 reconcile matches. */
async function seedW2Orphan(harness: E2eHarness): Promise<void> {
  const company: Company = { companyId: E2E_COMPANY, purpose: 'E2E tenant scope' };
  const delegation: Delegation = {
    delegationId: E2E_DELEGATION_ID,
    companyId: E2E_COMPANY,
    delegator: 'principal-owner',
    delegate: harness.principals.executor,
    authorityScope: { scope: 'low-risk-documents', actions: ['work.execute', 'create-document'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 4_100_000_000_000,
    expectedOutcome: 'create the E2E quarterly close document',
    state: 'active',
  };
  const orphan: Work = {
    workId: E2E_WORK_ID,
    companyId: E2E_COMPANY,
    delegationId: E2E_DELEGATION_ID,
    proposer: harness.principals.proposer,
    description: 'execute the low-risk quarterly close document create',
    state: 'in_progress',
    version: 2,
    fencingToken: 1, // the minted claim token — recovery MUST retain it (D6)
    evidenceRefs: [],
  };
  await harness.company.save(company);
  await harness.delegation.save(delegation);
  await harness.work.save(orphan);
  // The crashed worker's durable journal row: in_flight, deterministic
  // dispatch identity, the retained claim token, and NO effect evidence (the
  // sandbox undo log is empty — the effect provably never ran).
  const key = dispatchIdempotencyKeyFor(E2E_COMPANY, E2E_WORK_ID);
  await harness.journal.insertInFlight({
    companyId: E2E_COMPANY,
    idempotencyKey: key,
    requestHash: dispatchRequestHashFor(orphan),
    attemptId: attemptIdFor(E2E_COMPANY, key),
    fencingToken: 1,
  });
}

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (supervisor-recovery, 5.3): full designated recovery against live PostgreSQL — io-persistence-recovery-contract "Recovery Matrix"',
  () => {
    let harness: E2eHarness;
    let onRecovery: OnRecovery;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_recovery' });
      await seedW2Orphan(harness);
      // The PRODUCTION composition root (same shape the daemon wires in
      // production): buildSupervisorDispatch returns { deps, onActivate,
      // onRecovery, requestRecovery } — the daemon threads onRecovery into
      // startSupervisor; here the test pumps the composition's onRecovery
      // directly (the supervisor tick's recovery pass, design "SIDE EFFECT
      // FIRST, checkpoint LAST").
      const composed = buildSupervisorDispatch({
        connection: harness.conn,
        llm: harness.llm,
        sandboxRoot: harness.sandboxRoot,
        principals: harness.principals,
      });
      onRecovery = composed.onRecovery;
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('designate → onRecovery tick → W2 markRetryable → dispatchRecovery resume → effect→verify→finalize → completed, EXACTLY ONE receipt, journal completed (Recovery Matrix W2 row)', async () => {
      const { work } = harness;

      // 1. The operator designates the orphan: a plain CAS (version 2 → 3)
      //    that preserves state + fencing token (work-lifecycle "Operator
      //    Recovery Designation") — the tick's discovery query finds it.
      const designated = await work.setRecoveryRequest(E2E_COMPANY, E2E_WORK_ID, 2, true);
      expect(designated.ok).toBe(true);
      if (designated.ok) {
        expect(designated.value.state).toBe('in_progress'); // NOT a transition
        expect(designated.value.fencingToken).toBe(1); // token preserved
      }

      // 2. Pump the supervisor tick's recovery pass: discover → W2 reconcile
      //    (token-matched markRetryable, NO undo) → dispatchRecovery resume →
      //    claimed-work cycle (authority → intent → effect → verify →
      //    finalize) → marker cleared LAST.
      await onRecovery(E2E_COMPANY);

      // 3. The recovered orphan COMPLETED against live PG — retained token,
      //    never re-minted (D6).
      const stored = await work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('completed');
      // seed 2 → designation 3 → terminal CAS 4 → marker clear 5.
      expect(stored?.version).toBe(5);
      expect(stored?.fencingToken).toBe(1);

      // 4. EXACTLY ONE business receipt in the live database (exactly-once).
      const receiptCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptCount[0]?.count).toBe(1);
      const receipt = await harness.receipts.get(
        E2E_COMPANY,
        `rcpt:${attemptIdFor(E2E_COMPANY, dispatchIdempotencyKeyFor(E2E_COMPANY, E2E_WORK_ID))}`,
      );
      expect(receipt).toBeDefined();
      expect(receipt?.workId).toBe(E2E_WORK_ID);

      // 5. The journal attempt closed `completed` — the replay seal.
      const journalRows = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([{ status: 'completed' }]);

      // 6. The designation marker is cleared LAST — the next tick does NOT
      //    re-recover the completed Work (recovery is idempotent).
      expect(await work.listRecoveryRequestedByCompany(E2E_COMPANY)).toEqual([]);

      // 7. EXACTLY ONE LLM request drove the resume — the recovered cycle ran
      //    once (no second intent, no re-dispatch).
      expect((harness.llm as FakeLlmClient).requests).toHaveLength(1);
    });
  },
);
