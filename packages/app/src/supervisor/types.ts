import type {
  BusinessEventRepository,
  HeartbeatCursorStore,
  ModelTier,
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
 * with the activating company's id and the heartbeat-selected model tier AFTER
 * the gate decides `activate` and BEFORE the cursor checkpoint is persisted — a
 * failure leaves the activation retryable (at-least-once). MAY be a recorded
 * no-op.
 */
export type OnActivate = (companyId: string, model: ModelTier) => void | Promise<void>;

/**
 * Recovery side-effect seam (supervisor-timer "Sequential Checkpointed Tick"
 * delta, design D4): invoked with the company id AFTER `onActivate` and BEFORE
 * the cursor checkpoint on BOTH decision branches — exactly once per company
 * per tick. A failure leaves the cursor unadvanced for at-least-once re-tick
 * of the recovery pass. The recovery deps (work/journal/sandbox) are CLOSED
 * OVER in the composition root — `SupervisorDeps` stays `{events, cursors}`;
 * this callback is the whole widening. MAY be a recorded no-op. Its
 * designation and execution MUST NOT depend on `now`, age, lease, or
 * heartbeat (operator-designation semantics, design D2).
 */
export type OnRecovery = (companyId: string) => void | Promise<void>;

/**
 * One sequential company tick: read cursor → gate → derive stream tail →
 * side effect → recovery → checkpoint. `onActivate` and `onRecovery` are
 * optional so the supervisor can tick without registered callbacks.
 */
export type TickCompany = (
  deps: SupervisorDeps,
  companyId: string,
  onActivate?: OnActivate,
  onRecovery?: OnRecovery,
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
  /**
   * Optional recovery seam (supervisor-timer delta, design D4): the composition
   * root closes over work/journal/sandbox and resumes operator-designated
   * orphaned `in_progress` Work after activation, before the checkpoint.
   * `SupervisorDeps` is NOT widened — this callback carries the recovery
   * surface.
   */
  readonly onRecovery?: OnRecovery;
  /** Default: setInterval. Tests inject a manual pump. */
  readonly schedule?: Schedule;
};

export type SupervisorHandle = { stop: () => void };
