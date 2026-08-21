import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createLearningCandidate,
  InMemoryLearningCandidateRepository,
  type LearningCandidate,
  type LearningCandidateRepository,
} from '../src/index.js';

/**
 * In-memory LearningCandidate fake (task 2.4, candidate half): the INSERT-only,
 * append-only revision store — replay converges on equal digests, divergent
 * digests collide, one concurrent parent-claim winner stays current, stale
 * revisions never transition, and every operation is tenant-scoped. The fake
 * mirrors the PostgreSQL INSERT … SELECT semantics in one serialized critical
 * section (JS single-threaded, no internal awaits inside the decision).
 */

const subject = { skillId: 'sdlc-review', skillVersion: 3 };
const scope = { process: 'billing', schemaVersion: 2 };

function outcomeOf(
  evidenceId: string,
  occurredAt: number,
  companyId = 'acme',
): {
  evidenceId: string;
  eventId: string;
  companyId: string;
  subject: { skillId: string; skillVersion: number };
  occurredAt: number;
  workId: string;
} {
  return {
    evidenceId,
    eventId: evidenceId,
    companyId,
    subject,
    occurredAt,
    workId: `work-${evidenceId}`,
  };
}

function candidateFor(
  outcomes: readonly ReturnType<typeof outcomeOf>[],
  companyId = 'acme',
): LearningCandidate {
  const created = createLearningCandidate({
    companyId,
    subject,
    scope,
    outcomes,
    createdAt: 1000,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error('fixture: candidate creation failed');
  return created.value;
}

const first = (): LearningCandidate => candidateFor([outcomeOf('ev-1', 100)]);
const second = (): LearningCandidate => candidateFor([outcomeOf('ev-2', 200)]);

const transition = (reason: string) => ({
  toState: 'needs_review' as const,
  occurredAt: 2000,
  reason,
});

describe('InMemoryLearningCandidateRepository — appendInitial', () => {
  it('appends revision 1 and reads it back as current + listed', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const candidate = first();
    const result = await repo.appendInitial(candidate, 'digest-1');
    expect(result).toBe('appended');
    expect(await repo.getCurrent('acme', candidate.candidateId)).toEqual(candidate);
    expect(await repo.listRevisions('acme', candidate.candidateId)).toEqual([candidate]);
  });

  it('replays a converging retry with the same digest (INSERT … ON CONFLICT DO NOTHING)', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const candidate = first();
    expect(await repo.appendInitial(candidate, 'digest-1')).toBe('appended');
    expect(await repo.appendInitial(candidate, 'digest-1')).toBe('replayed');
    expect(await repo.listRevisions('acme', candidate.candidateId)).toHaveLength(1);
  });

  it('typed idempotency-collision when a reused identity carries a different digest', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const original = first();
    expect(await repo.appendInitial(original, 'digest-1')).toBe('appended');
    // Same (companyId, subject) → same deterministic candidateId, DIFFERENT bytes.
    expect(second().candidateId).toBe(original.candidateId);
    expect(await repo.appendInitial(second(), 'digest-2')).toBe('idempotency-collision');
    expect(await repo.getCurrent('acme', original.candidateId)).toEqual(original);
  });
});

