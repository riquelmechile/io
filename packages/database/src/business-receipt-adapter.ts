import type { BusinessReceipt } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseBusinessReceiptRow } from './row-guards.js';

/**
 * PostgreSQL-shaped adapter for the BusinessReceipt repository port (design §PG
 * Adapter Pattern). Implements `BusinessReceiptRepository` over an injected,
 * ASYNC {@link DbConnection}. Receipts are immutable (write-once): save()
 * INSERTs and there is NO update method. JSONB objects (evidenceRefs) pass
 * directly as params. `company_id` (tenant scope, ADR-0002) is written on save
 * and carried on every receipt; get() is a SCOPED read:
 * `WHERE company_id = $1 AND receipt_id = $2` so a lookup under the wrong
 * tenant returns no rows (not-found). `terminal_event_id` (D5) records the
 * terminal event (attempt) that closed the work; single issuance is enforced by
 * the 004 UNIQUE indexes: uq_receipt_receipt_id (no re-issue of a receiptId)
 * and uq_receipt_work_terminal (one terminal close per work — a duplicate
 * (work_id, terminal_event_id) is rejected even with a different receiptId).
 * Methods are ASYNC (D1).
 */
export class PgBusinessReceiptRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    if (!receipt.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    await this.conn.execute(
      'INSERT INTO business_receipt (receipt_id, company_id, work_id, delegation_id, actor, ' +
        'policy_hash, evidence_refs, terminal_state, terminal_event_id, artifact_hash, issued_at, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        receipt.receiptId,
        receipt.companyId,
        receipt.workId,
        receipt.delegationId,
        receipt.actor,
        receipt.policyHash,
        JSON.stringify(receipt.evidenceRefs),
        receipt.terminalState,
        receipt.terminalEventId,
        receipt.artifactHash,
        receipt.issuedAt,
        Date.now(),
      ],
    );
    return receipt;
  }

  async get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<BusinessReceipt>(
      'SELECT receipt_id AS "receiptId", company_id AS "companyId", work_id AS "workId", ' +
        'delegation_id AS "delegationId", actor, policy_hash AS "policyHash", ' +
        'evidence_refs AS "evidenceRefs", terminal_state AS "terminalState", ' +
        'terminal_event_id AS "terminalEventId", artifact_hash AS "artifactHash", issued_at AS "issuedAt" ' +
        'FROM business_receipt WHERE company_id = $1 AND receipt_id = $2',
      [companyId, receiptId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    // Rows read from PG are untrusted bytes: validate at runtime before use
    // (D7). A corrupt row is an integrity violation — fail loudly.
    const parsed = parseBusinessReceiptRow(row);
    if (!parsed.ok) {
      throw new Error(`corrupt business receipt row: ${parsed.reason}`);
    }
    return parsed.value;
  }
}
