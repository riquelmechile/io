import type { WorkRepository } from '@io/business-domain/src/ports/repositories.js';

import type { WorkerDeps, WorkerResult } from '../worker/types.js';

/**
 * Dispatch dependency surface (design "Interfaces / Contracts"): the worker
 * cycle's port set plus the tenant-scoped actionable read the dispatch picks
 * the OLDEST accepted Work from, and the acting principal (`actor`) forwarded
 * into `runWorker`'s command envelope. `worker` is the UNCHANGED
 * {@link WorkerDeps} — the dispatch layer never modifies the worker cycle.
 */
export type DispatchDeps = {
  readonly work: WorkRepository;
  readonly worker: WorkerDeps;
  readonly actor: string;
};

/**
 * Result of one activation (design "Interfaces / Contracts"):
 * `{ ok: true; dispatched: false }` when the actionable queue was empty (zero
 * worker/LLM invocation), or `{ ok: true; dispatched: true }` carrying the
 * dispatched Work id and the UNCHANGED typed {@link WorkerResult}. A typed
 * `{ok:false}` worker result SETTLES here (cursor advances — no hot LLM retry
 * loop); only a THROWN error propagates (cursor un-advanced, at-least-once
 * re-activation per R4-001).
 */
export type DispatchResult =
  | { ok: true; dispatched: false }
  | { ok: true; dispatched: true; workId: string; worker: WorkerResult };
