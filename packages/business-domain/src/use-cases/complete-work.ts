import type { BusinessReceipt, Work } from '../types.js';
import { canTransitionWork } from '../transitions.js';
import { evidenceId } from '../evidence-id.js';
import { IdempotentFlowAbortError, applyWorkTransition, dedupe } from './result.js';
import type { CompleteWorkCommand, CompleteWorkDeps, UseCaseResult } from './result.js';

/**
 * completeWork (D3/D6): in_progress → completed via get + CAS, merging the
 * outcome/deliverable/evidenceRefs from the command into the stored work.
 *
 * WITHOUT an idempotencyKey this is the plain transition path. WITH a key it
 * runs the idempotent atomic terminal close (D6): journal lookup (REPLAY same
 * hash / DENY different hash) → in_flight insert (pre-effect) → CAS →
 * receipt with terminal_event_id = attempt_id → journal complete. The CALLER
 * must wrap this flow in ONE `DbConnection.transaction` (see the database
 * package's completeWorkAtomically wiring) — every post-write failure THROWS
 * so the transaction rolls back and no partial in_flight/journal/receipt state
 * survives. Pre-write decisions (not-found, invalid-transition,
 * version-conflict, invalid-command) return results and leave no journal row.
 */

/** Deterministic attempt id for a (companyId, idempotencyKey): one attempt per
 * key is guaranteed by UNIQUE(company_id, idempotency_key), so a key-derived
 * id stays unique and keeps the receipt's terminal_event_id traceable. */
function attemptIdFor(companyId: string, idempotencyKey: string): string {
  return `att:${companyId}:${idempotencyKey}`;
}

export async function completeWork(
  cmd: CompleteWorkCommand,
  deps: CompleteWorkDeps,
): Promise<UseCaseResult<Work>> {
  if (cmd.idempotencyKey !== undefined) {
    return completeWorkIdempotent(cmd, deps);
  }
  return applyWorkTransition('completed', cmd, deps.work, (current) => ({
    ...current,
    state: 'completed',
    ...(cmd.outcome ? { outcome: cmd.outcome } : {}),
    ...(cmd.deliverable ? { deliverable: cmd.deliverable } : {}),
    ...(cmd.evidenceRefs
      ? { evidenceRefs: dedupe([...current.evidenceRefs, ...cmd.evidenceRefs]) }
      : {}),
  }));
}

/**
 * The idempotent atomic terminal close (D6). ATOMICITY IS CALLER-ENFORCED: this
 * flow MUST run inside ONE `DbConnection.transaction` — every post-write failure
 * THROWS so the transaction rolls back the in_flight row, the CAS, and the
 * receipt together (no partial state survives). `completeWorkAtomically`
 * (packages/database/src/complete-work-flow.ts) is the sanctioned wiring that
 * always wraps it; no shipped path drives the terminal close outside a single
 * transaction.
 */
async function completeWorkIdempotent(
  cmd: CompleteWorkCommand,
  deps: CompleteWorkDeps,
): Promise<UseCaseResult<Work>> {
  if (!cmd.idempotencyKey || !cmd.requestHash) {
    return { ok: false, reason: 'invalid-command' };
  }
  if (!cmd.workId) return { ok: false, reason: 'invalid-command' };

  // 1. Lookup: same key + same hash → REPLAY; same key + different hash → DENY.
  const entry = await deps.journal.lookup(cmd.companyId, cmd.idempotencyKey);
  if (entry !== undefined) {
    if (entry.requestHash !== cmd.requestHash) {
      return { ok: false, reason: 'idempotency-conflict' };
    }
    if (entry.status === 'in_flight') {
      // A concurrent attempt is in progress; never replay a partial result.
      return { ok: false, reason: 'attempt-in-flight' };
    }
    // Completed + same hash: replay the STORED result — the effect is NOT re-run.
    return { ok: true, value: entry.resultJson as Work };
  }

  // 2. Pre-flight validation BEFORE any write: failures leave no journal row.
  const current = await deps.work.get(cmd.companyId, cmd.workId);
  if (current === undefined) return { ok: false, reason: 'not-found' };
  if (!canTransitionWork(current.state, 'completed')) {
    return { ok: false, reason: 'invalid-transition', current };
  }
  if (cmd.expectedVersion !== undefined && cmd.expectedVersion !== current.version) {
    return { ok: false, reason: 'version-conflict', current };
  }
  if (!cmd.policyHash || !cmd.artifactHash) {
    return { ok: false, reason: 'invalid-command' };
  }

  // 3. Writes begin (pre-effect): claim the key (record the attempt in_flight).
  const attemptId = attemptIdFor(cmd.companyId, cmd.idempotencyKey);
  const claim = await deps.journal.insertInFlight({
    companyId: cmd.companyId,
    idempotencyKey: cmd.idempotencyKey,
    requestHash: cmd.requestHash,
    attemptId,
  });
  if (!claim.ok) {
    // Lost the same-key race at the claim boundary: a concurrent attempt owns
    // the key. A typed result (never a throw) — the caller retries for a clean
    // replay. No effect ran yet, so there is nothing to roll back.
    return { ok: false, reason: 'attempt-in-flight' };
  }

  // 4. Effect: the CAS transition.
  const next: Work = {
    ...current,
    state: 'completed',
    ...(cmd.outcome ? { outcome: cmd.outcome } : {}),
    ...(cmd.deliverable ? { deliverable: cmd.deliverable } : {}),
    ...(cmd.evidenceRefs
      ? { evidenceRefs: dedupe([...current.evidenceRefs, ...cmd.evidenceRefs]) }
      : {}),
  };
  const cas = await deps.work.updateIfVersion(next, current.version);
  if (!cas.ok) {
    // A concurrent writer won after the in_flight insert. Returning here would
    // COMMIT a zombie in_flight row that poisons every future retry of this
    // key — the surrounding transaction MUST abort (throw → full rollback).
    throw new IdempotentFlowAbortError('version-conflict after in_flight insert');
  }
  const completed = cas.value;

  // 5. Terminal close: receipt (terminal_event_id = attempt_id) + journal
  //    complete. The receipt references the STABLE evidence identity (D8).
  const receipt: BusinessReceipt = {
    receiptId: `rcpt:${attemptId}`,
    companyId: cmd.companyId,
    workId: current.workId,
    delegationId: current.delegationId,
    actor: cmd.actor,
    policyHash: cmd.policyHash,
    evidenceRefs: dedupe([
      ...(cmd.evidenceRefs ?? []),
      evidenceId(cmd.companyId, cmd.idempotencyKey),
    ]),
    terminalState: 'completed',
    terminalEventId: attemptId,
    artifactHash: cmd.artifactHash,
    issuedAt: Date.now(),
  };
  await deps.receipts.save(receipt);
  await deps.journal.complete(attemptId, completed);

  return { ok: true, value: completed };
}
