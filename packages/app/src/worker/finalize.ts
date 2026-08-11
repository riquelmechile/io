import { evidenceId } from '@io/business-domain/src/evidence-id.js';
import type { IdempotencyJournalPort } from '@io/business-domain/src/ports/idempotency.js';
import type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  WorkRepository,
} from '@io/business-domain/src/ports/repositories.js';
import type { BusinessEvent, BusinessReceipt, Work } from '@io/business-domain/src/types.js';
import type { DbConnection } from '@io/database/src/connection.js';

import type { EffectRecord, SandboxPort } from '../sandbox/sandbox-port.js';

/**
 * The finalize twin (design "Finalize CAS-loss — transaction boundary", WC-6
 * atomic terminal close + WC-7 journal-anchored reconciliation): closes the
 * attempt whose in_flight journal row was committed BEFORE the effect (D6
 * pre-effect pattern).
 *
 *   T1 (ONE transaction): work.get → state guard (only an in_progress Work may
 *   CAS; a terminal/absent Work aborts BEFORE the CAS) → updateIfVersion(completed)
 *   CAS → exactly ONE receipt (rcpt:<attemptId>, terminal_event_id = attemptId,
 *   evidenceId) → ONE deterministic `work.completed` business event
 *   (evt:<attemptId>, R5/R6 — terminal facts only, never LLM output) →
 *   journal.complete → COMMIT. The CAS + receipt + event + journal.complete
 *   are ONE REAL transaction because T1 builds its repositories on the
 *   TRANSACTION-SCOPED connection via the `repositories` factory — mirroring
 *   `completeWorkAtomically` (packages/database/src/complete-work-flow.ts) — so
 *   the writes CANNOT autocommit on the pool (the pool-bound repos would leave
 *   partial state on a mid-close failure), and a CAS loss rolls the event back
 *   with the close (no orphan event, R5).
 *
 *   T1 CAS-loss: STOP BEFORE receipts.save → ROLL BACK. Unlike the foundation
 *   in-tx insert, the in_flight row here was committed in a DIFFERENT
 *   transaction before the effect, so it SURVIVES the rollback — no zombie.
 *   After the rollback the twin reconciles honestly (T2, separate committed
 *   writes):
 *
 *     (i) work still in_progress (+ effect applied) → sandbox.undo(handle),
 *         then journal.markRetryable(attemptId) in its OWN committed write →
 *         `cas-lost-retryable` (controlled retry allowed — the marker is
 *         aborted_retryable, NEVER a failure-complete that bricks the key).
 *     (ii) work already terminal (+ effect applied) → NO undo, NO marker; only
 *         journal.complete(attemptId, UNRESOLVED_REQUIRES_HUMAN) →
 *         `UNRESOLVED_REQUIRES_HUMAN`. Never fabricate an in_progress state or
 *         a resolution.
 *
 * The replay / DENY lookup (WC-6) closes the table: completed + same hash →
 * recorded result; completed + different hash → DENY.
 *
 * §9.8: the external effect NEVER runs inside T1 — the effect phase
 * (worker/effect.ts) takes only sandbox + action and this twin is invoked only
 * after it. The effect and the durable bookkeeping never share a transaction.
 */

/** The honest close for an unresolvable attempt (design: "never fabricate"). */
export const UNRESOLVED_RESULT: Readonly<{ ok: false; reason: 'UNRESOLVED_REQUIRES_HUMAN' }> = {
  ok: false,
  reason: 'UNRESOLVED_REQUIRES_HUMAN',
};

/** Receipt policy identity: the worker's low-risk policy is the
 * delegation-scoped document create; there is no separate policy artifact, so
 * the receipt records the stable worker-policy identity rather than a
 * fabricated hash. Overridable via FinalizeInput.policyHash. */
export const WORKER_POLICY_HASH = 'worker:low-risk-documents';

/** Receipt artifact identity: the single reversible effect this worker ships
 * (create-document). Overridable via FinalizeInput.artifactHash. */
export const WORKER_ARTIFACT_HASH = 'worker:create-document';

/** The repository set one terminal-close step works on, bound to ONE
 * connection. The factory pattern keeps `@io/app` PG-agnostic: whoever wires
 * the worker (composition root / harness) decides what `repositories(conn)`
 * constructs — inside T1 it receives the transaction-scoped connection, outside
 * T1 the pool. */
export interface FinalizeRepositories {
  work: WorkRepository;
  receipts: BusinessReceiptRepository;
  journal: IdempotencyJournalPort;
  /** Append-only business-fact log (R5): T1 appends ONE `work.completed`
   * event between the receipt save and journal.complete — same transaction,
   * so a CAS loss rolls the event back with the close. */
  events: BusinessEventRepository;
}

/** Injectable port set for the terminal close (unit level: fakes; Slice C:
 * PG adapters + the real connection). */
