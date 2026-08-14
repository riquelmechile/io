import { describe, expect, expectTypeOf, it } from 'vitest';

import * as promotionApi from '../src/index.js';
import type {
  LearningSubject,
  PromotionEvidence,
  PromotionPolicy,
  SkillOutcomeEvidence,
  SkillScope,
} from '../src/index.js';

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

// ── aggregateSkillOutcomes (task 1.5 sub-slice: deterministic success-only aggregation) ──

const outcomeEvent = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt:sk:att:acme:attempt-1',
  companyId: 'acme',
  aggregateKind: 'work',
  aggregateId: 'work-1',
  eventType: 'work.skill-outcome',
  occurredAt: 1000,
  payload: { version: 1, activatedSkills: [{ skillId: 'sdlc-review', version: 3 }] },
  source: 'worker',
  ...overrides,
});
const aggBinding = (overrides: Record<string, unknown> = {}) => ({
  companyId: 'acme',
  subject: subject(),
  windowStart: 0,
  windowEnd: 2000,
  ...overrides,
});
const aggregate = (events: unknown[], input: unknown = aggBinding()) =>
  promotionApi.aggregateSkillOutcomes(events, input as never);
const canonical = (event: Record<string, unknown>) => ({
  evidenceId: event.eventId,
  eventId: event.eventId,
  companyId: 'acme',
  subject: subject(),
  occurredAt: event.occurredAt,
  workId: event.aggregateId,
});
const okValue = (positiveObservations: readonly unknown[] = []) => ({
  ok: true,
  value: { companyId: 'acme', subject: subject(), positiveObservations },
});
const emptyEvidence = okValue();
const refs = (activatedSkills: unknown[], eventId = 'evt:sk:att:acme:attempt-1') =>
  outcomeEvent({ eventId, payload: { version: 1, activatedSkills } });

describe('aggregateSkillOutcomes — gold projection, type contract, no evidence', () => {
  it('projects one matching event onto the evidence contract; missing is not harmful', () => {
    expect(aggregate([outcomeEvent()])).toEqual(okValue([canonical(outcomeEvent())]));
    expect(aggregate([])).toEqual(emptyEvidence);
    expectTypeOf<PromotionEvidence>().toMatchTypeOf<{
      companyId: string;
      subject: LearningSubject;
      positiveObservations: readonly SkillOutcomeEvidence[];
    }>();
  });
});
describe('aggregateSkillOutcomes — deterministic order, permutation, composite once', () => {
  it('sorts by (occurredAt, eventId) and is permutation-equal', () => {
    const a = outcomeEvent({ eventId: 'evt:sk:att:acme:a', occurredAt: 900 });
    const b = outcomeEvent({
      eventId: 'evt:sk:att:acme:b',
      occurredAt: 900,
      aggregateId: 'work-b',
    });
    const c = outcomeEvent({ eventId: 'evt:sk:att:acme:c', occurredAt: 300 });
    const expected = okValue([canonical(c), canonical(a), canonical(b)]);
    expect(aggregate([a, b, c])).toEqual(expected);
    expect(aggregate([c, b, a])).toEqual(expected);
  });
  it('a composite event with several refs (incl. duplicates) counts once', () => {
    const event = refs([
      { skillId: 'other', version: 2 },
      { skillId: 'sdlc-review', version: 3 },
      { skillId: 'sdlc-review', version: 3 },
    ]);
    expect(aggregate([event])).toEqual(okValue([canonical(event)]));
  });
});

describe('aggregateSkillOutcomes — half-open window [start, end), empty allowed', () => {
  it('includes start, excludes end and outside; empty [t,t) yields zero observations', () => {
    const atStart = outcomeEvent({ eventId: 'evt:sk:att:acme:s', occurredAt: 1000 });
    const atEnd = outcomeEvent({ eventId: 'evt:sk:att:acme:e', occurredAt: 2000 });
    const before = outcomeEvent({ eventId: 'evt:sk:att:acme:x', occurredAt: 999 });
    const inside = outcomeEvent({ eventId: 'evt:sk:att:acme:i', occurredAt: 1500 });
    const window = aggBinding({ windowStart: 1000, windowEnd: 2000 });
    const emptyWindow = aggBinding({ windowStart: 1000, windowEnd: 1000 });
    expect(aggregate([atEnd, before, atStart, inside], window)).toEqual(
      okValue([canonical(atStart), canonical(inside)]),
    );
    expect(aggregate([outcomeEvent()], emptyWindow)).toEqual(emptyEvidence);
  });
});
describe('aggregateSkillOutcomes — replay collapses; any divergent reused ID fails deterministically', () => {
  it('exact structural replay collapses; divergent routing/source/payload/occurredAt/workId fail, order-independent', () => {
    const base = outcomeEvent();
    expect(aggregate([base, outcomeEvent()])).toEqual(okValue([canonical(base)]));
    const variants = [
      outcomeEvent({ occurredAt: 1500 }),
      outcomeEvent({ aggregateId: 'work-2' }),
      outcomeEvent({ source: 'supervisor' }),
      outcomeEvent({ eventType: 'work.completed' }),
      refs([{ skillId: 'other', version: 2 }]),
    ];
    const expected = { ok: false, reason: expect.stringContaining('evt:sk:att:acme:attempt-1') };
    for (const variant of variants) {
      expect(aggregate([base, variant])).toEqual(expected);
      expect(aggregate([variant, base])).toEqual(expected);
    }
    // Malformed local duplicate (injected undefined key) never collapses as replay — fails both orders.
    const malformed = refs([{ skillId: 'sdlc-review', version: 3, extra: undefined }]);
    expect(aggregate([base, malformed]).ok).toBe(false);
    expect(aggregate([malformed, base]).ok).toBe(false);
  });
});

