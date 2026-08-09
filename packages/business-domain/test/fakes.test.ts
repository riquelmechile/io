import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { BusinessEvent, BusinessReceipt, Company, Delegation, Work } from '../src/types.js';
import type { CasResult } from '../src/ports/repositories.js';
import type { JournalEntry } from '../src/ports/idempotency.js';
import {
  DurableJournalFake,
  InMemoryBusinessEventRepository,
  InMemoryBusinessReceiptRepository,
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryHeartbeatCursorStore,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '../src/ports/fakes.js';
import type { JournalFakePersistence } from '../src/ports/fakes.js';
import type { HeartbeatCursorStore } from '../src/ports/cursors.js';

function sampleCompany(id: string): Company {
  return { companyId: id, purpose: `purpose-${id}` };
}

function sampleDelegation(id: string, companyId = 'acme'): Delegation {
  return {
    delegationId: id,
    companyId,
    delegator: 'principal-1',
    delegate: 'principal-2',
    authorityScope: { scope: 'finance', actions: ['approve', 'reject'] },
    budget: { currency: 'USD', limit: 100000 },
    validFrom: 1700000000000,
    validUntil: 1800000000000,
    expectedOutcome: 'quarterly report filed',
    state: 'draft',
  };
}

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

function sampleReceipt(id: string, companyId = 'acme'): BusinessReceipt {
  return {
    receiptId: id,
    companyId,
    workId: 'work-1',
    delegationId: 'del-1',
    actor: 'principal-2',
    policyHash: 'sha256:policy-hash',
    evidenceRefs: ['evid-x'],
    terminalState: 'verified',
    terminalEventId: 'attempt-1',
    artifactHash: 'sha256:artifact-hash',
    issuedAt: 1750000000000,
  };
}

function sampleEvent(eventId: string, companyId: string): BusinessEvent {
  return {
    eventId,
    companyId,
    aggregateKind: 'work',
    aggregateId: 'work-1',
    eventType: 'work.completed',
    occurredAt: 1750000000000,
    payload: { workId: 'work-1' },
    source: 'worker',
  };
}

describe('InMemoryCompanyRepository', () => {
  it('save → get round-trips all fields', async () => {
    const repo = new InMemoryCompanyRepository();
    const company = sampleCompany('acme');
    const saved = await repo.save(company);
    expect(saved).toEqual(company);
    const got = await repo.get('acme');
    expect(got).toEqual(company);
    expect(got?.companyId).toBe('acme');
    expect(got?.purpose).toBe('purpose-acme');
  });

  it('get(unknownId) returns undefined', async () => {
    const repo = new InMemoryCompanyRepository();
    expect(await repo.get('never')).toBeUndefined();
  });

  it('round-trips a second distinct company (triangulation)', async () => {
    const repo = new InMemoryCompanyRepository();
    await repo.save(sampleCompany('c1'));
    await repo.save(sampleCompany('c2'));
    expect(await repo.get('c1')).toEqual(sampleCompany('c1'));
    expect(await repo.get('c2')).toEqual(sampleCompany('c2'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryCompanyRepository();
    await expect(repo.save(sampleCompany(''))).rejects.toThrow(/companyId/i);
  });

  it('rejects get with an empty companyId', async () => {
    const repo = new InMemoryCompanyRepository();
    await expect(repo.get('')).rejects.toThrow(/companyId/i);
  });
});

describe('InMemoryDelegationRepository', () => {
  it('save → get round-trips all fields including nested objects and companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    const delegation = sampleDelegation('del-99');
    await repo.save(delegation);
    const got = await repo.get('acme', 'del-99');
    expect(got).toEqual(delegation);
    expect(got?.companyId).toBe('acme');
    expect(got?.authorityScope).toEqual({ scope: 'finance', actions: ['approve', 'reject'] });
    expect(got?.budget).toEqual({ currency: 'USD', limit: 100000 });
    expect(got?.state).toBe('draft');
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryDelegationRepository();
    expect(await repo.get('acme', 'missing')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryDelegationRepository();
    await repo.save(sampleDelegation('del-1', 'company-a'));
    expect(await repo.get('company-b', 'del-1')).toBeUndefined();
    expect(await repo.get('company-a', 'del-1')).toEqual(sampleDelegation('del-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    await expect(repo.save(sampleDelegation('del-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryDelegationRepository();
    await expect(repo.get('', 'del-1')).rejects.toThrow(/companyId/i);
  });
});

describe('InMemoryWorkRepository', () => {
  it('save → get round-trips all fields including evidenceRefs, companyId, and version', async () => {
    const repo = new InMemoryWorkRepository();
    const work = sampleWork('work-42');
    await repo.save(work);
    const got = await repo.get('acme', 'work-42');
    expect(got).toEqual(work);
    expect(got?.companyId).toBe('acme');
    expect(got?.evidenceRefs).toEqual(['evid-a', 'evid-b']);
    expect(got?.state).toBe('proposed');
  });

  it('version initializes to 1 on creation and round-trips', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(sampleWork('work-ver'));
    expect((await repo.get('acme', 'work-ver'))?.version).toBe(1);
  });

  it('round-trips optional deliverable and outcome', async () => {
    const repo = new InMemoryWorkRepository();
    const work: Work = {
      ...sampleWork('work-full'),
      deliverable: { description: 'report.pdf', format: 'pdf' },
      outcome: { result: 'success', success: true },
    };
    await repo.save(work);
    const got = await repo.get('acme', 'work-full');
    expect(got).toEqual(work);
    expect(got?.deliverable).toEqual({ description: 'report.pdf', format: 'pdf' });
    expect(got?.outcome).toEqual({ result: 'success', success: true });
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryWorkRepository();
    expect(await repo.get('acme', 'nope')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(sampleWork('work-1', 'company-a'));
    expect(await repo.get('company-b', 'work-1')).toBeUndefined();
    expect(await repo.get('company-a', 'work-1')).toEqual(sampleWork('work-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryWorkRepository();
    await expect(repo.save(sampleWork('work-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryWorkRepository();
    await expect(repo.get('', 'work-1')).rejects.toThrow(/companyId/i);
  });

  it('save is insert-only: a duplicate workId is rejected (no overwrite)', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(sampleWork('work-dup'));
    await expect(repo.save(sampleWork('work-dup'))).rejects.toThrow(/already/i);
  });
});

describe('InMemoryWorkRepository.listActionableByCompany (work-lifecycle scenarios 1-3)', () => {
  /** An ACCEPTED Work — the only actionable state (ACTIONABLE_WORK_STATES). */
  function accepted(id: string, companyId: string): Work {
    return { ...sampleWork(id, companyId), state: 'accepted' };
  }

  it("scenario 1: returns ONLY the tenant's accepted Work, oldest first across mixed state/tenant", async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(accepted('work-1', 'acme'));
    await repo.save(sampleWork('work-2', 'acme')); // proposed — not actionable
    await repo.save(accepted('work-3', 'other')); // another tenant — excluded
    await repo.save(accepted('work-4', 'acme'));
    await repo.save({ ...sampleWork('work-5', 'acme'), state: 'in_progress' });

    const actionable = await repo.listActionableByCompany('acme');
    expect(actionable.map((w) => w.workId)).toEqual(['work-1', 'work-4']);
    // Insertion order, not lexicographic: work-1 predates work-4.
    expect(actionable[0]?.companyId).toBe('acme');
    expect(actionable[1]?.companyId).toBe('acme');
  });

  it('scenario 2: no accepted Work for the tenant resolves to an empty list', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save({ ...sampleWork('work-1', 'acme'), state: 'in_progress' });
    await repo.save(accepted('work-2', 'other')); // another tenant's accepted Work is not ours

    expect(await repo.listActionableByCompany('acme')).toEqual([]);
  });

  it('scenario 3: an empty companyId rejects BEFORE any store read', async () => {
    const repo = new InMemoryWorkRepository();
    await repo.save(accepted('work-1', 'acme'));

    // The fake's storage is observable at runtime (TS `private` is compile-time
    // only): instrument the Map iterator so ANY store read is countable. Data
    // IS seeded, so a read would have produced a result — a guard error plus
    // zero reads proves the rejection precedes every store read (ADR-0002).
    const store = (repo as unknown as { entries: Map<string, Work> }).entries;
    const originalValues = store.values.bind(store);
    let reads = 0;
    store.values = (() => {
      reads += 1;
      return originalValues();
    }) as typeof store.values;

    await expect(repo.listActionableByCompany('')).rejects.toThrow(
      'a non-empty companyId is required',
    );
    expect(reads).toBe(0);
  });
});

describe('InMemoryWorkRepository CAS (updateIfVersion, ADR-0002/D4)', () => {
  async function seededRepo(version = 1): Promise<{ repo: InMemoryWorkRepository; work: Work }> {
    const repo = new InMemoryWorkRepository();
    const work: Work = { ...sampleWork('work-cas'), state: 'proposed', version };
    await repo.save(work);
    return { repo, work };
  }

  it('successful CAS bumps the stored version N → N+1 and returns { ok: true, value }', async () => {
    const { repo, work } = await seededRepo(1);
    const next: Work = { ...work, state: 'accepted' };

    const result = (await repo.updateIfVersion(next, 1)) as Extract<CasResult, { ok: true }>;

    expect(result.ok).toBe(true);
    expect(result.value.version).toBe(2);
    expect(result.value.state).toBe('accepted');
    expect((await repo.get('acme', 'work-cas'))?.version).toBe(2);
  });

  it('stale expectedVersion yields version-conflict with current, stored work unchanged', async () => {
    const { repo, work } = await seededRepo(2);
    const next: Work = { ...work, state: 'in_progress' };

    const result = (await repo.updateIfVersion(next, 1)) as Extract<CasResult, { ok: false }>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('version-conflict');
    expect(result.current?.version).toBe(2);
    expect(result.current?.state).toBe('proposed');
    const stored = await repo.get('acme', 'work-cas');
    expect(stored?.version).toBe(2);
    expect(stored?.state).toBe('proposed');
  });

  it('exactly one writer wins when two write with the same expectedVersion', async () => {
    const { repo, work } = await seededRepo(1);
    const first: Work = { ...work, state: 'accepted' };
    const second: Work = { ...work, state: 'in_progress' };

    const winner = await repo.updateIfVersion(first, 1);
    const loser = await repo.updateIfVersion(second, 1);

    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (loser.ok === false) {
      expect(loser.reason).toBe('version-conflict');
      expect(loser.current?.state).toBe('accepted');
      expect(loser.current?.version).toBe(2);
    }
  });

  it('CAS bumps N → N+1 repeatedly across successive updates (triangulation)', async () => {
    const { repo, work } = await seededRepo(1);
    const accepted: Work = { ...work, state: 'accepted' };
    const started: Work = { ...accepted, state: 'in_progress' };

    await repo.updateIfVersion(accepted, 1);
    const second = await repo.updateIfVersion(started, 2);

    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.version).toBe(3);
    expect((await repo.get('acme', 'work-cas'))?.version).toBe(3);
  });

  it('rejects an empty companyId on updateIfVersion (same guard as save/get)', async () => {
    const { repo, work } = await seededRepo(1);
    const orphan: Work = { ...work, companyId: '' };
    await expect(repo.updateIfVersion(orphan, 1)).rejects.toThrow(/companyId/i);
  });

  it('claim directive mints fencing token 1 from the pre-fencing epoch 0 (work-lifecycle "Claim mints from the pre-fencing epoch")', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-claim'), state: 'accepted' };
    await repo.save(epoch);
    expect(epoch.fencingToken).toBe(0);

    const claim = (await repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, {
      kind: 'claim',
    })) as Extract<CasResult, { ok: true }>;

    expect(claim.ok).toBe(true);
    // Minted server-side INSIDE the same CAS: token 0 → 1.
    expect(claim.value.fencingToken).toBe(1);
    expect(claim.value.version).toBe(2);
    const stored = await repo.get('acme', 'work-claim');
    expect(stored?.fencingToken).toBe(1);
    expect(stored?.state).toBe('in_progress');
  });

  it('a second claim on the SAME work mints the NEXT token (2) — monotonic per claim (triangulation)', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-claim2'), state: 'accepted' };
    await repo.save(epoch);
    const first = (await repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, {
      kind: 'claim',
    })) as Extract<CasResult, { ok: true }>;
    expect(first.value.fencingToken).toBe(1);

    // A second claim on the same work (e.g. a fresh take-over) bumps again.
    const second = (await repo.updateIfVersion(
      { ...first.value, state: 'in_progress' },
      first.value.version,
      { kind: 'claim' },
    )) as Extract<CasResult, { ok: true }>;
    expect(second.value.fencingToken).toBe(2);
    expect((await repo.get('acme', 'work-claim2'))?.fencingToken).toBe(2);
  });

  it('terminal directive with a STALE token returns fencing-conflict and leaves the work unchanged (work-lifecycle "Stale token cannot close Work")', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-stale'), state: 'accepted' };
    await repo.save(epoch);
    // The work is claimed: stored token = 1.
    const claimed = await repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, {
      kind: 'claim',
    });
    if (!claimed.ok) throw new Error('test setup: claim failed');

    // A stale holder (token 0) tries to close with a terminal directive.
    const terminal = (await repo.updateIfVersion(
      { ...claimed.value, state: 'completed' },
      claimed.value.version,
      { kind: 'terminal', expectedFencingToken: 0 },
    )) as Extract<CasResult, { ok: false }>;

    expect(terminal.ok).toBe(false);
    expect(terminal.reason).toBe('fencing-conflict');
    expect(terminal.current?.fencingToken).toBe(1);
    // No mutation: the stored work keeps token 1 and its in_progress state.
    const stored = await repo.get('acme', 'work-stale');
    expect(stored?.fencingToken).toBe(1);
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(2);
  });

  it('terminal directive with the MATCHING token succeeds (claim-owned close) and keeps the token (triangulation)', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-match'), state: 'accepted' };
    await repo.save(epoch);
    const claimed = await repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, {
      kind: 'claim',
    });
    if (!claimed.ok) throw new Error('test setup: claim failed');

    const terminal = await repo.updateIfVersion(
      { ...claimed.value, state: 'completed' },
      claimed.value.version,
      { kind: 'terminal', expectedFencingToken: claimed.value.fencingToken },
    );

    expect(terminal.ok).toBe(true);
    if (terminal.ok) {
      expect(terminal.value.state).toBe('completed');
      // The terminal close does NOT re-mint: the claim token is retained.
      expect(terminal.value.fencingToken).toBe(1);
    }
    expect((await repo.get('acme', 'work-match'))?.state).toBe('completed');
  });

  it('single winner among CONCURRENT claim directives: exactly one mints N+1, the loser gets version-conflict (work-lifecycle "Concurrent writers, single winner")', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-race'), state: 'accepted' };
    await repo.save(epoch);

    const [a, b] = await Promise.all([
      repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, { kind: 'claim' }),
      repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, { kind: 'claim' }),
    ]);

    const oks = [a, b].filter((r) => r.ok === true);
    const conflicts = [a, b].filter((r) => r.ok === false && r.reason === 'version-conflict');
    expect(oks).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    if (oks[0]?.ok) expect(oks[0].value.fencingToken).toBe(1);
    expect((await repo.get('acme', 'work-race'))?.fencingToken).toBe(1);
  });

  it('a terminal directive with a stale VERSION still reports version-conflict (version is checked first)', async () => {
    const repo = new InMemoryWorkRepository();
    const epoch: Work = { ...sampleWork('work-ver'), state: 'accepted' };
    await repo.save(epoch);
    const claimed = await repo.updateIfVersion({ ...epoch, state: 'in_progress' }, epoch.version, {
      kind: 'claim',
    });
    if (!claimed.ok) throw new Error('test setup: claim failed');

    const result = (await repo.updateIfVersion(
      { ...claimed.value, state: 'completed' },
      1, // stale version
      { kind: 'terminal', expectedFencingToken: claimed.value.fencingToken },
    )) as Extract<CasResult, { ok: false }>;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('version-conflict');
    expect((await repo.get('acme', 'work-ver'))?.state).toBe('in_progress');
  });
});

