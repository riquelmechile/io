import type { DbConnection } from '@io/database/src/connection.js';
import type { ModelTier } from '@io/business-domain/src/index.js';
import {
  requestRecovery,
  type RequestRecoveryCommand,
  type RequestRecoveryResult,
} from '@io/business-domain/src/use-cases/index.js';
import type { LlmClient } from '@io/llm-client/src/index.js';

import { dispatchCompanyActivation, dispatchRecovery } from '../dispatch/dispatch.js';
import type { DispatchDeps } from '../dispatch/types.js';
import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';
import type { OnActivate, OnRecovery, SupervisorDeps } from '../supervisor/types.js';
import { recoverDesignatedWork, type RecoverDeps, type RecoveryResult } from '../worker/recover.js';
import type { WorkerPrincipals } from '../worker/types.js';
import { buildSupervisorDeps } from './supervisor-deps.js';
import { buildWorkerDeps } from './worker-deps.js';

/**
 * Dispatch-aware supervisor composition root (work-dispatch design C1 +
 * supervisor-recovery design D4/D5): a SIBLING of {@link buildWorkerDeps} +
 * {@link buildSupervisorDeps} that returns the existing
 * `{ deps: SupervisorDeps; onActivate: OnActivate }` seam PLUS the recovery
 * seam — `{ onRecovery, requestRecovery }` — the same shape `startSupervisor`
 * already consumes. The worker cycle and the supervisor core are NOT touched:
 * this module ONLY composes the existing roots and closes over a dispatch deps
 * set whose actor is the worker principal `principals.executor`.
 *
 * RECOVERY (supervisor-recovery design D4/D5/D7): `onRecovery(companyId)`
 * discovers operator-designated orphans via `listRecoveryRequestedByCompany`,
 * reconciles each via `recoverDesignatedWork` (the W1/W2/W3 matrix over
 * work/journal/sandbox — recovery deps closed over HERE, NOT in
 * `SupervisorDeps`, which stays `{events, cursors}`), and resumes every
 * RESUMABLE disposition (`resume` | `cas-lost-retryable` |
 * `recovery-required`) through the claim-gate-free `dispatchRecovery` (retained
 * token, deterministic `wk:` identity). The marker is cleared LAST with a fresh
 * version read; completed-replay, UNRESOLVED escalation, and TYPED stale-token
 * reconciles all SETTLE (marker cleared — re-designation is a
 * fresh operator action; no hot retry loop).
 *
 * Byte-identity guarantee (R3): `supervisor.ts`, `tick.ts`,
 * `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`,
 * `supervisor-deps.ts`, `worker-deps.ts` stay UNCHANGED — this file is the
 * ONLY new wiring. The supervisor's tick still decides the gate; on `activate`
 * it calls `onActivate(companyId)`, which dispatches the oldest accepted Work
 * through the unchanged `runWorker`.
 */
