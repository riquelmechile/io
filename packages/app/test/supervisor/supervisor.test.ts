import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryBusinessEventRepository,
  InMemoryHeartbeatCursorStore,
  type BusinessEventRepository,
  type HeartbeatCursor,
  type HeartbeatCursorStore,
} from '@io/business-domain/src/index.js';
import type { BusinessEvent } from '@io/business-domain/src/types.js';

import { startSupervisor } from '../../src/supervisor/supervisor.js';
import { tickCompany } from '../../src/supervisor/tick.js';

/**
 * Supervisor module (task 3.1 — supervisor core): periodic discoverable
 * lifecycle + sequential checkpointed tick over the UNCHANGED companyId-only
 * `evaluateHeartbeatGate`. R4-001 crash-safety order: `activate` runs the
 * `onActivate` side effect FIRST and persists the cursor checkpoint LAST, so a
 * callback failure leaves the activation retryable (at-least-once). All tests
 * drive an INJECTED schedule (manual pump) — zero real timers.
 */

/** A material `work.completed` event (or any given eventType) for a tenant. */
function sampleEvent(eventId: string, eventType: string, companyId: string): BusinessEvent {
  return {
    eventId,
    companyId,
    aggregateKind: 'work',
    aggregateId: 'work-1',
    eventType,
    occurredAt: 1750000000000,
    payload: { workId: 'work-1' },
    source: 'worker',
  };
}

/**
 * Injectable schedule: a manual pump the test drives directly (no real
 * timers). The schedule's `stop` KEEPS the tick reference (a racing interval
 * can still fire), so `stop` tests prove the SUPERVISOR guard, not merely the
 * schedule teardown.
 */
function manualPump() {
  let current: (() => void | Promise<void>) | undefined;
  const stopCalls: number[] = [];
  return {
    schedule: (tick: () => void | Promise<void>, _intervalMs: number) => {
      current = tick;
      return {
        stop: () => {
          stopCalls.push(1);
        },
      };
    },
    /** Invoke the registered tick (the supervisor's wrapped tickAll). */
    pump: async (): Promise<void> => {
      await current?.();
    },
    /** How many times the supervisor called the schedule's stop. */
    stopCalls,
  };
}

/** Event double recording discovery + list calls (wraps the in-memory fake). */
class TracingEvents implements BusinessEventRepository {
  readonly discoveries: string[][] = [];
  readonly listCalls: string[] = [];
  private readonly inner = new InMemoryBusinessEventRepository();

  async append(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    return this.inner.append(event);
  }

  async listByCompany(companyId: string): Promise<readonly BusinessEvent[]> {
    this.listCalls.push(companyId);
    return this.inner.listByCompany(companyId);
  }

  async listCompanyIds(): Promise<readonly string[]> {
    const ids = await this.inner.listCompanyIds();
    this.discoveries.push([...ids]);
    return ids;
  }
}

/** Cursor double recording every upsert (wraps the in-memory fake). */
class TracingCursorStore implements HeartbeatCursorStore {
  readonly upsertTrace: string[] = [];
  private readonly inner = new InMemoryHeartbeatCursorStore();

  constructor(private readonly sharedTrace?: string[]) {}

  async get(companyId: string): Promise<HeartbeatCursor | undefined> {
    return this.inner.get(companyId);
  }

  async upsert(companyId: string, cursor: HeartbeatCursor): Promise<void> {
    this.upsertTrace.push(`upsert:${companyId}`);
    this.sharedTrace?.push(`upsert:${companyId}`);
    await this.inner.upsert(companyId, cursor);
  }
}