describe('InMemoryBusinessReceiptRepository', () => {
  it('save → get round-trips all fields including companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-1');
    await repo.save(receipt);
    const got = await repo.get('acme', 'r-1');
    expect(got).toEqual(receipt);
    expect(got?.companyId).toBe('acme');
    expect(got?.terminalState).toBe('verified');
    expect(got?.evidenceRefs).toEqual(['evid-x']);
  });

  it('get(companyId, unknownId) returns undefined', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    expect(await repo.get('acme', 'absent')).toBeUndefined();
  });

  it('scoped get for the wrong company resolves to not-found', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await repo.save(sampleReceipt('r-1', 'company-a'));
    expect(await repo.get('company-b', 'r-1')).toBeUndefined();
    expect(await repo.get('company-a', 'r-1')).toEqual(sampleReceipt('r-1', 'company-a'));
  });

  it('rejects save with an empty companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await expect(repo.save(sampleReceipt('r-x', ''))).rejects.toThrow(/companyId/i);
  });

  it('rejects scoped get with an empty companyId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await expect(repo.get('', 'r-1')).rejects.toThrow(/companyId/i);
  });

  it('first save succeeds, duplicate receiptId rejected', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const receipt = sampleReceipt('r-dup');
    await repo.save(receipt);
    const first = await repo.get('acme', 'r-dup');
    expect(first).toEqual(receipt);

    const second = sampleReceipt('r-dup');
    await expect(repo.save(second)).rejects.toThrow();

    const unchanged = await repo.get('acme', 'r-dup');
    expect(unchanged).toEqual(receipt);
  });

  it('round-trips terminalEventId (D5)', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await repo.save(sampleReceipt('r-term'));
    const got = await repo.get('acme', 'r-term');
    expect(got?.terminalEventId).toBe('attempt-1');
  });

  it('rejects a second receipt for the same (workId, terminalEventId) even with a different receiptId', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    const first = sampleReceipt('r-1'); // work-1 + attempt-1
    await repo.save(first);

    const second: BusinessReceipt = {
      ...sampleReceipt('r-2'),
      workId: 'work-1',
      terminalEventId: 'attempt-1',
    };
    await expect(repo.save(second)).rejects.toThrow(/terminal/i);

    const original = await repo.get('acme', 'r-1');
    expect(original).toEqual(first);
    expect(await repo.get('acme', 'r-2')).toBeUndefined();
  });

  it('allows the SAME work with a DIFFERENT terminal event (triangulation)', async () => {
    const repo = new InMemoryBusinessReceiptRepository();
    await repo.save(sampleReceipt('r-a')); // work-1 + attempt-1
    const second: BusinessReceipt = {
      ...sampleReceipt('r-b'),
      workId: 'work-1',
      terminalEventId: 'attempt-2',
    };
    await expect(repo.save(second)).resolves.toEqual(second);
  });
});

