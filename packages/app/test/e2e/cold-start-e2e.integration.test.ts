import type { Company, Delegation } from '@io/business-domain/src/types.js';
import { proposeWork } from '@io/business-domain/src/index.js';
import type { FakeLlmClient } from '@io/llm-client/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSupervisorDispatch } from '../../src/composition/supervisor-dispatch.js';
import { startSupervisor } from '../../src/supervisor/supervisor.js';
import type { SupervisorHandle } from '../../src/supervisor/types.js';
import type { E2eHarness } from './harness.js';
import {
  createE2eHarness,
  E2E_COMPANY,
  E2E_DELEGATION_ID,
  E2E_WORK_ID,
  e2eRequirePg,
  pgReachable,
  seedAcceptedWork,
} from './harness.js';

/**
 * Cold-start E2E (cold-start-discovery task 4.1, design D10, spec
 * business-event "Cold-start chain is provable through the real path"): a
 * zero-history company whose first Work is PROPOSED and ACCEPTED through the
 * REAL use cases — proposeWork over the live PG work repository, then the
 * composition's `acceptWork` seam (D10: `acceptWorkAtomically(connection,
 * cmd)`) — becomes discoverable via `listCompanyIds()` and is then driven to
 * completion by the REAL supervisor: `startSupervisor` with the injectable
 * one-shot schedule pump, `onActivate`/`onRecovery` from the same composition
 * root.
 *
 * Banned by design (D10): `seedAcceptedWork` (no direct accepted-Work seed) and
 * direct `onActivate`/`onRecovery` invocation (the tick must drive discovery →
 * gate → callbacks). No existing test is a precedent for this path
 * (recovery-e2e seeds in_progress Work and calls onRecovery directly).
 *
 * Honest 3-mode guard (mirrors the other E2E suites): SKIP locally when PG is
 * unreachable and IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL
 * LOUDLY in CI (IO_REQUIRE_PG=1) when PG is unreachable.
 */
const reachable = await pgReachable();

/** Tenant scope for the cold-start company (company + delegation rows only —
 * the Work itself is created through the real propose → accept path). */
