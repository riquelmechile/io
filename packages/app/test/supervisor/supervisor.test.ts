import { describe, expect, it, vi } from 'vitest';

import {
  buildHeartbeatDecisionEvent,
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

/** The supervisor-owned `heartbeat.decision` events for a company, in stream order. */
async function decisionEvents(
  events: BusinessEventRepository,
  companyId: string,
): Promise<readonly BusinessEvent[]> {
  return (await events.listByCompany(companyId)).filter(
    (event) => event.eventType === 'heartbeat.decision',
  );
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

  async appendIfAbsent(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    return this.inner.appendIfAbsent(event);
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

  it('no-llm-heartbeat appends ONE decision event before the checkpoint and MUST NOT run onActivate', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.started', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];

    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      activations.push(companyId);
    });

    expect(activations).toEqual([]);
    // The evaluation's decision event is appended BEFORE the tail is
    // checkpointed: exactly one supervisor-owned `heartbeat.decision`.
    const decisions = await decisionEvents(events, 'acme');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      companyId: 'acme',
      aggregateKind: 'heartbeat',
      eventType: 'heartbeat.decision',
      source: 'supervisor',
    });
    // A declined decision carries no `model`; an absent cursor is null.
    expect(decisions[0]?.payload).toEqual({ decision: 'no-llm-heartbeat', cursor: null });
    expect(decisions[0]?.source).toBe('supervisor');
    // The checkpoint is the PRE-append tail — never the decision event itself.
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('BOTH decision branches emit EXACTLY one heartbeat.decision with the branch payload', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:act-1', 'work.completed', 'company-act'));
    await events.append(sampleEvent('evt:decl-1', 'work.started', 'company-decl'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];

    await tickCompany({ events, cursors }, 'company-act', (companyId) => {
      activations.push(companyId);
    });
    await tickCompany({ events, cursors }, 'company-decl', (companyId) => {
      activations.push(companyId);
    });

    // Each evaluation appended exactly one decision event (spec: "Both
    // branches emit").
    const activated = await decisionEvents(events, 'company-act');
    expect(activated).toHaveLength(1);
    expect(activated[0]?.payload).toEqual({
      decision: 'activate',
      model: 'flash',
      cursor: null,
    });
    expect(activated[0]?.source).toBe('supervisor');

    const declined = await decisionEvents(events, 'company-decl');
    expect(declined).toHaveLength(1);
    expect(declined[0]?.payload).toEqual({ decision: 'no-llm-heartbeat', cursor: null });
    expect(declined[0]?.source).toBe('supervisor');

    // Only the activate branch invoked the callback.
    expect(activations).toEqual(['company-act']);
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

    // Tick 2: re-evaluates the SAME stream tail and re-invokes onActivate. The
    // retry checkpoints the PRE-append tail — now tick 1's decision event
    // (appended before the crash), which consumes the novelty.
    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      activations.push(companyId);
    });

    expect(activations).toEqual(['acme', 'acme']);
    expect(await cursors.get('acme')).toEqual({
      lastEventId: buildHeartbeatDecisionEvent('acme', {
        kind: 'activate',
        model: 'flash',
      }).eventId,
    });
  });

  it('a retried tick with the SAME unadvanced cursor keeps EXACTLY one decision event', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();

    // Tick 1: the decision event is appended, then the callback throws BEFORE
    // the checkpoint — the tick fails with the cursor unadvanced.
    await expect(
      tickCompany({ events, cursors }, 'acme', () => {
        throw new Error('simulated crash during onActivate');
      }),
    ).rejects.toThrow('simulated crash during onActivate');
    expect(await cursors.get('acme')).toBeUndefined();

    // Tick 2 (retry): the same cursor + decision rebuild the SAME event id →
    // appendIfAbsent no-ops (spec: "Retry does not duplicate the decision").
    await tickCompany({ events, cursors }, 'acme');
    const decisions = await decisionEvents(events, 'acme');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.eventId).toBe(
      buildHeartbeatDecisionEvent('acme', { kind: 'activate', model: 'flash' }).eventId,
    );
    // The retry checkpoints the PRE-append tail — tick 1's decision event.
    expect(await cursors.get('acme')).toEqual({
      lastEventId: buildHeartbeatDecisionEvent('acme', {
        kind: 'activate',
        model: 'flash',
      }).eventId,
    });
  });

  it('an APPEND failure fails the tick BEFORE callback and checkpoint, then retries', async () => {
    class FailingAppendEvents extends TracingEvents {
      failAppend = true;

      override async appendIfAbsent(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
        if (this.failAppend) {
          throw new Error('simulated append failure');
        }
        return super.appendIfAbsent(event);
      }
    }
    const events = new FailingAppendEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const activations: string[] = [];

    // The append failure propagates (never caught): no callback, no checkpoint.
    await expect(
      tickCompany({ events, cursors }, 'acme', (companyId) => {
        activations.push(companyId);
      }),
    ).rejects.toThrow('simulated append failure');
    expect(activations).toEqual([]);
    expect(await cursors.get('acme')).toBeUndefined();
    expect(cursors.upsertTrace).toEqual([]);

    // The next interval retries from the prior cursor and completes.
    events.failAppend = false;
    await tickCompany({ events, cursors }, 'acme', (companyId) => {
      activations.push(companyId);
    });
    expect(activations).toEqual(['acme']);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('onRecovery runs AFTER onActivate and BEFORE the cursor checkpoint — append, activate, recover, upsert (spec "Recovery runs in checkpoint order")', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const trace: string[] = [];
    const cursors = new TracingCursorStore(trace); // upserts record into the SAME trace

    await tickCompany(
      { events, cursors },
      'acme',
      (companyId) => {
        trace.push(`activate:${companyId}`);
      },
      (companyId) => {
        trace.push(`recover:${companyId}`);
      },
    );

    // The crash-safety order (spec): append → activation → ONE recovery call →
    // cursor upsert — recovery between the side effect and the checkpoint.
    expect(trace).toEqual(['activate:acme', 'recover:acme', 'upsert:acme']);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('onRecovery runs on the no-llm-heartbeat branch too — recovery runs, onActivate MUST NOT (spec "No-LLM decision advances the cursor")', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.started', 'acme')); // not material
    const cursors = new TracingCursorStore();
    const activations: string[] = [];
    const recoveries: string[] = [];

    await tickCompany(
      { events, cursors },
      'acme',
      (companyId) => {
        activations.push(companyId);
      },
      (companyId) => {
        recoveries.push(companyId);
      },
    );

    // Declined branch: one decision appended, recovery ran, checkpointed — NO
    // activation (spec: "onActivate MUST NOT run").
    expect(activations).toEqual([]);
    expect(recoveries).toEqual(['acme']);
    expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
  });

  it('a THROWING onRecovery leaves the cursor un-persisted; the next tick retries recovery (spec "Recovery failure leaves cursor unadvanced")', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const recoveries: string[] = [];

    // Tick 1: recovery CRASHES after activation succeeded — the checkpoint
    // MUST NOT persist (at-least-once retry of the recovery pass).
    await expect(
      tickCompany(
        { events, cursors },
        'acme',
        () => {},
        (companyId) => {
          recoveries.push(companyId);
          throw new Error('simulated crash during onRecovery');
        },
      ),
    ).rejects.toThrow('simulated crash during onRecovery');
    expect(await cursors.get('acme')).toBeUndefined();
    expect(cursors.upsertTrace).toEqual([]);

    // Tick 2: re-evaluates the same tail and re-invokes recovery (at-least-once).
    await tickCompany(
      { events, cursors },
      'acme',
      () => {},
      (companyId) => {
        recoveries.push(companyId);
      },
    );
    expect(recoveries).toEqual(['acme', 'acme']);
    // The retry checkpoints the PRE-append tail — tick 1's decision event.
    expect(await cursors.get('acme')).toEqual({
      lastEventId: buildHeartbeatDecisionEvent('acme', {
        kind: 'activate',
        model: 'flash',
      }).eventId,
    });
  });

  it('an APPEND failure fails the tick BEFORE onRecovery too — no recovery call, no checkpoint (spec "Append failure remains retryable")', async () => {
    class FailingAppendEvents extends TracingEvents {
      override async appendIfAbsent(_event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
        throw new Error('simulated append failure');
      }
    }
    const events = new FailingAppendEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const recoveries: string[] = [];

    await expect(
      tickCompany(
        { events, cursors },
        'acme',
        () => {},
        (companyId) => {
          recoveries.push(companyId);
        },
      ),
    ).rejects.toThrow('simulated append failure');
    expect(recoveries).toEqual([]);
    expect(await cursors.get('acme')).toBeUndefined();
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
      // company-a's decision event was appended BEFORE its callback; company-b's
      // tick has NOT begun — its stream holds no decision event yet.
      expect(await decisionEvents(events, 'company-a')).toHaveLength(1);
      expect(await decisionEvents(events, 'company-b')).toHaveLength(0);

      releaseA(); // company-a finishes its tick
      await tickPromise;

      expect(trace).toEqual(['activate:company-a', 'activate:company-b']);
      expect(await cursors.get('company-b')).toEqual({ lastEventId: 'evt:b-1' });
      expect(await decisionEvents(events, 'company-a')).toHaveLength(1);
      expect(await decisionEvents(events, 'company-b')).toHaveLength(1);
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

      // Each tick appended its decision BEFORE callback and checkpoint (spec):
      // activate → no-llm-heartbeat → activate, in stream order.
      expect((await decisionEvents(events, 'acme')).map((event) => event.payload.decision)).toEqual(
        ['activate', 'no-llm-heartbeat', 'activate'],
      );
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
      // sup2's no-llm tick checkpoints the PRE-append tail — now the decision
      // event from sup1's activate tick (decision events never renew novelty).
      expect(await cursors.get('acme')).toEqual({
        lastEventId: buildHeartbeatDecisionEvent('acme', {
          kind: 'activate',
          model: 'flash',
        }).eventId,
      });
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
      // The retry checkpoints the PRE-append tail — tick 1's decision event.
      expect(await cursors.get('acme')).toEqual({
        lastEventId: buildHeartbeatDecisionEvent('acme', {
          kind: 'activate',
          model: 'flash',
        }).eventId,
      });
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
      // The activation seam started NO Work: the stream holds the one seeded
      // event PLUS exactly one supervisor-owned `heartbeat.decision` — no
      // self-activation, no worker events (spec: "Recorded no-op is valid").
      const stream = await events.listByCompany('acme');
      expect(stream).toHaveLength(2);
      expect(stream[0]).toEqual(sampleEvent('evt:1', 'work.completed', 'acme'));
      expect(stream[1]).toMatchObject({
        companyId: 'acme',
        aggregateKind: 'heartbeat',
        eventType: 'heartbeat.decision',
        source: 'supervisor',
      });
    } finally {
      sup.stop();
    }
  });

  it('the recorded no-op receives the heartbeat-selected tier — a novel high-risk event activates with pro (ST Seam S1)', async () => {
    const events = new TracingEvents();
    await events.append({
      eventId: 'evt:risk-1',
      companyId: 'acme',
      aggregateKind: 'work',
      aggregateId: 'work-1',
      eventType: 'work.completed',
      occurredAt: 1750000000000,
      payload: { workId: 'work-1', riskClass: 'high' },
      source: 'worker',
    });
    const cursors = new TracingCursorStore();
    const activations: Array<{ companyId: string; model: string }> = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId, model) => {
          activations.push({ companyId, model }); // recorded no-op — no Work is started
        },
      },
    );

    try {
      await pump.pump();

      // The gate selected pro (novel material high-risk event) and the seam
      // received the company AND the exact tier.
      expect(activations).toEqual([{ companyId: 'acme', model: 'pro' }]);
      // No Work was started: the stream is the seeded event + the decision.
      expect(await events.listByCompany('acme')).toHaveLength(2);
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

  it('onRecovery is threaded through startSupervisor: EXACTLY ONCE per company per tick (spec "Recovery runs once per company per tick")', async () => {
    const events = new TracingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed', 'acme'));
    const cursors = new TracingCursorStore();
    const recoveries: string[] = [];
    const pump = manualPump();

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onRecovery: (companyId) => {
          recoveries.push(companyId);
        },
      },
    );

    try {
      // One tick, one company, ONE recovery invocation — the closure handles
      // any number of designated Work items internally, the seam fires once.
      await pump.pump();
      expect(recoveries).toEqual(['acme']);
      // The no-llm tick still checkpointed after recovery.
      expect(await cursors.get('acme')).toEqual({ lastEventId: 'evt:1' });
    } finally {
      sup.stop();
    }
  });

  it('companies are processed sequentially THROUGH recovery — each company\'s activation, recovery and checkpoint finish before the next begins (spec "Companies are processed sequentially")', async () => {
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
    let aRecovered!: () => void;
    const aRecoveredP = new Promise<void>((resolve) => {
      aRecovered = resolve;
    });

    const sup = startSupervisor(
      { events, cursors },
      {
        intervalMs: 1000,
        schedule: pump.schedule,
        onActivate: (companyId) => {
          trace.push(`activate:${companyId}`);
        },
        onRecovery: async (companyId) => {
          trace.push(`recover:${companyId}`);
          if (companyId === 'company-a') {
            aRecovered();
            await gateA; // company-a stays mid-recovery until released
          }
        },
      },
    );

    try {
      const tickPromise = pump.pump();
      await aRecoveredP; // company-a's recovery has begun
      // Flush microtasks: a concurrent implementation would ALREADY have
      // started company-b's tick.
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }
      expect(trace).toEqual(['activate:company-a', 'recover:company-a']);
      expect(await cursors.get('company-b')).toBeUndefined();

      releaseA(); // company-a finishes its recovery + checkpoint
      await tickPromise;

      expect(trace).toEqual([
        'activate:company-a',
        'recover:company-a',
        'activate:company-b',
        'recover:company-b',
      ]);
      expect(await cursors.get('company-b')).toEqual({ lastEventId: 'evt:b-1' });
    } finally {
      sup.stop();
    }
  });
});
