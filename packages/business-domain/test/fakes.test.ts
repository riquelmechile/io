import { describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '../src/types.js';
import {
  InMemoryBusinessReceiptRepository,
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryWorkRepository,
} from '../src/ports/fakes.js';

function sampleCompany(id: string): Company {
  return { companyId: id, purpose: `purpose-${id}` };
}

function sampleDelegation(id: string): Delegation {
  return {
    delegationId: id,
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

function sampleWork(id: string): Work {
  return {
    workId: id,
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'proposed',
    evidenceRefs: ['evid-a', 'evid-b'],
  };
}

function sampleReceipt(id: string): BusinessReceipt {
  return {
    receiptId: id,
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

describe('InMemoryCompanyRepository', () => {
  it('save → get round-trips all fields', async () => {
    const repo = new InMemoryCompanyRepository();
    const company = sampleCompany('acme');
    const saved = await repo.save(company);
    expect(saved).toEqual(company);
    const got = await repo.get('acme');
    expect(got).toEqual(company);
    expect(got?.companyId).toBe('acme');
    expect(got?.purpose).toBe('purpose-acme');
  });

  it('get(unknownId) returns undefined', async () => {
    const repo = new InMemoryCompanyRepository();
    expect(await repo.get('never')).toBeUndefined();
  });

  it('round-trips a second distinct company (triangulation)', async () => {
    const repo = new InMemoryCompanyRepository();
    await repo.save(sampleCompany('c1'));
    await repo.save(sampleCompany('c2'));
    expect(await repo.get('c1')).toEqual(sampleCompany('c1'));
    expect(await repo.get('c2')).toEqual(sampleCompany('c2'));
  });
});

describe('InMemoryDelegationRepository', () => {
  it('save → get round-trips all fields including nested objects', async () => {
    const repo = new InMemoryDelegationRepository();
    const delegation = sampleDelegation('del-99');
    await repo.save(delegation);
    const got = await repo.get('del-99');
    expect(got).toEqual(delegation);
    expect(got?.authorityScope).toEqual({ scope: 'finance', actions: ['approve', 'reject'] });
    expect(got?.budget).toEqual({ currency: 'USD', limit: 100000 });
    expect(got?.state).toBe('draft');
  });

  it('get(unknownId) returns undefined', async () => {
    const repo = new InMemoryDelegationRepository();
    expect(await repo.get('missing')).toBeUndefined();
  });
});

describe('InMemoryWorkRepository', () => {
  it('save → get round-trips all fields including evidenceRefs', async () => {
    const repo = new InMemoryWorkRepository();
    const work = sampleWork('work-42');
    await repo.save(work);
    const got = await repo.get('work-42');
    expect(got).toEqual(work);
    expect(got?.evidenceRefs).toEqual(['evid-a', 'evid-b']);
    expect(got?.state).toBe('proposed');
  });

  it('round-trips optional deliverable and outcome', async () => {
    const repo = new InMemoryWorkRepository();
    const work: Work = {
      ...sampleWork('work-full'),
      deliverable: { description: 'report.pdf', format: 'pdf' },
      outcome: { result: 'success', success: true },
    };
    await repo.save(work);
    const got = await repo.get('work-full');
    expect(got).toEqual(work);
    expect(got?.deliverable).toEqual({ description: 'report.pdf', format: 'pdf' });
    expect(got?.outcome).toEqual({ result: 'success', success: true });
  });

  it('get(unknownId) returns undefined', async () => {
    const repo = new InMemoryWorkRepository();
    expect(await repo.get('nope')).toBeUndefined();
  });
});

describe('InMemoryBusinessReceiptRepository', () => {
  it('save → get round-trips all fields', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-1');
    await repo.save(receipt);
    const got = await repo.get('r-1');
    expect(got).toEqual(receipt);
    expect(got?.terminalState).toBe('verified');
    expect(got?.evidenceRefs).toEqual(['evid-x']);
  });

  it('get(unknownId) returns undefined', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    expect(await repo.get('absent')).toBeUndefined();
  });

  it('first save succeeds, duplicate receiptId rejected', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-dup');
    await repo.save(receipt);
    const first = await repo.get('r-dup');
    expect(first).toEqual(receipt);

    const second = sampleReceipt('r-dup');
    await expect(repo.save(second)).rejects.toThrow();

    const unchanged = await repo.get('r-dup');
    expect(unchanged).toEqual(receipt);
  });
});
