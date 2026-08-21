import {
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  promotionScopeFor,
  type AuthorityTransitionProof,
  type BusinessEvent,
  type LearningSubject,
  type PromotionAuthorityRepository,
  type PromotionAuthorityResolution,
  type PromotionAuthorityResolutionInput,
  type PromotionPolicy,
  type Skill,
} from '@io/business-domain/src/index.js';
import { describe, expect, it } from 'vitest';

import type { LearningEvaluationResult } from '../../src/learning/evaluate.js';
import { evaluateLearningPromotionForCompany } from '../../src/learning/evaluate.js';
import { RecordingEvents, RecordingSkills } from '../worker-helpers.js';

/**
 * App learning evaluation seam — CORE (task 2.2, W3C1): gold promote, ONE
 * tenant-scoped stream read per repo, ZERO writes, fail-closed policy before
 * reads. Gate guards: `evaluate-gates.test.ts`. Matrices: `evaluate-coverage*.test.ts`.
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

function makeEvent(eventId: string, workId: string, occurredAt: number): BusinessEvent {
  return {
    eventId,
    companyId: 'acme',
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

/** Recording authority double: counts resolves/appends, delegates to the fake. */
class RecordingAuthority implements PromotionAuthorityRepository {
  resolves = 0;
  appends = 0;

  constructor(private readonly inner: PromotionAuthorityRepository) {}

  appendProof(
    proof: Omit<AuthorityTransitionProof, 'current'>,
  ): ReturnType<PromotionAuthorityRepository['appendProof']> {
    this.appends += 1;
    return this.inner.appendProof(proof);
  }

  resolve(input: PromotionAuthorityResolutionInput): Promise<PromotionAuthorityResolution> {
    this.resolves += 1;
    return this.inner.resolve(input);
  }
}

interface Seam {
  events: RecordingEvents;
  skills: RecordingSkills;
  authority: RecordingAuthority;
  result: Awaited<ReturnType<typeof evaluateLearningPromotionForCompany>>;
}

async function evaluate(
  input: Partial<Parameters<typeof evaluateLearningPromotionForCompany>[1]> = {},
): Promise<Seam> {
  const skills = new RecordingSkills();
  const events = new RecordingEvents();
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
  const fake = new InMemoryPromotionAuthorityRepository({ delegation });
  await fake.appendProof(makeProof());
  const authority = new RecordingAuthority(fake);
  await skills.save(makeSkill());
  await events.append(makeEvent('ev-1', 'w-1', 100));
  await events.append(makeEvent('ev-2', 'w-2', 200));
  events.appends.length = 0; // fixture seeding is not a seam write
  const result = await evaluateLearningPromotionForCompany(
    { events, skills, authority, trusted },
    {
      companyId: 'acme',
      subject,
      policies: [makePolicy()],
      explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
      authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
      at: 300,
      ...input,
    },
  );
  return { events, skills, authority, result };
}

function expectUnavailable(result: LearningEvaluationResult, reason: string): void {
  expect(result.kind).toBe('unavailable');
  if (result.kind === 'unavailable') expect(result.reason).toBe(reason);
}

describe('evaluateLearningPromotionForCompany — core', () => {
  it('promotes deterministic gold input through the full seam', async () => {
    const seam = await evaluate();
    expect(seam.result).toEqual({
      kind: 'evaluated',
      value: {
        outcome: 'promote',
        reasons: [],
        policyRef,
        outcomeIds: ['ev-1', 'ev-2'],
      },
    });
  });

  it('reads exactly one tenant-scoped stream per repo and writes nothing', async () => {
    const seam = await evaluate();
    expect(seam.skills.listCalls).toEqual(['acme']);
    expect(seam.events.listCalls).toEqual(['acme']);
    expect(seam.events.appends).toHaveLength(0);
    expect(seam.authority.appends).toBe(0);
    expect(seam.authority.resolves).toBe(1);
  });

  it('policy-not-found stops BEFORE any event read', async () => {
    const seam = await evaluate({ policies: [] });
    expectUnavailable(seam.result, 'policy-not-found');
    expect(seam.skills.listCalls).toEqual(['acme']);
    expect(seam.events.listCalls).toEqual([]);
    expect(seam.authority.resolves).toBe(0);
  });
});
