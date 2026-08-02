import { tickCompany } from './tick.js';
import type {
  Schedule,
  StartSupervisorOptions,
  SupervisorDeps,
  SupervisorHandle,
} from './types.js';

/** Default timer seam (design): wraps `setInterval` + `clearInterval`. */
function defaultSchedule(
  tick: () => void | Promise<void>,
  intervalMs: number,
): { stop: () => void } {
  const timer = setInterval(() => {
    // Fire-and-forget: the supervisor already catches+logs tick failures, so
    // a rejected tick can never crash the process (no unhandled rejection).
    void tick();
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}

/**
 * Periodic discoverable lifecycle (spec: Periodic Discoverable Lifecycle):
 * every interval the supervisor discovers companies via `listCompanyIds()`
 * and evaluates each SEQUENTIALLY through the unchanged companyId-only
 * `evaluateHeartbeatGate` (`tickCompany`; no `Promise.all`). Returns
 * `{ stop }` — stop clears the schedule AND prevents any further discovery or
 * evaluation (a mid-tick stop aborts the remaining companies).
 *
 * Failures (e.g. a throwing `onActivate`) are logged and swallowed — the
 * process never crashes; the NEXT interval re-evaluates from the un-advanced
 * cursor (at-least-once). `now` is reserved/unused: heartbeat novelty is never
 * clock-defined. The supervisor is a NEW gate caller; it never mutates
 * `runWorker`/`cycle.ts`/`evaluate.ts`; cursor writes are its own. It is not
 * auto-started from any runner/CLI.
 */
export function startSupervisor(
  deps: SupervisorDeps,
  options: StartSupervisorOptions,
): SupervisorHandle {
  let stopped = false;

  async function tickAll(): Promise<void> {
    if (stopped) return;
    const companyIds = await deps.events.listCompanyIds();
    for (const companyId of companyIds) {
      if (stopped) return;
      await tickCompany(deps, companyId, options.onActivate);
    }
  }

  const schedule: Schedule = options.schedule ?? defaultSchedule;
  const handle = schedule(
    () =>
      tickAll().catch((error: unknown) => {
        // Fire-and-forget tick: log and swallow — no process crash this slice.
        console.error('[supervisor] tick failed:', error);
      }),
    options.intervalMs,
  );

  return {
    stop: () => {
      stopped = true;
      handle.stop();
    },
  };
}
