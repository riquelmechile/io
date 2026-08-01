import { describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '@io/business-domain/src/index.js';

import { PgBusinessReceiptRepository } from '../src/business-receipt-adapter.js';
import { PgCompanyRepository } from '../src/company-adapter.js';
import { PgDelegationRepository } from '../src/delegation-adapter.js';
import { PgWorkRepository } from '../src/work-adapter.js';

import { InMemoryDbConnection } from './connection-fake.js';

/**
 * PG adapter unit tests for the four business-domain repositories (design §PG
 * Adapter Pattern). Uses {@link InMemoryDbConnection} which records SQL+params
 * and stores rows for round-trip. Asserts exact SQL shape ($N binding order,
 * AS "camelCase" aliases) and field-level equality on save→get round-trip,
 * including JSONB nested objects and nullable JSONB (null→undefined). Scoped
 * reads (ADR-0002) bind `company_id = $1 AND <id> = $2` so tenant isolation is
 * enforced at the SQL level; a wrong-company lookup returns no rows.
 */

function company(id: string): Company {
  return { companyId: id, purpose: `purpose-${id}` };
}

function delegation(id: string): Delegation {
  return {
    delegationId: id,
    companyId: 'acme',
    delegator: 'principal-1',
    delegate: 'principal-2',
    authorityScope: { scope: 'finance', actions: ['approve', 'reject'] },
    budget: { currency: 'USD', limit: 100000 },
    validFrom: 1700000000000,
    validUntil: 1800000000000,
    expectedOutcome: 'quarterly report filed',
    state: 'draft',
  };
}

function work(id: string): Work {
  return {
    workId: id,
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'proposed',
    version: 1,
    evidenceRefs: ['evid-a', 'evid-b'],
  };
}

function receipt(id: string): BusinessReceipt {
  return {
    receiptId: id,
    companyId: 'acme',
    workId: 'work-1',
    delegationId: 'del-1',
    actor: 'principal-2',
    policyHash: 'sha256:policy-hash',
    evidenceRefs: ['evid-x'],
    terminalState: 'verified',
    artifactHash: 'sha256:artifact-hash',
    issuedAt: 1750000000000,
  };
}

// ── Company adapter ──

describe('PgCompanyRepository', () => {
  describe('save() SQL shape', () => {
    it('emits INSERT INTO company with $1..$3 in field order', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgCompanyRepository(db);
      await repo.save(company('acme'));

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO company (company_id, purpose, created_at) VALUES ($1,$2,$3)',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('acme');
      expect(params[1]).toBe('purpose-acme');
      expect(typeof params[2]).toBe('number');
    });
  });

  describe('get() SQL shape', () => {
    it('emits SELECT with AS "camelCase" aliases WHERE company_id = $1', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgCompanyRepository(db);
      await repo.save(company('acme'));
      await repo.get('acme');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT company_id AS "companyId", purpose FROM company WHERE company_id = $1',
      );
      expect(selects[0]?.params).toEqual(['acme']);
    });
  });

  describe('round-trip', () => {
    it('save → get preserves all fields', async () => {
      const repo = new PgCompanyRepository(new InMemoryDbConnection());
      await repo.save(company('acme'));
      const got = await repo.get('acme');
      expect(got).toEqual(company('acme'));
    });

    it('get(unknown) returns undefined', async () => {
      const repo = new PgCompanyRepository(new InMemoryDbConnection());
      expect(await repo.get('missing')).toBeUndefined();
    });
  });
});

// ── Delegation adapter ──

