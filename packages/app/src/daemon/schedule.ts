import type { Schedule } from '../supervisor/types.js';

/**
 * No-overlap production schedule with a drain surface (spec: Non-Overlapping
 * Production Schedule, R3; Deterministic Lifecycle Verification, R7). Wraps the
 * UNCHANGED `Schedule` seam from the supervisor: at most ONE tick may be in
 * flight — a fire that lands while the previous tick is still running is
 * suppressed (R3 scenario 1). `stop` clears the timer AND blocks further fires;
 * `drain` awaits the active tick (a no-op when idle) so shutdown can stop
 * scheduling and then wait for in-flight work (R3 scenario 2).
 *
 * Timers are injectable (`TimerFns`) so tests drive fires with a manual pump —
 * the default is the global `setInterval`/`clearInterval`. The tick is
 * fire-and-forget: like the supervisor's default schedule, failures are the
 * caller's concern (the supervisor wraps `tickAll` in a catch); the `.finally`
 * latch reset guarantees the next due fire is never starved by a rejection.
 */
export type TimerFns = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

export type DrainableSchedule = {
  readonly schedule: Schedule;
  drain(): Promise<void>;
};

export function createProductionSchedule(
  timers: TimerFns = { setInterval, clearInterval },
): DrainableSchedule {
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const schedule: Schedule = (tick, intervalMs) => {
    timer = timers.setInterval(() => {
      if (stopped) {
        return;
      }
      if (inFlight !== undefined) {
        return; // R3: no concurrent tick
      }
      const run = Promise.resolve()
        .then(() => tick())
        .finally(() => {
          inFlight = undefined;
        });
      inFlight = run;
    }, intervalMs);

    return {
      stop: () => {
        stopped = true;
        if (timer !== undefined) {
          timers.clearInterval(timer);
        }
      },
    };
  };

  return {
    schedule,
    drain: async () => {
      const active = inFlight;
      if (active !== undefined) {
        await active;
      }
    },
  };
}
