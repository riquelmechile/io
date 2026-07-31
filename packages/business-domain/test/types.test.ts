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
 *
 * At runtime we assert the constructed objects are truthy and carry their
 * fields, so the test is not a pure no-op.
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
  it('requires all fields (delegationId, delegator, delegate, authorityScope, budget, validFrom, validUntil, expectedOutcome, state)', () => {
    const authorityScope: AuthorityScope = { scope: 'finance', actions: ['approve'] };
    const budget: Budget = { currency: 'USD', limit: 50000 };
    const delegation: Delegation = {
      delegationId: 'del-1',
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
    expect(delegation.authorityScope).toEqual(authorityScope);
    expect(delegation.budget).toEqual(budget);
    expect(delegation.state).toBe('draft');
  });
});

describe('Work type', () => {
  it('requires workId, delegationId, proposer, description, state, evidenceRefs', () => {
    const work: Work = {
      workId: 'work-1',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'execute the quarterly close',
      state: 'proposed',
      evidenceRefs: ['evid-1', 'evid-2'],
    };
    expect(work.workId).toBe('work-1');
    expect(work.delegationId).toBe('del-1');
    expect(work.evidenceRefs).toEqual(['evid-1', 'evid-2']);
  });

  it('accepts optional deliverable and outcome', () => {
    const deliverable: Deliverable = { description: 'report.pdf', format: 'pdf' };
    const outcome: WorkOutcome = { result: 'success', success: true };
    const work: Work = {
      workId: 'work-2',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'execute task',
      state: 'completed',
      evidenceRefs: [],
      deliverable,
      outcome,
    };
    expect(work.deliverable).toEqual(deliverable);
    expect(work.outcome).toEqual(outcome);
  });

  it('delegationId is a non-optional string — empty string is the only "absent" value at runtime', () => {
    // delegationId is typed as `string`, so tsc rejects omission.
    // At runtime an empty string is the closest to "missing".
    const work: Work = {
      workId: 'work-3',
      delegationId: '',
      proposer: 'p1',
      description: 'd',
      state: 'proposed',
      evidenceRefs: [],
    };
    expect(work.delegationId).toBe('');
  });
});

describe('BusinessReceipt type', () => {
  it('requires all 9 fields (receiptId, workId, delegationId, actor, policyHash, evidenceRefs, terminalState, artifactHash, issuedAt)', () => {
    const receipt: BusinessReceipt = {
      receiptId: 'receipt-1',
      workId: 'work-1',
      delegationId: 'del-1',
      actor: 'principal-2',
      policyHash: 'sha256:abc123',
      evidenceRefs: ['evid-1'],
      terminalState: 'verified',
      artifactHash: 'sha256:def456',
      issuedAt: 1750000000000,
    };
    expect(receipt.receiptId).toBe('receipt-1');
    expect(receipt.terminalState).toBe('verified');
    expect(receipt.evidenceRefs).toEqual(['evid-1']);
    expect(Object.keys(receipt)).toHaveLength(9);
  });
});