describe('PgDelegationRepository', () => {
  describe('save() SQL shape', () => {
    it('emits INSERT INTO delegation with $1..$11 including company_id', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgDelegationRepository(db);
      const del = delegation('del-1');
      await repo.save(del);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO delegation (delegation_id, company_id, delegator, delegate, authority_scope, budget, ' +
          'valid_from, valid_until, expected_outcome, state, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('del-1');
      expect(params[1]).toBe('acme');
      expect(params[2]).toBe('principal-1');
      expect(params[3]).toBe('principal-2');
      expect(params[4]).toBe(JSON.stringify(del.authorityScope));
      expect(params[5]).toBe(JSON.stringify(del.budget));
      expect(params[6]).toBe(1700000000000);
      expect(params[7]).toBe(1800000000000);
      expect(params[8]).toBe('quarterly report filed');
      expect(params[9]).toBe('draft');
      expect(typeof params[10]).toBe('number');
    });
  });

  describe('get() SQL shape', () => {
    it('emits scoped SELECT with AS "camelCase" aliases WHERE company_id = $1 AND delegation_id = $2', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgDelegationRepository(db);
      await repo.save(delegation('del-1'));
      await repo.get('acme', 'del-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT delegation_id AS "delegationId", company_id AS "companyId", delegator, delegate, ' +
          'authority_scope AS "authorityScope", budget, ' +
          'valid_from AS "validFrom", valid_until AS "validUntil", ' +
          'expected_outcome AS "expectedOutcome", state ' +
          'FROM delegation WHERE company_id = $1 AND delegation_id = $2',
      );
      expect(selects[0]?.params).toEqual(['acme', 'del-1']);
    });
  });

  describe('round-trip + tenant scoping', () => {
    it('save → get preserves all fields including nested JSONB and companyId', async () => {
      const repo = new PgDelegationRepository(new InMemoryDbConnection());
      const del = delegation('del-1');
      await repo.save(del);
      const got = await repo.get('acme', 'del-1');
      expect(got).toEqual(del);
      expect(got?.companyId).toBe('acme');
      expect(got?.authorityScope).toEqual({ scope: 'finance', actions: ['approve', 'reject'] });
      expect(got?.budget).toEqual({ currency: 'USD', limit: 100000 });
    });

    it('scoped get for the wrong company returns undefined (tenant isolation)', async () => {
      const repo = new PgDelegationRepository(new InMemoryDbConnection());
      await repo.save(delegation('del-1'));
      expect(await repo.get('other-company', 'del-1')).toBeUndefined();
      expect(await repo.get('acme', 'del-1')).toEqual(delegation('del-1'));
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      const repo = new PgDelegationRepository(new InMemoryDbConnection());
      expect(await repo.get('acme', 'missing')).toBeUndefined();
    });
  });
});

// ── Work adapter ──

describe('PgWorkRepository', () => {
  describe('save() SQL shape', () => {
    it('emits INSERT INTO work with $1..$11 including company_id and version', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgWorkRepository(db);
      const w = work('work-1');
      await repo.save(w);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO work (work_id, company_id, delegation_id, proposer, description, state, version, ' +
          'deliverable, evidence_refs, outcome, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('work-1');
      expect(params[1]).toBe('acme');
      expect(params[2]).toBe('del-1');
      expect(params[3]).toBe('principal-2');
      expect(params[4]).toBe('execute the quarterly close');
      expect(params[5]).toBe('proposed');
      expect(params[6]).toBe(1);
      expect(params[7]).toBeNull();
      expect(params[8]).toBe(JSON.stringify(['evid-a', 'evid-b']));
      expect(params[9]).toBeNull();
      expect(typeof params[10]).toBe('number');
    });

    it('passes deliverable/outcome objects when present', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgWorkRepository(db);
      const w: Work = {
        ...work('work-full'),
        deliverable: { description: 'report.pdf', format: 'pdf' },
        outcome: { result: 'success', success: true },
      };
      await repo.save(w);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      const params = inserts[0]?.params ?? [];
      expect(params[7]).toBe(JSON.stringify({ description: 'report.pdf', format: 'pdf' }));
      expect(params[9]).toBe(JSON.stringify({ result: 'success', success: true }));
    });
  });

  describe('get() SQL shape', () => {
    it('emits scoped SELECT with AS "camelCase" aliases WHERE company_id = $1 AND work_id = $2', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgWorkRepository(db);
      await repo.save(work('work-1'));
      await repo.get('acme', 'work-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT work_id AS "workId", company_id AS "companyId", delegation_id AS "delegationId", proposer, description, ' +
          'state, version, deliverable, evidence_refs AS "evidenceRefs", outcome ' +
          'FROM work WHERE company_id = $1 AND work_id = $2',
      );
      expect(selects[0]?.params).toEqual(['acme', 'work-1']);
    });
  });

  describe('round-trip + tenant scoping', () => {
    it('save → get preserves all fields, nullable deliverable/outcome → undefined, version round-trips', async () => {
      const repo = new PgWorkRepository(new InMemoryDbConnection());
      const w = work('work-1');
      await repo.save(w);
      const got = await repo.get('acme', 'work-1');
      expect(got).toEqual(w);
      expect(got?.companyId).toBe('acme');
      expect(got?.version).toBe(1);
      expect(got?.deliverable).toBeUndefined();
      expect(got?.outcome).toBeUndefined();
      expect(got?.evidenceRefs).toEqual(['evid-a', 'evid-b']);
    });

    it('round-trips with deliverable and outcome present', async () => {
      const repo = new PgWorkRepository(new InMemoryDbConnection());
      const w: Work = {
        ...work('work-full'),
        deliverable: { description: 'report.pdf', format: 'pdf' },
        outcome: { result: 'success', success: true },
      };
      await repo.save(w);
      const got = await repo.get('acme', 'work-full');
      expect(got).toEqual(w);
      expect(got?.deliverable).toEqual({ description: 'report.pdf', format: 'pdf' });
      expect(got?.outcome).toEqual({ result: 'success', success: true });
    });

    it('scoped get for the wrong company returns undefined (tenant isolation)', async () => {
      const repo = new PgWorkRepository(new InMemoryDbConnection());
      await repo.save(work('work-1'));
      expect(await repo.get('other-company', 'work-1')).toBeUndefined();
      expect(await repo.get('acme', 'work-1')).toEqual(work('work-1'));
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      const repo = new PgWorkRepository(new InMemoryDbConnection());
      expect(await repo.get('acme', 'missing')).toBeUndefined();
    });
  });
});

