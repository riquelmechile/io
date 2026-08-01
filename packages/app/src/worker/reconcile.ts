import type {
  IdempotencyJournalPort,
  JournalEntry,
} from '@io/business-domain/src/ports/idempotency.js';

/**
 * Pre-effect journal reconciliation (design "Pre-effect lookup" table): the
 * journal is the source of truth for attempt state; the worker consults it
 * BEFORE any effect. `decidePreEffect` is the pure decision table —
 * completed+same → REPLAY; completed+diff → DENY; aborted_retryable+same →
 * proceed (reopen); aborted_retryable+diff → DENY; in_flight → recovery (no
 * re-insert); none → proceed (insertInFlight). `reconcilePreEffect` drives the
 * table and performs the insert/reopen when the decision is `proceed`.
 */

export type PreEffectDecision =
  | { kind: 'replay'; resultJson: unknown }
  | { kind: 'deny'; reason: 'idempotency-conflict' }
  | { kind: 'recovery' }
  | { kind: 'proceed' };

/** The pure decision table — MUST match the design table row for row. */
export function decidePreEffect(
  entry: JournalEntry | undefined,
  requestHash: string,
): PreEffectDecision {
  if (entry === undefined) {
    // none → insertInFlight → execute.
    return { kind: 'proceed' };
  }
  if (entry.requestHash !== requestHash) {
    // Same key + different hash: DENY (completed+diff, aborted_retryable+diff,
    // and conservatively a conflicting in_flight attempt).
    return { kind: 'deny', reason: 'idempotency-conflict' };
  }
  if (entry.status === 'completed') {
    // Completed + same hash → REPLAY the recorded result; no effect.
    return { kind: 'replay', resultJson: entry.resultJson };
  }
  if (entry.status === 'aborted_retryable') {
    // Aborted_retryable + same hash → controlled retry: reopen via
    // insertInFlight (conditional UPDATE keeps the ORIGINAL attemptId).
    return { kind: 'proceed' };
  }
  // in_flight + same hash → the post-effect/recovery path; NEVER re-insert.
  return { kind: 'recovery' };
}

export async function reconcilePreEffect(
  journal: IdempotencyJournalPort,
  companyId: string,
  idempotencyKey: string,
  requestHash: string,
  attemptId: string,
): Promise<PreEffectDecision> {
  const entry = await journal.lookup(companyId, idempotencyKey);
  const decision = decidePreEffect(entry, requestHash);
  if (decision.kind === 'proceed') {
    // none → INSERT in_flight; aborted_retryable + same hash → reopen. Any
    // other existing status never reaches here (replay/deny/recovery returned).
    await journal.insertInFlight({ companyId, idempotencyKey, requestHash, attemptId });
  }
  return decision;
}
