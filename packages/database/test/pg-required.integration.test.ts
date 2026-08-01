import { describe, expect, it } from 'vitest';

import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

/**
 * CI-oriented PostgreSQL reachability guard (task 3.9, hygiene).
 *
 * The integration suites (business-pg-roundtrip, pg-roundtrip) SKIP when no PG
 * is reachable (`describe.skipIf(!reachable)`) — correct for LOCAL development,
 * where a developer may not have the io_pg container running. But a SILENT skip
 * in CI would let the entire database slice pass without ever exercising live
 * PostgreSQL. This guard flips that: when the CI marker `IO_REQUIRE_PG=1` is
 * set, an unreachable PG FAILS the suite LOUDLY instead of skipping. When the
 * marker is absent (local dev), it skips harmlessly and local workflows are
 * unchanged.
 *
 * CI wiring: .github/workflows/ci.yml runs a postgres:18 service container on
 * the runner and sets `IO_REQUIRE_PG: '1'` on the `pnpm run check` job — so CI
 * always exercises the PG integration tests and fails loudly if the database is
 * unavailable, never silently green.
 */
const requirePg = process.env.IO_REQUIRE_PG === '1';

describe.skipIf(!requirePg)(
  'CI: live PostgreSQL integration is REQUIRED (fails loudly, never silently skips)',
  () => {
    it('reaches the configured PostgreSQL server (pgConnectionString / DATABASE_URL)', async () => {
      const probe = new PgDbConnection(pgConnectionString());
      try {
        // The real assertion: this resolves. An unreachable server rejects here
        // and fails this test — the suite cannot silently skip under CI.
        await expect(probe.execute('SELECT 1', [])).resolves.toBeDefined();
      } finally {
        await probe.close();
      }
    });
  },
);
