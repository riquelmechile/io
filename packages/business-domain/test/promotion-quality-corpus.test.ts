import { describe, expect, expectTypeOf, it } from 'vitest';

import * as api from '../src/index.js';
import type {
  AuthorityTransitionProof,
  AuthorityUnavailableReason,
  ExplicitObservation,
  ExplicitPromotionEvidence,
  LearningCandidate,
  PromotionAuthorityResolution,
  PromotionEvidence,
  PromotionPolicy,
  SkillOutcomeEvidence,
  SkillScope,
  SkillState,
} from '../src/index.js';

// Fixture values prove behavior only; no operator defaults exist in production code.

const subject = (skillId = 'sdlc-review', skillVersion = 3) => ({ skillId, skillVersion });
const scope: SkillScope = { process: 'sdlc-review', schemaVersion: 1 };
const ref = { policyId: 'pol-1', version: 1 };
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
const outcome = (eventId: string, workId: string, occurredAt = 1000): SkillOutcomeEvidence => ({
  evidenceId: eventId,
  eventId,
  companyId: 'acme',
  subject: subject(),
  occurredAt,
  workId,
});
const GOLD = [outcome('evt:a', 'work-a'), outcome('evt:b', 'work-b'), outcome('evt:c', 'work-c')];
const candidate = (items: readonly SkillOutcomeEvidence[] = GOLD): LearningCandidate => {
  const built = api.createLearningCandidate({
    companyId: 'acme',
    subject: subject(),
    scope,
    outcomes: items,
    createdAt: 900,
  });
  if (!built.ok) throw new Error('fixture candidate');
  return built.value;
};
const evidence = (items: readonly SkillOutcomeEvidence[] = GOLD): PromotionEvidence => ({
  companyId: 'acme',
  subject: subject(),
  positiveObservations: items,
});
const observation = (
  id: string,
  value: unknown,
  companyId = 'acme',
): ExplicitObservation<never> => ({
  evidenceId: id,
  companyId,
  subject: subject(),
  sourceRef: `src-${id}`,
  observedAt: 1100,
  value: value as never,
});
const explicit = (
  overrides: Partial<ExplicitPromotionEvidence> = {},
): ExplicitPromotionEvidence => ({
  conflicts: [],
  catastrophicVetoes: [],
  ...overrides,
});
const proof = (overrides: Partial<AuthorityTransitionProof> = {}): AuthorityTransitionProof => ({
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
  scope: api.promotionScopeFor('acme', subject()),
  policyRef: ref,
  issuedAt: 1000,
  effectiveFrom: 1000,
  expiry: 2000,
  revoked: false,
  revocationVersion: 0,
  current: true,
  ...overrides,
});
const resolved = (
  overrides: Partial<AuthorityTransitionProof> = {},
): PromotionAuthorityResolution => ({
  kind: 'resolved',
  value: proof(overrides),
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
  api.evaluatePromotion(
    o.cand ?? candidate(),
    o.obs ?? evidence(),
    o.exp ?? explicit(),
    o.pol ?? policy(),
    o.aut ?? resolved(),
  );

describe('promotion quality corpus — gold promotes within delegated policy', () => {
  it('bare gold and gold with every explicit gate satisfied both promote', () => {
    expect(evaluate()).toEqual({
      outcome: 'promote',
      reasons: [],
      policyRef: ref,
      outcomeIds: ['evt:a', 'evt:b', 'evt:c'],
    });
    const rich = evaluate({
      pol: policy({
        minConfidence: 0.5,
        allowedSourceAuthorities: ['trusted-ai'],
        successRate: { threshold: 0.5 },
        harmfulCap: { threshold: 0.5 },
        catastrophicVetoEnabled: true,
      }),
      exp: explicit({
        confidence: observation('obs-cf', 0.9),
        sourceAuthority: observation('obs-sa', 'trusted-ai'),
        rateObservations: [
          observation('obs-r1', { positive: true, harmful: false }),
          observation('obs-r2', { positive: true, harmful: false }),
          observation('obs-r3', { positive: false, harmful: false }),
        ],
      }),
    });
    expect(rich.outcome).toBe('promote');
    expect(rich.reasons).toEqual([]);
    expect(Object.isFrozen(rich)).toBe(true);
  });
});

describe('promotion quality corpus — decoys never promote', () => {
  it('foreign outcomes are excluded; remains candidate, or needs-review with absent authority', () => {
    const foreign = evidence([
      { ...outcome('evt:f', 'work-f'), companyId: 'other' },
      { ...outcome('evt:g', 'work-g'), subject: { skillId: 'other-skill', skillVersion: 1 } },
    ]);
    expect(evaluate({ obs: foreign })).toEqual({
      outcome: 'remain-candidate',
      reasons: ['insufficient-positive-observations'],
      policyRef: ref,
      outcomeIds: [],
    });
    const authless = evaluate({ obs: foreign, aut: unavailable('authority-missing') });
    expect(authless.outcome).toBe('needs-review');
    expect(authless.reasons).toEqual(['authority-missing']);
  });
});

describe('promotion quality corpus — semantically equivalent inputs are identical', () => {
  it('outcome and explicit-observation reordering yields byte-identical results', () => {
    const reordered = evidence([
      outcome('evt:c', 'work-c'),
      outcome('evt:a', 'work-a'),
      outcome('evt:b', 'work-b'),
    ]);
    expect(evaluate({ obs: evidence() })).toEqual(evaluate({ obs: reordered }));
    const conflict = (id: string) => observation(id, { unresolved: true, description: id });
    const veto = (id: string) => observation(id, { triggered: true, description: id });
    const rate = (id: string, positive: boolean) => observation(id, { positive, harmful: false });
    const pol = policy({ catastrophicVetoEnabled: true });
    const a = explicit({
      conflicts: [conflict('c1'), conflict('c2')],
      catastrophicVetoes: [veto('v1'), veto('v2')],
      rateObservations: [rate('r1', true), rate('r2', false)],
    });
    const b = explicit({
      rateObservations: [rate('r2', false), rate('r1', true)],
      catastrophicVetoes: [veto('v2'), veto('v1')],
      conflicts: [conflict('c2'), conflict('c1')],
    });
    expect(evaluate({ pol, exp: a })).toEqual(evaluate({ pol, exp: b }));
    expect(evaluate({ pol, exp: b }).reasons).toEqual(['conflict-unresolved', 'veto-triggered']);
  });
});

describe('promotion quality corpus — missing evidence is never harmful', () => {
  it('absent confidence, source authority, and rate denominators are typed unavailable', () => {
    const cases: readonly [PromotionPolicy, string][] = [
      [policy({ minConfidence: 0.5 }), 'confidence-unavailable'],
      [policy({ allowedSourceAuthorities: ['trusted-ai'] }), 'source-authority-unavailable'],
      [policy({ successRate: { threshold: 0.5 } }), 'success-rate-unavailable'],
      [policy({ harmfulCap: { threshold: 0.5 } }), 'harmful-evidence-unavailable'],
    ];
    for (const [pol, reason] of cases) {
      const result = evaluate({ pol });
      expect(result.outcome).toBe('remain-candidate');
      expect(result.reasons).toEqual([reason]);
    }
  });
});

describe('promotion quality corpus — catastrophic veto is never averaged away', () => {
  it('one or many triggered vetoes both need review, despite abundant positive rates', () => {
    for (const n of [1, 5]) {
      const vetoes = Array.from({ length: n }, (_, i) =>
        observation(`v${i}`, { triggered: true, description: `veto-${i}` }),
      );
      const result = evaluate({
        pol: policy({ catastrophicVetoEnabled: true }),
        exp: explicit({
          catastrophicVetoes: vetoes,
          rateObservations: Array.from({ length: 7 }, (_, i) =>
            observation(`r${i}`, { positive: true, harmful: false }),
          ),
        }),
      });
      expect(result.outcome).toBe('needs-review');
      expect(result.reasons).toEqual(['veto-triggered']);
    }
  });
});

describe('promotion quality corpus — absent or revoked authority gates promotion', () => {
  it('authority-missing and authority-revoked resolve to needs-review, never promote', () => {
    const cases: readonly [PromotionAuthorityResolution, string][] = [
      [unavailable('authority-missing'), 'authority-missing'],
      [resolved({ revoked: true, revocationVersion: 1 }), 'authority-revoked'],
    ];
    for (const [aut, reason] of cases) {
      const result = evaluate({ aut });
      expect(result.outcome).toBe('needs-review');
      expect(result.reasons).toEqual([reason]);
    }
  });
});

describe('promotion quality corpus — retired policy fails closed with history intact', () => {
  it('inactive policy needs review while candidate evidence and ids stay untouched', () => {
    const cand = candidate();
    const exp = explicit({
      catastrophicVetoes: [observation('v', { triggered: true, description: 'v' })],
    });
    const result = evaluate({ cand, exp, pol: policy({ active: false }) });
    expect(result.outcome).toBe('needs-review');
    expect(result.reasons).toEqual(['policy-inactive']);
    expect(result.outcomeIds).toEqual(['evt:a', 'evt:b', 'evt:c']);
    expect(cand.outcomeEvidence).toHaveLength(3);
    expect(Object.isFrozen(cand)).toBe(true);
  });
});

describe('promotion quality corpus — Stage-4 boundary unchanged', () => {
  it('SkillState and MATERIAL_EVENT_TYPES keep their delivered shapes', () => {
    expectTypeOf<SkillState>().toEqualTypeOf<'draft' | 'active' | 'retired'>();
    expect(api.MATERIAL_EVENT_TYPES).toEqual(['work.accepted', 'work.completed']);
  });
});
