import { describe, expect, it } from 'vitest';

import {
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  promotionScopeFor,
  type AuthorityTransitionProof,
  type PromotionAuthorityResolutionInput,
} from '../src/index.js';

/**
 * In-memory PromotionAuthority fake — EXTENDED coverage (task 2.4, W3B2): the
 * full typed unavailability matrix (ambiguous, foreign, principal, policy,
 * command, stale) plus the delegation-backing validation, the unique transition
 * identity, and proof-PK tenant isolation. Complements
 * `promotion-authority-fake.test.ts` (core resolution + append semantics).
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

function delegationRepo(delegate = 'principal-1', overrides: Record<string, unknown> = {}) {
  const repo = new InMemoryDelegationRepository();
  void repo.save({
    delegationId: 'del-1',
    companyId: 'acme',
    delegator: 'owner-1',
    delegate,
    authorityScope: { scope, actions: ['learning.promote'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 9999,
    expectedOutcome: 'promote the skill',
    state: 'active',
    ...overrides,
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

describe('InMemoryPromotionAuthorityRepository — typed unavailability matrix', () => {
  it('authority-ambiguous when two unconsumed leaves exist for one proof id', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    await repo.appendProof(proofOver({ proofRevision: 2, issuedAt: 1200 }));
    expect(await repo.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-ambiguous',
    });
  });

  it('authority-foreign for a mismatched subject binding or non-canonical scope', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    expect(await repo.resolve(resolveInput({ subject: { skillId: 'other', skillVersion: 3 } }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-foreign',
    });
    await repo.appendProof(proofOver({ proofId: 'proof-2', transitionId: 'tr-2', scope: 'forged:scope' }));
    expect(await repo.resolve(resolveInput({ sourceRef: 'proof-2' }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-foreign',
    });
  });

  it('authority-principal-mismatch for actor or principal disagreement', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    expect(await repo.resolve(resolveInput({ expectedActorId: 'actor-9' }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-principal-mismatch',
    });
    expect(await repo.resolve(resolveInput({ expectedPrincipalId: 'principal-9' }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-principal-mismatch',
    });
  });

  it('authority-policy-mismatch for a stale policy reference', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    expect(await repo.resolve(resolveInput({ policyRef: { policyId: 'pol-2', version: 2 } }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-policy-mismatch',
    });
  });

  it('authority-command-mismatch for a forged row command', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver({ command: 'skill.activate' as unknown as 'learning.promote' }));
    expect(await repo.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-command-mismatch',
    });
  });

  it('authority-stale for expired, future, and post-dated proofs', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    await repo.appendProof(proofOver());
    expect(await repo.resolve(resolveInput({ at: 2500 }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-stale',
    });
    expect(await repo.resolve(resolveInput({ at: 500 }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-stale',
    });
    await repo.appendProof(proofOver({ proofId: 'proof-2', transitionId: 'tr-2', issuedAt: 1600 }));
    expect(await repo.resolve(resolveInput({ sourceRef: 'proof-2', at: 1500 }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-stale',
    });
  });
});

describe('InMemoryPromotionAuthorityRepository — delegation backing validation', () => {
  it('fails closed without a delegation backing and on a missing delegation row', async () => {
    const bare = new InMemoryPromotionAuthorityRepository();
    await bare.appendProof(proofOver());
    expect(await bare.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-proof-unavailable',
    });
    const missing = new InMemoryPromotionAuthorityRepository({
      delegation: new InMemoryDelegationRepository(),
    });
    await missing.appendProof(proofOver());
    expect(await missing.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-proof-unavailable',
    });
  });

  it('rejects a revoked delegation, a delegated-principal conflict, and a clamped window', async () => {
    const revoked = new InMemoryPromotionAuthorityRepository({
      delegation: delegationRepo('principal-1', { state: 'revoked' }),
    });
    await revoked.appendProof(proofOver());
    expect(await revoked.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-proof-unavailable',
    });
    const delegate = new InMemoryPromotionAuthorityRepository({
      delegation: delegationRepo('principal-x'),
    });
    await delegate.appendProof(proofOver());
    expect(await delegate.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-principal-mismatch',
    });
    const clamped = new InMemoryPromotionAuthorityRepository({
      delegation: delegationRepo('principal-1', { validUntil: 1600 }),
    });
    await clamped.appendProof(proofOver());
    expect(await clamped.resolve(resolveInput({ at: 1700 }))).toEqual({
      kind: 'unavailable',
      reason: 'authority-stale',
    });
  });
});

describe('InMemoryPromotionAuthorityRepository — identity semantics', () => {
  it('enforces the unique transition identity across proof ids only', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    expect(await repo.appendProof(proofOver())).toBe('appended');
    expect(
      await repo.appendProof(proofOver({ proofId: 'proof-2', principalId: 'principal-9' })),
    ).toBe('conflict');
  });

  it('tenant-isolates the proof PK (same ids under another tenant append fine)', async () => {
    const repo = new InMemoryPromotionAuthorityRepository();
    expect(await repo.appendProof(proofOver())).toBe('appended');
    expect(await repo.appendProof({ ...proofOver(), companyId: 'other' })).toBe('appended');
  });
});