describe('aggregateSkillOutcomes — foreign string tenants filtered BEFORE payload validation', () => {
  it('foreign events with malformed payloads or identities are skipped in either order', () => {
    const foreignMalformed = outcomeEvent({ companyId: 'other', payload: { version: 99 } });
    const foreignUnicode = outcomeEvent({ companyId: 'oth\uD800er', payload: null });
    const good = outcomeEvent();
    expect(aggregate([foreignMalformed])).toEqual(emptyEvidence);
    expect(aggregate([foreignMalformed, good])).toEqual(okValue([canonical(good)]));
    expect(aggregate([good, foreignUnicode])).toEqual(okValue([canonical(good)]));
  });
});

describe('aggregateSkillOutcomes — malformed same-tenant candidates fail closed', () => {
  it('rejects malformed payload, version, refs, identity, routing, envelope, and companyId', () => {
    const malformed = [
      outcomeEvent({ payload: { version: 2, activatedSkills: [] } }),
      outcomeEvent({ payload: null }),
      outcomeEvent({ payload: { version: 1 } }),
      outcomeEvent({ payload: { version: 1, activatedSkills: 'nope' } }),
      refs([null]),
      refs([{ skillId: '', version: 3 }]),
      refs([{ skillId: 'x\uD800', version: 3 }]),
      refs([{ skillId: 'x', version: 0 }]),
      refs([{ skillId: 'x', version: 1.5 }]),
      refs([{ skillId: 'x', version: 3, extra: 1 }]),
      outcomeEvent({ payload: { version: 1, activatedSkills: [], extra: 1 } }),
      outcomeEvent({ eventId: '' }),
      outcomeEvent({ eventId: 'e\uD800' }),
      outcomeEvent({ aggregateId: '' }),
      outcomeEvent({ occurredAt: NaN }),
      outcomeEvent({ companyId: 42 }),
      outcomeEvent({ eventType: 42 }),
      outcomeEvent({ eventType: undefined }),
      outcomeEvent({ aggregateKind: '' }),
      outcomeEvent({ source: 'sup\uD800ervisor' }),
      { ...outcomeEvent(), extra: 1 },
      Object.assign(Object.create({ extra: 1 }), outcomeEvent()),
    ];
    for (const event of malformed) expect(aggregate([event]).ok).toBe(false);
  });
});

describe('aggregateSkillOutcomes — decoys skipped; malformed sibling fails', () => {
  it('skips unrelated same-tenant events (well-formed wrong type, kind, source, or subject)', () => {
    const decoys = [
      outcomeEvent({ eventId: 'evt:sk:d1', eventType: 'work.completed' }),
      outcomeEvent({ eventId: 'evt:sk:d2', aggregateKind: 'delegation' }),
      outcomeEvent({ eventId: 'evt:sk:d3', source: 'supervisor' }),
      refs([{ skillId: 'other', version: 1 }], 'evt:sk:d4'),
      refs([], 'evt:sk:d5'),
    ];
    expect(aggregate(decoys)).toEqual(emptyEvidence);
    expect(aggregate([refs([{ skillId: 'sdlc-review', version: 3 }, { skillId: 42 }])]).ok).toBe(
      false,
    );
  });
});
describe('aggregateSkillOutcomes — input/output immutability', () => {
  it('never mutates or freezes inputs; output is deep-copied and deeply frozen', () => {
    const event = outcomeEvent();
    const events: unknown[] = [event];
    const input = aggBinding();
    const result = aggregate(events, input);
    if (!result.ok) throw new Error('expected ok');
    const { value } = result;
    const first = value.positiveObservations[0];
    if (!first) throw new Error('expected observation');
    for (const unfrozen of [events, event, event.payload, input])
      expect(Object.isFrozen(unfrozen)).toBe(false);
    for (const frozen of [value, value.subject, value.positiveObservations, first, first.subject])
      expect(Object.isFrozen(frozen)).toBe(true);
    event.occurredAt = 9999;
    expect(value.positiveObservations[0]?.occurredAt).toBe(1000);
  });
});

describe('aggregateSkillOutcomes — invalid binding, timestamps, and interval fail closed', () => {
  it('rejects malformed bindings, non-array events, and non-record events', () => {
    const badBindings: unknown[] = [
      aggBinding({ companyId: '' }),
      aggBinding({ companyId: 'ac\uD800me' }),
      aggBinding({ companyId: 42 }),
      aggBinding({ subject: { skillId: '', skillVersion: 3 } }),
      aggBinding({ subject: { skillId: 'x\uD800', skillVersion: 3 } }),
      aggBinding({ subject: { skillId: 'x', skillVersion: 0 } }),
      aggBinding({ subject: { skillId: 'x', skillVersion: 1.5 } }),
      aggBinding({ subject: { skillId: 'x', skillVersion: 3, extra: 1 } }),
      aggBinding({ windowStart: NaN }),
      aggBinding({ windowEnd: Infinity }),
      aggBinding({ windowStart: 2000, windowEnd: 1000 }),
      aggBinding({ extra: 1 }),
      { companyId: 'acme' },
    ];
    for (const bad of badBindings) expect(aggregate([outcomeEvent()], bad).ok).toBe(false);
    expect(aggregate('nope' as unknown as unknown[]).ok).toBe(false);
    expect(aggregate([null]).ok).toBe(false);
  });
});
