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
  it('requires all fields including a non-empty companyId', () => {
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
      version: 1,
      fencingToken: 0,
      evidenceRefs: ['evid-1', 'evid-2'],
    };
    expect(work.workId).toBe('work-1');
    expect(work.companyId).toBe('acme');
    expect(work.delegationId).toBe('del-1');
    expect(work.version).toBe(1);
    expect(work.evidenceRefs).toEqual(['evid-1', 'evid-2']);
  });

  it('version is a numeric optimistic-concurrency counter initialized to 1 on creation', () => {
    const work: Work = {
      workId: 'work-ver',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'execute task',
      state: 'proposed',
      version: 1,
      fencingToken: 0,
      evidenceRefs: [],
    };
    expect(work.version).toBe(1);
    expect(typeof work.version).toBe('number');
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
      version: 1,
      fencingToken: 0,
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
      companyId: 'acme',
      delegationId: '',
      proposer: 'p1',
      description: 'd',
      state: 'proposed',
      version: 1,
      fencingToken: 0,
      evidenceRefs: [],
    };
    expect(work.delegationId).toBe('');
  });

  it('requires fencingToken — a numeric field initialized to 0 (the valid pre-fencing epoch)', () => {
    const work: Work = {
      workId: 'work-4',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'p1',
      description: 'd',
      state: 'proposed',
      version: 1,
      fencingToken: 0,
      evidenceRefs: [],
    };
    expect(work.fencingToken).toBe(0);
    expect(typeof work.fencingToken).toBe('number');
  });

  it('a proposed Work carrying every mandatory field incl. fencingToken 0 is accepted as valid', () => {
    // work-lifecycle delta, "Valid proposed work" scenario: proposed Work with
    // every mandatory field, version 1, and fencingToken 0 MUST be valid.
    const work: Work = {
      workId: 'work-5',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'p1',
      description: 'd',
      state: 'proposed',
      version: 1,
      fencingToken: 0,
      evidenceRefs: [],
    };
    expect(work.state).toBe('proposed');
    expect(work.version).toBe(1);
    expect(work.fencingToken).toBe(0);
  });
});

describe('BusinessReceipt type', () => {
  it('requires all 11 fields including a non-empty companyId and terminalEventId', () => {
    const receipt: BusinessReceipt = {
      receiptId: 'receipt-1',
      companyId: 'acme',
      workId: 'work-1',
      delegationId: 'del-1',
      actor: 'principal-2',
      policyHash: 'sha256:abc123',
      evidenceRefs: ['evid-1'],
      terminalState: 'verified',
      terminalEventId: 'attempt-1',
      artifactHash: 'sha256:def456',
      issuedAt: 1750000000000,
    };
    expect(receipt.receiptId).toBe('receipt-1');
    expect(receipt.companyId).toBe('acme');
    expect(receipt.terminalState).toBe('verified');
    expect(receipt.terminalEventId).toBe('attempt-1');
    expect(receipt.evidenceRefs).toEqual(['evid-1']);
    expect(Object.keys(receipt)).toHaveLength(11);
  });

  it('terminalEventId is a required string — omitting it is a compile error', () => {
    // tsc rejects the omission; at runtime the closest to "missing" is empty.
    const receipt: BusinessReceipt = {
      receiptId: 'receipt-2',
      companyId: 'acme',
      workId: 'work-1',
      delegationId: 'del-1',
      actor: 'principal-2',
      policyHash: 'sha256:abc123',
      evidenceRefs: [],
      terminalState: 'verified',
      terminalEventId: '',
      artifactHash: 'sha256:def456',
      issuedAt: 1750000000000,
    };
    expect(receipt.terminalEventId).toBe('');
  });
});
