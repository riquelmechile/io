import {
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  promotionScopeFor,
  type DelegationRepository,
  type FencingDirective,
  type LearningSubject,
  type PromotionAuthorityResolutionInput,
  type Work,
  type WorkRepository,
} from '@io/business-domain/src/index.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { describe, expect, it } from 'vitest';

import { verifyWorkWithProofAtomically, type VerifyWorkResult } from '../src/worker/verify.js';

/**
 * Worker verify hook (task 2.6, W3D1): ONE transaction = `completed → verified`
 * CAS win + proof append; failures roll BOTH back. Races: coverage test file.
 */

const subject: LearningSubject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = promotionScopeFor('acme', subject);
const policyRef = { policyId: 'pol-1', version: 1 };

function completedWork(overrides: Partial<Work> = {}): Work {
  return {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-proposer',
    description: 'promote the learning candidate',
    state: 'completed',
    version: 3,
    fencingToken: 0,
    evidenceRefs: [],
    ...overrides,
  };
}

function activeDelegation(): Parameters<DelegationRepository['save']>[0] {
  return {
    delegationId: 'del-1',
    companyId: 'acme',
    delegator: 'owner-1',
    delegate: 'principal-promoter',
    authorityScope: { scope, actions: ['learning.promote'] },
    budget: { currency: 'usd', limit: 1000 },
    validFrom: 0,
    validUntil: 99999,
    expectedOutcome: 'promote the skill',
    state: 'active',
  };
}

/** Test work repository with snapshot/restore for REAL rollback assertions. */
class TxWorkRepository implements WorkRepository {
  private entries = new Map<string, Work>();
  private snapshotEntries = new Map<string, Work>();

  constructor(casper: (current: Work) => boolean = () => true) {
    this.casper = casper;
  }

  private readonly casper: (current: Work) => boolean;

  save(work: Work): Promise<Readonly<Work>> {
    if (this.entries.has(work.workId)) throw new Error(`Work already exists: ${work.workId}`);
    this.entries.set(work.workId, work);
    return Promise.resolve(work);
  }

  get(companyId: string, workId: string): Promise<Work | undefined> {
    const entry = this.entries.get(workId);
    return Promise.resolve(
      entry !== undefined && entry.companyId === companyId ? entry : undefined,
    );
  }

  updateIfVersion(work: Work, expectedVersion: number, _fencing?: FencingDirective) {
    const current = this.entries.get(work.workId);
    if (current === undefined || current.version !== expectedVersion || !this.casper(current)) {
      return Promise.resolve({ ok: false as const, reason: 'version-conflict' as const, current });
    }
    const updated: Work = { ...work, version: expectedVersion + 1 };
    this.entries.set(work.workId, updated);
    return Promise.resolve({ ok: true as const, value: updated });
  }

  listActionableByCompany(): Promise<readonly Work[]> {
    return Promise.resolve([...this.entries.values()]);
  }

  setRecoveryRequest(): ReturnType<WorkRepository['setRecoveryRequest']> {
    return Promise.resolve({ ok: false, reason: 'version-conflict' });
  }

  listRecoveryRequestedByCompany(): Promise<readonly Work[]> {
    return Promise.resolve([]);
  }

  capture(): void {
    this.snapshotEntries = new Map(this.entries);
  }

  restore(): void {
    this.entries = new Map(this.snapshotEntries);
  }
}

/** Capture/restore adapter over the authority fake's snapshot API. */
function authorityStore(authority: InMemoryPromotionAuthorityRepository): {
  capture(): void;
  restore(): void;
} {
  let snapshot: ReturnType<InMemoryPromotionAuthorityRepository['takeSnapshot']> | undefined;
  return {
    capture: () => {
      snapshot = authority.takeSnapshot();
    },
    restore: () => {
      if (snapshot !== undefined) authority.restoreSnapshot(snapshot);
    },
  };
}

/** DbConnection double with a REAL rollback: restores the registered stores. */
class TxRollbackConnection implements DbConnection {
  constructor(private readonly stores: { capture(): void; restore(): void }[]) {}

