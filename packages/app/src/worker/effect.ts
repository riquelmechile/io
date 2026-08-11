import type { EffectRecord, SandboxAction, SandboxPort } from '../sandbox/sandbox-port.js';

/**
 * The effect phase (§9.8): the ONLY place the worker applies an external
 * effect. The seam receives ONLY the sandbox, the action, and the executing
 * attempt's `idempotencyKey` (the correlation the sandbox stamps on the
 * durable undo-log record — spec "Undo evidence is attempt-correlated") — no
 * journal, no receipts, no connection — so the effect STRUCTURALLY cannot run
 * inside the terminal transaction (the B7 finalize twin). It runs strictly
 * AFTER the intent commit (`insertInFlight`) and leaves the attempt in_flight.
 */
export async function executeEffect(
  sandbox: SandboxPort,
  action: SandboxAction,
  idempotencyKey: string,
): Promise<EffectRecord> {
  return sandbox.execute(action, { idempotencyKey });
}
