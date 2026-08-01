import type {
  IdempotencyJournalPort,
  JournalEntry,
  NewJournalEntry,
} from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL adapter for the idempotency journal port (design D6) over the
 * `idempotency_journal` table (004). Implemented over an injected, ASYNC
 * {@link DbConnection}; company scope binds `company_id = $1` on lookup so a
 * lookup under the wrong tenant returns no rows. The 004 UNIQUE indexes
 * (UNIQUE(company_id, idempotency_key) + UNIQUE(attempt_id)) enforce one
 * attempt per key at the database level — a concurrent duplicate insert
 * rejects. `insertInFlight` records the attempt BEFORE the effect (pre-effect,
 * D6); `complete` closes it with the stored result so a retry can REPLAY it.
 * Empty-companyId guards match the fake's requireCompanyId parity contract.
 * `markRetryable` records the durable retryable marker (finalize CAS-loss
 * recovery, first-enterprise-vertical) and `insertInFlight` reopens an
 * `aborted_retryable` row via a CONDITIONAL UPDATE (never a fresh INSERT — the
 * 004 UNIQUE(company_id, idempotency_key) forbids a second row; the original
 * attempt_id is kept). The journal LOGIC (replay/DENY and the atomic terminal
 * close in one transaction) lives in the business-domain use cases + the
 * completeWorkAtomically wiring; this adapter is a dumb row store.
 */
export class PgIdempotencyJournalRepository implements IdempotencyJournalPort {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    if (!idempotencyKey) {
      throw new Error('a non-empty idempotencyKey is required');
    }
    const rows = await this.conn.query<JournalEntry>(
      'SELECT company_id AS "companyId", idempotency_key AS "idempotencyKey", request_hash AS "requestHash", ' +
        'attempt_id AS "attemptId", status, result_json AS "resultJson" ' +
        'FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
      [companyId, idempotencyKey],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    return { ...row, resultJson: row.resultJson ?? undefined };
  }

  async insertInFlight(entry: NewJournalEntry): Promise<void> {
    if (!entry.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    if (!entry.idempotencyKey) {
      throw new Error('a non-empty idempotencyKey is required');
    }
    if (!entry.requestHash) {
      throw new Error('a non-empty requestHash is required');
    }
    if (!entry.attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    const existing = await this.lookup(entry.companyId, entry.idempotencyKey);
    if (existing !== undefined && existing.status === 'aborted_retryable') {
      if (existing.requestHash !== entry.requestHash) {
        // Controlled retry only under the SAME request hash — a different hash
        // under the marker is an idempotency-conflict (DENY, no overwrite).
        throw new Error(
          `idempotency conflict: request hash differs for retryable attempt: ${entry.idempotencyKey}`,
        );
      }
      // Reopen = CONDITIONAL UPDATE (acceptance note 1) — NEVER a fresh INSERT,
      // which would violate UNIQUE(company_id, idempotency_key). The original
      // attempt_id is kept (a receipt was never issued on the prior CAS loss).
      const result = (await this.conn.execute(
        'UPDATE idempotency_journal SET status=$4, result_json=$5 WHERE company_id=$1 AND ' +
          'idempotency_key=$2 AND status=$3 AND request_hash=$6',
        [
          entry.companyId,
          entry.idempotencyKey,
          'aborted_retryable',
          'in_flight',
          null,
          entry.requestHash,
        ],
      )) as { rowCount?: number };
      if ((result.rowCount ?? 0) === 0) {
        // The marker vanished or its hash changed concurrently: deny the reopen.
        throw new Error(
          `idempotency conflict: retryable attempt changed concurrently: ${entry.idempotencyKey}`,
        );
      }
      return;
    }
    if (existing !== undefined) {
      // Mirrors UNIQUE(company_id, idempotency_key): in_flight and completed
      // attempts are never re-opened.
      throw new Error(`idempotency key already recorded: ${entry.idempotencyKey}`);
    }
    await this.conn.execute(
      'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6)',
      [
        entry.companyId,
        entry.idempotencyKey,
        entry.requestHash,
        entry.attemptId,
        'in_flight',
        Date.now(),
      ],
    );
  }

  async complete(attemptId: string, resultJson: unknown): Promise<void> {
    if (!attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    await this.conn.execute(
      'UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1',
      [attemptId, 'completed', resultJson === undefined ? null : JSON.stringify(resultJson)],
    );
  }

  async markRetryable(attemptId: string): Promise<void> {
    if (!attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    // Finalize CAS-loss recovery: in_flight → aborted_retryable, result_json
    // cleared. The status guard makes it a no-op-safe conditional write: a
    // missing or completed (or already-marked) attempt updates 0 rows and is
    // rejected — parity with the fake's contract.
    const result = (await this.conn.execute(
      'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3',
      [attemptId, 'aborted_retryable', 'in_flight', null],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`attempt is not in_flight (or missing): ${attemptId}`);
    }
  }
}
