import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AuthorityTransitionProof,
  LearningCandidate,
  LearningCandidateAppendResult,
  LearningCandidateRepository,
  LearningCandidateTransition,
  PromotionAuthorityAppendResult,
  PromotionAuthorityRepository,
  PromotionAuthorityResolution,
  PromotionAuthorityResolutionInput,
} from '../src/index.js';

const subject = { skillId: 'sdlc-review', skillVersion: 3 };
const proof: AuthorityTransitionProof = {
  proofId: 'proof-1',
  proofRevision: 1,
  transitionId: 'tr-1',
  transitionRevision: 1,
  kind: 'verification',
  companyId: 'acme',
  subject,
  actorId: 'actor-1',
  principalId: 'principal-1',
  delegationId: 'del-1',
  grantId: 'del-1',
  command: 'learning.promote',
  capability: 'learning.promote',
  scope: 'learning.promote',
  policyRef: { policyId: 'pol-1', version: 1 },
  issuedAt: 1000,
  effectiveFrom: 1000,
  expiry: 2000,
  revoked: false,
  revocationVersion: 0,
  current: true,
};

describe('repository ports — typed learning-candidate surfaces (task 1.9)', () => {
  it('candidate appends expose the five closed results', () => {
    expectTypeOf<LearningCandidateRepository>().toMatchTypeOf<{
      appendInitial: (
        item: LearningCandidate,
        digest: string,
      ) => Promise<LearningCandidateAppendResult>;
      appendTransition: (
        item: LearningCandidateTransition,
        digest: string,
      ) => Promise<LearningCandidateAppendResult>;
      getCurrent: (
        companyId: string,
        candidateId: string,
      ) => Promise<LearningCandidate | undefined>;
      listRevisions: (
        companyId: string,
        candidateId: string,
      ) => Promise<readonly LearningCandidate[]>;
    }>();
    const verbs: LearningCandidateAppendResult[] = [
      'appended',
      'replayed',
      'stale',
      'conflict',
      'idempotency-collision',
    ];
    expect(new Set(verbs).size).toBe(5);
    // @ts-expect-error — append results are a closed set
    const badVerb: LearningCandidateAppendResult = 'updated';
    expect(badVerb).toBe('updated');
  });
  it('authority proofs append and resolve through the design contracts', () => {
    expectTypeOf<PromotionAuthorityRepository>().toMatchTypeOf<{
      appendProof: (
        item: Omit<AuthorityTransitionProof, 'current'>,
      ) => Promise<PromotionAuthorityAppendResult>;
      resolve: (input: PromotionAuthorityResolutionInput) => Promise<PromotionAuthorityResolution>;
    }>();
    const input: PromotionAuthorityResolutionInput = {
      sourceRef: 'proof-1',
      companyId: 'acme',
      subject,
      policyRef: { policyId: 'pol-1', version: 1 },
      at: 1500,
      expectedPrincipalId: 'principal-1',
      expectedActorId: 'actor-1',
      command: 'learning.promote',
      capability: 'learning.promote',
      scope: 'learning.promote',
    };
    expect(input.command).toBe('learning.promote');
    // @ts-expect-error — command is the exact learning.promote literal
    const badCommand: PromotionAuthorityResolutionInput['command'] = 'skill.activate';
    expect(badCommand).toBe('skill.activate');
    // @ts-expect-error — proofs are current leaves only
    const badProof: AuthorityTransitionProof = { ...proof, current: false };
    expect(badProof.proofId).toBe('proof-1');
  });
});
