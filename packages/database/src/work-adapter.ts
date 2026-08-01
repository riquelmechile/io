import type { CasResult, Deliverable, Work, WorkOutcome } from '@io/business-domain/src/index.js';

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
 * returns no rows (not-found). `save` is INSERT-only (a duplicate work_id is
 * rejected by `uq_work_work_id` once 004 is applied); state changes go through
 * `updateIfVersion` (D4): a single `UPDATE … version=version+1 WHERE
 * work_id=$1 AND company_id=$2 AND version=$3` — 0 rows updated means the
 * expected version is stale and the write is rejected as `version-conflict`
 * with the current work attached when available. An empty `companyId` is
 * rejected up front — PG/fake validation parity (task 2.11, Slice A review
 * follow-up). Methods are ASYNC (D1).
 */
export class PgWorkRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(work: Work): Promise<Readonly<Work>> {
    if (!work.companyId) {
      throw new Error('a non-empty companyId is required');
    }
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
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
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

  /**
   * Compare-and-swap update (D4): one atomic `UPDATE` that writes ONLY when the
   * supplied `expectedVersion` still matches the stored `version`, bumping it
   * to `version + 1` in the same statement. `rowCount === 0` ⇒ the stored
   * version advanced (or the work vanished) ⇒ the write is rejected as
   * `version-conflict` and the stored work is NEVER overwritten. Under
   * concurrent writers the row lock serializes them: exactly one sees
   * `rowCount === 1`, every other sees `rowCount === 0`.
   */
  async updateIfVersion(work: Work, expectedVersion: number): Promise<CasResult> {
    if (!work.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const result = (await this.conn.execute(
      'UPDATE work SET description=$4, state=$5, deliverable=$6, evidence_refs=$7, outcome=$8, ' +
        'version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3',
      [
        work.workId,
        work.companyId,
        expectedVersion,
        work.description,
        work.state,
        work.deliverable !== undefined ? JSON.stringify(work.deliverable) : null,
        JSON.stringify(work.evidenceRefs),
        work.outcome !== undefined ? JSON.stringify(work.outcome) : null,
      ],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      // Stale writer: report the current work when available (D4).
      const current = await this.get(work.companyId, work.workId);
      return current === undefined
        ? { ok: false, reason: 'version-conflict' }
        : { ok: false, reason: 'version-conflict', current };
    }
    // The WHERE clause guaranteed the stored version matched `expectedVersion`,
    // and PG bumped the stored column with `version=version+1`; the caller's
    // `work.version` could be stale, so the new version is `expectedVersion + 1`.
    return { ok: true, value: { ...work, version: expectedVersion + 1 } };
  }
}
