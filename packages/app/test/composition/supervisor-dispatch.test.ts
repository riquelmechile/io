import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryHeartbeatCursorStore } from '@io/business-domain/src/ports/fakes.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { PgBusinessEventRepository, PgHeartbeatCursorRepository } from '@io/database/src/index.js';
import { describe, expect, it } from 'vitest';

import { buildSupervisorDispatch } from '../../src/composition/supervisor-dispatch.js';
import { tickCompany } from '../../src/supervisor/tick.js';
import { E2E_PRINCIPALS } from '../e2e/harness.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';
import { cannedLlm, RecordingEvents } from '../worker-helpers.js';

/**
 * Non-invasive heartbeat wiring (work-dispatch R3, scenario 1): the NEW
 * composition root `buildSupervisorDispatch` returns the existing
 * `{ deps: SupervisorDeps; onActivate: OnActivate }` shape — supervisor deps
 * composed by the UNCHANGED `buildSupervisorDeps`, and an `onActivate` that
 * runs the dispatch layer with `actor = principals.executor`. The existing
 * roots (`worker-deps.ts`, `supervisor-deps.ts`) and the supervisor/worker
 * cores stay byte-identical (verified in 2.7).
 *
 * The `no-llm-heartbeat` gate decision performs NO dispatch: the real
 * `tickCompany` only invokes `onActivate` on `activate`, so a declined company
 * causes zero actionable reads, zero worker cycles, and zero LLM invocations.
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

describe('buildSupervisorDispatch — { deps, onActivate } shape (R3 scenario 1)', () => {
  it('returns SupervisorDeps composed by the unchanged buildSupervisorDeps + a dispatch onActivate', () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-dispatch-'));
    try {
      const composed = buildSupervisorDispatch({
        connection: connectionDouble(),
        llm: cannedLlm(),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // The {deps, onActivate} seam: supervisor deps are the PG adapters from
      // the unchanged buildSupervisorDeps root; onActivate is a callable.
      expect(composed.deps.events).toBeInstanceOf(PgBusinessEventRepository);
      expect(composed.deps.cursors).toBeInstanceOf(PgHeartbeatCursorRepository);
      expect(typeof composed.onActivate).toBe('function');
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('onActivate is wired to the REAL dispatch path (not a recorded no-op): it attempts the actionable read', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-dispatch-'));
    try {
      const composed = buildSupervisorDispatch({
        connection: connectionDouble(),
        llm: cannedLlm(),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // Against a connection whose every read throws, the composed onActivate
      // MUST attempt the dispatch read and fail loudly — proving it drives the
      // real dispatch → worker path rather than resolving as a no-op.
      await expect(composed.onActivate('acme', 'flash')).rejects.toThrow(
        'unexpected query on the connection double',
      );
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});

describe('buildSupervisorDispatch — no-llm-heartbeat performs NO dispatch (R3 scenario 1)', () => {
  it('a declined gate decision never invokes onActivate: zero actionable read, worker cycle, or LLM', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-dispatch-'));
    try {
      const composed = buildSupervisorDispatch({
        connection: connectionDouble(),
        // Zero canned responses: ANY invocation of the composed LLM throws,
        // so a clean tick proves the LLM was never reached.
        llm: new FakeLlmClient({ responses: [] }),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // Fake supervisor deps: an EMPTY event stream → no material novelty →
      // evaluateHeartbeatGate decides `no-llm-heartbeat` → tickCompany MUST
      // skip onActivate entirely.
      const events = new RecordingEvents();
      const cursors = new InMemoryHeartbeatCursorStore();
      let onActivateCalls = 0;
      const onActivate = async (companyId: string): Promise<void> => {
        onActivateCalls += 1;
        await composed.onActivate(companyId, 'flash');
      };

      // The real supervisor tick (unchanged tick.ts) over the composed seam.
      await tickCompany({ events, cursors }, 'acme', onActivate);

      // No dispatch: onActivate never invoked, so no actionable read, no
      // worker cycle, and no LLM call happened. The only reads are the
      // unchanged tick's own two tenant-scoped event lists (the gate's
      // evaluation + the supervisor's stream read — both read-only).
      expect(onActivateCalls).toBe(0);
      expect(events.listCalls).toEqual(['acme', 'acme']);
      expect(events.appends).toHaveLength(0);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('an activate decision DOES invoke onActivate through the composed seam (dispatch path fires)', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'io-supervisor-dispatch-'));
    try {
      const composed = buildSupervisorDispatch({
        connection: connectionDouble(),
        llm: cannedLlm(),
        sandboxRoot,
        principals: E2E_PRINCIPALS,
      });

      // A material `work.completed` event → unseen novelty → `activate`.
      const events = new RecordingEvents();
      await events.append({
        eventId: 'evt:dispatch-1',
        companyId: 'acme',
        aggregateKind: 'work',
        aggregateId: 'work-1',
        eventType: 'work.completed',
        occurredAt: 1750000000000,
        payload: { workId: 'work-1' },
        source: 'worker',
      });
      const cursors = new InMemoryHeartbeatCursorStore();

      let onActivateCalls = 0;
      const onActivate = async (companyId: string): Promise<void> => {
        onActivateCalls += 1;
        // The composed onActivate runs against the throwing connection — the
        // dispatch read fails, PROVING it fired (a no-op would resolve).
        await expect(composed.onActivate(companyId, 'flash')).rejects.toThrow();
      };

      await tickCompany({ events, cursors }, 'acme', onActivate);
      expect(onActivateCalls).toBe(1);
    } finally {
      rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });
});