describe('tickCompany — sequential checkpointed tick (task 3.1)', () => {
  it('rejects an EMPTY companyId BEFORE any read or write (ADR-0002)', async () => {
    const events = new TracingEvents();
    const cursors = new TracingCursorStore();

    await expect(tickCompany({ events, cursors }, '')).rejects.toThrow(
      'a non-empty companyId is required',
    );

    expect(events.listCalls).toEqual([]);
    expect(cursors.upsertTrace).toEqual([]);
  });

  it('no-llm-heartbeat advances the cursor and MUST NOT run onActivate', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.started', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];

    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      activations.push(companyId);
    });

    expect(activations).toEqual([]);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('empty stream → no-llm with NO cursor persisted (defensive empty tail)', async () => {
    const events = new TracingEvents();
    const cursors = new TracingCursorStore();

    await tickCompany({ events, cursors }, 'acme');

    expect(await cursors.get('acme')).toBeUndefined();
    expect(cursors.upsertTrace).toEqual([]);
  });

  it('activate runs onActivate FIRST and persists the cursor LAST (R4-001 order)', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const trace: string[] = [];
    const cursors = new TracingCursorStore(trace); // upserts record into the SAME trace

    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      trace.push(`activate:${companyId}`);
    });

    // Side effect first, checkpoint last — the crash-safety order (R4-001).
    expect(trace).toEqual(['activate:acme', 'upsert:acme']);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('a THROWING onActivate leaves the cursor un-persisted; the next tick re-invokes (at-least-once)', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];

    // Tick 1: the callback CRASHES before returning (simulated process crash).
    await expect(
      tickCompany({ events, cursors }, 'acme', (companyId) => {
        activations.push(companyId);
        throw new Error('simulated crash during onActivate');
      }),
    ).rejects.toThrow('simulated crash during onActivate');

    // The checkpoint MUST NOT be persisted before the callback returns.
    expect(await cursors.get('acme')).toBeUndefined();
    expect(cursors.upsertTrace).toEqual([]);

    // Tick 2: re-evaluates the SAME stream tail and re-invokes onActivate.
    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      activations.push(companyId);
    });

    expect(activations).toEqual(['acme', 'acme']);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });
});

