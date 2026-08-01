import { describe, expect, it } from 'vitest';

import {
  parseBusinessEventRow,
  parseBusinessReceiptRow,
  parseSkillRow,
  parseWorkRow,
} from '../src/row-guards.js';

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

describe('parseBusinessEventRow (R4, design §006 — untrusted PG bytes, guarded)', () => {
  function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      eventId: 'evt:att:acme:key-1',
      companyId: 'acme',
      aggregateKind: 'work',
      aggregateId: 'work-1',
      eventType: 'work.completed',
      occurredAt: 1750000000000,
      payload: {
        workId: 'work-1',
        state: 'completed',
        receiptId: 'rcpt:att:acme:key-1',
        terminalState: 'verified',
        evidenceId: 'evid:acme:key-1',
        attemptId: 'att:acme:key-1',
        actor: 'principal-2',
      },
      source: 'worker',
      ...overrides,
    };
  }

  it('accepts a well-formed event row → {ok:true, value} preserving all 8 fields', () => {
    const result = parseBusinessEventRow(eventRow());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventId).toBe('evt:att:acme:key-1');
      expect(result.value.companyId).toBe('acme');
      expect(result.value.aggregateKind).toBe('work');
      expect(result.value.aggregateId).toBe('work-1');
      expect(result.value.eventType).toBe('work.completed');
      expect(result.value.occurredAt).toBe(1750000000000);
      expect(result.value.payload).toEqual({
        workId: 'work-1',
        state: 'completed',
        receiptId: 'rcpt:att:acme:key-1',
        terminalState: 'verified',
        evidenceId: 'evid:acme:key-1',
        attemptId: 'att:acme:key-1',
        actor: 'principal-2',
      });
      expect(result.value.source).toBe('worker');
    }
  });

  it('accepts a payload with arbitrary extra keys (payload is an opaque record)', () => {
    const result = parseBusinessEventRow(eventRow({ payload: { attemptId: 'x', custom: 42 } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload).toEqual({ attemptId: 'x', custom: 42 });
    }
  });

  it('rejects a corrupt event row with a NON-EMPTY reason, WITHOUT throwing', () => {
    const corrupt: unknown[] = [
      null,
      'row',
      [],
      eventRow({ eventId: '' }),
      eventRow({ eventId: undefined }),
      eventRow({ companyId: 42 }),
      eventRow({ aggregateKind: null }),
      eventRow({ aggregateId: '' }),
      eventRow({ eventType: undefined }),
      eventRow({ source: '' }),
      eventRow({ occurredAt: 'not-a-number' }),
      eventRow({ occurredAt: undefined }),
      eventRow({ payload: null }),
      eventRow({ payload: [] }),
      eventRow({ payload: 'json-text' }),
      eventRow({ payload: undefined }),
    ];

    for (const bad of corrupt) {
      const result = parseBusinessEventRow(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });
});

describe('parseSkillRow (R6, design §007 — untrusted PG bytes, guarded)', () => {
  function skillRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      skillId: 'skill-1',
      companyId: 'acme',
      name: 'Quarterly close procedure',
      version: 1,
      body: 'Execute the Q4 financial close end-to-end.',
      scope: { process: 'financial-close', schemaVersion: 1 },
      state: 'active',
      createdAt: 1750000000000,
      updatedAt: 1750000000000,
      ...overrides,
    };
  }

  it('accepts a well-formed skill row → {ok:true, value} preserving all 9 fields', () => {
    const result = parseSkillRow(skillRow());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skillId).toBe('skill-1');
      expect(result.value.companyId).toBe('acme');
      expect(result.value.name).toBe('Quarterly close procedure');
      expect(result.value.version).toBe(1);
      expect(result.value.body).toBe('Execute the Q4 financial close end-to-end.');
      expect(result.value.scope).toEqual({ process: 'financial-close', schemaVersion: 1 });
      expect(result.value.state).toBe('active');
      expect(result.value.createdAt).toBe(1750000000000);
      expect(result.value.updatedAt).toBe(1750000000000);
    }
  });

  it('accepts schemaVersion exactly 1 (boundary — design says ≥1)', () => {
    const result = parseSkillRow(skillRow({ scope: { process: 'p', schemaVersion: 1 } }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scope.schemaVersion).toBe(1);
    }
  });

  it('accepts every SkillState value (draft | active | retired)', () => {
    for (const state of ['draft', 'active', 'retired']) {
      const result = parseSkillRow(skillRow({ state }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.state).toBe(state);
    }
  });

  it('rejects a corrupt skill row with a NON-EMPTY reason, WITHOUT throwing', () => {
    const corrupt: unknown[] = [
      null,
      'row',
      [],
      skillRow({ skillId: '' }),
      skillRow({ skillId: undefined }),
      skillRow({ companyId: 42 }),
      skillRow({ companyId: null }),
      skillRow({ name: '' }),
      skillRow({ name: undefined }),
      skillRow({ body: '' }),
      skillRow({ body: 7 }),
      skillRow({ version: 0 }),
      skillRow({ version: -1 }),
      skillRow({ version: 1.5 }),
      skillRow({ version: '2' }),
      skillRow({ createdAt: 'not-a-number' }),
      skillRow({ createdAt: undefined }),
      skillRow({ updatedAt: 'not-a-number' }),
      skillRow({ updatedAt: null }),
      skillRow({ state: 'bogus' }),
      skillRow({ state: 'published' }),
      skillRow({ state: 42 }),
      skillRow({ scope: null }),
      skillRow({ scope: [] }),
      skillRow({ scope: 'json-text' }),
      skillRow({ scope: undefined }),
      skillRow({ scope: { process: 'p', schemaVersion: 0 } }),
      skillRow({ scope: { process: 'p', schemaVersion: -1 } }),
      skillRow({ scope: { process: 'p', schemaVersion: '1' } }),
      skillRow({ scope: { process: '', schemaVersion: 1 } }),
      skillRow({ scope: { process: undefined, schemaVersion: 1 } }),
      skillRow({ scope: { schemaVersion: 1 } }),
      skillRow({ scope: { process: 'p' } }),
    ];

    for (const bad of corrupt) {
      const result = parseSkillRow(bad);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.reason).not.toBe('');
    }
  });
});
