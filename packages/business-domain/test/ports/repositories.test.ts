import { describe, expect, it } from 'vitest';

import type { Work } from '../../src/types.js';
import type { CasResult } from '../../src/ports/repositories.js';
import { InMemoryWorkRepository } from '../../src/ports/fakes.js';

/**
 * WorkRepository recovery-designation port contract (supervisor-recovery design
 * D2, work-lifecycle "Operator Recovery Designation", scenario "Recovery
 * metadata stays outside Work"): `listRecoveryRequestedByCompany` + the
 * `setRecoveryRequest` marker CAS, as implemented by
 * {@link InMemoryWorkRepository}. Partial-index semantics (migration 011): only
 * `in_progress` Work with the marker set is ever discovered; the marker is a
 * SIDE store — the domain `Work` type stays pure and never carries it.
 */

function sampleWork(id: string, companyId = 'acme'): Work {
  return {
    workId: id,
    companyId,
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the quarterly close',
    state: 'proposed',
    version: 1,
    fencingToken: 0,
    evidenceRefs: ['evid-a', 'evid-b'],
  };
}

describe('WorkRepository.listRecoveryRequestedByCompany — partial-index semantics', () => {
  it("returns ONLY the tenant's in_progress Work whose marker is set, across mixed state/tenant data", async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress' });
    await repo.save({ ...sampleWork('work-2'), state: 'accepted' });
    await repo.save({ ...sampleWork('work-3'), state: 'in_progress' });
    await repo.save({ ...sampleWork('work-4', 'other'), state: 'in_progress' });
    await repo.save({ ...sampleWork('work-5'), state: 'in_progress' });

    // Designate: in_progress work-1 + work-5, accepted work-2, OTHER tenant work-4.
    expect((await repo.setRecoveryRequest('acme', 'work-1', 1, true)).ok).toBe(true);
    expect((await repo.setRecoveryRequest('acme', 'work-2', 1, true)).ok).toBe(true);
    expect((await repo.setRecoveryRequest('other', 'work-4', 1, true)).ok).toBe(true);
    expect((await repo.setRecoveryRequest('acme', 'work-5', 1, true)).ok).toBe(true);

    const listed = await repo.listRecoveryRequestedByCompany('acme');
    expect(listed.map((w) => w.workId)).toEqual(['work-1', 'work-5']);
    for (const work of listed) {
      expect(work.companyId).toBe('acme');
      expect(work.state).toBe('in_progress');
      expect(Object.keys(work)).not.toContain('recoveryRequested');
    }
  });

  it('an in_progress Work WITHOUT the marker is never listed (marker is the gate)', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress' });
    await repo.save({ ...sampleWork('work-2'), state: 'in_progress' });
    await repo.setRecoveryRequest('acme', 'work-2', 1, true);

    expect((await repo.listRecoveryRequestedByCompany('acme')).map((w) => w.workId)).toEqual([
      'work-2',
    ]);
  });

  it('a designated Work that leaves in_progress drops out of discovery (designated completed → empty)', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress' });
    await repo.setRecoveryRequest('acme', 'work-1', 1, true);
    // The terminal close moves the Work out of in_progress; the stale marker
    // must NOT resurrect it into discovery (the partial index predicate).
    const current = await repo.get('acme', 'work-1');
    if (current === undefined) throw new Error('test setup: work not seeded');
    await repo.updateIfVersion({ ...current, state: 'completed' }, current.version);

    expect(await repo.listRecoveryRequestedByCompany('acme')).toEqual([]);
  });

  it('no designated in_progress Work for the tenant resolves to an EMPTY list (with data present elsewhere)', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1', 'other'), state: 'in_progress' });
    await repo.setRecoveryRequest('other', 'work-1', 1, true);
    await repo.save({ ...sampleWork('work-2'), state: 'in_progress' });

    expect(await repo.listRecoveryRequestedByCompany('acme')).toEqual([]);
  });

  it('an empty companyId rejects BEFORE any store read', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress' });
    await repo.setRecoveryRequest('acme', 'work-1', 1, true);

    // Instrument the Work store: ANY read would have produced a result, so a
    // guard error plus zero reads proves rejection precedes every store read
    // (ADR-0002/R8, fake parity with the PG adapter guard).
    const store = (repo as unknown as { entries: Map<string, Work> }).entries;
    const originalValues = store.values.bind(store);
    let reads = 0;
    store.values = (() => {
      reads += 1;
      return originalValues();
    }) as typeof store.values;

    await expect(repo.listRecoveryRequestedByCompany('')).rejects.toThrow(
      'a non-empty companyId is required',
    );
    expect(reads).toBe(0);
  });
});

