import type { Deliverable, Work, WorkOutcome } from '@io/business-domain/src/index.js';
import { NotFoundError, VersionConflictError } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the Work repository port (design §PG Adapter
 * Pattern). Implements `WorkRepository` over an injected, ASYNC
 * {@link DbConnection}. Scoped by companyId. save() is insert-only;
 * transitions use updateWithVersion CAS.
 */
export class PgWorkRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(work: Work): Promise<Readonly<Work>> {
    await this.conn.execute(
      'INSERT INTO work (work_id, company_id, delegation_id, proposer, description, state, ' +
        'version, deliverable, evidence_refs, outcome, created_at) ' +
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

  async get(workId: string, companyId: string): Promise<Work | undefined> {
    const rows = await this.conn.query<
      Work & { deliverable: Deliverable | null; outcome: WorkOutcome | null }
    >(
      'SELECT work_id AS "workId", company_id AS "companyId", delegation_id AS "delegationId", ' +
        'proposer, description, state, version, deliverable, evidence_refs AS "evidenceRefs", outcome ' +
        'FROM work WHERE work_id = $1 AND company_id = $2',
      [workId, companyId],
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

  async updateWithVersion(work: Work, expectedVersion: number): Promise<Readonly<Work>> {
    const result = (await this.conn.execute(
      'UPDATE work SET state = $1, version = version + 1, deliverable = $2, ' +
        'evidence_refs = $3, outcome = $4, proposer = $5, description = $6, delegation_id = $7 ' +
        'WHERE work_id = $8 AND company_id = $9 AND version = $10',
      [
        work.state,
        work.deliverable !== undefined ? JSON.stringify(work.deliverable) : null,
        JSON.stringify(work.evidenceRefs),
        work.outcome !== undefined ? JSON.stringify(work.outcome) : null,
        work.proposer,
        work.description,
        work.delegationId,
        work.workId,
        work.companyId,
        expectedVersion,
      ],
    )) as { rowCount?: number } | undefined;

    const rowCount = result?.rowCount ?? 0;
    if (rowCount === 0) {
      const existing = await this.get(work.workId, work.companyId);
      if (existing === undefined) {
        throw new NotFoundError(`work not found: ${work.workId}`);
      }
      throw new VersionConflictError(
        `expected version ${expectedVersion}, found ${existing.version}`,
      );
    }

    const updated = await this.get(work.workId, work.companyId);
    if (updated === undefined) {
      throw new NotFoundError(`work not found after update: ${work.workId}`);
    }
    return updated;
  }
}
