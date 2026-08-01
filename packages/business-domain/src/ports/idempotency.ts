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

export interface JournalEntry {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
  readonly status: JournalStatus;
  /** Stored use-case result captured when the attempt completed (replayed). */
  readonly resultJson?: unknown;
}

export interface NewJournalEntry {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly attemptId: string;
}

export interface IdempotencyJournalPort {
  /** The recorded attempt for (companyId, idempotencyKey), or undefined. */
  lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined>;
  /** Record the attempt as in_flight BEFORE the effect (pre-effect, D6). */
  insertInFlight(entry: NewJournalEntry): Promise<void>;
  /** Close the attempt: status completed + the stored result for replay. */
  complete(attemptId: string, resultJson: unknown): Promise<void>;
  /**
   * Finalize CAS-loss recovery: in_flight → aborted_retryable (a durable
   * retryable marker distinct from in_flight and completed, so a controlled
   * retry can reopen the key instead of bricking it). Clears resultJson.
   * Rejects when the attempt is missing or its status is not in_flight.
   * MUST be invoked in its OWN committed write (not inside a rolling-back
   * finalize tx).
   */
  markRetryable(attemptId: string): Promise<void>;
}
