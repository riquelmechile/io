import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryBusinessEventRepository,
  InMemoryHeartbeatCursorStore,
} from '@io/business-domain/src/index.js';
import type { DbConnection } from '@io/database/src/connection.js';
import type { LlmClient } from '@io/llm-client/src/index.js';

import type { DaemonConfig } from '../../src/daemon/config.js';
import type { DrainableSchedule } from '../../src/daemon/schedule.js';
import { runDaemon, type DaemonHooks } from '../../src/daemon/daemon.js';
import type { SupervisorDeps } from '../../src/supervisor/types.js';

/**
 * Daemon lifecycle suite (task 2.1): `runDaemon(config, hooks?)` is exercised
 * ENTIRELY through the injectable `DaemonHooks` seams (R7) — zero real timers,
 * zero `process.on`/`process.exit`, zero live PostgreSQL. The REAL
 * `startSupervisor` runs against the injected manual-pump schedule + in-memory
 * deps (its tick never fires), so the composition wiring itself is observed;
 * only `buildDispatch` is spied (its real root builds PG adapters + a
 * filesystem sandbox — slice-2 boot-smoke territory). R2/R4/R5 as mapped in
 * the describe blocks below.
 */

function makeConfig(): DaemonConfig {
  return {
    databaseUrl: 'postgresql://io:io_dev@localhost:5432/io_dev',
    deepseekApiKey: 'sk-test',
    sandboxRoot: '/tmp/io-sandbox-test',
    intervalMs: 5000,
    principals: {
      proposer: 'proposer-e2e',
      approver: 'approver-e2e',
      executor: 'executor-e2e',
      verifier: 'verifier-e2e',
    },
  };
}

/** Drain the microtask queue — probe + every shutdown step settle one turn
 * apart (mirrors the schedule suite's flush pattern). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

/**
 * One hermetic lifecycle harness: every seam `runDaemon` touches is recorded.
 * `order` captures the exact shutdown sequence (R5); `signals` captures the
 * registered SIGTERM/SIGINT handlers (R4).
 */
function makeHarness() {
  const order: string[] = [];
  const signals = new Map<'SIGTERM' | 'SIGINT', () => void>();

  const execute = vi.fn(async (_sql: string, _params: readonly unknown[]) => {
    order.push('probe:execute');
    return { rowCount: 1 };
  });
  const connection: DbConnection & { close(): Promise<void> } = {
    execute,
    query: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(async () => {
      order.push('conn.close');
    }),
  };

  const llm: LlmClient & { close(): Promise<void> } = {
    complete: vi.fn(),
    close: vi.fn(async () => {
      order.push('llm.close');
    }),
  };

  const scheduleStop = vi.fn(() => {
    order.push('schedule.stop');
  });
  const drain = vi.fn(() => {
    order.push('schedule.drain');
    return Promise.resolve();
  });
  const schedule = vi.fn((_tick: () => void | Promise<void>, _intervalMs: number) => ({
    stop: scheduleStop,
  }));
  const fakeSchedule: DrainableSchedule = { schedule, drain };

  const deps: SupervisorDeps = {
    events: new InMemoryBusinessEventRepository(),
    cursors: new InMemoryHeartbeatCursorStore(),
  };
  const buildDispatch = vi.fn(() => ({
    deps,
    onActivate: vi.fn(),
    // The widened composition seam (supervisor-recovery PR 4): recorded
    // no-ops — the daemon never drives them in the lifecycle tests.
    onRecovery: vi.fn(),
    requestRecovery: vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid-command' as const,
    })),
  }));
  const exit = vi.fn((code: number) => {
    order.push(`exit:${code}`);
  });

  const hooks: DaemonHooks = {
    registerSignal: (signal, handler) => {
      signals.set(signal, handler);
    },
    exit,
    createConnection: () => connection,
    createLlm: () => llm,
    createSchedule: () => fakeSchedule,
    buildDispatch, // startSupervisor intentionally NOT injected (see header).
  };

  return {
    hooks,
    signals,
    order,
    execute,
    connection,
    llm,
    scheduleStop,
    drain,
    schedule,
    buildDispatch,
    exit,
  };
}

/** Retrieve a registered signal handler — throws if `runDaemon` never registered it. */
function getSignal(
  signals: Map<'SIGTERM' | 'SIGINT', () => void>,
  signal: 'SIGTERM' | 'SIGINT',
): () => void {
  const handler = signals.get(signal);
  if (handler === undefined) {
    throw new Error(`${signal} handler was never registered`);
  }
  return handler;
}

/** Make the schedule drain hold in flight until the returned release is called. */
function holdDrain(h: ReturnType<typeof makeHarness>): () => void {
  let releaseDrain: () => void = () => {};
  h.drain.mockImplementation(() => {
    h.order.push('schedule.drain');
    return new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
  });
  return () => {
    releaseDrain();
  };
}

