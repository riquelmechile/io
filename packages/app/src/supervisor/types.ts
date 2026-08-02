import type {
  BusinessEventRepository,
  HeartbeatCursorStore,
} from '@io/business-domain/src/index.js';

/**
 * Supervisor dependency surface (design: app/src/supervisor/types.ts): the
 * two ports the supervisor needs — the append-only event log (company
 * discovery + stream reads) and the durable per-company heartbeat cursor
 * store. The cursor store is the ONLY checkpoint writer; the heartbeat
 * gate/evaluator remain read-only and unchanged.
 */
export type SupervisorDeps = {
  readonly events: BusinessEventRepository;
  readonly cursors: HeartbeatCursorStore;
};

/**
 * Activation side effect seam (spec: Non-Invasive Activation Seam): invoked
 * with the activating company's id AFTER the gate decides `activate` and
 * BEFORE the cursor checkpoint is persisted — a failure leaves the activation
 * retryable (at-least-once). MAY be a recorded no-op.
 */
export type OnActivate = (companyId: string) => void | Promise<void>;

/**
 * One sequential company tick: read cursor → gate → derive stream tail →
 * side effect → checkpoint. `onActivate` is optional so the supervisor can
 * tick without a registered callback.
 */
export type TickCompany = (
  deps: SupervisorDeps,
  companyId: string,
  onActivate?: OnActivate,
) => Promise<void>;

/**
 * Timer seam (injectable for deterministic tests): `tick` fires at
 * `intervalMs`. The default wraps `setInterval`; tests inject a manual pump.
 */
export type Schedule = (
  tick: () => void | Promise<void>,
  intervalMs: number,
) => { stop: () => void };

export type StartSupervisorOptions = {
  readonly intervalMs: number;
  /** Reserved (design): the heartbeat decision is never clock-defined. */
  readonly now?: () => number;
  readonly onActivate?: OnActivate;
  /** Default: setInterval. Tests inject a manual pump. */
  readonly schedule?: Schedule;
};

export type SupervisorHandle = { stop: () => void };
