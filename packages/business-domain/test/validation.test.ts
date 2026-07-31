import { describe, expect, it } from 'vitest';

import {
  assertValidCommand,
  assertValidLlmPlan,
  assertValidWorkRow,
  assertValidWorkTransition,
  ValidationError,
} from '../src/index.js';

describe('assertValidCommand', () => {
  it('accepts a valid command', () => {
    expect(() =>
      assertValidCommand({
        companyId: 'acme',
        workId: 'w1',
        delegationId: 'd1',
        principalId: 'p1',
        action: 'propose',
      }),
    ).not.toThrow();
  });

  it('rejects missing companyId', () => {
    expect(() =>
      assertValidCommand({
        companyId: '',
        workId: 'w1',
        delegationId: 'd1',
        principalId: 'p1',
        action: 'propose',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects empty workId', () => {
    expect(() =>
      assertValidCommand({
        companyId: 'acme',
        workId: '',
        delegationId: 'd1',
        principalId: 'p1',
        action: 'propose',
      }),
    ).toThrow(/workId/);
  });
});

describe('assertValidWorkRow', () => {
  const valid = {
    workId: 'w1',
    companyId: 'acme',
    delegationId: 'd1',
    proposer: 'p1',
    description: 'do it',
    state: 'proposed',
    version: 0,
    evidenceRefs: [],
  };

  it('accepts a well-formed row', () => {
    expect(assertValidWorkRow(valid)).toEqual(valid);
  });

  it('rejects version as string', () => {
    expect(() => assertValidWorkRow({ ...valid, version: '0' })).toThrow(ValidationError);
  });

  it('rejects illegal state', () => {
    expect(() => assertValidWorkRow({ ...valid, state: 'flying' })).toThrow(ValidationError);
  });
});

describe('assertValidWorkTransition', () => {
  it('accepts proposed -> accepted', () => {
    expect(() => assertValidWorkTransition('proposed', 'accepted')).not.toThrow();
  });

  it('rejects accepted -> verified', () => {
    expect(() => assertValidWorkTransition('accepted', 'verified')).toThrow(ValidationError);
  });
});

describe('assertValidLlmPlan', () => {
  it('accepts a well-formed plan', () => {
    expect(() =>
      assertValidLlmPlan({ description: 'close books', actions: ['prepare', 'file'] }),
    ).not.toThrow();
  });

  it('rejects missing description', () => {
    expect(() => assertValidLlmPlan({ description: '', actions: ['a'] })).toThrow(ValidationError);
  });

  it('rejects empty actions', () => {
    expect(() => assertValidLlmPlan({ description: 'x', actions: [] })).toThrow(ValidationError);
  });
});
