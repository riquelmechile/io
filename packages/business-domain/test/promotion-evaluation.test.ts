import { describe, expect, it } from 'vitest';

import * as promotionApi from '../src/index.js';
import type { LearningSubject, PromotionPolicy, SkillScope } from '../src/index.js';

const subject = (skillId = 'sdlc-review', skillVersion = 3) => ({ skillId, skillVersion });
const scope: SkillScope = { process: 'sdlc-review', schemaVersion: 1 };
const policy = (overrides: Partial<PromotionPolicy> = {}): PromotionPolicy => ({
  policyId: 'pol-1',
  version: 1,
  companyId: 'acme',
  scope,
  active: true,
  effectiveFrom: 1000,
  effectiveUntil: 2000,
  minPositiveObservations: 3,
  minLinkedOutcomes: 2,
  requireUniqueOutcomes: true,
  conflictBehavior: 'needs-review',
  delegatedRiskClasses: ['low', 'medium'],
  ...overrides,
});
const input = (
  o: Partial<{ companyId: string; subject: LearningSubject; scope: SkillScope; at: number }> = {},
) => ({ companyId: 'acme', subject: subject(), scope, at: 1500, ...o });
const kind = (policies: unknown[], binding: ReturnType<typeof input> = input()) =>
  promotionApi.resolvePromotionPolicy(policies, binding).kind;

describe('resolvePromotionPolicy — zero applicable => policy-not-found', () => {
  it('empty, inactive, expired, foreign (incl. malformed-unicode), scope- and subject-mismatched sets', () => {
    const cases = [
      [],
      [policy({ active: false })],
      [policy({ effectiveFrom: 2000, effectiveUntil: 3000 })],
      [policy({ effectiveUntil: 1500 })],
      [policy({ companyId: 'other' })],
      [policy({ companyId: 'ac\uD800me' })],
      [policy({ companyId: '' })],
      [policy({ scope: { process: 'other', schemaVersion: 2 } })],
      [policy({ subject: subject('other', 1) })],
    ];
    for (const p of cases) expect(kind(p)).toBe('policy-not-found');
  });
});

describe('resolvePromotionPolicy — exactly one applicable => resolved', () => {
  it('resolves one valid active policy with window boundaries', () => {
    const w300 = policy({ observationWindowMs: 300 });
    const w2000 = policy({ observationWindowMs: 2000 });
    const cases = [
      [[policy()], policy(), input(), 1000, 1500],
      [[w300], w300, input(), 1200, 1500],
      [[w2000], w2000, input(), 1000, 1500],
      [[policy()], policy(), input({ at: 1000 }), 1000, 1000],
      [[policy()], policy(), input({ subject: subject('other', 7) }), 1000, 1500],
    ] as const;
    for (const [policies, expected, binding, windowStart, windowEnd] of cases) {
      expect(promotionApi.resolvePromotionPolicy(policies, binding)).toEqual({
        kind: 'resolved',
        policy: expected,
        windowStart,
        windowEnd,
      });
    }
  });
});

describe('resolvePromotionPolicy — multiple applicable => policy-ambiguous', () => {
  it('returns deterministic refs sorted by (policyId, version), order-independent', () => {
    const z = policy({ policyId: 'pol-z', version: 2 });
    const a = policy({ policyId: 'pol-a', version: 1 });
    const expected = {
      kind: 'policy-ambiguous',
      policyRefs: [
        { policyId: 'pol-a', version: 1 },
        { policyId: 'pol-z', version: 2 },
      ],
    };
    expect(promotionApi.resolvePromotionPolicy([z, a], input())).toEqual(expected);
    expect(promotionApi.resolvePromotionPolicy([a, z], input())).toEqual(expected);
  });
});