describe('runDaemon — database readiness probe (R2)', () => {
  it('probe ok — starts the supervisor with the production schedule, probe only, no migrate (R2 scenario 1)', async () => {
    const h = makeHarness();
    const config = makeConfig();

    const daemonPromise = runDaemon(config, h.hooks);
    await flushMicrotasks();

    // Readiness: exactly ONE statement — the SELECT 1 probe (R2: no migrate).
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledWith('SELECT 1', []);

    // Dispatch composition wired from config; schedule registered at intervalMs.
    expect(h.buildDispatch).toHaveBeenCalledTimes(1);
    expect(h.buildDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: h.connection,
        llm: h.llm,
        sandboxRoot: config.sandboxRoot,
        principals: config.principals,
      }),
    );
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith(expect.any(Function), config.intervalMs);
    expect(h.signals.has('SIGTERM')).toBe(true);
    expect(h.signals.has('SIGINT')).toBe(true);

    // Idle shutdown still closes every resource and exits 0 (R5 scenario 2).
    getSignal(h.signals, 'SIGTERM')();
    await daemonPromise;
    expect(h.order).toEqual([
      'probe:execute',
      'schedule.stop',
      'schedule.drain',
      'conn.close',
      'llm.close',
      'exit:0',
    ]);
  });

  it('probe failure — exit(1) BEFORE the schedule starts (R2 scenario 2)', async () => {
    const h = makeHarness();
    h.execute.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await runDaemon(makeConfig(), h.hooks);

    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.buildDispatch).not.toHaveBeenCalled();
    expect(h.schedule).not.toHaveBeenCalled();
  });
});

describe('runDaemon — process signal handling (R4)', () => {
  it('first signal — graceful shutdown begins exactly once (R4 scenario 1)', async () => {
    const h = makeHarness();

    const daemonPromise = runDaemon(makeConfig(), h.hooks);
    await flushMicrotasks();
    getSignal(h.signals, 'SIGTERM')();
    await daemonPromise;

    expect(h.scheduleStop).toHaveBeenCalledTimes(1);
    expect(h.drain).toHaveBeenCalledTimes(1);
    expect(h.connection.close).toHaveBeenCalledTimes(1);
    expect(h.llm.close).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('second signal during shutdown — immediate exit(1), cleanup NOT awaited, no second shutdown (R4 scenario 2)', async () => {
    const h = makeHarness();
    const releaseDrain = holdDrain(h);

    const daemonPromise = runDaemon(makeConfig(), h.hooks);
    await flushMicrotasks();

    getSignal(h.signals, 'SIGTERM')(); // first — graceful shutdown begins
    await flushMicrotasks();
    expect(h.scheduleStop).toHaveBeenCalledTimes(1);
    expect(h.connection.close).not.toHaveBeenCalled(); // still draining

    getSignal(h.signals, 'SIGINT')(); // second — force exit, synchronously
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.scheduleStop).toHaveBeenCalledTimes(1); // NO second shutdown pass
    expect(h.connection.close).not.toHaveBeenCalled(); // cleanup NOT awaited

    releaseDrain(); // settle the abandoned graceful path
    await daemonPromise;
    expect(h.exit).toHaveBeenLastCalledWith(0);
  });
});

describe('runDaemon — ordered graceful shutdown (R5)', () => {
  it('order: stop → drain → conn.close → llm.close → exit(0); db closes before llm (R5 scenario 1)', async () => {
    const h = makeHarness();
    const releaseDrain = holdDrain(h);

    const daemonPromise = runDaemon(makeConfig(), h.hooks);
    await flushMicrotasks();

    getSignal(h.signals, 'SIGTERM')();
    await flushMicrotasks();
    // While the in-flight tick is still draining, resources are NOT closed.
    expect(h.order).toEqual(['probe:execute', 'schedule.stop', 'schedule.drain']);

    releaseDrain();
    await daemonPromise;

    expect(h.order).toEqual([
      'probe:execute',
      'schedule.stop',
      'schedule.drain',
      'conn.close',
      'llm.close',
      'exit:0',
    ]);
    expect(h.order.indexOf('conn.close')).toBeLessThan(h.order.indexOf('llm.close'));
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it('a rejecting close step exits non-zero, logs, and resolves (never hangs) (R5 — no unhandled rejection)', async () => {
    const h = makeHarness();
    (h.connection.close as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('pool close failed'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const daemonPromise = runDaemon(makeConfig(), h.hooks);
    await flushMicrotasks();
    getSignal(h.signals, 'SIGTERM')();
    // Even though a shutdown step rejected, runDaemon MUST resolve, not hang.
    await daemonPromise;

    expect(h.order).toEqual(['probe:execute', 'schedule.stop', 'schedule.drain', 'exit:1']);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.llm.close).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled(); // the failure is surfaced, not swallowed
    errorSpy.mockRestore();
  });
});