export function buildSupervisorDispatch(input: {
  readonly connection: DbConnection;
  readonly llm: LlmClient;
  readonly sandboxRoot: string;
  readonly principals: WorkerPrincipals;
  readonly now?: () => number;
}): {
  deps: SupervisorDeps;
  onActivate: OnActivate;
  onRecovery: OnRecovery;
  requestRecovery: (cmd: RequestRecoveryCommand) => Promise<RequestRecoveryResult>;
} {
  const workerDeps = buildWorkerDeps(input);
  const supervisorDeps = buildSupervisorDeps(input.connection);
  const dispatchDeps: DispatchDeps = {
    work: workerDeps.work,
    worker: workerDeps,
    actor: input.principals.executor,
  };
  // The recovery deps (design D4): the same work/journal ports + the DURABLE
  // production sandbox (FileDocumentSandbox — the applied-effect SoT). Closed
  // over HERE — `SupervisorDeps` is never widened.
  const recoverDeps: RecoverDeps = {
    work: workerDeps.work,
    journal: workerDeps.journal,
    sandbox: workerDeps.sandbox as SandboxPort & { snapshotUndoLog(): readonly EffectRecord[] },
  };
  // The resume runs the heartbeat-free recovery seam, so NO gate-selected tier
  // exists at onRecovery time (supervisor-timer spec: recovery MUST NOT depend
  // on the heartbeat). The composition resumes designated orphans on the
  // conservative default flash tier.
  const RECOVERY_MODEL_TIER: ModelTier = 'flash';
  return {
    deps: supervisorDeps,
    // Awaitable activation (OnActivate = Promise<void>): the supervisor tick
    // AWAITS this before checkpointing the cursor (design "SIDE EFFECT FIRST,
    // checkpoint LAST") — a thrown dispatch error propagates and leaves the
    // cursor un-advanced for at-least-once re-activation. The DispatchResult
    // itself is discarded: typed failures never throw (settlement policy), so
    // only real errors reach the tick. The heartbeat-selected model tier is
    // threaded unchanged into the dispatch → runWorker cycle.
    onActivate: async (companyId: string, model: ModelTier): Promise<void> => {
      await dispatchCompanyActivation(companyId, dispatchDeps, model);
    },
    // Awaitable recovery (supervisor-timer delta): runs AFTER activation,
    // BEFORE the checkpoint — a THROWN error propagates (cursor un-advanced,
    // at-least-once re-tick of the recovery pass). Typed/settled dispositions
    // (replay, UNRESOLVED escalation, stale-token) clear the marker; a
    // successful resume clears it with a FRESH version read.
    onRecovery: async (companyId: string): Promise<void> => {
      const designated = await workerDeps.work.listRecoveryRequestedByCompany(companyId);
      for (const row of designated) {
        const current = await workerDeps.work.get(companyId, row.workId);
        if (current === undefined || current.state !== 'in_progress') {
          // List→get race net (design "work.get → in_progress? no → clear"):
          // the Work left in_progress between discovery and the fresh read.
          await workerDeps.work.setRecoveryRequest(
            companyId,
            row.workId,
            current?.version ?? row.version,
            false,
          );
          continue;
        }
        let outcome: RecoveryResult;
        try {
          outcome = await recoverDesignatedWork(recoverDeps, current);
        } catch {
          // DEFENSIVE net for UNEXPECTED throws only: since the stale-token
          // fencing rejection became a TYPED `UNRESOLVED_REQUIRES_HUMAN`
          // escalation (spec "Stale reconciliation token is rejected"),
          // `recoverDesignatedWork` no longer throws for any business
          // rejection — it returns a typed disposition the settlement path
          // below handles. A real error here still settles as an escalation
          // (marker cleared; re-designation is a fresh operator action).
          await workerDeps.work.setRecoveryRequest(companyId, row.workId, current.version, false);
          continue;
        }
        if (outcome.ok) {
          // The only ok member is the replay: the attempt already completed
          // elsewhere — nothing to resume.
          await workerDeps.work.setRecoveryRequest(companyId, row.workId, current.version, false);
          continue;
        }
        if (outcome.reason === 'UNRESOLVED_REQUIRES_HUMAN') {
          // Escalated (missing evidence / undo failure / terminal): never
          // re-execute without durable non-execution proof; the marker clears
          // (re-designation = fresh operator action).
          await workerDeps.work.setRecoveryRequest(companyId, row.workId, current.version, false);
          continue;
        }
        // RESUMABLE (W1 `resume` | W2/W3 `cas-lost-retryable` | pending
        // `recovery-required`): the attempt is reconciled to the retry boundary
        // (or needs none) — resume the orphan through the claim-gate-free
        // dispatchRecovery (retained token, deterministic identity). Typed
        // worker failures inside SETTLE (no throw); real errors propagate.
        await dispatchRecovery(companyId, current, dispatchDeps, RECOVERY_MODEL_TIER);
        // Clear the marker LAST with a FRESH version read: a completed resume
        // advanced the version via the terminal CAS — a stale-version clear
        // would version-conflict and leave the marker set for a re-tick.
        const after = await workerDeps.work.get(companyId, row.workId);
        await workerDeps.work.setRecoveryRequest(
          companyId,
          row.workId,
          after?.version ?? current.version,
          false,
        );
      }
    },
    // Admin designation entry (work-lifecycle "Operator Recovery
    // Designation"): the pure requestRecovery use-case bound to the production
    // work repository — a plain CAS that bumps version, preserves
    // state/fencing token, and sets/clears the recovery marker.
    requestRecovery: (cmd: RequestRecoveryCommand) =>
      requestRecovery(cmd, { work: workerDeps.work }),
  };
}