describe('startSupervisor — periodic discoverable lifecycle (task 3.1)', () => {
  it('an injected schedule drives ONE tick over BOTH companies', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    await events.append(sampleEvent('evt:b-1', 'work.completed', 'company-b'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );

    try {
      await pump.pump();

      expect(events.discoveries).toEqual([['company-a', 'company-b']]);
      expect(activations).toEqual(['company-a', 'company-b']);
      expect(await cursors.get('company-a')).toEqual({ lastEventId: 'evt:a-1' });
      expect(await cursors.get('company-b')).toEqual({ lastEventId: 'evt:b-1' });
    } finally {
      sup.stop();
    }
  });

  it('stop() blocks later ticks: no further discovery or evaluation', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );

    await pump.pump();
    expect(events.discoveries).toHaveLength(1);
    expect(activations).toEqual(['company-a']);

    sup.stop();
    expect(pump.stopCalls).toHaveLength(1); // the schedule was cleared

    await pump.pump(); // a racing later interval fires — the supervisor is stopped

    expect(events.discoveries).toHaveLength(1); // NO further discovery
    expect(activations).toEqual(['company-a']); // NO further evaluation
    expect(await cursors.get('company-a')).toEqual({ lastEventId: 'evt:a-1' });
  });

  it('stop() DURING a tick prevents the remaining companies from being evaluated', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    await events.append(sampleEvent('evt:b-1', 'work.completed', 'company-b'));
    const cursors = new TracingCursorStore();
    const trace: string[] = [];
    const pump = manualPump();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aStarted!: () => void;
    const aStartedP = new Promise<void>((resolve) => {
      aStarted = resolve;
    });

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: async (companyId) => {
          trace.push(`activate:${companyId}`);
          if (companyId === 'company-a') {
            aStarted();
            await gateA; // company-a is mid-tick — stop() now
          }
        },
      },
    );

    const tickPromise = pump.pump();
    await aStartedP; // company-a's callback is running
    sup.stop();
    releaseA();
    await tickPromise;

    expect(trace).toEqual(['activate:company-a']); // company-b NEVER evaluated
    expect(await cursors.get('company-b')).toBeUndefined();
  });

  it('companies are processed SEQUENTIALLY — company-b never starts while company-a is mid-tick', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    await events.append(sampleEvent('evt:b-1', 'work.completed', 'company-b'));
    const cursors = new TracingCursorStore();
    const trace: string[] = [];
    const pump = manualPump();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aStarted!: () => void;
    const aStartedP = new Promise<void>((resolve) => {
      aStarted = resolve;
    });

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: async (companyId) => {
          trace.push(`activate:${companyId}`);
          if (companyId === 'company-a') {
            aStarted();
            await gateA; // company-a stays mid-tick until released
          }
        },
      },
    );

    try {
      const tickPromise = pump.pump();
      await aStartedP; // company-a's callback has begun
      // Flush microtasks: under a concurrent implementation (Promise.all)
      // company-b would ALREADY have started by now.
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }

      expect(trace).toEqual(['activate:company-a']);
      expect(await cursors.get('company-b')).toBeUndefined();

      releaseA(); // company-a finishes its tick
      await tickPromise;

      expect(trace).toEqual(['activate:company-a', 'activate:company-b']);
      expect(await cursors.get('company-b')).toEqual({ lastEventId: 'evt:b-1' });
    } finally {
      sup.stop();
    }
  });

  it('activation is consumed once, then renewed by a NEW work.completed', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );

    try {
      await pump.pump(); // tick 1: activate (novelty)
      expect(activations).toEqual(['acme']);
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });

      await pump.pump(); // tick 2: unchanged → no-llm, no re-fire
      expect(activations).toEqual(['acme']);

      await events.append(sampleEvent('evt:2', 'work.completed', 'acme'));
      await pump.pump(); // tick 3: novelty renewed → activate again
      expect(activations).toEqual(['acme', 'acme']);
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:2' });
    } finally {
      sup.stop();
    }
  });

  it('a fresh supervisor over the SAME store resumes from the persisted cursor (no re-activation)', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore(); // the SHARED durable store
    const activations: string[] = [];
    const pump1 = manualPump();
    const pump2 = manualPump();

    const sup1 = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump1.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );
    await pump1.pump(); // tick 1: activate once, cursor persisted
    sup1.stop();

    // Restart: a FRESH supervisor over the same store supplies the persisted
    // cursor to the gate → no-llm → onActivate MUST NOT run again.
    const sup2 = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump2.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );
    try {
      await pump2.pump();

      expect(activations).toEqual(['acme']); // no re-activation after restart
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
    } finally {
      sup2.stop();
    }
  });

  it('a failing tick is logged and swallowed; the NEXT interval re-invokes onActivate (at-least-once)', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    let shouldThrow = true;
    const pump = manualPump();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
          if (shouldThrow) {
            throw new Error('simulated crash during onActivate');
          }
        },
      },
    );

    try {
      await pump.pump(); // tick 1: the callback crashes — the supervisor MUST NOT crash
      expect(activations).toEqual(['acme']);
      expect(await cursors.get('acme')).toBeUndefined(); // checkpoint NOT persisted
      expect(errorSpy).toHaveBeenCalled(); // logged, not crashed

      shouldThrow = false;
      await pump.pump(); // tick 2: re-evaluates the same tail → re-invokes
      expect(activations).toEqual(['acme', 'acme']);
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
    } finally {
      sup.stop();
      errorSpy.mockRestore();
    }
  });

  it('a recorded no-op onActivate is valid: the company arrives, no Work is started', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId); // recorded no-op — no Work is started
        },
      },
    );

    try {
      await pump.pump();

      expect(activations).toEqual(['acme']);
      // The activation seam started NO Work: the stream still holds exactly
      // the one seeded event (no supervisor/gate appends, no self-activation).
      expect(await events.listByCompany('acme')).toEqual([
        sampleEvent('evt:1', 'work.completed', 'acme'),
      ]);
    } finally {
      sup.stop();
    }
  });

  it('now? is reserved and NOT wired into decision logic (non-clock novelty)', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        now: () => 0, // a frozen clock must NOT suppress activation
        schedule: pump.schedule,
        onActivate: (companyId) => {
          activations.push(companyId);
        },
      },
    );

    try {
      await pump.pump();
      expect(activations).toEqual(['acme']);
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
    } finally {
      sup.stop();
    }
  });
});