// ── BusinessReceipt adapter ──

describe('PgBusinessReceiptRepository', () => {
  describe('save() SQL shape', () => {
    it('emits INSERT INTO business_receipt with $1..$11 including company_id', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgBusinessReceiptRepository(db);
      const r = receipt('r-1');
      await repo.save(r);

      const inserts = db.operations.filter((op) => op.sql.startsWith('INSERT'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.sql).toBe(
        'INSERT INTO business_receipt (receipt_id, company_id, work_id, delegation_id, actor, ' +
          'policy_hash, evidence_refs, terminal_state, artifact_hash, issued_at, created_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      );
      const params = inserts[0]?.params ?? [];
      expect(params[0]).toBe('r-1');
      expect(params[1]).toBe('acme');
      expect(params[2]).toBe('work-1');
      expect(params[3]).toBe('del-1');
      expect(params[4]).toBe('principal-2');
      expect(params[5]).toBe('sha256:policy-hash');
      expect(params[6]).toBe(JSON.stringify(['evid-x']));
      expect(params[7]).toBe('verified');
      expect(params[8]).toBe('sha256:artifact-hash');
      expect(params[9]).toBe(1750000000000);
      expect(typeof params[10]).toBe('number');
    });
  });

  describe('get() SQL shape', () => {
    it('emits scoped SELECT with AS "camelCase" aliases WHERE company_id = $1 AND receipt_id = $2', async () => {
      const db = new InMemoryDbConnection();
      const repo = new PgBusinessReceiptRepository(db);
      await repo.save(receipt('r-1'));
      await repo.get('acme', 'r-1');

      const selects = db.operations.filter((op) => op.sql.startsWith('SELECT'));
      expect(selects[0]?.sql).toBe(
        'SELECT receipt_id AS "receiptId", company_id AS "companyId", work_id AS "workId", ' +
          'delegation_id AS "delegationId", actor, policy_hash AS "policyHash", ' +
          'evidence_refs AS "evidenceRefs", terminal_state AS "terminalState", ' +
          'artifact_hash AS "artifactHash", issued_at AS "issuedAt" ' +
          'FROM business_receipt WHERE company_id = $1 AND receipt_id = $2',
      );
      expect(selects[0]?.params).toEqual(['acme', 'r-1']);
    });
  });

  describe('round-trip + tenant scoping', () => {
    it('save → get preserves all fields including companyId', async () => {
      const repo = new PgBusinessReceiptRepository(new InMemoryDbConnection());
      const r = receipt('r-1');
      await repo.save(r);
      const got = await repo.get('acme', 'r-1');
      expect(got).toEqual(r);
      expect(got?.companyId).toBe('acme');
      expect(got?.evidenceRefs).toEqual(['evid-x']);
      expect(got?.terminalState).toBe('verified');
    });

    it('scoped get for the wrong company returns undefined (tenant isolation)', async () => {
      const repo = new PgBusinessReceiptRepository(new InMemoryDbConnection());
      await repo.save(receipt('r-1'));
      expect(await repo.get('other-company', 'r-1')).toBeUndefined();
      expect(await repo.get('acme', 'r-1')).toEqual(receipt('r-1'));
    });

    it('get(companyId, unknownId) returns undefined', async () => {
      const repo = new PgBusinessReceiptRepository(new InMemoryDbConnection());
      expect(await repo.get('acme', 'missing')).toBeUndefined();
    });
  });
});
