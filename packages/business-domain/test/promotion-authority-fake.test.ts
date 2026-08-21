import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  promotionScopeFor,
  type AuthorityTransitionProof,
  type PromotionAuthorityRepository,
  type PromotionAuthorityResolutionInput,
} from '../src/index.js';

/**
 * In-memory PromotionAuthority fake — CORE behavior (task 2.4, W3B1): the
 * append-only proof store with the typed replay/conflict outcomes, current-leaf
 * derivation (supersede chains), revocation, tenant scoping, and the closed
 * INSERT-only surface. The extended coverage file
 * (`promotion-authority-coverage.test.ts`) exercises the remaining typed
 * unavailability reasons and delegation validation.
 */

const subject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = promotionScopeFor('acme', subject);
const policyRef = { policyId: 'pol-1', version: 1 };

type Proof = Omit<AuthorityTransitionProof, 'current'>;

function proofOver(overrides: Partial<AuthorityTransitionProof> = {}): Proof {
  return {
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
    scope,
    policyRef,
    issuedAt: 1000,
    effectiveFrom: 1000,
    expiry: 2000,
    revoked: false,
    revocationVersion: 0,
    ...overrides,
  };
}

function activeDelegationRepo(): InMemoryDelegationRepository {
  const repo = new InMemoryDelegationRepository();
  void repo.save({
    delegationId: 'del-1',
    companyId: 'acme',
    delegator: 'owner-1',
    delegate: 'principal-1',
    authorityScope: { scope, actions: ['learning.promote'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 9999,
    expectedOutcome: 'promote the skill',
    state: 'active',
  });
  return repo;
}

function resolveInput(
  overrides: Partial<PromotionAuthorityResolutionInput> = {},
): PromotionAuthorityResolutionInput {
  return {
    sourceRef: 'proof-1',
    companyId: 'acme',
    subject,
    policyRef,
    at: 1500,
    expectedPrincipalId: 'principal-1',
    expectedActorId: 'actor-1',
    command: 'learning.promote',
    capability: 'learning.promote',
    scope,
    ...overrides,
  };
}

describe('InMemoryPromotionAuthorityRepository — resolution core', () => {
  it('resolves the current verification leaf with current:true', async () => {
    const repo = new InMemoryPromotionAuthorityRepository({
      delegation: activeDelegationRepo(),
    });
    expect(await repo.appendProof(proofOver())).toBe('appended');
    expect(await repo.resolve(resolveInput())).toEqual({
      kind: 'resolved',
      value: { ...proofOver(), current: true },
    });
  });

  it('a superseding revision becomes the current leaf', async () => {
    const repo = new InMemoryPromotionAuthorityRepository({
      delegation: activeDelegationRepo(),
    });
    await repo.appendProof(proofOver());
    await repo.appendProof(
      proofOver({ proofRevision: 2, supersedesProofRevision: 1, issuedAt: 1200 }),
    );
    const resolution = await repo.resolve(resolveInput());
    expect(resolution.kind).toBe('resolved');
    if (resolution.kind === 'resolved') {
      expect(resolution.value.proofRevision).toBe(2);
      expect(resolution.value.supersedesProofRevision).toBe(1);
    }
  });

  it('a revoked superseding revision resolves as authority-revoked', async () => {
    const repo = new InMemoryPromotionAuthorityRepository({
      delegation: activeDelegationRepo(),
    });
    await repo.appendProof(proofOver());
    await repo.appendProof(
      proofOver({
        proofRevision: 2,
        supersedesProofRevision: 1,
        revoked: true,
        revocationVersion: 1,
      }),
    );
    expect(await repo.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-revoked',
    });
  });

  it('authority-missing for an unknown sourceRef and a foreign tenant', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    expect(await repo.resolve(resolveInput({ sourceRef: 'nope' }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-missing',
    });
    expect(await repo.resolve(resolveInput({ companyId: 'other' }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-missing',
    });
  });

  it('rejects an empty tenant on every operation before storage', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await expect(repo.appendProof({ ...proofOver(), companyId: '' })).rejects.toThrow(
      'a non-empty companyId is required',
    );
    await expect(repo.resolve(resolveInput({ companyId: '' }))).rejects.toThrow(
      'a non-empty companyId is required',
    );
  });
});

describe('InMemoryPromotionAuthorityRepository — appendProof core', () => {
  it('replays identical appends and conflicts on divergent bytes under one identity', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    expect(await repo.appendProof(proofOver())).toBe('appended');
    expect(await repo.appendProof(proofOver())).toBe('replayed');
    expect(
      await repo.appendProof(proofOver({ policyRef: { policyId: 'pol-2', version: 2 } })),
    ).toBe('conflict');
  });

  it('rejects a supersede target that does not exist (self-FK parity)', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await expect(
      repo.appendProof(proofOver({ proofRevision: 2, supersedesProofRevision: 1 })),
    ).rejects.toThrow('supersedes');
  });

  it('exposes the closed INSERT-only verb set (no update/delete surface)', () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    expect('update' in repo).toBe(false);
    expect('delete' in repo).toBe(false);
    // @ts-expect-error — the authority repository has no update method
    void repo.update;
    expectTypeOf<InMemoryPromotionAuthorityRepository>().toMatchTypeOf<PromotionAuthorityRepository>();
  });
});
