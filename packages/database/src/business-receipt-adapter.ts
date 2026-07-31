import type { BusinessReceipt } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the BusinessReceipt repository port (design §PG
 * Adapter Pattern). Implements `BusinessReceiptRepository` over an injected,
 * ASYNC {@link DbConnection}. Receipts are immutable (write-once). Scoped by
 * companyId; UNIQUE(work_id, terminal_event_id) enforced at the schema layer.
 */
export class PgBusinessReceiptRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    await this.conn.execute(
      'INSERT INTO business_receipt (receipt_id, work_id, delegation_id, company_id, actor, ' +
        'policy_hash, evidence_refs, terminal_event_id, terminal_state, artifact_hash, issued_at, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        receipt.receiptId,
        receipt.workId,
        receipt.delegationId,
        receipt.companyId,
        receipt.actor,
        receipt.policyHash,
        JSON.stringify(receipt.evidenceRefs),
        receipt.terminalEventId,
        receipt.terminalState,
        receipt.artifactHash,
        receipt.issuedAt,
        Date.now(),
      ],
    );
    return receipt;
  }

  async get(receiptId: string, companyId: string): Promise<BusinessReceipt | undefined> {
    const rows = await this.conn.query<BusinessReceipt>(
      'SELECT receipt_id AS "receiptId", work_id AS "workId", ' +
        'delegation_id AS "delegationId", company_id AS "companyId", actor, policy_hash AS "policyHash", ' +
        'evidence_refs AS "evidenceRefs", terminal_event_id AS "terminalEventId", ' +
        'terminal_state AS "terminalState", ' +
        'artifact_hash AS "artifactHash", issued_at AS "issuedAt" ' +
        'FROM business_receipt WHERE receipt_id = $1 AND company_id = $2',
      [receiptId, companyId],
    );
    return rows[0];
  }
}
