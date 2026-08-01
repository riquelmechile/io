import type { Delegation } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the Delegation repository port (design §PG
 * Adapter Pattern). Implements `DelegationRepository` over an injected, ASYNC
 * {@link DbConnection}. save() binds fields as `$1..$11` (JSONB objects passed
 * directly for authorityScope and budget; `company_id` is the tenant scope,
 * ADR-0002); get() is a SCOPED read: `WHERE company_id = $1 AND delegation_id
 * = $2` so a lookup under the wrong tenant returns no rows (not-found). An
 * empty `companyId` is rejected up front — PG/fake validation parity (task
 * 2.11, Slice A review follow-up). Methods are ASYNC (D1).
 */
export class PgDelegationRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(delegation: Delegation): Promise<Readonly<Delegation>> {
    if (!delegation.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    await this.conn.execute(
      'INSERT INTO delegation (delegation_id, company_id, delegator, delegate, authority_scope, budget, ' +
        'valid_from, valid_until, expected_outcome, state, created_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        delegation.delegationId,
        delegation.companyId,
        delegation.delegator,
        delegation.delegate,
        JSON.stringify(delegation.authorityScope),
        JSON.stringify(delegation.budget),
        delegation.validFrom,
        delegation.validUntil,
        delegation.expectedOutcome,
        delegation.state,
        Date.now(),
      ],
    );
    return delegation;
  }

  async get(companyId: string, delegationId: string): Promise<Delegation | undefined> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<Delegation>(
      'SELECT delegation_id AS "delegationId", company_id AS "companyId", delegator, delegate, ' +
        'authority_scope AS "authorityScope", budget, ' +
        'valid_from AS "validFrom", valid_until AS "validUntil", ' +
        'expected_outcome AS "expectedOutcome", state ' +
        'FROM delegation WHERE company_id = $1 AND delegation_id = $2',
      [companyId, delegationId],
    );
    return rows[0];
  }
}