describe('InMemoryIdempotencyJournalRepository — markRetryable (IJ marker-distinct)', () => {
  async function seedInFlight(): Promise<InMemoryIdempotencyJournalRepository> {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    return journal;
  }

  it('in_flight → aborted_retryable, a status distinct from in_flight and completed, with resultJson cleared', async () => {
    const journal = await seedInFlight();

    await journal.markRetryable('att:acme:key-1');

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('aborted_retryable');
    expect(entry?.status).not.toBe('in_flight');
    expect(entry?.status).not.toBe('completed');
    expect(entry?.resultJson).toBeUndefined();
  });

  it('rejects a missing attemptId', async () => {
    const journal = await seedInFlight();
    await expect(journal.markRetryable('att:missing')).rejects.toThrow(/attempt/i);
  });

  it('rejects a completed attempt (the marker never overwrites completed)', async () => {
    const journal = await seedInFlight();
    await journal.complete('att:acme:key-1', { ok: true });
    await expect(journal.markRetryable('att:acme:key-1')).rejects.toThrow(/not in_flight/i);
  });

  it('rejects an already-retryable attempt (only in_flight can be marked)', async () => {
    const journal = await seedInFlight();
    await journal.markRetryable('att:acme:key-1');
    await expect(journal.markRetryable('att:acme:key-1')).rejects.toThrow(/not in_flight/i);
  });
});

