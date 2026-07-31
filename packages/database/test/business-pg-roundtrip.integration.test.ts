import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '@io/business-domain/src/index.js';
import { VersionConflictError } from '@io/business-domain/src/index.js';

import { PgBusinessReceiptRepository } from '../src/business-receipt-adapter.js';
import { PgCompanyRepository } from '../src/company-adapter.js';
import { PgDelegationRepository } from '../src/delegation-adapter.js';
import { PgWorkRepository } from '../src/work-adapter.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_001 = join(pkgRoot, 'sql', '001_create_tables.sql');
const SCHEMA_002 = join(pkgRoot, 'sql', '002_create_business_tables.sql');
const SCHEMA_003 = join(pkgRoot, 'sql', '003_harden_business_tables.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for all four business-domain
 * aggregates. Connects to live PG 18.4 via PgDbConnection. SKIPPED when no
 * live PG is reachable.
 */

async function pgReachable(): Promise<boolean> {
  const probe = new PgDbConnection(pgConnectionString());
  try {
    await probe.execute('SELECT 1', []);
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const reachable = await pgReachable();

describe.skipIf(!reachable)('integration: real PG business-domain round-trip', () => {
  let conn!: PgDbConnection;
  let companyRepo!: PgCompanyRepository;
  let delegationRepo!: PgDelegationRepository;
  let workRepo!: PgWorkRepository;
  let receiptRepo!: PgBusinessReceiptRepository;

  beforeAll(async () => {
    conn = new PgDbConnection(pgConnectionString());
    await conn.execute(readFileSync(SCHEMA_001, 'utf8'), []);
    // Drop and recreate business tables so UNIQUE/new columns from 002 apply cleanly
    await conn.execute(
      'DROP TABLE IF EXISTS idempotency_journal, business_receipt, work, delegation, company CASCADE',
      [],
    );
    await conn.execute(readFileSync(SCHEMA_002, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_003, 'utf8'), []);
    companyRepo = new PgCompanyRepository(conn);
    delegationRepo = new PgDelegationRepository(conn);
    workRepo = new PgWorkRepository(conn);
    receiptRepo = new PgBusinessReceiptRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute(
      'TRUNCATE company, delegation, work, business_receipt, idempotency_journal RESTART IDENTITY',
      [],
    );
  });

  afterAll(async () => {
    await conn?.close();
  });

  function sampleCompany(): Company {
    return { companyId: 'acme-corp', purpose: 'global tenant scope' };
  }

  function sampleDelegation(): Delegation {
    return {
      delegationId: 'del-001',
      companyId: 'acme-corp',
      delegator: 'principal-1',
      delegate: 'principal-2',
      authorityScope: { scope: 'finance', actions: ['approve', 'reject', 'view'] },
      budget: { currency: 'USD', limit: 250000 },
      validFrom: 1700000000000,
      validUntil: 1800000000000,
      expectedOutcome: 'quarterly report filed and approved',
      state: 'active',
    };
  }

  function sampleWork(): Work {
    return {
      workId: 'work-001',
      companyId: 'acme-corp',
      delegationId: 'del-001',
      proposer: 'principal-2',
      description: 'execute the Q4 financial close',
      state: 'completed',
      version: 0,
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
      deliverable: { description: 'q4-close-report.pdf', format: 'pdf' },
      outcome: { result: 'closed successfully', success: true },
    };
  }

  function sampleReceipt(): BusinessReceipt {
    return {
      receiptId: 'receipt-001',
      workId: 'work-001',
      delegationId: 'del-001',
      companyId: 'acme-corp',
      actor: 'principal-2',
      policyHash: 'sha256:abc123def456',
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
      terminalEventId: 'evt-terminal-001',
      terminalState: 'verified',
      artifactHash: 'sha256:artifact-hash-789',
      issuedAt: 1750000000000,
    };
  }

  describe('Company save → get', () => {
    it('round-trips byte-identically', async () => {
      const company = sampleCompany();
      await companyRepo.save(company);
      const got = await companyRepo.get(company.companyId);
      expect(got).toEqual(company);
    });

    it('get(unknown) returns undefined', async () => {
      expect(await companyRepo.get('nonexistent')).toBeUndefined();
    });

    it('duplicate company_id rejected by UNIQUE', async () => {
      await companyRepo.save(sampleCompany());
      await expect(companyRepo.save(sampleCompany())).rejects.toThrow();
    });
  });

  describe('Delegation save → get', () => {
    it('round-trips byte-identically including nested JSONB', async () => {
      const delegation = sampleDelegation();
      await delegationRepo.save(delegation);
      const got = await delegationRepo.get(delegation.delegationId, 'acme-corp');
      expect(got).toEqual(delegation);
    });

    it('cross-company get returns undefined', async () => {
      await delegationRepo.save(sampleDelegation());
      expect(await delegationRepo.get('del-001', 'other')).toBeUndefined();
    });
  });

  describe('Work save → get', () => {
    it('round-trips with deliverable and outcome present', async () => {
      const w = sampleWork();
      await workRepo.save(w);
      const got = await workRepo.get(w.workId, 'acme-corp');
      expect(got).toEqual(w);
      expect(got?.version).toBe(0);
    });

    it('round-trips without deliverable/outcome (nullable JSONB → undefined)', async () => {
      const w: Work = {
        workId: 'work-minimal',
        companyId: 'acme-corp',
        delegationId: 'del-001',
        proposer: 'principal-2',
        description: 'minimal work item',
        state: 'proposed',
        version: 0,
        evidenceRefs: [],
      };
      await workRepo.save(w);
      const got = await workRepo.get('work-minimal', 'acme-corp');
      expect(got).toEqual(w);
      expect(got?.deliverable).toBeUndefined();
      expect(got?.outcome).toBeUndefined();
    });

    it('updateWithVersion CAS — matching version wins, stale conflicts', async () => {
      await workRepo.save(sampleWork());
      const a = await workRepo.updateWithVersion({ ...sampleWork(), state: 'verified' }, 0);
      expect(a.version).toBe(1);
      await expect(
        workRepo.updateWithVersion({ ...sampleWork(), state: 'rejected' }, 0),
      ).rejects.toBeInstanceOf(VersionConflictError);
      const got = await workRepo.get('work-001', 'acme-corp');
      expect(got?.version).toBe(1);
      expect(got?.state).toBe('verified');
    });
  });

  describe('BusinessReceipt save → get', () => {
    it('round-trips byte-identically', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);
      const got = await receiptRepo.get(receipt.receiptId, 'acme-corp');
      expect(got).toEqual(receipt);
      expect(got?.terminalEventId).toBe('evt-terminal-001');
    });

    it('duplicate (work_id, terminal_event_id) rejected', async () => {
      await receiptRepo.save(sampleReceipt());
      await expect(
        receiptRepo.save({
          ...sampleReceipt(),
          receiptId: 'receipt-002',
        }),
      ).rejects.toThrow();
    });
  });

  describe('transaction commit/rollback', () => {
    it('commit persists both writes', async () => {
      await conn.transaction(async (tx) => {
        const companies = new PgCompanyRepository(tx);
        await companies.save({ companyId: 'c-tx-1', purpose: 'a' });
        await companies.save({ companyId: 'c-tx-2', purpose: 'b' });
      });
      expect(await companyRepo.get('c-tx-1')).toEqual({ companyId: 'c-tx-1', purpose: 'a' });
      expect(await companyRepo.get('c-tx-2')).toEqual({ companyId: 'c-tx-2', purpose: 'b' });
    });

    it('rollback discards writes on throw', async () => {
      await expect(
        conn.transaction(async (tx) => {
          const companies = new PgCompanyRepository(tx);
          await companies.save({ companyId: 'c-roll', purpose: 'x' });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(await companyRepo.get('c-roll')).toBeUndefined();
    });
  });

  describe('TRUNCATE isolation', () => {
    it('starts each test with empty tables', async () => {
      expect(await companyRepo.get('acme-corp')).toBeUndefined();
      expect(await delegationRepo.get('del-001', 'acme-corp')).toBeUndefined();
      expect(await workRepo.get('work-001', 'acme-corp')).toBeUndefined();
      expect(await receiptRepo.get('receipt-001', 'acme-corp')).toBeUndefined();
    });
  });
});
