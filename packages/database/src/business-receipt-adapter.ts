import type { BusinessReceipt } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the BusinessReceipt repository port (design §PG
 * Adapter Pattern). Implements `BusinessReceiptRepository` over an injected,
 * ASYNC {@link DbConnection}. Receipts are immutable (write-once): save()
 * INSERTs and there is NO update method. JSONB objects (evidenceRefs) pass
 * directly as params. Methods are ASYNC (D1).
 */
export class PgBusinessReceiptRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    await this.conn.execute(
      'INSERT INTO business_receipt (receipt_id, work_id, delegation_id, actor, ' +
        'policy_hash, evidence_refs, terminal_state, artifact_hash, issued_at, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        receipt.receiptId,
        receipt.workId,
        receipt.delegationId,
        receipt.actor,
        receipt.policyHash,
        JSON.stringify(receipt.evidenceRefs),
        receipt.terminalState,
        receipt.artifactHash,
        receipt.issuedAt,
        Date.now(),
      ],
    );
    return receipt;
  }

  async get(receiptId: string): Promise<BusinessReceipt | undefined> {
    const rows = await this.conn.query<BusinessReceipt>(
      'SELECT receipt_id AS "receiptId", work_id AS "workId", ' +
        'delegation_id AS "delegationId", actor, policy_hash AS "policyHash", ' +
        'evidence_refs AS "evidenceRefs", terminal_state AS "terminalState", ' +
        'artifact_hash AS "artifactHash", issued_at AS "issuedAt" ' +
        'FROM business_receipt WHERE receipt_id = $1',
      [receiptId],
    );
    return rows[0];
  }
}