describe('resolvePromotionPolicy — malformed policy, binding, defaults, or rate rules => policy-invalid', () => {
  it('rejects malformed shape, identity, Unicode breaks, closed shape, rate rules, ranges, bindings, and missing fields', () => {
    const cases = [
      [null],
      [{ ...policy(), policyId: '' }],
      [{ ...policy(), policyId: 'p\uD800' }],
      [{ ...policy(), version: 0 }],
      [{ ...policy(), companyId: 42 }],
      [{ ...policy(), scope: { process: '', schemaVersion: 1 } }],
      [{ ...policy(), scope: { process: 'x\uD800', schemaVersion: 1 } }],
      [{ ...policy(), scope: { process: 'x', schemaVersion: 0 } }],
      [{ ...policy(), scope: { process: 'x', schemaVersion: 1, extra: 1 } }],
      [{ ...policy(), subject: { skillId: '', skillVersion: 3 } }],
      [{ ...policy(), subject: { skillId: 'x\uD800', skillVersion: 3 } }],
      [{ ...policy(), subject: { skillId: 'x', skillVersion: 0 } }],
      [{ ...policy(), subject: { skillId: 'x', skillVersion: 3, extra: 1 } }],
      [{ ...policy(), active: 'yes' }],
      [{ ...policy(), effectiveFrom: NaN }],
      [{ ...policy(), effectiveFrom: 2000, effectiveUntil: 1000 }],
      [{ ...policy(), observationWindowMs: 0 }],
      [{ ...policy(), minPositiveObservations: -1 }],
      [{ ...policy(), conflictBehavior: 'approve' }],
      [{ ...policy(), delegatedRiskClasses: [] }],
      [{ ...policy(), delegatedRiskClasses: ['low', 'low'] }],
      [{ ...policy(), minConfidence: 1.5 }],
      [{ ...policy(), allowedSourceAuthorities: [42] }],
      [{ ...policy(), successRate: { threshold: 1.5 } }],
      [{ ...policy(), successRate: {} }],
      [{ ...policy(), successRate: { threshold: 0.5, extra: 1 } }],
      [{ ...policy(), successRate: 0.5 }],
      [{ ...policy(), harmfulCap: { threshold: -0.1 } }],
      [{ ...policy(), extra: 1 }],
    ];
    for (const p of cases) expect(kind(p)).toBe('policy-invalid');
    expect(kind([policy(), { ...policy(), version: 0 }])).toBe('policy-invalid');
    const bindings = [input({ companyId: '' }), input({ at: NaN })];
    for (const b of bindings) expect(kind([policy()], b)).toBe('policy-invalid');
    const missing = [
      [{ ...policy(), minPositiveObservations: undefined }],
      [{ ...policy(), conflictBehavior: undefined }],
      [{ ...policy(), delegatedRiskClasses: undefined }],
      [{ ...policy(), active: undefined }],
    ];
    for (const p of missing) expect(kind(p)).toBe('policy-invalid');
  });
});

describe('resolvePromotionPolicy — tenant isolation, rate-rule acceptance, immutability, explicit reconstruction', () => {
  it('foreign policies are skipped before local identity/Unicode/content validation, in either order', () => {
    const foreignBad = { ...policy({ companyId: 'other\uD800' }), scope: { process: 42 } };
    expect(kind([foreignBad])).toBe('policy-not-found');
    expect(kind([foreignBad, policy()])).toBe('resolved');
    expect(kind([policy(), foreignBad])).toBe('resolved');
  });
  it('deep-copies and freezes rate rules; omitted rules stay undefined; input stays mutable; inherited keys never leak', () => {
    const source = policy({ successRate: { threshold: 0.5 }, harmfulCap: { threshold: 0.1 } });
    const result = promotionApi.resolvePromotionPolicy([source], input());
    expect(result).toEqual({
      kind: 'resolved',
      policy: source,
      windowStart: 1000,
      windowEnd: 1500,
    });
    if (result.kind !== 'resolved') throw new Error('expected resolved');
    expect(Object.isFrozen(source)).toBe(false);
    expect(result.policy).not.toBe(source);
    expect(Object.isFrozen(result.policy)).toBe(true);
    expect(Object.isFrozen(result.policy.scope) && Object.isFrozen(result.policy.successRate)).toBe(
      true,
    );
    expect(result.policy.scope).not.toBe(source.scope);
    expect(result.policy.successRate).not.toBe(source.successRate);
    const plain = promotionApi.resolvePromotionPolicy([policy()], input());
    if (plain.kind !== 'resolved') throw new Error('expected resolved');
    expect(plain.policy).toEqual(policy());
    const inherited = Object.create({ extra: 1 });
    Object.assign(inherited, policy());
    const ih = promotionApi.resolvePromotionPolicy([inherited], input());
    if (ih.kind !== 'resolved') throw new Error('expected resolved');
    expect('extra' in ih.policy).toBe(false);
    expect(ih.policy).toEqual(policy());
  });
});
