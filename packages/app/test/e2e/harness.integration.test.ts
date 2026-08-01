import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PgBusinessReceiptRepository,
  PgCompanyRepository,
  PgDelegationRepository,
  PgIdempotencyJournalRepository,
  PgWorkRepository,
} from '@io/database/src/index.js';
import { PgDbConnection } from '@io/database/src/pg-connection.js';
import { FakeLlmClient } from '@io/llm-client/src/index.js';

import { FileDocumentSandbox } from '../../src/sandbox/file-document-sandbox.js';
import { createE2eHarness, e2eRequirePg, pgReachable } from './harness.js';
import type { E2eHarness } from './harness.js';

/**
 * E2E harness smoke (Slice C, C1): proves the harness BOOTS against the live
 * io_pg container, applies migrations 001–005 into an ISOLATED scratch
 * database (created/dropped per run — io_dev is never polluted), and wires the
 * FULL real stack: PgDbConnection + the real PG repository adapters + the real
 * terminal transaction + the worker cycle + FakeLlmClient (canned
 * create-document plan) + the shipped FileDocumentSandbox over a tmp root.
 *
 * Honest 3-mode guard (C6): SKIP locally when PG is unreachable and
 * IO_REQUIRE_PG is unset; RUN when PG is reachable; FAIL LOUDLY in CI
 * (IO_REQUIRE_PG=1) when PG is unreachable — `createE2eHarness` throws on an
 * unreachable server, a skipped integration hides defects.
 */
const reachable = await pgReachable();

describe.skipIf(!reachable && !e2eRequirePg)(
  'E2E harness (C1): boots vs live PG, applies 001–005, wires the real stack',
  () => {
    let harness: E2eHarness;

    beforeAll(async () => {
      harness = await createE2eHarness({ databaseName: 'io_dev_e2e_smoke' });
    });

    afterAll(async () => {
      await harness?.close();
    });

    it('connects and applies migrations 001–005 (005 three-value journal CHECK present)', async () => {
      // 005 lands the three-value CHECK: 'aborted_retryable' is a valid status.
      // A two-value (004-era) CHECK would reject this row.
      await harness.conn.execute(
        'INSERT INTO idempotency_journal (company_id, idempotency_key, request_hash, attempt_id, status, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6)',
        ['smoke-co', 'smoke-key', 'smoke-hash', 'smoke-attempt', 'aborted_retryable', Date.now()],
      );
      const rows = await harness.conn.query<{ status: string }>(
        'SELECT status FROM idempotency_journal WHERE attempt_id = $1',
        ['smoke-attempt'],
      );
      expect(rows).toEqual([{ status: 'aborted_retryable' }]);
      await harness.conn.execute('DELETE FROM idempotency_journal WHERE attempt_id = $1', [
        'smoke-attempt',
      ]);
    });

    it('wires the REAL adapters + FakeLlmClient + shipped FileDocumentSandbox (no fakes)', () => {
      // The scratch connection is the PLAIN PgDbConnection pool — the finalize
      // twin's T1 gets its own tx-scoped repos from the `repositories` factory
      // (mirrors completeWorkAtomically), so NO transaction-routing decorator is
      // involved: the atomic close is by construction, not by routing.
      expect(harness.conn).toBeInstanceOf(PgDbConnection);
      expect(harness.deps.work).toBeInstanceOf(PgWorkRepository);
      expect(harness.deps.delegation).toBeInstanceOf(PgDelegationRepository);
      expect(harness.deps.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(harness.deps.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
      expect(harness.deps.sandbox).toBeInstanceOf(FileDocumentSandbox);
      expect(harness.deps.llm).toBeInstanceOf(FakeLlmClient);
      expect(harness.company).toBeInstanceOf(PgCompanyRepository);
      // The atomicity wiring: `repositories(conn)` binds FRESH PG adapters to the
      // connection it is given — T1 hands it the transaction-scoped client, so
      // CAS + receipt + journal.complete share ONE real transaction with no
      // statement routing (the Slice C correction).
      const conn = harness.deps.connection;
      const txRepos = conn === undefined ? undefined : harness.deps.repositories?.(conn);
      expect(txRepos?.work).toBeInstanceOf(PgWorkRepository);
      expect(txRepos?.receipts).toBeInstanceOf(PgBusinessReceiptRepository);
      expect(txRepos?.journal).toBeInstanceOf(PgIdempotencyJournalRepository);
    });

    it('round-trips a trivial operation through real PG (company save → get)', async () => {
      const company = { companyId: 'smoke-company', purpose: 'E2E smoke round-trip' };
      await harness.company.save(company);
      expect(await harness.company.get(company.companyId)).toEqual(company);
    });
  },
);
