import { describe, expect, expectTypeOf, it } from 'vitest';

import * as promotionApi from '../src/index.js';
import type {
  AuthorityTransitionProof,
  AuthorityUnavailableReason,
  ExplicitObservation,
  ExplicitPromotionEvidence,
  LearningCandidate,
  LearningSubject,
  PromotionAuthorityResolution,
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

// ── evaluatePromotion (task 1.7) — lean gate set; full 1.8 corpus ⇒ child 2C ──

const evt = (eventId: string, workId: string, occurredAt = 1000): SkillOutcomeEvidence => ({
  evidenceId: eventId,
  eventId,
  companyId: 'acme',
  subject: subject(),
  occurredAt,
  workId,
});
const built = promotionApi.createLearningCandidate({
  companyId: 'acme',
  subject: subject(),
  scope,
  outcomes: [evt('evt:a', 'work-a'), evt('evt:b', 'work-b'), evt('evt:c', 'work-c')],
  createdAt: 900,
});
if (!built.ok) throw new Error('fixture candidate');
const CAND = built.value;
const obs = (positive: readonly SkillOutcomeEvidence[]): PromotionEvidence => ({
  companyId: 'acme',
  subject: subject(),
  positiveObservations: positive,
});
const observation = (id: string, value: unknown): ExplicitObservation<never> => ({
  evidenceId: id,
  companyId: 'acme',
  subject: subject(),
  sourceRef: `src-${id}`,
  observedAt: 1100,
  value: value as never,
});
const explicit = (o: Partial<ExplicitPromotionEvidence> = {}): ExplicitPromotionEvidence => ({
  conflicts: [],
  catastrophicVetoes: [],
  ...o,
});
const proof = (o: Partial<AuthorityTransitionProof> = {}): AuthorityTransitionProof => ({
  proofId: 'proof-1',
  proofRevision: 1,
  transitionId: 'tr-1',
  transitionRevision: 1,
  kind: 'verification',
  companyId: 'acme',
  subject: subject(),
  actorId: 'actor-1',
  principalId: 'principal-1',
  delegationId: 'del-1',
  grantId: 'del-1',
  command: 'learning.promote',
  capability: 'learning.promote',
  scope: promotionApi.promotionScopeFor('acme', subject()),
  policyRef: { policyId: 'pol-1', version: 1 },
  issuedAt: 1000,
  effectiveFrom: 1000,
  expiry: 2000,
  revoked: false,
  revocationVersion: 0,
  current: true,
  ...o,
});
const resolved = (o: Partial<AuthorityTransitionProof> = {}): PromotionAuthorityResolution => ({
  kind: 'resolved',
  value: proof(o),
});
const unavailable = (reason: AuthorityUnavailableReason): PromotionAuthorityResolution => ({
  kind: 'unavailable',
  reason,
});
const evaluate = (
  o: {
    cand?: LearningCandidate;
    obs?: PromotionEvidence;
    exp?: ExplicitPromotionEvidence;
    pol?: PromotionPolicy;
    aut?: PromotionAuthorityResolution;
  } = {},
) =>
  promotionApi.evaluatePromotion(
    o.cand ?? CAND,
    o.obs ?? obs(CAND.outcomeEvidence),
    o.exp ?? explicit(),
    o.pol ?? policy(),
    o.aut ?? resolved(),
  );
const ref = { policyId: 'pol-1', version: 1 };

describe('evaluatePromotion — gold promotion within delegated policy', () => {
  it('promotes with typed references; result frozen; ids canonical and tenant-scoped', () => {
    const result = evaluate();
    expect(result).toEqual({
      outcome: 'promote',
      reasons: [],
      policyRef: ref,
      outcomeIds: ['evt:a', 'evt:b', 'evt:c'],
    });
    const ordered = evaluate({
      obs: obs([
        evt('evt:c', 'work-c', 1000),
        { ...evt('evt:x', 'work-x'), companyId: 'other' },
        evt('evt:b', 'work-b', 900),
        evt('evt:a', 'work-a', 950),
      ]),
    });
    expect(ordered.outcomeIds).toEqual(['evt:b', 'evt:a', 'evt:c']);
  });
});

describe('evaluatePromotion — escalation gates run before thresholds', () => {
  it('inactive policy short-circuits alone', () => {
    const result = evaluate({ pol: policy({ active: false }) });
    expect(result.outcome).toBe('needs-review');
    expect(result.reasons).toEqual(['policy-inactive']);
  });
  it('unresolved conflict and triggered veto escalate despite satisfied thresholds', () => {
    const conflict = evaluate({
      exp: explicit({
        conflicts: [observation('c1', { unresolved: true, description: 'stale' })],
      }),
    });
    expect(conflict.outcome).toBe('needs-review');
    expect(conflict.reasons).toEqual(['conflict-unresolved']);
    const veto = evaluate({
      pol: policy({ catastrophicVetoEnabled: true, successRate: { threshold: 0.8 } }),
      exp: explicit({
        rateObservations: [observation('r1', { positive: true, harmful: false })],
        catastrophicVetoes: [observation('v1', { triggered: true, description: 'boom' })],
      }),
    });
    expect(veto.outcome).toBe('needs-review');
    expect(veto.reasons).toEqual(['veto-triggered']);
  });
  it('harmful without a cap undelegates; reserved critical tier escalates', () => {
    const undelegated = evaluate({
      exp: explicit({
        rateObservations: [observation('r1', { positive: false, harmful: true })],
      }),
    });
    expect(undelegated.outcome).toBe('needs-review');
    expect(undelegated.reasons).toEqual(['risk-undelegated']);
    const reserved = evaluate({
      pol: policy({ delegatedRiskClasses: ['low', 'medium', 'critical'] }),
    });
    expect(reserved.reasons).toEqual(['risk-reserved']);
  });
});

describe('evaluatePromotion — authority gates promotion', () => {
  it('unavailable authority is never promotion; revoked/mismatched/foreign proof escalates', () => {
    expect(evaluate({ aut: unavailable('authority-missing') }).outcome).toBe('needs-review');
    expect(evaluate({ aut: unavailable('authority-missing') }).reasons).toEqual([
      'authority-missing',
    ]);
    const cases = [
      [{ revoked: true, revocationVersion: 1 }, 'authority-revoked'],
      [{ policyRef: { policyId: 'pol-1', version: 2 } }, 'authority-policy-mismatch'],
      [{ companyId: 'other' }, 'authority-foreign'],
    ] as const;
    for (const [override, reason] of cases)
      expect(evaluate({ aut: resolved({ ...override }) }).reasons).toEqual([reason]);
  });
});

describe('evaluatePromotion — insufficient evidence remains candidate', () => {
  it('positive, linked, and harmful-cap thresholds', () => {
    const cases: [PromotionPolicy, PromotionEvidence, ExplicitPromotionEvidence, string][] = [
      [
        policy(),
        obs([evt('evt:a', 'work-a'), evt('evt:b', 'work-b')]),
        explicit(),
        'insufficient-positive-observations',
      ],
      [
        policy({ minLinkedOutcomes: 3 }),
        obs([
          evt('evt:a', 'work-a', 900),
          evt('evt:b', 'work-a', 950),
          evt('evt:c', 'work-b', 1000),
        ]),
        explicit(),
        'insufficient-linked-outcomes',
      ],
      [
        policy({ harmfulCap: { threshold: 0.1 } }),
        obs(CAND.outcomeEvidence),
        explicit({
          rateObservations: [
            observation('r1', { positive: true, harmful: true }),
            observation('r2', { positive: true, harmful: false }),
          ],
        }),
        'harmful-cap-exceeded',
      ],
    ];
    for (const [pol, o, exp, reason] of cases)
      expect(evaluate({ pol, obs: o, exp })).toEqual({
        outcome: 'remain-candidate',
        reasons: [reason],
        policyRef: ref,
        outcomeIds: o.positiveObservations.map((item) => item.eventId),
      });
  });
});

describe('evaluatePromotion — explicit observations are candidate-bound (R3-001)', () => {
  const foreign = (id: string, value: unknown): ExplicitObservation<never> => ({
    ...observation(id, value),
    companyId: 'other',
  });
  it('foreign unresolved conflict is ignored; gold still promotes', () => {
    const result = evaluate({
      exp: explicit({
        conflicts: [
          foreign('c-f', { unresolved: true, description: 'foreign' }),
          {
            ...observation('c-s', { unresolved: true, description: 'other skill' }),
            subject: subject('other', 7),
          },
        ],
      }),
    });
    expect(result.outcome).toBe('promote');
  });
  it('foreign triggered veto is ignored', () => {
    const result = evaluate({
      pol: policy({ catastrophicVetoEnabled: true }),
      exp: explicit({
        catastrophicVetoes: [foreign('v-f', { triggered: true, description: 'x' })],
      }),
    });
    expect(result.outcome).toBe('promote');
  });
  it('foreign rate observations are excluded from rate gates', () => {
    const rates = [foreign('r-f', { positive: true, harmful: true })];
    const success = evaluate({
      pol: policy({ successRate: { threshold: 0.8 } }),
      exp: explicit({ rateObservations: rates }),
    });
    expect(success.reasons).toEqual(['success-rate-unavailable']);
    const harmful = evaluate({
      pol: policy({ harmfulCap: { threshold: 0.1 } }),
      exp: explicit({ rateObservations: rates }),
    });
    expect(harmful.reasons).toEqual(['harmful-evidence-unavailable']);
    expect(evaluate({ exp: explicit({ rateObservations: rates }) }).outcome).toBe('promote');
  });
  it('foreign confidence and source authority become unavailable, never binding', () => {
    const conf = evaluate({
      pol: policy({ minConfidence: 0.9 }),
      exp: explicit({ confidence: foreign('cf-f', 1) }),
    });
    expect(conf.reasons).toEqual(['confidence-unavailable']);
    const allowed = evaluate({
      pol: policy({ allowedSourceAuthorities: ['hq'] }),
      exp: explicit({ sourceAuthority: foreign('s-f', 'hq') }),
    });
    expect(allowed.reasons).toEqual(['source-authority-unavailable']);
    const unallowed = evaluate({
      pol: policy({ allowedSourceAuthorities: ['hq'] }),
      exp: explicit({ sourceAuthority: foreign('s-f', 'field-bot') }),
    });
    expect(unallowed.outcome).toBe('remain-candidate');
    expect(unallowed.reasons).toEqual(['source-authority-unavailable']);
  });
});
