import {
  InMemoryBusinessEventRepository,
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  InMemorySkillRepository,
  promotionScopeFor,
  type AuthorityTransitionProof,
  type BusinessEvent,
  type BusinessEventRepository,
  type LearningSubject,
  type PromotionPolicy,
  type Skill,
} from '@io/business-domain/src/index.js';
import { describe, expect, it } from 'vitest';

import { evaluateLearningPromotionForCompany } from '../../src/learning/evaluate.js';
import type { LearningEvaluationResult } from '../../src/learning/evaluate.js';

/**
 * App learning evaluation seam — EXTENDED (task 2.2, W3C2): the typed
 * authority-failure matrix (never promote), skill misresolution guards,
 * malformed explicit evidence, zero outcomes, loaded conflict escalation, and
 * foreign-event isolation through a leaking-ish event stream.
 */

const subject: LearningSubject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = { process: 'billing', schemaVersion: 2 };
const policyRef = { policyId: 'pol-1', version: 1 };
const trusted = { principalId: 'principal-promoter', actorId: 'actor-verifier' };

function makeSkill(state: Skill['state'] = 'active'): Skill {
  return {
    skillId: subject.skillId,
    companyId: 'acme',
    name: 'SDL review',
    version: subject.skillVersion,
    body: 'skill body',
    scope,
    state,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeEvent(
  eventId: string,
  workId: string,
  occurredAt: number,
  companyId = 'acme',
): BusinessEvent {
  return {
    eventId,
    companyId,
    aggregateKind: 'work',
    aggregateId: workId,
    eventType: 'work.skill-outcome',
    occurredAt,
    payload: {
      version: 1,
      activatedSkills: [{ skillId: subject.skillId, version: subject.skillVersion }],
    },
    source: 'worker',
  };
}

function makePolicy(overrides: Partial<PromotionPolicy> = {}): PromotionPolicy {
  return {
    policyId: 'pol-1',
    version: 1,
    companyId: 'acme',
    scope,
    subject,
    active: true,
    effectiveFrom: 0,
    effectiveUntil: 99999,
    observationWindowMs: 3600000,
    minPositiveObservations: 1,
    minLinkedOutcomes: 1,
    requireUniqueOutcomes: true,
    conflictBehavior: 'needs-review',
    delegatedRiskClasses: ['low'],
    ...overrides,
  };
}

function makeProof(
  overrides: Partial<AuthorityTransitionProof> = {},
): Omit<AuthorityTransitionProof, 'current'> {
  return {
    proofId: 'proof-1',
    proofRevision: 1,
    transitionId: 'tr-1',
    transitionRevision: 1,
    kind: 'verification',
    companyId: 'acme',
    subject,
    actorId: 'actor-verifier',
    principalId: 'principal-promoter',
    delegationId: 'del-1',
    grantId: 'del-1',
    command: 'learning.promote',
    capability: 'learning.promote',
    scope: promotionScopeFor('acme', subject),
    policyRef,
    issuedAt: 100,
    effectiveFrom: 100,
    expiry: 99999,
    revoked: false,
    revocationVersion: 0,
    ...overrides,
  };
}

interface Harness {
  skills: InMemorySkillRepository;
  events: InMemoryBusinessEventRepository;
  delegation: InMemoryDelegationRepository;
  authority: InMemoryPromotionAuthorityRepository;
}

async function harness(): Promise<Harness> {
  const skills = new InMemorySkillRepository();
  const events = new InMemoryBusinessEventRepository();
  const delegation = new InMemoryDelegationRepository();
  await delegation.save({
    delegationId: 'del-1',
    companyId: 'acme',
    delegator: 'owner-1',
    delegate: 'principal-promoter',
    authorityScope: { scope: promotionScopeFor('acme', subject), actions: ['learning.promote'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 99999,
    expectedOutcome: 'promote the skill',
    state: 'active',
  });
  await skills.save(makeSkill());
  await events.append(makeEvent('ev-1', 'w-1', 100));
  await events.append(makeEvent('ev-2', 'w-2', 200));
  return {
    skills,
    events,
    delegation,
    authority: new InMemoryPromotionAuthorityRepository({ delegation }),
  };
}

function expectEvaluatedNeedsReview(
  result: Awaited<ReturnType<typeof evaluateLearningPromotionForCompany>>,
  reasons: readonly string[],
): void {
  expect(result.kind).toBe('evaluated');
  if (result.kind === 'evaluated') {
    expect(result.value.outcome).toBe('needs-review');
    expect(result.value.reasons).toEqual([...reasons]);
  }
}

function expectUnavailable(result: LearningEvaluationResult, reason: string): void {
  expect(result.kind).toBe('unavailable');
  if (result.kind === 'unavailable') expect(result.reason).toBe(reason);
}

describe('evaluateLearningPromotionForCompany — typed authority failures', () => {
  it.each([
    ['authority-missing', undefined],
    ['authority-malformed', { companyId: 'acme', subject, extra: 1 }],
    ['authority-foreign', { companyId: 'other', subject, sourceRef: 'proof-1' }],
  ])('%s never promotes', async (reason, authorityEvidence) => {
    const h = await harness();
    const result = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
        authorityEvidence,
        at: 300,
      },
    );
    expectEvaluatedNeedsReview(result, [reason]);
  });

  it('an unresolvable sourceRef stays typed needs-review', async () => {
    const h = await harness();
    const result = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'nope' },
        at: 300,
      },
    );
    expectEvaluatedNeedsReview(result, ['authority-missing']);
  });

  it('a revoked superseding proof resolves as authority-revoked', async () => {
    const h = await harness();
    await h.authority.appendProof(makeProof());
    await h.authority.appendProof(
      makeProof({
        proofRevision: 2,
        supersedesProofRevision: 1,
        revoked: true,
        revocationVersion: 1,
      }),
    );
    const result = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
        at: 300,
      },
    );
    expectEvaluatedNeedsReview(result, ['authority-revoked']);
  });
});

