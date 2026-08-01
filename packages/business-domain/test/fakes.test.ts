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

function sampleDelegation(id: string, companyId = 'acme'): Delegation {
  return {
    delegationId: id,
    companyId,
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

function sampleWork(id: string, companyId = 'acme'): Work {
  return {
    workId: id,
    companyId,
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'proposed',
    version: 1,
    evidenceRefs: ['evid-a', 'evid-b'],
  };
}

function sampleReceipt(id: string, companyId = 'acme'): BusinessReceipt {
  return {
    receiptId: id,
    companyId,
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

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryCompanyRepository();
    await expect(repo.save(sampleCompany(''))).rejects.toThrow(/companyId/i);
  });

  it('rejects get with an empty companyId', async () => {
    const repo = new InMemoryCompanyRepository();
    await expect(repo.get('')).rejects.toThrow(/companyId/i);
  });
});

describe('InMemoryDelegationRepository', () => {
  it('save → get round-trips all fields including nested objects and companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    const delegation = sampleDelegation('del-99');
    await repo.save(delegation);
    const got = await repo.get('acme', 'del-99');
    expect(got).toEqual(delegation);
    expect(got?.companyId).toBe('acme');
    expect(got?.authorityScope).toEqual({ scope: 'finance', actions: ['approve', 'reject'] });
    expect(got?.budget).toEqual({ currency: 'USD', limit: 100000 });
    expect(got?.state).toBe('draft');
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryDelegationRepository();
    expect(await repo.get('acme', 'missing')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryDelegationRepository();
    await repo.save(sampleDelegation('del-1', 'company-a'));
    expect(await repo.get('company-b', 'del-1')).toBeUndefined();
    expect(await repo.get('company-a', 'del-1')).toEqual(sampleDelegation('del-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    await expect(repo.save(sampleDelegation('del-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    await expect(repo.get('', 'del-1')).rejects.toThrow(/companyId/i);
  });
});

describe('InMemoryWorkRepository', () => {
  it('save → get round-trips all fields including evidenceRefs, companyId, and version', async () => {
    const repo = new InMemoryWorkRepository();
    const work = sampleWork('work-42');
    await repo.save(work);
    const got = await repo.get('acme', 'work-42');
    expect(got).toEqual(work);
    expect(got?.companyId).toBe('acme');
    expect(got?.evidenceRefs).toEqual(['evid-a', 'evid-b']);
    expect(got?.state).toBe('proposed');
  });

  it('version initializes to 1 on creation and round-trips', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(sampleWork('work-ver'));
    expect((await repo.get('acme', 'work-ver'))?.version).toBe(1);
  });

  it('round-trips optional deliverable and outcome', async () => {
    const repo = new InMemoryWorkRepository();
    const work: Work = {
      ...sampleWork('work-full'),
      deliverable: { description: 'report.pdf', format: 'pdf' },
      outcome: { result: 'success', success: true },
    };
    await repo.save(work);
    const got = await repo.get('acme', 'work-full');
    expect(got).toEqual(work);
    expect(got?.deliverable).toEqual({ description: 'report.pdf', format: 'pdf' });
    expect(got?.outcome).toEqual({ result: 'success', success: true });
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryWorkRepository();
    expect(await repo.get('acme', 'nope')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(sampleWork('work-1', 'company-a'));
    expect(await repo.get('company-b', 'work-1')).toBeUndefined();
    expect(await repo.get('company-a', 'work-1')).toEqual(sampleWork('work-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryWorkRepository();
    await expect(repo.save(sampleWork('work-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryWorkRepository();
    await expect(repo.get('', 'work-1')).rejects.toThrow(/companyId/i);
  });
});

describe('InMemoryBusinessReceiptRepository', () => {
  it('save → get round-trips all fields including companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-1');
    await repo.save(receipt);
    const got = await repo.get('acme', 'r-1');
    expect(got).toEqual(receipt);
    expect(got?.companyId).toBe('acme');
    expect(got?.terminalState).toBe('verified');
    expect(got?.evidenceRefs).toEqual(['evid-x']);
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    expect(await repo.get('acme', 'absent')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await repo.save(sampleReceipt('r-1', 'company-a'));
    expect(await repo.get('company-b', 'r-1')).toBeUndefined();
    expect(await repo.get('company-a', 'r-1')).toEqual(sampleReceipt('r-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await expect(repo.save(sampleReceipt('r-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await expect(repo.get('', 'r-1')).rejects.toThrow(/companyId/i);
  });

  it('first save succeeds, duplicate receiptId rejected', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-dup');
    await repo.save(receipt);
    const first = await repo.get('acme', 'r-dup');
    expect(first).toEqual(receipt);

    const second = sampleReceipt('r-dup');
    await expect(repo.save(second)).rejects.toThrow();

    const unchanged = await repo.get('acme', 'r-dup');
    expect(unchanged).toEqual(receipt);
  });
});
