import { ACTIONABLE_WORK_STATES } from '@io/business-domain/src/index.js';
import type {
  CasResult,
  Deliverable,
  FencingDirective,
  Work,
  WorkOutcome,
} from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseWorkRow } from './row-guards.js';

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
        'fencing_token, deliverable, evidence_refs, outcome, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        work.workId,
        work.companyId,
        work.delegationId,
        work.proposer,
        work.description,
        work.state,
        work.version,
        work.fencingToken,
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
        'state, version, fencing_token AS "fencingToken", deliverable, evidence_refs AS "evidenceRefs", outcome ' +
        'FROM work WHERE company_id = $1 AND work_id = $2',
      [companyId, workId],
    );
    if (rows.length === 0) return undefined;
    const row = rows[0];
    // Rows read from PG are untrusted bytes: validate at runtime before use
    // (D7). A corrupt row is an integrity violation — fail loudly.
    const parsed = parseWorkRow(row);
    if (!parsed.ok) {
      throw new Error(`corrupt work row: ${parsed.reason}`);
    }
    return parsed.value;
  }

  /**
   * Compare-and-swap update (D4 + fencing, design "Work CAS evolution"): one
   * atomic `UPDATE` that writes ONLY when the supplied `expectedVersion` still
   * matches the stored `version`, bumping it to `version + 1` in the same
   * statement. `rowCount === 0` ⇒ the stored version advanced (or the work
   * vanished) ⇒ the write is rejected as `version-conflict` and the stored
   * work is NEVER overwritten. Under concurrent writers the row lock
   * serializes them: exactly one sees `rowCount === 1`, every other sees
   * `rowCount === 0`.
   *
   * Fencing directives (fencing-tokens change), handled atomically in the SAME
   * statement:
   * - `{ kind: 'claim' }` — mints `fencing_token = fencing_token + 1` in the
   *   UPDATE and reads the minted value back via `RETURNING` (query(), not
   *   execute() — the token must be returned to the caller). A 0-row claim is
   *   a version-conflict (a concurrent claim won; losers never mint).
   * - `{ kind: 'terminal', expectedFencingToken }` — adds `AND
   *   fencing_token = $N` to the WHERE clause so a claim-owned terminal close
   *   only lands when the caller still owns the work. A 0-row terminal CAS is
   *   re-read to distinguish version-conflict (version advanced) from
   *   fencing-conflict (version matched but the token is stale — zombie
   *   writer); both leave the stored work untouched.
   */
  async updateIfVersion(
    work: Work,
    expectedVersion: number,
    fencing?: FencingDirective,
  ): Promise<CasResult> {
    if (!work.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    if (fencing?.kind === 'claim') {
      return this.claimWithFencing(work, expectedVersion);
    }
    if (fencing?.kind === 'terminal') {
      return this.terminalWithFencing(work, expectedVersion, fencing.expectedFencingToken);
    }
    return this.plainUpdateIfVersion(work, expectedVersion);
  }

  /** Version-only CAS (plain transitions / unclaimed admin closes). */
  private async plainUpdateIfVersion(work: Work, expectedVersion: number): Promise<CasResult> {
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
      const current = await this.get(work.companyId, work.workId);
      return current === undefined
        ? { ok: false, reason: 'version-conflict' }
        : { ok: false, reason: 'version-conflict', current };
    }
    return { ok: true, value: { ...work, version: expectedVersion + 1 } };
  }

  /**
   * Claim CAS (fencing): mints the NEXT server-side token in the SAME atomic
   * statement and reads it back with `RETURNING` — the minted value can only
   * come from the database (the caller's snapshot cannot know it). A 0-row
   * UPDATE means the expected version is stale: a concurrent claim won and this
   * loser NEVER mints.
   */
  private async claimWithFencing(work: Work, expectedVersion: number): Promise<CasResult> {
    const rows = await this.conn.query<{ fencingToken: number }>(
      'UPDATE work SET description=$4, state=$5, deliverable=$6, evidence_refs=$7, outcome=$8, ' +
        'version=version+1, fencing_token=fencing_token+1 ' +
        'WHERE work_id=$1 AND company_id=$2 AND version=$3 ' +
        'RETURNING fencing_token AS "fencingToken"',
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
    );
    if (rows.length === 0) {
      // Stale claimant: a concurrent claim won between the read and this write.
      const current = await this.get(work.companyId, work.workId);
      return current === undefined
        ? { ok: false, reason: 'version-conflict' }
        : { ok: false, reason: 'version-conflict', current };
    }
    const minted = rows[0]?.fencingToken;
    // Fail-loud boundary guard (R4-001 hardening): the pool-level int8→number
    // parser (pg-connection) guarantees a numeric BIGINT on every query path;
    // anything else — missing, non-numeric, fractional, or negative — is a
    // connection-layer integrity violation and must never flow into a CasResult
    // as a mistyped token.
    if (typeof minted !== 'number' || !Number.isInteger(minted) || minted < 0) {
      throw new Error('claim mint returned no valid numeric fencing_token');
    }
    return {
      ok: true,
      value: { ...work, version: expectedVersion + 1, fencingToken: minted },
    };
  }

  /**
   * Terminal CAS (fencing): the claim-owned close adds `AND fencing_token = $N`
   * to the WHERE clause — the write lands ONLY when the caller still owns the
   * work (matching version AND claim token). A 0-row result is re-read to
   * classify the conflict: version advanced ⇒ version-conflict; version matched
   * but token stale ⇒ fencing-conflict (zombie writer). Never overwrites.
   */
  private async terminalWithFencing(
    work: Work,
    expectedVersion: number,
    expectedFencingToken: number,
  ): Promise<CasResult> {
    const result = (await this.conn.execute(
      'UPDATE work SET description=$4, state=$5, deliverable=$6, evidence_refs=$7, outcome=$8, ' +
        'version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3 AND fencing_token=$9',
      [
        work.workId,
        work.companyId,
        expectedVersion,
        work.description,
        work.state,
        work.deliverable !== undefined ? JSON.stringify(work.deliverable) : null,
        JSON.stringify(work.evidenceRefs),
        work.outcome !== undefined ? JSON.stringify(work.outcome) : null,
        expectedFencingToken,
      ],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      const current = await this.get(work.companyId, work.workId);
      if (current === undefined) return { ok: false, reason: 'version-conflict' };
      if (current.version !== expectedVersion) {
        // A concurrent transition advanced the version: classic race.
        return { ok: false, reason: 'version-conflict', current };
      }
      // Version still matches but the token does not: a zombie writer holding a
      // stale claim token tried to close a work owned by a NEWER token.
      return { ok: false, reason: 'fencing-conflict', current };
    }
    return { ok: true, value: { ...work, version: expectedVersion + 1 } };
  }

  /**
   * Tenant-scoped actionable read (work-lifecycle delta, design migration 009):
   * the company's Work in `ACTIONABLE_WORK_STATES` (currently only `accepted`),
   * oldest first (`ORDER BY id ASC` — the dispatch queue). `state = ANY($2)`
   * binds the declarative state set, so adding an actionable state never
   * touches this SQL. An empty `companyId` is rejected BEFORE SQL (fake
   * parity). Rows read from PG are UNTRUSTED bytes: every row passes
   * {@link parseWorkRow} (D7) and a corrupt row throws loudly.
   */
  async listActionableByCompany(companyId: string): Promise<readonly Work[]> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<
      Work & { deliverable: Deliverable | null; outcome: WorkOutcome | null }
    >(
      'SELECT work_id AS "workId", company_id AS "companyId", delegation_id AS "delegationId", proposer, description, ' +
        'state, version, fencing_token AS "fencingToken", deliverable, evidence_refs AS "evidenceRefs", outcome ' +
        'FROM work WHERE company_id = $1 AND state = ANY($2) ORDER BY id ASC',
      [companyId, ACTIONABLE_WORK_STATES],
    );
    return rows.map((row) => {
      const parsed = parseWorkRow(row);
      if (!parsed.ok) {
        throw new Error(`corrupt work row: ${parsed.reason}`);
      }
      return parsed.value;
    });
  }

  /**
   * Recovery designation discovery (supervisor-recovery design D2, migration
   * 011): the company's designated `in_progress` Work — the EXACT predicate
   * the partial index `idx_work_recovery_requested` (`WHERE recovery_requested
   * AND state='in_progress'`) covers, oldest first (`ORDER BY id ASC`) like the
   * actionable read. A designated Work that leaves `in_progress` (terminal
   * close) drops out of discovery by construction. An empty `companyId` is
   * rejected BEFORE SQL (fake parity). Rows read from PG are UNTRUSTED bytes:
   * every row passes {@link parseWorkRow} (D7) — the projected
   * `recovery_requested` marker is validated (boolean, default false) but never
   * becomes a `Work` field.
   */
  async listRecoveryRequestedByCompany(companyId: string): Promise<readonly Work[]> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<
      Work & { deliverable: Deliverable | null; outcome: WorkOutcome | null }
    >(
      'SELECT work_id AS "workId", company_id AS "companyId", delegation_id AS "delegationId", proposer, description, ' +
        'state, version, fencing_token AS "fencingToken", deliverable, evidence_refs AS "evidenceRefs", outcome, ' +
        'recovery_requested AS "recoveryRequested" ' +
        "FROM work WHERE company_id = $1 AND recovery_requested AND state = 'in_progress' ORDER BY id ASC",
      [companyId],
    );
    return rows.map((row) => {
      const parsed = parseWorkRow(row);
      if (!parsed.ok) {
        throw new Error(`corrupt work row: ${parsed.reason}`);
      }
      return parsed.value;
    });
  }

  /**
   * Recovery designation CAS (supervisor-recovery design D2): sets/clears the
   * `recovery_requested` marker with expected-version CAS — one atomic UPDATE
   * that bumps `version=version+1` and touches NOTHING else (`state` and
   * `fencing_token` stay UNCHANGED; no FencingDirective, no token mint). The
   * version bump is the fencing: a zombie worker holding the stale version
   * fails its terminal CAS once the stored version advances. `rowCount === 0`
   * ⇒ stale version, absent work, or wrong tenant ⇒ typed `version-conflict`
   * with the current work attached when the scoped read finds it — never an
   * overwrite. The marker is repository metadata: the returned `Work` never
   * carries it.
   */
  async setRecoveryRequest(
    companyId: string,
    workId: string,
    expectedVersion: number,
    requested: boolean,
  ): Promise<CasResult> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const result = (await this.conn.execute(
      'UPDATE work SET recovery_requested=$4, version=version+1 ' +
        'WHERE work_id=$1 AND company_id=$2 AND version=$3',
      [workId, companyId, expectedVersion, requested],
    )) as { rowCount?: number };
    if ((result.rowCount ?? 0) === 0) {
      const current = await this.get(companyId, workId);
      return current === undefined
        ? { ok: false, reason: 'version-conflict' }
        : { ok: false, reason: 'version-conflict', current };
    }
    // The CAS matched, so the row exists; re-read it to return the fresh Work
    // (the marker CAS carries no Work object of its own). A vanishing row is a
    // connection-layer integrity violation — fail loudly (claim-mint precedent,
    // R4-001 boundary guard) rather than fabricate a value.
    const current = await this.get(companyId, workId);
    if (current === undefined) {
      throw new Error(`work row vanished after designation CAS: ${companyId}/${workId}`);
    }
    return { ok: true, value: { ...current, version: expectedVersion + 1 } };
  }
}