describe('evaluateLearningPromotionForCompany — guards and wiring', () => {
  it('skill-not-found and skill-not-active fail closed before policy work', async () => {
    const h = await harness();
    const base = {
      companyId: 'acme',
      subject,
      policies: [makePolicy()],
      explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
      authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
      at: 300,
    };
    const notFound = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      { ...base, subject: { skillId: 'nope', skillVersion: 1 } },
    );
    expectUnavailable(notFound, 'skill-not-found');
    const retired = new InMemorySkillRepository();
    await retired.save(makeSkill('retired'));
    const inactive = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: retired, authority: h.authority, trusted },
      base,
    );
    expectUnavailable(inactive, 'skill-not-active');
  });

  it('malformed explicit evidence and zero outcomes are typed, never harmful', async () => {
    const h = await harness();
    const malformed = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: 'nope' },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
        at: 300,
      },
    );
    expectUnavailable(malformed, 'explicit-evidence-malformed');
    const empty = new InMemoryBusinessEventRepository();
    const none = await evaluateLearningPromotionForCompany(
      { events: empty, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
        at: 300,
      },
    );
    expectUnavailable(none, 'no-matching-outcomes');
  });

  it('a loaded unresolved conflict escalates to typed needs-review', async () => {
    const h = await harness();
    await h.authority.appendProof(makeProof());
    const result = await evaluateLearningPromotionForCompany(
      { events: h.events, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: {
          conflicts: [
            {
              evidenceId: 'conf-1',
              companyId: 'acme',
              subject,
              sourceRef: 'ref-1',
              observedAt: 150,
              value: { unresolved: true, description: 'open conflict' },
            },
          ],
          catastrophicVetoes: [],
        },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
        at: 300,
      },
    );
    expectEvaluatedNeedsReview(result, ['conflict-unresolved']);
  });

  it('excludes foreign-tenant events even when the stream carries them', async () => {
    const h = await harness();
    const leaky: BusinessEventRepository = {
      append: (event) => h.events.append(event),
      appendIfAbsent: (event) => h.events.appendIfAbsent(event),
      listByCompany: async (companyId: string) => [
        ...(await h.events.listByCompany(companyId)),
        makeEvent('ev-foreign', 'w-foreign', 150, 'other'),
      ],
      listCompanyIds: () => h.events.listCompanyIds(),
    };
    await h.authority.appendProof(makeProof());
    const result = await evaluateLearningPromotionForCompany(
      { events: leaky, skills: h.skills, authority: h.authority, trusted },
      {
        companyId: 'acme',
        subject,
        policies: [makePolicy()],
        explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
        authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
        at: 300,
      },
    );
    expect(result.kind).toBe('evaluated');
    if (result.kind === 'evaluated') {
      expect(result.value.outcome).toBe('promote');
      expect(result.value.outcomeIds).toEqual(['ev-1', 'ev-2']);
    }
  });
});