describe('InMemoryIdempotencyJournalRepository — lookup decision data (IJ replay/DENY/in-flight/tenant)', () => {
  it('completed lookup returns the stored resultJson + requestHash so the caller REPLAYS', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    await journal.complete('att:acme:key-1', { result: 'closed', success: true });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.requestHash).toBe('hash-1');
    expect(entry?.resultJson).toEqual({ result: 'closed', success: true });
  });

  it('in_flight lookup returns the attempt WITHOUT resultJson (never replayed)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('in_flight');
    expect(entry?.resultJson).toBeUndefined();
  });

  it('no row for a fresh key resolves to undefined (record a fresh attempt)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    expect(await journal.lookup('acme', 'never-recorded')).toBeUndefined();
  });

  it('tenant scope: a wrong-company lookup resolves to no row; empty companyId/key reject', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });

    expect(await journal.lookup('other-company', 'key-1')).toBeUndefined();
    expect(await journal.lookup('acme', 'other-key')).toBeUndefined();
    await expect(journal.lookup('', 'key-1')).rejects.toThrow(/companyId/i);
    await expect(journal.lookup('acme', '')).rejects.toThrow(/idempotencyKey/i);
  });
});

describe('InMemoryIdempotencyJournalRepository — reopen on aborted_retryable (IJ retryable-no-replay)', () => {
  async function seedRetryable(): Promise<InMemoryIdempotencyJournalRepository> {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    await journal.markRetryable('att:acme:key-1');
    return journal;
  }

  it('aborted_retryable + same request hash reopens in_flight, KEEPING the same attemptId and clearing resultJson', async () => {
    const journal = await seedRetryable();

    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-NEW',
    });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('in_flight');
    expect(entry?.attemptId).toBe('att:acme:key-1'); // preserved — receipt never issued on prior CAS loss
    expect(entry?.resultJson).toBeUndefined();
  });

  it('aborted_retryable + DIFFERENT request hash is a conflict; the marker is NOT overwritten', async () => {
    const journal = await seedRetryable();

    await expect(
      journal.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-DIFFERENT',
        attemptId: 'att:acme:key-2',
      }),
    ).rejects.toThrow(/hash|conflict/i);

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('aborted_retryable');
  });

  it('an in_flight row is never reopened — a duplicate claim is a typed attempt-in-flight (not a throw)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });

    await expect(
      journal.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'attempt-in-flight' });
  });

  it('a completed row is never reopened — a duplicate claim is a typed attempt-in-flight (replay/DENY only)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    await journal.complete('att:acme:key-1', { ok: true });

    await expect(
      journal.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-2',
      }),
    ).resolves.toEqual({ ok: false, reason: 'attempt-in-flight' });
  });

  it('a same-key race loser receives a typed attempt-in-flight claim result, NOT a thrown error', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    const claim = await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    expect(claim).toEqual({ ok: true });

    // A concurrent attempt on the SAME key loses the claim: a typed result the
    // caller can retry, never a thrown unique-violation-style error.
    const lost = await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });
    expect(lost).toEqual({ ok: false, reason: 'attempt-in-flight' });
  });
});

