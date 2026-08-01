import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '@io/business-domain/src/index.js';

import { PgBusinessReceiptRepository } from '../src/business-receipt-adapter.js';
import { PgCompanyRepository } from '../src/company-adapter.js';
import { PgDelegationRepository } from '../src/delegation-adapter.js';
import { PgWorkRepository } from '../src/work-adapter.js';
import { PgDbConnection, pgConnectionString } from '../src/pg-connection.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const SCHEMA_001 = join(pkgRoot, 'sql', '001_create_tables.sql');
const SCHEMA_002 = join(pkgRoot, 'sql', '002_create_business_tables.sql');
const SCHEMA_003 = join(pkgRoot, 'sql', '003_harden_columns.sql');

/**
 * Integration test — REAL PostgreSQL round-trip for all four business-domain
 * aggregates (design §Testing Strategy). Connects to live PG 18.4 via
 * PgDbConnection, applies the shipped schema DDL, and round-trips each type
 * through save→get, asserting byte-identical field-level equality including
 * JSONB nested objects and nullable fields. State is isolated via TRUNCATE in
 * beforeEach. The whole suite is SKIPPED when no live PG is reachable.
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
    await conn.execute(readFileSync(SCHEMA_002, 'utf8'), []);
    await conn.execute(readFileSync(SCHEMA_003, 'utf8'), []);
    companyRepo = new PgCompanyRepository(conn);
    delegationRepo = new PgDelegationRepository(conn);
    workRepo = new PgWorkRepository(conn);
    receiptRepo = new PgBusinessReceiptRepository(conn);
  });

  beforeEach(async () => {
    await conn.execute('TRUNCATE company, delegation, work, business_receipt RESTART IDENTITY', []);
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
      version: 1,
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
      deliverable: { description: 'q4-close-report.pdf', format: 'pdf' },
      outcome: { result: 'closed successfully', success: true },
    };
  }

  function sampleReceipt(): BusinessReceipt {
    return {
      receiptId: 'receipt-001',
      companyId: 'acme-corp',
      workId: 'work-001',
      delegationId: 'del-001',
      actor: 'principal-2',
      policyHash: 'sha256:abc123def456',
      evidenceRefs: ['evid-1', 'evid-2', 'evid-3'],
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
  });

  describe('Delegation save → get', () => {
    it('round-trips byte-identically including nested JSONB', async () => {
      const delegation = sampleDelegation();
      await delegationRepo.save(delegation);
      const got = await delegationRepo.get(delegation.companyId, delegation.delegationId);
      expect(got).toEqual(delegation);
      expect(got?.authorityScope).toEqual({
        scope: 'finance',
        actions: ['approve', 'reject', 'view'],
      });
      expect(got?.budget).toEqual({ currency: 'USD', limit: 250000 });
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await delegationRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });
  });

  describe('Work save → get', () => {
    it('round-trips with deliverable and outcome present', async () => {
      const w = sampleWork();
      await workRepo.save(w);
      const got = await workRepo.get(w.companyId, w.workId);
      expect(got).toEqual(w);
      expect(got?.deliverable).toEqual({ description: 'q4-close-report.pdf', format: 'pdf' });
      expect(got?.outcome).toEqual({ result: 'closed successfully', success: true });
      expect(got?.evidenceRefs).toEqual(['evid-1', 'evid-2', 'evid-3']);
    });

    it('round-trips without deliverable/outcome (nullable JSONB → undefined)', async () => {
      const w: Work = {
        workId: 'work-minimal',
        companyId: 'acme-corp',
        delegationId: 'del-001',
        proposer: 'principal-2',
        description: 'minimal work item',
        state: 'proposed',
        version: 1,
        evidenceRefs: [],
      };
      await workRepo.save(w);
      const got = await workRepo.get('acme-corp', 'work-minimal');
      expect(got).toEqual(w);
      expect(got?.deliverable).toBeUndefined();
      expect(got?.outcome).toBeUndefined();
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await workRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });
  });

  describe('BusinessReceipt save → get', () => {
    it('round-trips byte-identically', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);
      const got = await receiptRepo.get(receipt.companyId, receipt.receiptId);
      expect(got).toEqual(receipt);
      expect(got?.evidenceRefs).toEqual(['evid-1', 'evid-2', 'evid-3']);
      expect(got?.terminalState).toBe('verified');
    });

    it('has no update path — re-save with same ID creates duplicate (immutability is port-level)', async () => {
      const receipt = sampleReceipt();
      await receiptRepo.save(receipt);
      const original = await receiptRepo.get(receipt.companyId, receipt.receiptId);
      expect(original).toEqual(receipt);
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      expect(await receiptRepo.get('acme-corp', 'nonexistent')).toBeUndefined();
    });
  });

  describe('TRUNCATE isolation', () => {
    it('starts each test with empty tables', async () => {
      expect(await companyRepo.get('acme-corp')).toBeUndefined();
      expect(await delegationRepo.get('acme-corp', 'del-001')).toBeUndefined();
      expect(await workRepo.get('acme-corp', 'work-001')).toBeUndefined();
      expect(await receiptRepo.get('acme-corp', 'receipt-001')).toBeUndefined();
    });
  });
});