describe('InMemoryLearningCandidateRepository — appendTransition', () => {
  async function seeded(): Promise<InMemoryLearningCandidateRepository> {
    const repo = new InMemoryLearningCandidateRepository();
    await repo.appendInitial(first(), 'digest-1');
    return repo;
  }

  it('stale attempts never mutate: unknown candidate, zero, and over-advanced revisions', async () => {
    const repo = await seeded();
    const id = first().candidateId;
    expect(
      await repo.appendTransition(
        {
          companyId: 'acme',
          candidateId: 'lc:other',
          expectedRevision: 1,
          transition: transition('x'),
        },
        't1',
      ),
    ).toBe('stale');
    expect(
      await repo.appendTransition(
        { companyId: 'acme', candidateId: id, expectedRevision: 0, transition: transition('x') },
        't1',
      ),
    ).toBe('stale');
    expect(
      await repo.appendTransition(
        { companyId: 'acme', candidateId: id, expectedRevision: 5, transition: transition('x') },
        't1',
      ),
    ).toBe('stale');
    expect(await repo.listRevisions('acme', id)).toHaveLength(1);
  });

  it('supersedes the current leaf and records full lineage', async () => {
    const repo = await seeded();
    const id = first().candidateId;
    expect(
      await repo.appendTransition(
        {
          companyId: 'acme',
          candidateId: id,
          expectedRevision: 1,
          transition: transition('policy-1'),
        },
        't1',
      ),
    ).toBe('appended');
    const current = await repo.getCurrent('acme', id);
    expect(current?.revision).toBe(2);
    expect(current?.state).toBe('needs_review');
    expect(current?.supersedesRevision).toBe(1);
    expect(current?.transition).toEqual({
      toState: 'needs_review',
      occurredAt: 2000,
      reason: 'policy-1',
    });
    expect(current?.subject).toEqual(subject);
    expect(current?.scope).toEqual(scope);
    const revisions = await repo.listRevisions('acme', id);
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
  });

  it('replays a converging transition retry and conflicts on a divergent digest', async () => {
    const repo = await seeded();
    const id = first().candidateId;
    const firstTransition = {
      companyId: 'acme',
      candidateId: id,
      expectedRevision: 1,
      transition: transition('winner'),
    };
    expect(await repo.appendTransition(firstTransition, 't1')).toBe('appended');
    expect(await repo.appendTransition(firstTransition, 't1')).toBe('replayed');
    // Occupied parent claim + DIFFERENT digest: the stored current winner stays.
    expect(
      await repo.appendTransition(
        {
          companyId: 'acme',
          candidateId: id,
          expectedRevision: 1,
          transition: transition('loser'),
        },
        't2',
      ),
    ).toBe('conflict');
    const current = await repo.getCurrent('acme', id);
    expect(current?.transition?.reason).toBe('winner');
    expect(await repo.listRevisions('acme', id)).toHaveLength(2);
  });
});

describe('InMemoryLearningCandidateRepository — concurrency (serialized critical section)', () => {
  it('racing identical initial appends converge: exactly one appended, the rest replayed', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const candidate = first();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => repo.appendInitial(candidate, 'same-digest')),
    );
    expect(results.filter((result) => result === 'appended')).toHaveLength(1);
    expect(results.filter((result) => result === 'replayed')).toHaveLength(5);
  });

  it('racing divergent transitions: exactly one parent-claim winner becomes current', async () => {
    const repo = await (async () => {
      const seededRepo = new InMemoryLearningCandidateRepository();
      await seededRepo.appendInitial(first(), 'digest-1');
      return seededRepo;
    })();
    const id = first().candidateId;
    const reasons = ['r-0', 'r-1', 'r-2', 'r-3', 'r-4', 'r-5'];
    const results = await Promise.all(
      reasons.map((reason, index) =>
        repo.appendTransition(
          {
            companyId: 'acme',
            candidateId: id,
            expectedRevision: 1,
            transition: transition(reason),
          },
          `t-${index}`,
        ),
      ),
    );
    expect(results.filter((result) => result === 'appended')).toHaveLength(1);
    expect(results.filter((result) => result === 'conflict')).toHaveLength(5);
    const winnerIndex = results.indexOf('appended');
    expect((await repo.getCurrent('acme', id))?.transition?.reason).toBe(reasons[winnerIndex]);
    expect(await repo.listRevisions('acme', id)).toHaveLength(2);
  });
});

describe('InMemoryLearningCandidateRepository — tenant scoping', () => {
  it('rejects an empty companyId before any storage access', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const candidate = first();
    await expect(repo.getCurrent('', candidate.candidateId)).rejects.toThrow(
      'a non-empty companyId is required',
    );
    await expect(repo.listRevisions('', candidate.candidateId)).rejects.toThrow(
      'a non-empty companyId is required',
    );
    await expect(repo.appendInitial({ ...candidate, companyId: '' }, 'd')).rejects.toThrow(
      'a non-empty companyId is required',
    );
  });

  it('a foreign tenant never resolves another company candidate', async () => {
    const repo = new InMemoryLearningCandidateRepository();
    const candidate = first();
    await repo.appendInitial(candidate, 'digest-1');
    await repo.appendInitial(candidateFor([outcomeOf('ev-9', 900, 'other')], 'other'), 'digest-1');
    expect(await repo.getCurrent('other', candidate.candidateId)).toBeUndefined();
    expect(await repo.listRevisions('other', candidate.candidateId)).toEqual([]);
  });

  it('exposes the closed INSERT-only verb set (no update/delete surface)', () => {
    const repo = new InMemoryLearningCandidateRepository();
    expect('update' in repo).toBe(false);
    expect('delete' in repo).toBe(false);
    // @ts-expect-error — the learning repository has no update method
    void repo.update;
    expectTypeOf<InMemoryLearningCandidateRepository>().toMatchTypeOf<LearningCandidateRepository>();
  });
});