describe('WorkRepository.setRecoveryRequest — plain marker CAS (typed CasResult)', () => {
  it('matching version: ok, version N → N + 1, state and fencingToken UNCHANGED, marker set', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress', version: 2, fencingToken: 4 });

    const result = (await repo.setRecoveryRequest('acme', 'work-1', 2, true)) as Extract<
      CasResult,
      { ok: true }
    >;

    expect(result.ok).toBe(true);
    expect(result.value.version).toBe(3);
    expect(result.value.state).toBe('in_progress');
    expect(result.value.fencingToken).toBe(4); // NO new token minted
    expect(result.value.workId).toBe('work-1');
    expect(Object.keys(result.value)).not.toContain('recoveryRequested');

    const stored = await repo.get('acme', 'work-1');
    expect(stored?.version).toBe(3);
    expect(stored?.state).toBe('in_progress');
    expect(stored?.fencingToken).toBe(4);
  });

  it('stale expectedVersion: typed version-conflict with current, marker NOT set, stored work unchanged', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress', version: 2 });

    const result = (await repo.setRecoveryRequest('acme', 'work-1', 1, true)) as Extract<
      CasResult,
      { ok: false }
    >;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('version-conflict');
    expect(result.current?.version).toBe(2);
    expect(result.current?.state).toBe('in_progress');
    expect(await repo.listRecoveryRequestedByCompany('acme')).toEqual([]);
    expect((await repo.get('acme', 'work-1'))?.version).toBe(2);
  });

  it('an absent work returns typed version-conflict (never fabricate)', async () => {
    const repo = new InMemoryWorkRepository();
    const result = await repo.setRecoveryRequest('acme', 'ghost', 1, true);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('version-conflict');
  });

  it('a wrong-tenant CAS returns typed version-conflict WITHOUT a current (scoped read resolves not-found)', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress' });

    const result = (await repo.setRecoveryRequest('other', 'work-1', 1, true)) as Extract<
      CasResult,
      { ok: false }
    >;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('version-conflict');
    expect(result.current).toBeUndefined();
    // The OWNING tenant is untouched and still discoverable after ITS designation.
    await repo.setRecoveryRequest('acme', 'work-1', 1, true);
    expect((await repo.listRecoveryRequestedByCompany('acme')).map((w) => w.workId)).toEqual([
      'work-1',
    ]);
  });

  it('clearing (requested=false) removes the marker while version still bumps; re-designation is a fresh CAS', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1'), state: 'in_progress', version: 2 });
    await repo.setRecoveryRequest('acme', 'work-1', 2, true);
    expect((await repo.listRecoveryRequestedByCompany('acme')).map((w) => w.workId)).toEqual([
      'work-1',
    ]);

    const cleared = (await repo.setRecoveryRequest('acme', 'work-1', 3, false)) as Extract<
      CasResult,
      { ok: true }
    >;
    expect(cleared.ok).toBe(true);
    expect(cleared.value.version).toBe(4);
    expect(cleared.value.state).toBe('in_progress');
    expect(await repo.listRecoveryRequestedByCompany('acme')).toEqual([]);

    // Explicit re-designation (spec S4: a later operator action) succeeds.
    const reDesignated = (await repo.setRecoveryRequest('acme', 'work-1', 4, true)) as Extract<
      CasResult,
      { ok: true }
    >;
    expect(reDesignated.ok).toBe(true);
    expect(reDesignated.value.version).toBe(5);
    expect((await repo.listRecoveryRequestedByCompany('acme')).map((w) => w.workId)).toEqual([
      'work-1',
    ]);
  });

  it('rejects an empty companyId (same guard as every other repository method)', async () => {
    const repo = new InMemoryWorkRepository();
    await expect(repo.setRecoveryRequest('', 'work-1', 1, true)).rejects.toThrow(/companyId/i);
  });
});
