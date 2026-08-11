/**
 * Sandbox driven port (SP reversible-port): the single seam through which the
 * worker executes a LOW-RISK external effect and, when needed, reverses it.
 * Owned by the composition root (`@io/app`) — mirroring how business-domain
 * owns its repository ports. Every executed effect MUST be reversible: the
 * port records exactly one undo-log entry per effect, and that undo log is the
 * source of truth for whether the effect was applied (consulted during
 * reconciliation).
 */

/** The shipped low-risk reversible effect: create a document under the sandbox
 * root. Its concrete inverse is `unlink`. */
export type SandboxAction = {
  readonly type: 'create-document';
  readonly relativePath: string;
  readonly content: string;
};

/** Opaque handle returned by {@link SandboxPort.execute} to reverse the effect
 * with {@link SandboxPort.undo}. `applied` is always true — a handle only ever
 * refers to an effect that was applied. */
export type UndoHandle = {
  readonly handleId: string;
  readonly action: SandboxAction;
  readonly applied: true;
};

/** What {@link SandboxPort.execute} returns: the effect record (with its
 * absolute effect path) plus the undo handle. */
export type EffectRecord = {
  readonly effectId: string;
  readonly action: SandboxAction;
  readonly absolutePath: string;
  readonly applied: boolean;
  /**
   * Attempt correlation (supervisor-recovery, spec "Journal-Anchored
   * Reconciliation"; verification CRITICAL #1): the `idempotencyKey` of the
   * attempt whose cycle executed this effect — stamped by `execute` from the
   * correlation the worker passes at the call site. The durable undo log is
   * the applied-effect source of truth, and restart recovery may consider
   * ONLY entries PROVABLY from the designated attempt: it filters the log by
   * this key (never the globally-last applied entry). An entry WITHOUT a
   * correlation (a pre-fix legacy record — empty string) CANNOT be attributed
   * and forces escalation instead of a guess. `''` is the "no correlation"
   * sentinel; real keys are non-empty (`wk:…`).
   */
  readonly idempotencyKey: string;
  readonly undo: UndoHandle;
};

export interface SandboxPort {
  /**
   * Apply the action and record exactly one undo-log entry for it. The
   * optional `correlation` stamps the executing attempt's `idempotencyKey` on
   * the durable record (attempt correlation — see {@link EffectRecord}): the
   * worker cycle ALWAYS passes it; tests that never run recovery may omit it
   * (the record then carries the `''` no-correlation sentinel).
   */
  execute(action: SandboxAction, correlation?: { idempotencyKey: string }): Promise<EffectRecord>;
  /** Reverse a previously executed effect via its undo handle. */
  undo(handle: UndoHandle): Promise<void>;
  /** Whether the effect for `handleId` is still applied (undo log = SoT). */
  wasApplied(handleId: string): Promise<boolean>;
  /** Every currently-applied effect record (effect SoT — recovery evidence).
   * Excludes undone entries; consulted during reconciliation to distinguish an
   * applied effect from one that never ran. */
  snapshotUndoLog(): readonly EffectRecord[];
}