async function seedTenant(harness: E2eHarness): Promise<void> {
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
  await harness.company.save(company);
  await harness.delegation.save(delegation);
}

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (cold-start, 4.1): zero-history company accepted through the composition acceptWork seam → supervisor one-shot pump → completed (D10, no seedAcceptedWork)',
  () => {
    let harness: E2eHarness;
    let composed: ReturnType<typeof buildSupervisorDispatch>;
    const WORK_ID = 'work-coldstart';

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_coldstart' });
      await seedTenant(harness);
      // The PRODUCTION composition root (D10): the SAME shape the daemon
      // wires — { deps, onActivate, onRecovery, requestRecovery, acceptWork }.
      composed = buildSupervisorDispatch({
        connection: harness.conn,
        llm: harness.llm,
        sandboxRoot: harness.sandboxRoot,
        principals: harness.principals,
      });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('propose → accept via the composition seam → discovered by listCompanyIds → one-shot supervisor pump → work.completed + Work completed', async () => {
      const { work } = harness;

      // 1. PROPOSE through the real use case over the live PG work repo.
      const proposed = await proposeWork(
        {
          companyId: E2E_COMPANY,
          actor: harness.principals.proposer,
          workId: WORK_ID,
          delegationId: E2E_DELEGATION_ID,
          description: 'execute the low-risk quarterly close document create',
        },
        { work: harness.deps.work },
      );
      expect(proposed.ok).toBe(true);
      if (proposed.ok) {
        expect(proposed.value.state).toBe('proposed');
        expect(proposed.value.version).toBe(1);
      }

      // 2. ACCEPT through the composition `acceptWork` seam (D10) — the
      //    production atomic path over the live PG transaction.
      const accepted = await composed.acceptWork({
        companyId: E2E_COMPANY,
        actor: harness.principals.approver,
        workId: WORK_ID,
        expectedVersion: 1,
      });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) {
        expect(accepted.value.state).toBe('accepted');
        expect(accepted.value.version).toBe(2);
      }

      // 3. DISCOVERY: the accepted Work's single work.accepted event makes the
      //    zero-history company visible to the read-only distinct selection.
      const discovered = await composed.deps.events.listCompanyIds();
      expect(discovered).toEqual([E2E_COMPANY]);

      // 4. PUMP the REAL supervisor one-shot schedule: startSupervisor with the
      //    composition's deps + callbacks; the injectable schedule fires
      //    exactly one tick, which discovers → gates → activates → dispatches →
      //    runWorker → finalize. Nothing is invoked directly.
      const pump = manualPump();
      const supervisor: SupervisorHandle = startSupervisor(composed.deps, {
        intervalMs: 1_000,
        schedule: pump.schedule,
        onActivate: composed.onActivate,
        onRecovery: composed.onRecovery,
      });
      await pump.pump();
      supervisor.stop();

      // 5. The Work reached `completed` in live PG (propose v1 → accept v2 →
      //    claim v3 → terminal v4).
      const stored = await work.get(E2E_COMPANY, WORK_ID);
      expect(stored?.state).toBe('completed');
      expect(stored?.version).toBe(4);

      // 6. EXACTLY ONE work.completed business event (source worker), the
      //    acceptance event (source acceptor), and one supervisor decision
      //    event in the live database — the full material chain persisted.
      const eventRows = await harness.conn.query<{ eventType: string; source: string }>(
        'SELECT event_type AS "eventType", source FROM business_event ORDER BY id ASC',
        [],
      );
      expect(eventRows.map((row) => `${row.source}:${row.eventType}`)).toEqual([
        'acceptor:work.accepted',
        'supervisor:heartbeat.decision',
        'worker:work.completed',
      ]);

      // 7. EXACTLY ONE business receipt + journal `completed` — the real
      //    dispatch ran the worker once through the supervisor path.
      const receiptCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptCount[0]?.count).toBe(1);
      const journalRows = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal',
        [],
      );
      expect(journalRows).toEqual([{ status: 'completed' }]);

      // 8. The worker cycle consumed EXACTLY ONE LLM plan — the supervisor
      //    tick drove one real dispatch (no second activation, no re-run).
      expect((harness.llm as FakeLlmClient).requests).toHaveLength(1);
    });

    it('triangulation: a second one-shot pump after completion does NOT re-run the worker (empty actionable queue settles, D9)', async () => {
      const pump = manualPump();
      const supervisor: SupervisorHandle = startSupervisor(composed.deps, {
        intervalMs: 1_000,
        schedule: pump.schedule,
        onActivate: composed.onActivate,
        onRecovery: composed.onRecovery,
      });
      await pump.pump();
      supervisor.stop();

      // The completed Work is no longer actionable: the re-pump settles the
      // dispatch with zero worker/LLM invocation and appends no second
      // work.completed event (D9 settled-failure residual).
      const eventRows = await harness.conn.query<{ eventType: string; source: string }>(
        'SELECT event_type AS "eventType", source FROM business_event WHERE source = $1',
        ['worker'],
      );
      expect(eventRows).toEqual([{ eventType: 'work.completed', source: 'worker' }]);
      const receiptCount = await harness.conn.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM business_receipt',
        [],
      );
      expect(receiptCount[0]?.count).toBe(1);
      expect((harness.llm as FakeLlmClient).requests).toHaveLength(1);
    });
  },
);

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E (no-backfill): pre-change accepted Work with no event is not discovered/activated; no work.accepted synthesized',
  () => {
    let harness: E2eHarness;
    let composed: ReturnType<typeof buildSupervisorDispatch>;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_nobackfill' });
      // GIVEN: pre-change persisted state — accepted Work, NO event row.
      await seedAcceptedWork(harness);
      composed = buildSupervisorDispatch({
        connection: harness.conn,
        llm: harness.llm,
        sandboxRoot: harness.sandboxRoot,
        principals: harness.principals,
      });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('proves no synthesis and no activation', async () => {
      const count = async (table: string): Promise<number> => {
        const rows = await harness.conn.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM ${table}`,
          [],
        );
        return rows[0]?.count ?? 0;
      };
      // DISCOVERY is event-log-driven: the bare accepted Work row is absent.
      expect(await composed.deps.events.listCompanyIds()).toEqual([]);
      // HEARTBEAT: real one-shot supervisor pump — nothing discovered, so no
      // gate fires, no activation, and no startup/backfill synthesizes events.
      const pump = manualPump();
      const supervisor: SupervisorHandle = startSupervisor(composed.deps, {
        intervalMs: 1_000,
        schedule: pump.schedule,
        onActivate: composed.onActivate,
        onRecovery: composed.onRecovery,
      });
      await pump.pump();
      supervisor.stop();
      // THEN: no synthesis (event log still empty), no activation (no
      // receipts, no LLM plan), and the historical Work is untouched.
      expect(await count('business_event')).toBe(0);
      expect(await count('business_receipt')).toBe(0);
      expect((harness.llm as FakeLlmClient).requests).toHaveLength(0);
      const stored = await harness.work.get(E2E_COMPANY, E2E_WORK_ID);
      expect(stored?.state).toBe('accepted');
      expect(stored?.version).toBe(1);
    });
  },
);

/** Injectable schedule: a manual one-shot pump the test drives (zero timers). */
function manualPump() {
  let current: (() => void | Promise<void>) | undefined;
  return {
    schedule: (tick: () => void | Promise<void>, _intervalMs: number) => {
      current = tick;
      return { stop: () => {} };
    },
    pump: async (): Promise<void> => {
      await current?.();
    },
  };
}
