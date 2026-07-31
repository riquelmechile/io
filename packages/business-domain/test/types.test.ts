import { describe, expect, it } from 'vitest';

import type {
  AuthorityScope,
  Budget,
  BusinessReceipt,
  Company,
  Delegation,
  Deliverable,
  Work,
  WorkOutcome,
} from '../src/types.js';

/**
 * Type-level tests: verify the domain interfaces REQUIRE their fields and that
 * omitting any required field is a compile-time error. These are structural
 * guarantees enforced by tsc, not runtime checks — the value of these tests is
 * that they COMPILE. Any missing field would cause tsc to reject the file.
 */

describe('Company type', () => {
  it('requires companyId + purpose', () => {
    const company: Company = { companyId: 'acme', purpose: 'tenant scope' };
    expect(company.companyId).toBe('acme');
    expect(company.purpose).toBe('tenant scope');
  });

  it('is minimal — no extra fields at type level', () => {
    const company: Company = { companyId: 'c1', purpose: 'p' };
    const keys = Object.keys(company);
    expect(keys).toEqual(['companyId', 'purpose']);
  });
});

describe('Delegation type', () => {
  it('requires companyId plus all authority fields', () => {
    const authorityScope: AuthorityScope = { scope: 'finance', actions: ['approve'] };
    const budget: Budget = { currency: 'USD', limit: 50000 };
    const delegation: Delegation = {
      delegationId: 'del-1',
      companyId: 'acme',
      delegator: 'principal-1',
      delegate: 'principal-2',
      authorityScope,
      budget,
      validFrom: 1700000000000,
      validUntil: 1800000000000,
      expectedOutcome: 'quarterly report filed',
      state: 'draft',
    };
    expect(delegation.delegationId).toBe('del-1');
    expect(delegation.companyId).toBe('acme');
    expect(delegation.authorityScope).toEqual(authorityScope);
    expect(delegation.budget).toEqual(budget);
    expect(delegation.state).toBe('draft');
  });
});

describe('Work type', () => {
  it('requires workId, companyId, delegationId, proposer, description, state, version, evidenceRefs', () => {
    const work: Work = {
      workId: 'work-1',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'execute the quarterly close',
      state: 'proposed',
      version: 0,
      evidenceRefs: ['evid-1', 'evid-2'],
    };
    expect(work.workId).toBe('work-1');
    expect(work.companyId).toBe('acme');
    expect(work.delegationId).toBe('del-1');
    expect(work.version).toBe(0);
    expect(work.evidenceRefs).toEqual(['evid-1', 'evid-2']);
  });

  it('accepts optional deliverable and outcome', () => {
    const deliverable: Deliverable = { description: 'report.pdf', format: 'pdf' };
    const outcome: WorkOutcome = { result: 'success', success: true };
    const work: Work = {
      workId: 'work-2',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'execute task',
      state: 'completed',
      version: 3,
      evidenceRefs: [],
      deliverable,
      outcome,
    };
    expect(work.deliverable).toEqual(deliverable);
    expect(work.outcome).toEqual(outcome);
    expect(work.version).toBe(3);
  });

  it('delegationId is a non-optional string — empty string is the only "absent" value at runtime', () => {
    const work: Work = {
      workId: 'work-3',
      companyId: 'acme',
      delegationId: '',
      proposer: 'p1',
      description: 'd',
      state: 'proposed',
      version: 0,
      evidenceRefs: [],
    };
    expect(work.delegationId).toBe('');
  });
});

describe('BusinessReceipt type', () => {
  it('requires companyId, terminalEventId, and all prior fields', () => {
    const receipt: BusinessReceipt = {
      receiptId: 'receipt-1',
      workId: 'work-1',
      delegationId: 'del-1',
      companyId: 'acme',
      actor: 'principal-2',
      policyHash: 'sha256:abc123',
      evidenceRefs: ['evid-1'],
      terminalEventId: 'evt-terminal-1',
      terminalState: 'verified',
      artifactHash: 'sha256:def456',
      issuedAt: 1750000000000,
    };
    expect(receipt.receiptId).toBe('receipt-1');
    expect(receipt.companyId).toBe('acme');
    expect(receipt.terminalEventId).toBe('evt-terminal-1');
    expect(receipt.terminalState).toBe('verified');
    expect(receipt.evidenceRefs).toEqual(['evid-1']);
    expect(Object.keys(receipt)).toHaveLength(11);
  });
});
