import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  NewJournalEntry,
} from '@io/business-domain/src/index.js';
import { isUnresolvedJournalResult } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseWorkRow } from './row-guards.js';

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
        'attempt_id AS "attemptId", status, fencing_token AS "fencingToken", result_json AS "resultJson" ' +
        'FROM idempotency_journal WHERE company_id = $1 AND idempotency_key = $2',
      [companyId, idempotencyKey],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const resultJson = row.resultJson ?? undefined;
    if (resultJson === undefined) {
      // in_flight / aborted_retryable rows carry no stored result to guard.
      return { ...row, resultJson: undefined };
    }
    // The journal legitimately stores TWO result shapes: a completed Work (the
    // replay path) AND the NON-Work UNRESOLVED_REQUIRES_HUMAN sentinel (the
    // honest finalize T2(ii) / worker terminal close). `lookup` is a generic
    // read serving BOTH caller classes, so recognize the sentinel and pass it
    // through unguarded — a same-key retry after an honest UNRESOLVED close
    // MUST get the typed result, not a throw that poisons the key (F1).
    if (isUnresolvedJournalResult(resultJson)) {
      return { ...row, resultJson };
    }
    // D7: any OTHER present result_json is a Work-shaped replay payload —
    // untrusted PG bytes, guarded with the SAME row parser the work adapter
    // uses, so a stale/malformed stored result is caught consistently (fail
    // loudly) rather than returned raw to the replay path.
    const parsed = parseWorkRow(resultJson);
    if (!parsed.ok) {
      throw new Error(`corrupt journal result_json: ${parsed.reason}`);
    }
    return { ...row, resultJson: parsed.value };
  }

  async insertInFlight(entry: NewJournalEntry): Promise<JournalClaimResult> {
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
      return { ok: true };
    }
    if (existing !== undefined) {
      // Mirrors UNIQUE(company_id, idempotency_key): an in_flight or completed
      // attempt already owns the key, so this caller LOST the claim. A typed
      // result (never a thrown error) so the caller can retry for a clean replay.
      return { ok: false, reason: 'attempt-in-flight' };
    }
    // Claim the key. ON CONFLICT DO NOTHING WITHOUT a target (fencing-tokens
    // race fix) turns the same-key RACE (a concurrent insert committed between
    // our lookup and this INSERT) into a 0-row result instead of a thrown
    // unique-violation that would ABORT the enclosing transaction. A TARGETED
    // `ON CONFLICT (company_id, idempotency_key)` does NOT arbitrate the
    // separate UNIQUE(attempt_id) index: two concurrent same-key inserts with
    // the SAME attempt id conflict on BOTH indexes, and PG raises the
    // non-arbiter duplicate-key error (index checks are independent, order
    // unspecified — the historical ~10-25% flake). No-target DO NOTHING handles
    // conflicts with ANY usable unique constraint (PG docs), so the loser gets
    // a typed attempt-in-flight and stays clean. The claim fencing token is
    // stored pre-effect ($6) — the row is the claim-ownership record.
    const inserted = (await this.conn.execute(
      'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, fencing_token, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [
        entry.companyId,
        entry.idempotencyKey,
        entry.requestHash,
        entry.attemptId,
        'in_flight',
        entry.fencingToken ?? 0,
        Date.now(),
      ],
    )) as { rowCount?: number };
    if ((inserted.rowCount ?? 0) === 0) {
      return { ok: false, reason: 'attempt-in-flight' };
    }
    return { ok: true };
  }

  async complete(attemptId: string, resultJson: unknown): Promise<void> {
    if (!attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    // Status-guarded, TOKEN-FREE terminal close (fencing-tokens spec): a
    // completed row must never re-complete. The honest T2(ii)
    // UNRESOLVED_REQUIRES_HUMAN close (stale holder) carries NO token: the
    // guard is status-only, so the honest stale-holder close stays reachable.
    // 0 rows → rejected without mutation (parity with the fake's throw).
    // (Interim: an aborted_retryable marker MAY still complete — the legacy
    // honest close the pre-wiring worker relies on; the strict in_flight-only
    // guard lands with the worker wiring.) Read the row's status FIRST, reject
    // a completed (or missing) row, then CAS on the OBSERVED status so a
    // concurrent state change still resolves to a throw.
    const rows = await this.conn.query<{ status: string }>(
      'SELECT status FROM idempotency_journal WHERE attempt_id = $1',
      [attemptId],
    );
    const status = rows[0]?.status;
    if (status === undefined || status === 'completed') {
      throw new Error(`attempt is not in_flight (or missing): ${attemptId}`);
    }
    const result = (await this.conn.execute(
      'UPDATE idempotency_journal SET status=$2, result_json=$3 WHERE attempt_id=$1 AND status=$4',
      [
        attemptId,
        'completed',
        resultJson === undefined ? null : JSON.stringify(resultJson),
        status,
      ],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`attempt is not in_flight (or missing): ${attemptId}`);
    }
  }

  async markRetryable(attemptId: string, fencingToken?: number): Promise<void> {
    if (!attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    // Finalize CAS-loss recovery: in_flight → aborted_retryable, result_json
    // cleared. The status guard makes it a no-op-safe conditional write: a
    // missing or completed (or already-marked) attempt updates 0 rows and is
    // rejected — parity with the fake's contract. The claim-ownership GATE
    // (fencing-tokens change): when a token is supplied, the marker write must
    // carry the stored claim token — a STALE token (a zombie holder) matches 0
    // rows and is rejected WITHOUT mutation, exactly like the fake. A call
    // WITHOUT a token keeps the legacy status-only write.
    const result = (await this.conn.execute(
      fencingToken === undefined
        ? 'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3'
        : 'UPDATE idempotency_journal SET status=$2, result_json=$4 WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5',
      fencingToken === undefined
        ? [attemptId, 'aborted_retryable', 'in_flight', null]
        : [attemptId, 'aborted_retryable', 'in_flight', null, fencingToken],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`attempt is not in_flight (or missing): ${attemptId}`);
    }
  }
}