export interface FinalizeDeps {
  /** Builds the repository set bound to the GIVEN connection (mirrors
   * `completeWorkAtomically`, packages/database/src/complete-work-flow.ts:32-39):
   * T1 passes the TRANSACTION-SCOPED `tx` so CAS + receipt + journal.complete
   * share ONE real transaction; T2 passes the pool (`deps.connection`) so the
   * reconciliation writes (`sandbox.undo`, `journal.markRetryable`,
   * `journal.complete(UNRESOLVED)`) are separate committed writes (§9.8). The
   * app stays PG-agnostic — PG repos are constructed at the composition root. */
  repositories: (conn: DbConnection) => FinalizeRepositories;
  sandbox: SandboxPort;
  /** The terminal-close transaction boundary (§9.8): T1 runs inside it and
   * rolls back on CAS loss; T2 writes are separate committed writes. */
  connection: DbConnection;
  /** The acting principal (the executor) — recorded on the business receipt. */
  executor: string;
  now?: () => number;
}

export interface FinalizeInput {
  readonly companyId: string;
  readonly workId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
  /**
   * The claim-scoped fencing token (fencing-tokens change): the token the
   * worker captured at claim (minted by the startWork CAS). The T1 terminal
   * CAS supplies it as a `terminal` FencingDirective — the close lands ONLY
   * when the caller still owns the Work (matching version AND claim token). A
   * stale token (zombie writer) loses the CAS and T1 rolls back every terminal
   * mutation atomically.
   */
  readonly fencingToken: number;
  /** The applied effect + undo handle (undo log = applied SoT, §9.8). */
  readonly effect: EffectRecord;
  /** Optional receipt policy/artifact identities; default to the worker
   * policy/artifact constants. */
  readonly policyHash?: string;
  readonly artifactHash?: string;
}

export type FinalizeResult =
  /** T1 committed: the work is completed, exactly one receipt was issued, and
   * the journal stores the completed work as the replayable result. */
  | { ok: true; work: Work; receipt: BusinessReceipt }
  /** WC-6 replay: the key already completed with the same hash — the recorded
   * result is returned and NOTHING is re-run. */
  | { ok: true; replayed: true; resultJson: unknown }
  /** WC-6 DENY: same key + different hash. */
  | { ok: false; reason: 'idempotency-conflict'; current?: Work }
  /** T2(i): CAS lost while the work is still in_progress — effect undone +
   * retryable marker (own commit). A controlled retry is allowed. */
  | { ok: false; reason: 'cas-lost-retryable'; current: Work }
  /** T2(ii) / unresolvable: the work is already terminal (or the state
   * disagrees) — no undo, no marker; only the typed honest close. */
  | { ok: false; reason: 'UNRESOLVED_REQUIRES_HUMAN'; current?: Work };

/** The minimal port set the post-effect-failure reconciliation needs — shared
 * by the finalize CAS-loss T2 (B7), the verify-fail path (B8) and the durable
 * restart recovery (B9). The effect and the durable bookkeeping never share a
 * transaction: every write here is a separate committed write. */
export interface PostEffectReconcileDeps {
  work: WorkRepository;
  journal: IdempotencyJournalPort;
  sandbox: SandboxPort;
}

/** The honest close of a post-effect failure (design "Post-effect / restart"
 * table + "Other post-effect failures … same as CAS-loss (i)"). */
export type PostEffectReconcileResult =
  /** T2(i): in_progress + applied → effect undone + retryable marker (own
   * commit). A controlled retry is allowed. */
  | { ok: false; reason: 'cas-lost-retryable'; current: Work }
  /** T2(ii) / unresolvable: the work is already terminal (or gone) — no undo,
   * no marker; only the typed honest close. Never fabricate a resolution. */
  | { ok: false; reason: 'UNRESOLVED_REQUIRES_HUMAN'; current?: Work };

/** Thrown INSIDE the T1 transaction on a CAS loss so the enclosing
 * `DbConnection.transaction` rolls back; the twin catches it OUTSIDE the
 * transaction and reconciles via T2. Not control flow — it aborts the close. */
class FinalizeCasLostError extends Error {
  constructor() {
    super('finalize CAS loss: T1 rolls back before the receipt');
    this.name = 'FinalizeCasLostError';
  }
}

