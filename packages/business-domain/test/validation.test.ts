import { describe, expect, it } from 'vitest';

import {
  assertValidCommand,
  assertValidDelegationRow,
  assertValidLlmPlan,
  assertValidReceiptRow,
  assertValidWorkRow,
  assertValidWorkTransition,
  isDelegationActive,
  isDelegationWindowActive,
  ValidationError,
} from '../src/index.js';
import type { Delegation } from '../src/index.js';

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

const validDelegation = {
  delegationId: 'd1',
  companyId: 'acme',
  delegator: 'founder',
  delegate: 'worker',
  authorityScope: { scope: 'sandbox', actions: ['write'] },
  budget: { currency: 'USD', limit: 10 },
  validFrom: 1000,
  validUntil: 9000,
  expectedOutcome: 'done',
  state: 'active' as const,
} satisfies Delegation;

describe('isDelegationWindowActive / isDelegationActive', () => {
  it('future-start delegation is not active (window)', () => {
    expect(isDelegationWindowActive(2000, 1500, 9000)).toBe(false);
  });

  it('currently active window', () => {
    expect(isDelegationWindowActive(1000, 1500, 9000)).toBe(true);
  });

  it('expiry boundary is exclusive', () => {
    expect(isDelegationWindowActive(1000, 9000, 9000)).toBe(false);
  });

  it('active state + future start → not active', () => {
    expect(
      isDelegationActive({ ...validDelegation, validFrom: 2000, validUntil: 9000 }, 1500),
    ).toBe(false);
  });

  it('active state + current window → active', () => {
    expect(isDelegationActive(validDelegation, 1500)).toBe(true);
  });

  it('draft state + current window → not active', () => {
    expect(isDelegationActive({ ...validDelegation, state: 'draft' }, 1500)).toBe(false);
  });
});

describe('assertValidDelegationRow', () => {
  it('accepts a well-formed delegation', () => {
    expect(assertValidDelegationRow(validDelegation)).toEqual(validDelegation);
  });

  it('rejects missing budget', () => {
    const { budget: _b, ...rest } = validDelegation;
    expect(() => assertValidDelegationRow(rest)).toThrow(/budget/);
  });

  it('rejects missing authorityScope', () => {
    const { authorityScope: _a, ...rest } = validDelegation;
    expect(() => assertValidDelegationRow(rest)).toThrow(/authorityScope/);
  });

  it('rejects missing companyId', () => {
    expect(() => assertValidDelegationRow({ ...validDelegation, companyId: '' })).toThrow(
      /companyId/,
    );
  });

  it('rejects inverted window', () => {
    expect(() =>
      assertValidDelegationRow({ ...validDelegation, validFrom: 9000, validUntil: 1000 }),
    ).toThrow(/validUntil/);
  });
});

describe('assertValidReceiptRow', () => {
  const validReceipt = {
    receiptId: 'r1',
    workId: 'w1',
    delegationId: 'd1',
    companyId: 'acme',
    actor: 'verifier',
    policyHash: 'ph',
    evidenceRefs: ['e1'],
    terminalEventId: 'te1',
    terminalState: 'verified',
    artifactHash: 'ah',
    issuedAt: 1700000000000,
  };

  it('accepts a well-formed receipt', () => {
    expect(assertValidReceiptRow(validReceipt)).toEqual(validReceipt);
  });

  it('rejects missing workId', () => {
    expect(() => assertValidReceiptRow({ ...validReceipt, workId: '' })).toThrow(/workId/);
  });

  it('rejects missing actor', () => {
    expect(() => assertValidReceiptRow({ ...validReceipt, actor: '' })).toThrow(/actor/);
  });

  it('rejects missing issuedAt', () => {
    const { issuedAt: _i, ...rest } = validReceipt;
    expect(() => assertValidReceiptRow(rest)).toThrow(/issuedAt/);
  });

  it('rejects missing evidenceRefs', () => {
    const { evidenceRefs: _e, ...rest } = validReceipt;
    expect(() => assertValidReceiptRow(rest)).toThrow(/evidenceRefs/);
  });
});