  execute(): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  query<T>(): Promise<readonly T[]> {
    return Promise.resolve([]);
  }

  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    for (const store of this.stores) store.capture();
    try {
      return await fn(this);
    } catch (error) {
      for (const store of this.stores) store.restore();
      throw error;
    }
  }
}

interface Stores {
  work: TxWorkRepository;
  delegation: DelegationRepository;
  authority: InMemoryPromotionAuthorityRepository;
}

async function freshStores(overrides: Partial<Work> = {}, seedConflict = false): Promise<Stores> {
  const work = new TxWorkRepository();
  await work.save(completedWork(overrides));
  const delegation = new InMemoryDelegationRepository();
  await delegation.save(activeDelegation());
  const authority = new InMemoryPromotionAuthorityRepository({ delegation });
  if (seedConflict) {
    await authority.appendProof({
      proofId: 'other-proof',
      proofRevision: 1,
      transitionId: 'work-1',
      transitionRevision: 1,
      kind: 'verification',
      companyId: 'acme',
      subject,
      actorId: 'actor-9',
      principalId: 'principal-promoter',
      delegationId: 'del-1',
      grantId: 'del-1',
      command: 'learning.promote',
      capability: 'learning.promote',
      scope,
      policyRef: { policyId: 'pol-other', version: 1 },
      issuedAt: 100,
      effectiveFrom: 100,
      expiry: 99999,
      revoked: false,
      revocationVersion: 0,
    });
  }
  return { work, delegation, authority };
}

async function run(stores: Stores): Promise<VerifyWorkResult> {
  const conn = new TxRollbackConnection([stores.work, authorityStore(stores.authority)]);
  return verifyWorkWithProofAtomically(
    {
      repositories: () => stores,
      connection: conn,
      verifier: 'actor-verifier',
      now: () => 500,
    },
    { companyId: 'acme', workId: 'work-1', subject, policyRef },
  );
}

function resolveInput(): PromotionAuthorityResolutionInput {
  return {
    sourceRef: 'proof:work-1',
    companyId: 'acme',
    subject,
    policyRef,
    at: 500,
    expectedPrincipalId: 'principal-promoter',
    expectedActorId: 'actor-verifier',
    command: 'learning.promote',
    capability: 'learning.promote',
    scope,
  };
}

describe('verifyWorkWithProofAtomically — the atomic win', () => {
  it('wins completed → verified and appends the verification proof atomically', async () => {
    const stores = await freshStores();
    const result = await run(stores);
    expect(result).toEqual({
      ok: true,
      work: { ...completedWork(), state: 'verified', version: 4 },
      proof: {
        proofId: 'proof:work-1',
        proofRevision: 1,
        transitionId: 'work-1',
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
        scope,
        policyRef,
        issuedAt: 500,
        effectiveFrom: 0,
        expiry: 99999,
        revoked: false,
        revocationVersion: 0,
        current: true,
      },
    });
    expect(await stores.authority.resolve(resolveInput())).toMatchObject({ kind: 'resolved' });
  });
});

describe('verifyWorkWithProofAtomically — no partial writes', () => {
  it('refuses a non-completed work with zero writes', async () => {
    const stores = await freshStores({ state: 'in_progress' });
    const result = await run(stores);
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-work-state',
      current: completedWork({ state: 'in_progress' }),
    });
    expect((await stores.work.get('acme', 'work-1'))?.state).toBe('in_progress');
    expect(await stores.authority.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-missing',
    });
  });

  it('a proof-identity conflict rolls the CAS back: no verified work, no proof', async () => {
    const stores = await freshStores({}, true);
    const result = await run(stores);
    expect(result).toEqual({ ok: false, reason: 'proof-conflict' });
    expect(await stores.work.get('acme', 'work-1')).toEqual(completedWork());
    expect(await stores.authority.resolve(resolveInput())).toEqual({
      kind: 'unavailable',
      reason: 'authority-missing',
    });
  });
});
