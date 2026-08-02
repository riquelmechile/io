import type { DbConnection } from '@io/database/src/connection.js';
import type { LlmClient } from '@io/llm-client/src/index.js';

import { dispatchCompanyActivation } from '../dispatch/dispatch.js';
import type { DispatchDeps } from '../dispatch/types.js';
import type { OnActivate, SupervisorDeps } from '../supervisor/types.js';
import type { WorkerPrincipals } from '../worker/types.js';
import { buildSupervisorDeps } from './supervisor-deps.js';
import { buildWorkerDeps } from './worker-deps.js';

/**
 * Dispatch-aware supervisor composition root (work-dispatch design C1): a
 * SIBLING of {@link buildWorkerDeps} + {@link buildSupervisorDeps} that returns
 * the existing `{ deps: SupervisorDeps; onActivate: OnActivate }` seam
 * (supervisor/types.ts) — the same shape `startSupervisor` already consumes.
 * The worker cycle and the supervisor core are NOT touched: this module ONLY
 * composes the existing roots and closes over a dispatch deps set whose actor
 * is the worker principal `principals.executor`.
 *
 * Byte-identity guarantee (R3): `supervisor.ts`, `tick.ts`, `supervisor/types.ts`,
 * `worker.ts`, `cycle.ts`, `evaluate.ts`, `supervisor-deps.ts`, `worker-deps.ts`
 * stay UNCHANGED — this file is the ONLY new wiring. The supervisor's tick
 * still decides the gate; on `activate` it calls `onActivate(companyId)`, which
 * dispatches the oldest accepted Work through the unchanged `runWorker`.
 */
export function buildSupervisorDispatch(input: {
  readonly connection: DbConnection;
  readonly llm: LlmClient;
  readonly sandboxRoot: string;
  readonly principals: WorkerPrincipals;
  readonly now?: () => number;
}): { deps: SupervisorDeps; onActivate: OnActivate } {
  const workerDeps = buildWorkerDeps(input);
  const supervisorDeps = buildSupervisorDeps(input.connection);
  const dispatchDeps: DispatchDeps = {
    work: workerDeps.work,
    worker: workerDeps,
    actor: input.principals.executor,
  };
  return {
    deps: supervisorDeps,
    // Awaitable activation (OnActivate = Promise<void>): the supervisor tick
    // AWAITS this before checkpointing the cursor (design "SIDE EFFECT FIRST,
    // checkpoint LAST") — a thrown dispatch error propagates and leaves the
    // cursor un-advanced for at-least-once re-activation. The DispatchResult
    // itself is discarded: typed failures never throw (settlement policy), so
    // only real errors reach the tick.
    onActivate: async (companyId: string): Promise<void> => {
      await dispatchCompanyActivation(companyId, dispatchDeps);
    },
  };
}