describe('InMemoryHeartbeatCursorStore (supervisor-timer)', () => {
  it('get on a company with no checkpoint resolves to no cursor', async () => {
    const store = new InMemoryHeartbeatCursorStore();
    expect(await store.get('acme')).toBeUndefined();
  });

  it('upsert creates the checkpoint, readable by get', async () => {
    const store = new InMemoryHeartbeatCursorStore();
    await store.upsert('acme', { lastEventId: 'evt:5' });
    expect(await store.get('acme')).toEqual({ lastEventId: 'evt:5' });
  });

  it('a second upsert REPLACES the checkpoint (atomic upsert, not insert-only)', async () => {
    const store = new InMemoryHeartbeatCursorStore();
    await store.upsert('acme', { lastEventId: 'evt:5' });
    await store.upsert('acme', { lastEventId: 'evt:9' });
    expect(await store.get('acme')).toEqual({ lastEventId: 'evt:9' });
  });

  it('upsert for company A leaves company B unchanged (tenant isolation)', async () => {
    const store = new InMemoryHeartbeatCursorStore();
    await store.upsert('company-a', { lastEventId: 'evt:a-3' });
    await store.upsert('company-b', { lastEventId: 'evt:b-1' });
    await store.upsert('company-a', { lastEventId: 'evt:a-7' });

    expect(await store.get('company-a')).toEqual({ lastEventId: 'evt:a-7' });
    expect(await store.get('company-b')).toEqual({ lastEventId: 'evt:b-1' });
  });

  it('rejects an empty companyId on get and upsert (requireCompanyId parity)', async () => {
    const store = new InMemoryHeartbeatCursorStore();
    await expect(store.get('')).rejects.toThrow(/companyId/i);
    await expect(store.upsert('', { lastEventId: 'evt:1' })).rejects.toThrow(/companyId/i);
  });

  it('is assignable to the HeartbeatCursorStore port contract', () => {
    const port: HeartbeatCursorStore = new InMemoryHeartbeatCursorStore();
    expect(port).toBeInstanceOf(InMemoryHeartbeatCursorStore);
    expectTypeOf<keyof HeartbeatCursorStore>().toEqualTypeOf<'get' | 'upsert'>();
  });
});