/**
 * Shared post-effect-failure reconciliation (design "Post-effect / restart"
 * table; WC-7 journal-anchored reconciliation; §9.8): after ANY post-effect
 * failure — the finalize T1 CAS loss, a failed verification, or a mid-cycle
 * crash recovered on restart — the worker consults the journal AND the sandbox
 * undo log and closes the attempt honestly:
 *
 *   - work gone → typed UNRESOLVED close (never fabricate an in_progress or an undo)
 *   - work already terminal (+ effect applied) → T2(ii): NO undo, NO marker;
 *     only `journal.complete(UNRESOLVED_REQUIRES_HUMAN)`.
 *   - work still in_progress + effect applied → T2(i): `sandbox.undo(handle)`
 *     FIRST, then `journal.markRetryable(attemptId, retainedToken)` in its OWN
 *     committed write → `cas-lost-retryable` (the marker is aborted_retryable,
 *     NEVER a failure-complete that bricks the key — a controlled retry stays
 *     allowed).
 *   - work still in_progress + NO effect applied → W2 (design D3): durable
 *     evidence proves no effect ran — `journal.markRetryable(attemptId,
 *     retainedToken)` with NO preceding undo → `cas-lost-retryable`. The marker
 *     un-sticks the W2 window (the row would otherwise stay `in_flight` forever)
 *     and the claim-gated marker write refuses a stale holder.
 */
export async function reconcilePostEffectFailure(
  deps: PostEffectReconcileDeps,
  input: FinalizeInput,
): Promise<PostEffectReconcileResult> {
  // Fresh read OUTSIDE any rolled-back transaction.
  const current = await deps.work.get(input.companyId, input.workId);
  if (current === undefined) {
    // The work vanished between the effect and the close — unresolvable; the
    // journal row is closed honestly (never a fabricated in_progress/undo).
    await deps.journal.complete(input.attemptId, UNRESOLVED_RESULT);
    return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' };
  }
  if (current.state !== 'in_progress') {
    // T2(ii): the work is ALREADY terminal — a concurrent writer closed it.
    // Do NOT undo (reversing the effect would fabricate an in_progress that no
    // longer exists) and do NOT mark retryable (a marker would invite a retry
    // of a key whose work is terminal). Close the attempt honestly.
    await deps.journal.complete(input.attemptId, UNRESOLVED_RESULT);
    return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN', current };
  }
  if (input.effect.applied) {
    // T2(i): the work is STILL in_progress and the effect WAS applied — reverse
    // it, then set the retryable marker in its OWN committed write (never a
    // failure-complete). The marker write is CLAIM-GATED (fencing-tokens
    // change): markRetryable(attemptId, token) succeeds only when the supplied
    // token still owns the journal row — a stale holder (zombie) cannot mark a
    // row it no longer owns.
    try {
      await deps.sandbox.undo(input.effect.undo);
    } catch {
      // The required undo FAILED (missing/contradictory evidence — the effect
      // may still be live). NEVER re-execute the effect: close the attempt
      // honestly with the typed UNRESOLVED result (spec "Missing evidence or
      // undo failure escalates") — no marker (a marker would invite a retry of
      // an effect we could not reverse).
      await deps.journal.complete(input.attemptId, UNRESOLVED_RESULT);
      return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN', current };
    }
    await deps.journal.markRetryable(input.attemptId, input.fencingToken);
    return { ok: false, reason: 'cas-lost-retryable', current };
  }
  // in_progress + NO effect applied (W2, design D3): durable evidence proves
  // the effect never ran — mark the attempt retryable WITHOUT undo (nothing to
  // reverse). The marker is claim-gated by the retained token (a stale holder
  // cannot convert the row) and is NEVER a failure-complete; the controlled
  // retry reopens the key with the same token.
  await deps.journal.markRetryable(input.attemptId, input.fencingToken);
  return { ok: false, reason: 'cas-lost-retryable', current };
}

