import {
  InMemoryDelegationRepository,
  InMemoryPromotionAuthorityRepository,
  InMemoryWorkRepository,
  promotionScopeFor,
  type FencingDirective,
  type LearningSubject,
  type Work,
  type WorkRepository,
} from '@io/business-domain/src/index.js';
import type { DbConnection } from '@io/database/src/connection.js';
import { describe, expect, it } from 'vitest';

import { verifyWorkWithProofAtomically } from '../src/worker/verify.js';

/**
 * Worker verify hook — COVERAGE (task 2.6, W3D2): revocation supersedes the
 * appended proof; a missing delegation and a CAS version-conflict abort with
 * ZERO writes (the win + proof rollback paths live in `worker-verify-work.test.ts`).
 */

const subject: LearningSubject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = promotionScopeFor('acme', subject);
const policyRef = { policyId: 'pol-1', version: 1 };

function completedWork(): Work {
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
  };
}

/** Work fake whose CAS always loses (version-conflict), never mutating. */
class RacedWorkRepository implements WorkRepository {
  private entries = new Map<string, Work>();

  save(work: Work): Promise<Readonly<Work>> {
    this.entries.set(work.workId, work);
    return Promise.resolve(work);
  }

  get(companyId: string, workId: string): Promise<Work | undefined> {
    const entry = this.entries.get(workId);
    return Promise.resolve(
      entry !== undefined && entry.companyId === companyId ? entry : undefined,
    );
  }

  updateIfVersion(_work: Work, _expectedVersion: number, _fencing?: FencingDirective) {
    return Promise.resolve({
      ok: false as const,
      reason: 'version-conflict' as const,
      current: completedWork(),
    });
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
}

/** A pass-through one-shot transaction double (no repository rollback here). */
function connection(): DbConnection {
  return {
    execute: () => Promise.resolve(undefined),
    query: <T>() => Promise.resolve([] as readonly T[]),
    transaction: <T>(fn: (conn: DbConnection) => Promise<T>) =>
      fn({
        execute: () => Promise.resolve(undefined),
        query: <U>() => Promise.resolve([] as readonly U[]),
        transaction: () => Promise.reject(new Error('nested transactions are forbidden')),
      }),
  };
}

async function activeDelegation(): Promise<InMemoryDelegationRepository> {
  const delegation = new InMemoryDelegationRepository();
  await delegation.save({
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
  });
  return delegation;
}

function input() {
  return { companyId: 'acme', workId: 'work-1', subject, policyRef };
}

describe('verifyWorkWithProofAtomically — coverage', () => {
  it('a revoked superseding revision makes the appended proof resolve revoked', async () => {
    const work = new InMemoryWorkRepository();
    await work.save(completedWork());
    const delegation = await activeDelegation();
    const authority = new InMemoryPromotionAuthorityRepository({ delegation });
    const result = await verifyWorkWithProofAtomically(
      {
        repositories: () => ({ work, delegation, authority }),
        connection: connection(),
        verifier: 'actor-verifier',
        now: () => 500,
      },
      input(),
    );
    if (!result.ok) throw new Error('fixture: expected the verify win');
    const { current: _current, ...rest } = result.proof;
    expect(
      await authority.appendProof({
        ...rest,
        proofRevision: 2,
        supersedesProofRevision: 1,
        revoked: true,
        revocationVersion: 1,
      }),
    ).toBe('appended');
    expect(
      await authority.resolve({
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
      }),
    ).toEqual({ kind: 'unavailable', reason: 'authority-revoked' });
  });

  it('a missing delegation aborts with zero writes', async () => {
    const work = new InMemoryWorkRepository();
    await work.save(completedWork());
    const delegation = new InMemoryDelegationRepository();
    const authority = new InMemoryPromotionAuthorityRepository({ delegation });
    const result = await verifyWorkWithProofAtomically(
      {
        repositories: () => ({ work, delegation, authority }),
        connection: connection(),
        verifier: 'actor-verifier',
        now: () => 500,
      },
      input(),
    );
    expect(result).toEqual({ ok: false, reason: 'delegation-unavailable' });
    expect((await work.get('acme', 'work-1'))?.state).toBe('completed');
    expect(
      await authority.resolve({
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
      }),
    ).toEqual({ kind: 'unavailable', reason: 'authority-missing' });
  });

  it('a version-conflict CAS loss is typed and never appends a proof', async () => {
    const raced = new RacedWorkRepository();
    await raced.save(completedWork());
    const delegation = await activeDelegation();
    const authority = new InMemoryPromotionAuthorityRepository({ delegation });
    const result = await verifyWorkWithProofAtomically(
      {
        repositories: () => ({ work: raced, delegation, authority }),
        connection: connection(),
        verifier: 'actor-verifier',
        now: () => 500,
      },
      input(),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'version-conflict',
      current: completedWork(),
    });
    expect((await raced.get('acme', 'work-1'))?.state).toBe('completed');
    expect(
      await authority.resolve({
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
      }),
    ).toEqual({ kind: 'unavailable', reason: 'authority-missing' });
  });
});
