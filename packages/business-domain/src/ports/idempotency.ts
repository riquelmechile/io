/**
 * Idempotency journal port (D6): records business-operation attempts keyed by
 * (companyId, idempotencyKey) so a retried request with the SAME key and
 * request hash REPLAYS the stored result, a DIFFERENT hash under the same key
 * is DENIED, and a new key records an attempt (in_flight) before the effect and
 * is closed (completed) with the stored result afterwards. A PG adapter over
 * the idempotency_journal table (004) and an in-memory fake implement this
 * port. Pure interface — zero @io/* imports, no driver or table knowledge.
 */

export type JournalStatus = 'in_flight' | 'completed' | 'aborted_retryable';

/**
 * Structural recognizer for the journal's honest NON-Work close sentinel —
 * `{ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' }` (stored via
 * `journal.complete` on the finalize T2(ii) / worker terminal path). The
 * journal's `result_json` is genuinely polymorphic: a completed Work (the
 * replay path) OR this sentinel. A row guard that validates ONLY Work-shaped
 * payloads MUST recognize and pass the sentinel through unguarded, or a
 * same-key retry after an honest UNRESOLVED close would fail loudly and poison
 * the key. Defined here (zero @io/* imports) so the PG adapter and the
 * in-memory fake share ONE source of truth for the sentinel shape and cannot
 * diverge. Pure structural check — no driver or table knowledge.
 */
export function isUnresolvedJournalResult(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.ok === false && row.reason === 'UNRESOLVED_REQUIRES_HUMAN';
}

export interface JournalEntry {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
  readonly status: JournalStatus;
  /**
   * Claim-scoped fencing token (fencing-tokens change): the token minted at the
   * Work claim CAS, stored on the journal row pre-effect. It proves claim
   * ownership for `markRetryable` (stale token → rejected) and is retained on a
   * controlled retry / reopen (never re-minted, never incremented). Token 0 is
   * the valid pre-fencing epoch: legacy rows and unclaimed admin closes default
   * to it and remain valid (spec "Pre-fencing row remains valid").
   */
  readonly fencingToken: number;
  /** Stored use-case result captured when the attempt completed (replayed). */
  readonly resultJson?: unknown;
}

export interface NewJournalEntry {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
  /**
   * The claim-scoped fencing token (fencing-tokens change): the token minted at
   * the Work claim CAS and carried into the pre-effect journal insert. Token 0
   * (the epoch) is valid for unclaimed admin closes and legacy rows.
   */
  readonly fencingToken: number;
}

/**
 * Result of claiming a key with {@link IdempotencyJournalPort.insertInFlight}.
 * `{ ok: true }` — this caller owns the attempt (proceed to the effect).
 * `{ ok: false; reason: 'attempt-in-flight' }` — a concurrent attempt already
 * owns the key (a same-key race loser): a typed VALUE, never a thrown
 * unique-violation, so the caller can retry for a clean replay. Exactly one
 * claimant per key is guaranteed by UNIQUE(company_id, idempotency_key).
 */
export type JournalClaimResult = { ok: true } | { ok: false; reason: 'attempt-in-flight' };

/**
 * Result of marking an attempt retryable (finalize CAS-loss / W2 / W3
 * recovery). `{ ok: true }` — the attempt became durable `aborted_retryable`.
 * `{ ok: false; reason: 'stale-token' }` — the marker write was REFUSED
 * WITHOUT mutation: the attempt is missing, its status is not `in_flight`, OR
 * the supplied token does not equal the stored claim token (a stale holder
 * cannot mark a row it no longer owns — fencing-tokens change). `current`
 * reports the stored row when it exists (informative, like `CasResult.current`).
 * A typed VALUE, never a thrown rejection (spec "Stale token cannot mark
 * retryable"): the caller escalates honestly instead of failing loudly.
 */
export type MarkRetryableResult =
  | { ok: true }
  | { ok: false; reason: 'stale-token'; current?: JournalEntry };

/**
 * Idempotency journal port (D6).
 *
 * ATOMICITY IS CALLER-ENFORCED: the port alone does NOT make the
 * lookup → insertInFlight → effect → complete flow atomic. The caller MUST wrap
 * the whole flow in ONE `DbConnection.transaction` so any post-write failure
 * rolls back the in_flight row, the CAS, and the receipt together (no partial
 * state). `completeWorkAtomically` (packages/database/src/complete-work-flow.ts)
 * is the sanctioned wiring that always wraps it; no shipped path drives the
 * terminal close outside a single transaction.
 */
export interface IdempotencyJournalPort {
  /** The recorded attempt for (companyId, idempotencyKey), or undefined. */
  lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined>;
  /**
   * Record the attempt as in_flight BEFORE the effect (pre-effect, D6) and claim
   * the key. Returns {@link JournalClaimResult}: `{ ok: true }` when this caller
   * owns the attempt; `{ ok: false, reason: 'attempt-in-flight' }` when a
   * concurrent attempt already owns the key (a same-key race loser — a typed
   * result, never a thrown unique-violation).
   */
  insertInFlight(entry: NewJournalEntry): Promise<JournalClaimResult>;
  /** Close the attempt: status completed + the stored result for replay. */
  complete(attemptId: string, resultJson: unknown): Promise<void>;
  /**
   * Finalize CAS-loss recovery: in_flight → aborted_retryable (a durable
   * retryable marker distinct from in_flight and completed, so a controlled
   * retry can reopen the key instead of bricking it). Clears resultJson.
   * Returns a TYPED {@link MarkRetryableResult}: `{ ok: true }` on success;
   * `{ ok: false, reason: 'stale-token', current }` when the attempt is
   * missing, its status is not in_flight, OR the supplied token does not equal
   * the stored claim token (a stale holder cannot mark a row it no longer
   * owns — fencing-tokens change). NEVER throws for a business rejection; the
   * row is NEVER mutated on failure.
   * MUST be invoked in its OWN committed write (not inside a rolling-back
   * finalize tx).
   */
  markRetryable(attemptId: string, fencingToken: number): Promise<MarkRetryableResult>;
}
