import { describe, expect, it } from 'vitest';

import type { Work } from '@io/business-domain/src/types.js';

import { dispatchIdempotencyKeyFor, dispatchRequestHashFor } from '../../src/dispatch/keys.js';

/**
 * Deterministic dispatch identity (work-dispatch R1): the idempotency key is
 * the stable `wk:${companyId}:${workId}` anchor — restart-stable,
 * company-scoped, collision-free — and the request hash is SHA-256 over the
 * canonical `{ companyId, workId, delegationId, description }`, EXCLUDING the
 * stateful Work fields (state/version/outcome/deliverable/evidenceRefs) so the
 * hash survives the `accepted → in_progress → completed` lifecycle. Same Work
 * ⇒ same key + hash ⇒ journal replay instead of a second effect/receipt.
 */

/** A canonical Work fixture; only identity fields matter for the hash. */
function work(overrides: Partial<Work> = {}): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'proposer-1',
    description: 'execute the quarterly close',
    state: 'accepted',
    version: 1,
    fencingToken: 0,
    evidenceRefs: [],
    ...overrides,
  };
}

describe('dispatchIdempotencyKeyFor (R1 — deterministic, company-scoped, collision-free)', () => {
  it('produces the exact wk: scheme: wk:<companyId>:<workId>', () => {
    expect(dispatchIdempotencyKeyFor('acme', 'work-1')).toBe('wk:acme:work-1');
    expect(dispatchIdempotencyKeyFor('globex', 'work-42')).toBe('wk:globex:work-42');
  });

  it('is restart-stable: the same inputs always derive the same key', () => {
    expect(dispatchIdempotencyKeyFor('acme', 'work-1')).toBe(
      dispatchIdempotencyKeyFor('acme', 'work-1'),
    );
  });

  it('is company-scoped: the same workId under different companies yields different keys', () => {
    expect(dispatchIdempotencyKeyFor('acme', 'work-1')).not.toBe(
      dispatchIdempotencyKeyFor('globex', 'work-1'),
    );
  });

  it('is collision-free across distinct (companyId, workId) pairs', () => {
    const pairs = [
      ['acme', 'work-1'],
      ['acme', 'work-2'],
      ['globex', 'work-1'],
      ['globex', 'work-2'],
    ] as const;
    const keys = pairs.map(([companyId, workId]) => dispatchIdempotencyKeyFor(companyId, workId));
    expect(new Set(keys).size).toBe(4);
  });

  it('REJECTS a companyId containing the ":" delimiter — otherwise ("a:b","c") and ("a","b:c") would both yield "wk:a:b:c"', () => {
    expect(() => dispatchIdempotencyKeyFor('a:b', 'c')).toThrow();
  });

  it('REJECTS a workId containing the ":" delimiter — same collision vector as the companyId case', () => {
    expect(() => dispatchIdempotencyKeyFor('a', 'b:c')).toThrow();
  });

  it('names the offending component and the forbidden character in the rejection message', () => {
    expect(() => dispatchIdempotencyKeyFor('a:b', 'c')).toThrow(/companyId/);
    expect(() => dispatchIdempotencyKeyFor('a:b', 'c')).toThrow(/:/);
    expect(() => dispatchIdempotencyKeyFor('a', 'b:c')).toThrow(/workId/);
  });

  it('still produces the exact wk: key for valid identifiers without ":" (guard is not over-restrictive)', () => {
    expect(() => dispatchIdempotencyKeyFor('acme', 'work-1')).not.toThrow();
    expect(dispatchIdempotencyKeyFor('acme', 'work-1')).toBe('wk:acme:work-1');
    expect(dispatchIdempotencyKeyFor('globex', 'work-42')).toBe('wk:globex:work-42');
  });
});

describe('dispatchRequestHashFor (R1 — SHA-256 over identity fields only)', () => {
  it('is a 64-char lowercase hex SHA-256 digest', () => {
    expect(dispatchRequestHashFor(work())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical across accepted → in_progress → completed (state-transition stable)', () => {
    const accepted = work({ state: 'accepted', version: 1 });
    const inProgress = work({ state: 'in_progress', version: 2 });
    const completed = work({
      state: 'completed',
      version: 3,
      outcome: { result: 'done', success: true },
      deliverable: { description: 'quarterly close document' },
      evidenceRefs: ['evid:1'],
    });

    expect(dispatchRequestHashFor(accepted)).toBe(dispatchRequestHashFor(inProgress));
    expect(dispatchRequestHashFor(inProgress)).toBe(dispatchRequestHashFor(completed));
  });

  it('EXCLUDES state, version, outcome, deliverable, and evidenceRefs', () => {
    const base = work();
    const mutated = work({
      state: 'completed',
      version: 9,
      outcome: { result: 'different', success: false },
      deliverable: { description: 'different document' },
      evidenceRefs: ['evid:x', 'evid:y'],
    });
    expect(dispatchRequestHashFor(base)).toBe(dispatchRequestHashFor(mutated));
  });

  it('INCLUDES companyId, workId, delegationId, and description (any identity change alters the hash)', () => {
    expect(dispatchRequestHashFor(work({ companyId: 'globex' }))).not.toBe(
      dispatchRequestHashFor(work()),
    );
    expect(dispatchRequestHashFor(work({ workId: 'work-2' }))).not.toBe(
      dispatchRequestHashFor(work()),
    );
    expect(dispatchRequestHashFor(work({ delegationId: 'del-2' }))).not.toBe(
      dispatchRequestHashFor(work()),
    );
    expect(dispatchRequestHashFor(work({ description: 'different task' }))).not.toBe(
      dispatchRequestHashFor(work()),
    );
  });

  it('is deterministic: the same Work always hashes to the same digest', () => {
    const w = work();
    expect(dispatchRequestHashFor(w)).toBe(dispatchRequestHashFor(w));
  });
});