describe('InMemoryBusinessEventRepository — listCompanyIds (supervisor-timer)', () => {
  it('returns each company exactly once, in insertion-first-seen order', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('evt:a-1', 'company-a'));
    await repo.append(sampleEvent('evt:b-1', 'company-b'));
    await repo.append(sampleEvent('evt:a-2', 'company-a'));
    await repo.append(sampleEvent('evt:b-2', 'company-b'));

    expect(await repo.listCompanyIds()).toEqual(['company-a', 'company-b']);
  });

  it('repeated appends for one company never duplicate its id (triangulation)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('evt:a-1', 'company-a'));
    await repo.append(sampleEvent('evt:a-2', 'company-a'));
    await repo.append(sampleEvent('evt:b-1', 'company-b'));
    await repo.append(sampleEvent('evt:a-3', 'company-a'));

    expect(await repo.listCompanyIds()).toEqual(['company-a', 'company-b']);
  });

  it('an empty log resolves to an empty list', async () => {
    const repo = new InMemoryBusinessEventRepository();
    expect(await repo.listCompanyIds()).toEqual([]);
  });

  it('is read-only: the event log snapshot is unchanged by listing', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const a1 = sampleEvent('evt:a-1', 'company-a');
    const b1 = sampleEvent('evt:b-1', 'company-b');
    await repo.append(a1);
    await repo.append(b1);

    expect(await repo.listCompanyIds()).toEqual(['company-a', 'company-b']);

    // The append-only log is untouched: same count, same events, same order.
    expect(await repo.listByCompany('company-a')).toEqual([a1]);
    expect(await repo.listByCompany('company-b')).toEqual([b1]);
  });
});

