import type { Company } from '@io/business-domain/src/index.js';

import type { DbConnection } from './connection.js';

/**
 * PostgreSQL-shaped adapter for the Company repository port (design §PG Adapter
 * Pattern). Implements `CompanyRepository` over an injected, ASYNC
 * {@link DbConnection}. save() binds fields as `$1..$3` (including adapter-
 * managed `created_at`); get() aliases columns so rows map straight to Company.
 * Methods are ASYNC (D1): they `await` the connection's execute/query.
 */
export class PgCompanyRepository {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  async save(company: Company): Promise<Readonly<Company>> {
    await this.conn.execute(
      'INSERT INTO company (company_id, purpose, created_at) VALUES ($1,$2,$3)',
      [company.companyId, company.purpose, Date.now()],
    );
    return company;
  }

  async get(companyId: string): Promise<Company | undefined> {
    const rows = await this.conn.query<Company>(
      'SELECT company_id AS "companyId", purpose FROM company WHERE company_id = $1',
      [companyId],
    );
    return rows[0];
  }
}
