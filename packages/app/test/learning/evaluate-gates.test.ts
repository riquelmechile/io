import {
  InMemoryBusinessEventRepository,
  InMemoryPromotionAuthorityRepository,
  InMemorySkillRepository,
  type BusinessEvent,
  type LearningSubject,
  type PromotionPolicy,
  type Skill,
} from '@io/business-domain/src/index.js';
import { describe, expect, it } from 'vitest';

import { evaluateLearningPromotionForCompany } from '../../src/learning/evaluate.js';
import type { LearningEvaluationResult } from '../../src/learning/evaluate.js';
import { RecordingEvents, RecordingSkills } from '../worker-helpers.js';

/**
 * App learning evaluation seam — GATE guards (task 2.2, W3C2): typed
 * policy-invalid/policy-ambiguous BEFORE event reads, tenant rejection BEFORE
 * ANY repository access, and typed invalid-input BEFORE storage. No proof
 * seeding needed here: policy/top guards fire before authority resolution.
 */

const subject: LearningSubject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = { process: 'billing', schemaVersion: 2 };
const trusted = { principalId: 'principal-promoter', actorId: 'actor-verifier' };

function makeSkill(): Skill {
  return {
    skillId: subject.skillId,
    companyId: 'acme',
    name: 'SDL review',
    version: subject.skillVersion,
    body: 'skill body',
    scope,
    state: 'active',
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeEvent(): BusinessEvent {
  return {
    eventId: 'ev-1',
    companyId: 'acme',
    aggregateKind: 'work',
    aggregateId: 'w-1',
    eventType: 'work.skill-outcome',
    occurredAt: 100,
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

function expectUnavailable(result: LearningEvaluationResult, reason: string): void {
  expect(result.kind).toBe('unavailable');
  if (result.kind === 'unavailable') expect(result.reason).toBe(reason);
}

describe('evaluateLearningPromotionForCompany — gate guards', () => {
  it('policy-invalid and policy-ambiguous are typed, before any event read', async () => {
    const skills = new RecordingSkills();
    const events = new RecordingEvents();
    await skills.save(makeSkill());
    await events.append(makeEvent());
    const authority = new InMemoryPromotionAuthorityRepository();
    const base = {
      companyId: 'acme',
      subject,
      explicitEvidence: { conflicts: [], catastrophicVetoes: [] },
      authorityEvidence: { companyId: 'acme', subject, sourceRef: 'proof-1' },
      at: 300,
    };
    const malformed = await evaluateLearningPromotionForCompany(
      { events, skills, authority, trusted },
      { ...base, policies: [makePolicy({ active: 'yes' as unknown as boolean })] },
    );
    expectUnavailable(malformed, 'policy-invalid');
    const ambiguous = await evaluateLearningPromotionForCompany(
      { events, skills, authority, trusted },
      { ...base, policies: [makePolicy({ policyId: 'pol-a' }), makePolicy({ policyId: 'pol-b' })] },
    );
    expectUnavailable(ambiguous, 'policy-ambiguous');
    expect(skills.listCalls).toEqual(['acme', 'acme']);
    expect(events.listCalls).toEqual([]);
  });

  it('rejects an empty tenant before any repository read', async () => {
    const skills = new RecordingSkills();
    const events = new RecordingEvents();
    const empty = () =>
      evaluateLearningPromotionForCompany(
        {
          events,
          skills,
          authority: new InMemoryPromotionAuthorityRepository(),
          trusted,
        },
        {
          companyId: '',
          subject,
          policies: [],
          explicitEvidence: null,
          authorityEvidence: null,
          at: 1,
        },
      );
    await expect(empty()).rejects.toThrow('a non-empty companyId is required');
    expect(skills.listCalls).toEqual([]);
    expect(events.listCalls).toEqual([]);
  });

  it('invalid input (non-positive skill version) is typed before any storage access', async () => {
    const skills = new RecordingSkills();
    const events = new RecordingEvents();
    const result = await evaluateLearningPromotionForCompany(
      {
        events,
        skills,
        authority: new InMemoryPromotionAuthorityRepository(),
        trusted,
      },
      {
        companyId: 'acme',
        subject: { skillId: subject.skillId, skillVersion: 0 },
        policies: [],
        explicitEvidence: null,
        authorityEvidence: null,
        at: 1,
      },
    );
    expectUnavailable(result, 'invalid-input');
    expect(skills.listCalls).toEqual([]);
    expect(events.listCalls).toEqual([]);
  });
});
