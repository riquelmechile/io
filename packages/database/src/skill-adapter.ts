import type { Skill } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';
import { parseSkillRow } from './row-guards.js';

/**
 * PostgreSQL-shaped adapter for the Skill repository port (design §007, R6
 * insert-only persistence). Implements `SkillRepository` over an injected,
 * ASYNC {@link DbConnection}. Skills are IMMUTABLE versioned facts
 * (append-only registry, R2): `save` INSERTs a NEW version row and there is
 * NO update/delete/overwrite method — the port and the adapter surface are
 * exactly `save` + `get` + `listByCompany`.
 *
 * `company_id` (tenant scope, ADR-0002/R7) is written on save and every read
 * is SCOPED: `get` and `listByCompany` are `WHERE company_id = $1` so a read
 * under one tenant can never return another tenant's Skills. No-overwrite is
 * enforced by the 007 UNIQUE index `uq_skill_company_skill_version`: a
 * duplicate `(company_id, skill_id, version)` is REJECTED at the database
 * level — no upsert — and the ORIGINAL row is preserved (R2).
 *
 * Like the receipt/event adapters, the same construction works for a pool
 * connection OR a transaction-scoped connection (`constructor(conn:
 * DbConnection)`), so `save` can commit atomically with surrounding work when
 * bound inside `connection.transaction`. Rows read from PG are UNTRUSTED
 * bytes: every row passes {@link parseSkillRow} (D7) and a corrupt row throws
 * loudly. Methods are ASYNC (D1).
 */
export class PgSkillRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(skill: Skill): Promise<Readonly<Skill>> {
    if (!skill.companyId) {
      throw new Error('a non-empty companyId is required');
    }
    await this.conn.execute(
      'INSERT INTO skill (skill_id, company_id, name, version, body, scope, state, ' +
        'created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        skill.skillId,
        skill.companyId,
        skill.name,
        skill.version,
        skill.body,
        JSON.stringify(skill.scope),
        skill.state,
        skill.createdAt,
        skill.updatedAt,
      ],
    );
    return skill;
  }

  async get(companyId: string, skillId: string): Promise<Skill | undefined> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<Skill>(
      'SELECT skill_id AS "skillId", company_id AS "companyId", name, version, body, ' +
        'scope, state, created_at AS "createdAt", updated_at AS "updatedAt" ' +
        'FROM skill WHERE company_id = $1 AND skill_id = $2 ORDER BY version DESC LIMIT 1',
      [companyId, skillId],
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    const parsed = parseSkillRow(row);
    if (!parsed.ok) {
      throw new Error(`corrupt skill row: ${parsed.reason}`);
    }
    return parsed.value;
  }

  async listByCompany(companyId: string): Promise<readonly Skill[]> {
    if (!companyId) {
      throw new Error('a non-empty companyId is required');
    }
    const rows = await this.conn.query<Skill>(
      'SELECT skill_id AS "skillId", company_id AS "companyId", name, version, body, ' +
        'scope, state, created_at AS "createdAt", updated_at AS "updatedAt" ' +
        'FROM skill WHERE company_id = $1 ORDER BY skill_id, version',
      [companyId],
    );
    // Rows read from PG are untrusted bytes: validate at runtime before use
    // (D7). A corrupt row is an integrity violation — fail loudly.
    return rows.map((row) => {
      const parsed = parseSkillRow(row);
      if (!parsed.ok) {
        throw new Error(`corrupt skill row: ${parsed.reason}`);
      }
      return parsed.value;
    });
  }
}