describe('InMemoryBusinessEventRepository — appendIfAbsent (at-most-once append)', () => {
  it('inserts an unseen event once and returns it; distinct ids both insert', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const first = sampleEvent('evt:hb-1', 'acme');
    const second = sampleEvent('evt:hb-2', 'acme');

    expect(await repo.appendIfAbsent(first)).toEqual(first);
    expect(await repo.appendIfAbsent(second)).toEqual(second);
    expect(await repo.listByCompany('acme')).toEqual([first, second]);
  });

  it('a duplicate NO-OPS: returns the STORED ORIGINAL byte-for-byte and never changes log length', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const original = sampleEvent('evt:hb-1', 'acme');
    await repo.appendIfAbsent(original);

    // Same eventId, DIFFERENT payload + occurredAt: no-op — resolve the
    // ORIGINAL, never the tampered input, never an overwrite.
    const duplicate: BusinessEvent = {
      ...sampleEvent('evt:hb-1', 'acme'),
      occurredAt: 999,
      payload: { tampered: true },
    };
    expect(await repo.appendIfAbsent(duplicate)).toEqual(original);
    await repo.appendIfAbsent(sampleEvent('evt:hb-1', 'acme'));
    expect(await repo.listByCompany('acme')).toEqual([original]);
  });

  it('appendIfAbsent preserves the throwing append semantics: append on an existing id still throws', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const event = sampleEvent('evt:hb-1', 'acme');
    await repo.appendIfAbsent(event);

    await expect(repo.append(event)).rejects.toThrow(/already recorded/i);
    expect(await repo.listByCompany('acme')).toEqual([event]);
  });

  it('rejects an empty companyId (requireCompanyId parity)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await expect(repo.appendIfAbsent(sampleEvent('evt:hb-1', ''))).rejects.toThrow(/companyId/i);
  });
});

