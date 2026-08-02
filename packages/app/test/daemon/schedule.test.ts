import { describe, expect, it } from 'vitest';

import {
  createProductionSchedule,
  type DrainableSchedule,
  type TimerFns,
} from '../../src/daemon/schedule.js';

/**
 * Fake timer seam (R7: Deterministic Lifecycle Verification): a manual pump
 * standing in for `setInterval`/`clearInterval` so the schedule's no-overlap
 * and drain behavior is observable with ZERO real timers / elapsed time.
 */
function fakeTimerFns() {
  let registered: (() => void) | undefined;
  let intervalMs: number | undefined;
  const handles: Array<{ cleared: boolean }> = [];
  return {
    setInterval(callback: () => void, ms: number) {
      registered = callback;
      intervalMs = ms;
      return { cleared: false };
    },
    clearInterval(handle: { cleared: boolean }) {
      handle.cleared = true;
      handles.push(handle);
    },
    /** Drive one interval fire (the manual pump). */
    fire(): void {
      registered?.();
    },
    registeredIntervalMs(): number | undefined {
      return intervalMs;
    },
    wasCleared(): boolean {
      return handles.some((handle) => handle.cleared);
    },
  };
}

/** Awaitable tick recording invocations; a caller can hold it in flight. */
function trackedTick() {
  const starts: string[] = [];
  const releaseCurrent: Array<() => void> = [];
  let settled = 0;
  return {
    tick: (): Promise<void> =>
      new Promise((resolve) => {
        starts.push('tick');
        releaseCurrent.push(() => resolve());
      }),
    starts,
    /** Settle the MOST RECENT started tick (call only after it has begun). */
    release: (): void => {
      releaseCurrent[settled]?.();
      settled += 1;
    },
  };
}

/**
 * Drain the microtask queue (multi-turn: a fire schedules the tick start one
 * microtask turn later, and the `.finally` latch reset is another turn behind
 * the settled tick — mirrors the supervisor suite's flush pattern). Zero real
 * timers.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('createProductionSchedule — non-overlapping schedule with drain (R3, R7)', () => {
  it('registers the tick with the configured interval (Schedule seam contract)', () => {
    const fns = fakeTimerFns();
    const schedule: DrainableSchedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();

    schedule.schedule(tracker.tick, 5000);

    expect(fns.registeredIntervalMs()).toBe(5000);
  });

  it('an in-flight tick suppresses the NEXT interval fire (R3 scenario 1)', async () => {
    const fns = fakeTimerFns();
    const schedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();

    schedule.schedule(tracker.tick, 1000);
    fns.fire(); // tick 1 due
    await flushMicrotasks(); // tick 1 begins and stays in flight
    fns.fire(); // tick 2 becomes due — MUST NOT start
    await flushMicrotasks();
    expect(tracker.starts).toEqual(['tick']);

    tracker.release(); // tick 1 settles
    await flushMicrotasks();
    expect(tracker.starts).toEqual(['tick']); // still exactly ONE tick
  });

  it('fires again after a settled tick — the no-overlap latch resets', async () => {
    const fns = fakeTimerFns();
    const schedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();

    schedule.schedule(tracker.tick, 1000);
    fns.fire(); // tick 1 due
    await flushMicrotasks(); // tick 1 begins
    tracker.release(); // tick 1 settles
    await flushMicrotasks(); // the latch resets
    fns.fire(); // tick 2 due — MUST run (latch reset)
    await flushMicrotasks(); // tick 2 begins
    expect(tracker.starts).toEqual(['tick', 'tick']);

    tracker.release(); // settle tick 2 (cleanup)
    await flushMicrotasks();
  });

  it('stop clears the timer and blocks further fires (R3 scenario 2)', async () => {
    const fns = fakeTimerFns();
    const schedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();

    const handle = schedule.schedule(tracker.tick, 1000);
    fns.fire(); // tick 1 due
    await flushMicrotasks(); // tick 1 begins
    tracker.release(); // tick 1 settles
    await flushMicrotasks();
    expect(tracker.starts).toEqual(['tick']);

    handle.stop();
    expect(fns.wasCleared()).toBe(true);

    fns.fire(); // a racing late interval — MUST NOT start a tick
    await flushMicrotasks();
    expect(tracker.starts).toEqual(['tick']);
  });

  it('drain awaits the active tick and resolves only after it settles (R3 scenario 2)', async () => {
    const fns = fakeTimerFns();
    const schedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();

    schedule.schedule(tracker.tick, 1000);
    fns.fire(); // tick 1 due
    await flushMicrotasks(); // tick 1 is mid-flight

    let drained = false;
    const drainPromise = schedule.drain().then(() => {
      drained = true;
    });
    await flushMicrotasks();
    expect(drained).toBe(false); // still awaiting the in-flight tick

    tracker.release();
    await drainPromise;
    expect(drained).toBe(true);
    expect(tracker.starts).toEqual(['tick']);
  });

  it('drain on an idle schedule is a no-op (R3 scenario 2)', async () => {
    const fns = fakeTimerFns();
    const schedule = createProductionSchedule(fns as unknown as TimerFns);
    const tracker = trackedTick();
    schedule.schedule(tracker.tick, 1000);

    await schedule.drain(); // no tick ever fired — must resolve immediately
    expect(tracker.starts).toEqual([]);
  });
});