export async function finalizeInFlightWorkAtomically(
  deps: FinalizeDeps,
  input: FinalizeInput,
): Promise<FinalizeResult> {
  // WC-6 lookup: replay | DENY | continue. Read-only standalone access — the
  // POOL factory (no transaction needed; autocommit read is correct here).
  const { journal } = deps.repositories(deps.connection);
  const entry = await journal.lookup(input.companyId, input.idempotencyKey);
  if (entry?.status === 'completed') {
    if (entry.requestHash !== input.requestHash) {
      return { ok: false, reason: 'idempotency-conflict' };
    }
    // Completed + same hash: replay the RECORDED result — no receipt, no effect.
    return { ok: true, replayed: true, resultJson: entry.resultJson };
  }
  if (entry === undefined) {
    // Invariant: the cycle commits the in_flight row BEFORE the effect. A
    // missing row at close is an unresolvable disagreement — never fabricate.
    return { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' };
  }

  // T1: the atomic terminal close — CAS + receipt + journal.complete in ONE
  // transaction. Any post-write failure aborts the whole close.
  try {
    return await deps.connection.transaction(async (tx) => {
      // The repositories are bound to the TRANSACTION-SCOPED `tx` connection:
      // the CAS + receipt + journal.complete + business-event append share ONE
      // real PostgreSQL transaction (mirrors completeWorkAtomically). The
      // pool-bound adapters would AUTOCOMMIT each write — a failure after the
      // CAS would leave partial state (the Slice C correction BLOCKER).
      const { work, receipts, journal, events } = deps.repositories(tx);
      const current = await work.get(input.companyId, input.workId);
      if (current === undefined || current.state !== 'in_progress') {
        // State guard BEFORE the CAS: only an in_progress Work may CAS
        // in_progress → completed. A TERMINAL Work (e.g. completed out-of-band
        // under another key) must NEVER CAS completed → completed — that would
        // issue a SECOND receipt with a DIFFERENT terminal_event_id, which
        // UNIQUE(work_id, terminal_event_id) does not catch. Abort → T2(ii)
        // closes the attempt honestly (no undo, no marker).
        throw new FinalizeCasLostError();
      }
      // Token-checked terminal CAS (fencing-tokens change): the close lands
      // ONLY when the caller still owns the Work — matching version AND the
      // claim token. A stale token (zombie writer) yields fencing-conflict and
      // rolls back every terminal mutation (work, receipt, event, journal).
      const cas = await work.updateIfVersion({ ...current, state: 'completed' }, current.version, {
        kind: 'terminal',
        expectedFencingToken: input.fencingToken,
      });
      if (!cas.ok) {
        // A concurrent writer won after our read (version) OR the caller no
        // longer owns the claim (fencing): STOP before the receipt and roll
        // back. The pre-committed in_flight row (different tx) survives.
        throw new FinalizeCasLostError();
      }
      const completed = cas.value;
      const receipt = await receipts.save(buildReceipt(deps, input, completed));
      // ONE deterministic `work.completed` event in the SAME transaction
      // (R5/R6): built ONLY from terminal-close facts — the Work terminal
      // state, receipt identity fields, evidenceId, attemptId, actor. Never
      // LLM output. On a CAS loss the throw above aborts the whole
      // transaction, so NO orphan event survives the rollback (R5).
      await events.append(buildWorkCompletedEvent(deps, input, completed, receipt));
      await journal.complete(input.attemptId, completed);
      return { ok: true, work: completed, receipt } as const;
    });
  } catch (error) {
    if (error instanceof FinalizeCasLostError) {
      return reconcileCasLoss(deps, input);
    }
    throw error;
  }
}

async function reconcileCasLoss(deps: FinalizeDeps, input: FinalizeInput): Promise<FinalizeResult> {
  // T2 — the shared post-effect-failure reconciliation, on the POOL connection
  // (OUTSIDE the rolled-back T1): `deps.repositories(deps.connection)` yields
  // separate committed writes — `sandbox.undo`, `journal.markRetryable`,
  // `journal.complete(UNRESOLVED)` are each their own committed write (§9.8).
  const { work, journal } = deps.repositories(deps.connection);
  return reconcilePostEffectFailure({ work, journal, sandbox: deps.sandbox }, input);
}

function buildReceipt(deps: FinalizeDeps, input: FinalizeInput, completed: Work): BusinessReceipt {
  return {
    receiptId: `rcpt:${input.attemptId}`,
    companyId: input.companyId,
    workId: completed.workId,
    delegationId: completed.delegationId,
    actor: deps.executor,
    policyHash: input.policyHash ?? WORKER_POLICY_HASH,
    evidenceRefs: [evidenceId(input.companyId, input.idempotencyKey)],
    terminalState: 'completed',
    terminalEventId: input.attemptId,
    artifactHash: input.artifactHash ?? WORKER_ARTIFACT_HASH,
    issuedAt: deps.now?.() ?? Date.now(),
  };
}

/**
 * The deterministic `work.completed` event factory (design "Interfaces /
 * Contracts"): DETERMINISTIC from terminal-close facts ONLY (R6) — the Work
 * terminal state, the receipt identity fields, evidenceId, attemptId, and the
 * acting principal. NO LLM field is read: the model output never selects,
 * judges, or alters any event field. `eventId = evt:{attemptId}` is the
 * single-issuance identity (R7). Equal terminal facts ⇒ equal events.
 */
function buildWorkCompletedEvent(
  deps: FinalizeDeps,
  input: FinalizeInput,
  completed: Work,
  receipt: BusinessReceipt,
): BusinessEvent {
  return {
    eventId: `evt:${input.attemptId}`,
    companyId: input.companyId,
    aggregateKind: 'work',
    aggregateId: completed.workId,
    eventType: 'work.completed',
    occurredAt: deps.now?.() ?? Date.now(),
    payload: {
      workId: completed.workId,
      state: completed.state,
      receiptId: receipt.receiptId,
      terminalState: receipt.terminalState,
      evidenceId: evidenceId(input.companyId, input.idempotencyKey),
      attemptId: input.attemptId,
      actor: deps.executor,
    },
    source: 'worker',
  };
}