/** JSON-file-backed persistence for the durable fake (fs lives in the test —
 * business-domain src stays pure). */
function jsonFilePersistence(path: string): JournalFakePersistence {
  return {
    load() {
      return existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as readonly JournalEntry[])
        : [];
    },
    save(entries) {
      writeFileSync(path, JSON.stringify(entries));
    },
  };
}

describe('DurableJournalFake — JSON durability across a simulated restart (IJ marker-durable)', () => {
  function tmpJournalFile(): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'io-journal-fake-'));
    return { dir, path: join(dir, 'journal.json') };
  }

  it('a retryable marker written before the restart survives it with full row shape', async () => {
    const { dir, path } = tmpJournalFile();
    try {
      const first = new DurableJournalFake(jsonFilePersistence(path));
      await first.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-1',
      });
      await first.markRetryable('att:acme:key-1');

      // Simulated restart: a FRESH fake over the same JSON file.
      const second = new DurableJournalFake(jsonFilePersistence(path));
      const entry = await second.lookup('acme', 'key-1');
      expect(entry?.status).toBe('aborted_retryable');
      expect(entry?.requestHash).toBe('hash-1');
      expect(entry?.attemptId).toBe('att:acme:key-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a completed resultJson survives the restart for replay', async () => {
    const { dir, path } = tmpJournalFile();
    try {
      const first = new DurableJournalFake(jsonFilePersistence(path));
      await first.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-1',
      });
      await first.complete('att:acme:key-1', { result: 'closed', success: true });

      const second = new DurableJournalFake(jsonFilePersistence(path));
      const entry = await second.lookup('acme', 'key-1');
      expect(entry?.status).toBe('completed');
      expect(entry?.resultJson).toEqual({ result: 'closed', success: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a reopen after restart still works (restored rows are fully functional)', async () => {
    const { dir, path } = tmpJournalFile();
    try {
      const first = new DurableJournalFake(jsonFilePersistence(path));
      await first.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-1',
      });
      await first.markRetryable('att:acme:key-1');

      const second = new DurableJournalFake(jsonFilePersistence(path));
      await second.insertInFlight({
        companyId: 'acme',
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
        attemptId: 'att:acme:key-2',
      });

      const reopened = await second.lookup('acme', 'key-1');
      expect(reopened?.status).toBe('in_flight');
      expect(reopened?.attemptId).toBe('att:acme:key-1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
