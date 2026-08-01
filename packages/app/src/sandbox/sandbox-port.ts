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
  readonly undo: UndoHandle;
};

export interface SandboxPort {
  /** Apply the action and record exactly one undo-log entry for it. */
  execute(action: SandboxAction): Promise<EffectRecord>;
  /** Reverse a previously executed effect via its undo handle. */
  undo(handle: UndoHandle): Promise<void>;
  /** Whether the effect for `handleId` is still applied (undo log = SoT). */
  wasApplied(handleId: string): Promise<boolean>;
}
