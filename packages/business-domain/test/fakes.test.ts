import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BusinessReceipt, Company, Delegation, Work } from '../src/types.js';
import type { CasResult } from '../src/ports/repositories.js';
import type { JournalEntry } from '../src/ports/idempotency.js';
import {
  DurableJournalFake,
  InMemoryBusinessReceiptRepository,
  InMemoryCompanyRepository,
  InMemoryDelegationRepository,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '../src/ports/fakes.js';
import type { JournalFakePersistence } from '../src/ports/fakes.js';

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

  it('an in_flight row is never reopened (duplicate attempt rejected)', async () => {
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
    ).rejects.toThrow(/already recorded/i);
  });

  it('a completed row is never reopened (replay/DENY only)', async () => {
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
    ).rejects.toThrow(/already recorded/i);
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
