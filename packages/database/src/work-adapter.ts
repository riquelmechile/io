import type { Deliverable, Work, WorkOutcome } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the Work repository port (design §PG Adapter
 * Pattern). Implements `WorkRepository` over an injected, ASYNC
 * {@link DbConnection}. Nullable JSONB columns (`deliverable`, `outcome`) are
 * converted: `undefined` → `null` on save, `null` → `undefined` on get. JSONB
 * objects (deliverable, evidenceRefs, outcome) pass directly as params.
 * `company_id` (tenant scope, ADR-0002) and `version` (optimistic-concurrency
 * counter, init 1) are written on save; get() is a SCOPED read:
 * `WHERE company_id = $1 AND work_id = $2` so a lookup under the wrong tenant
 * returns no rows (not-found). Methods are ASYNC (D1).
 */
export class PgWorkRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(work: Work): Promise<Readonly<Work>> {
    await this.conn.execute(
      'INSERT INTO work (work_id, company_id, delegation_id, proposer, description, state, version, ' +
        'deliverable, evidence_refs, outcome, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        work.workId,
        work.companyId,
        work.delegationId,
        work.proposer,
        work.description,
        work.state,
        work.version,
        work.deliverable !== undefined ? JSON.stringify(work.deliverable) : null,
        JSON.stringify(work.evidenceRefs),
        work.outcome !== undefined ? JSON.stringify(work.outcome) : null,
        Date.now(),
      ],
    );
    return work;
  }

  async get(companyId: string, workId: string): Promise<Work | undefined> {
    const rows = await this.conn.query<
      Work & { deliverable: Deliverable | null; outcome: WorkOutcome | null }
    >(
      'SELECT work_id AS "workId", company_id AS "companyId", delegation_id AS "delegationId", proposer, description, ' +
        'state, version, deliverable, evidence_refs AS "evidenceRefs", outcome ' +
        'FROM work WHERE company_id = $1 AND work_id = $2',
      [companyId, workId],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    if (!row) return undefined;
    return {
      workId: row.workId,
      companyId: row.companyId,
      delegationId: row.delegationId,
      proposer: row.proposer,
      description: row.description,
      state: row.state,
      version: row.version,
      deliverable: row.deliverable ?? undefined,
      evidenceRefs: row.evidenceRefs,
      outcome: row.outcome ?? undefined,
    };
  }
}
