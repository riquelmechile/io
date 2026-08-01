import { describe, expect, it } from 'vitest';

import { parseBusinessReceiptRow, parseWorkRow } from '../src/row-guards.js';

/**
 * PostgreSQL row-guard tests (design D7, runtime-validation spec). Rows read
 * from PG are UNTRUSTED bytes: before an adapter uses a row it MUST pass a
 * runtime guard that returns `{ok:true,value}` for a well-formed row and
 * `{ok:false,reason}` for a corrupt one — never a silent pass-through and
 * never a thrown exception used for control flow.
 */

function workRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the close',
    state: 'in_progress',
    version: 2,
    evidenceRefs: ['evid-a', 'evid-b'],
    deliverable: { description: 'report.pdf', format: 'pdf' },
    outcome: { result: 'on track', success: true },
    ...overrides,
  };
}

function receiptRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    receiptId: 'rcpt-1',
    companyId: 'acme',
    workId: 'work-1',
    delegationId: 'del-1',
    actor: 'principal-2',
    policyHash: 'sha256:policy-hash',
    evidenceRefs: ['evid-a'],
    terminalState: 'completed',
    terminalEventId: 'att:acme:key-1',
    artifactHash: 'sha256:artifact-hash',
    issuedAt: 1750000000000,
    ...overrides,
  };
}

describe('parseWorkRow (D7)', () => {
  it('accepts a well-formed work row → {ok:true, value} preserving all fields', () => {
    const result = parseWorkRow(workRow());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.workId).toBe('work-1');
      expect(result.value.companyId).toBe('acme');
      expect(result.value.state).toBe('in_progress');
      expect(result.value.version).toBe(2);
      expect(result.value.evidenceRefs).toEqual(['evid-a', 'evid-b']);
      expect(result.value.deliverable).toEqual({ description: 'report.pdf', format: 'pdf' });
      expect(result.value.outcome).toEqual({ result: 'on track', success: true });
    }
  });

  it('normalizes null JSONB deliverable/outcome → undefined (nullable columns)', () => {
    const result = parseWorkRow(workRow({ deliverable: null, outcome: null }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deliverable).toBeUndefined();
      expect(result.value.outcome).toBeUndefined();
    }
  });

  it('rejects a corrupt work row with a NON-EMPTY reason, WITHOUT throwing', () => {
    const corrupt: unknown[] = [
      null,
      'row',
      [],
      workRow({ workId: '' }),
      workRow({ companyId: undefined }),
      workRow({ state: 'bogus' }),
      workRow({ version: 0 }),
      workRow({ version: 1.5 }),
      workRow({ evidenceRefs: 'evid-a' }),
      workRow({ evidenceRefs: [42] }),
      workRow({ description: 7 }),
    ];

    for (const bad of corrupt) {
      const result = parseWorkRow(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });
});

describe('parseBusinessReceiptRow (D7)', () => {
  it('accepts a well-formed receipt row → {ok:true, value} preserving all fields', () => {
    const result = parseBusinessReceiptRow(receiptRow());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.receiptId).toBe('rcpt-1');
      expect(result.value.terminalEventId).toBe('att:acme:key-1');
      expect(result.value.issuedAt).toBe(1750000000000);
      expect(result.value.evidenceRefs).toEqual(['evid-a']);
    }
  });

  it('rejects a corrupt receipt row (missing policyHash or artifactHash) with a non-empty reason', () => {
    const corrupt: unknown[] = [
      receiptRow({ policyHash: undefined }),
      receiptRow({ artifactHash: '' }),
      receiptRow({ actor: 42 }),
      receiptRow({ terminalEventId: null }),
      receiptRow({ issuedAt: 'not-a-number' }),
      receiptRow({ evidenceRefs: 'evid-a' }),
      'receipt',
    ];

    for (const bad of corrupt) {
      const result = parseBusinessReceiptRow(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });
});
