import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BusinessEvent as IndexedBusinessEvent,
  BusinessEventRepository as IndexedRepository,
} from '../src/index.js';
import { InMemoryBusinessEventRepository as IndexedFake } from '../src/index.js';
import { InMemoryBusinessEventRepository } from '../src/ports/fakes.js';
import type { BusinessEventRepository } from '../src/ports/repositories.js';
import type { BusinessEvent } from '../src/types.js';

function sampleEvent(attemptId: string, companyId = 'acme'): BusinessEvent {
  return {
    eventId: `evt:${attemptId}`,
    companyId,
    aggregateKind: 'work',
    aggregateId: 'work-1',
    eventType: 'work.completed',
    occurredAt: 1750000000000,
    payload: {
      workId: 'work-1',
      state: 'completed',
      receiptId: `rcpt:${attemptId}`,
      terminalState: 'verified',
      evidenceId: 'evid:acme:key-1',
      attemptId,
      actor: 'principal-2',
    },
    source: 'worker',
  };
}

describe('BusinessEvent (R1, R6)', () => {
  it('carries exactly the 8 design fields with the design types', () => {
    const event = sampleEvent('attempt-1');
    expect(Object.keys(event)).toEqual([
      'eventId',
      'companyId',
      'aggregateKind',
      'aggregateId',
      'eventType',
      'occurredAt',
      'payload',
      'source',
    ]);
    expect(event.eventId).toBe('evt:attempt-1');
    expect(event.companyId).toBe('acme');
    expect(event.aggregateKind).toBe('work');
    expect(event.aggregateId).toBe('work-1');
    expect(event.eventType).toBe('work.completed');
    expect(typeof event.occurredAt).toBe('number');
    expect(event.source).toBe('worker');
    expect(event.payload).toEqual({
      workId: 'work-1',
      state: 'completed',
      receiptId: 'rcpt:attempt-1',
      terminalState: 'verified',
      evidenceId: 'evid:acme:key-1',
      attemptId: 'attempt-1',
      actor: 'principal-2',
    });
    expectTypeOf(event).toEqualTypeOf<BusinessEvent>();
  });

  it('is deterministic: equal terminal-close facts produce equal events', () => {
    const first = sampleEvent('attempt-1');
    const second = sampleEvent('attempt-1');
    expect(first).toEqual(second);
    expect(second).toEqual(first);
  });

  it('differs when the underlying facts differ (triangulation)', () => {
    const base = sampleEvent('attempt-1');
    const other = sampleEvent('attempt-2');
    expect(other).not.toEqual(base);
    expect(other.eventId).toBe('evt:attempt-2');
    expect(other.payload.attemptId).toBe('attempt-2');
  });
});

describe('BusinessEventRepository port (R2)', () => {
  it('surface is EXACTLY append + appendIfAbsent + listByCompany + read-only listCompanyIds — no update/delete/overwrite/getById', async () => {
    // Type-level exact-surface check: the port must not expose any other key.
    expectTypeOf<keyof BusinessEventRepository>().toEqualTypeOf<
      'append' | 'appendIfAbsent' | 'listByCompany' | 'listCompanyIds'
    >();

    // Runtime: a conforming implementation only needs those four operations.
    const repo: BusinessEventRepository = {
      async append(event) {
        return event;
      },
      async appendIfAbsent(event) {
        return event;
      },
      async listByCompany(companyId) {
        return companyId === 'acme' ? [sampleEvent('attempt-1')] : [];
      },
      async listCompanyIds() {
        return ['acme'];
      },
    };
    const appended = await repo.append(sampleEvent('attempt-1'));
    expect(appended.eventId).toBe('evt:attempt-1');
    expect((await repo.appendIfAbsent(sampleEvent('attempt-1'))).eventId).toBe('evt:attempt-1');
    expect(await repo.listByCompany('acme')).toHaveLength(1);
    expect(await repo.listByCompany('other')).toHaveLength(0);
    expect(await repo.listCompanyIds()).toEqual(['acme']);
  });
});

describe('InMemoryBusinessEventRepository (R3, R8)', () => {
  it('real fake surface is EXACTLY append + appendIfAbsent + listByCompany + listCompanyIds — no mutation operations', () => {
    const repo = new InMemoryBusinessEventRepository();
    const proto = Object.getPrototypeOf(repo) as Record<string, unknown>;
    const methods = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .sort();
    expect(methods).toEqual(['append', 'appendIfAbsent', 'listByCompany', 'listCompanyIds']);
  });

  it('append → listByCompany round-trips all 8 fields including payload and source', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const event = sampleEvent('attempt-1');
    const appended = await repo.append(event);
    expect(appended).toEqual(event);

    const listed = await repo.listByCompany('acme');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(event);
    expect(listed[0]?.payload).toEqual(event.payload);
    expect(listed[0]?.source).toBe('worker');
  });

  it('returns company events in insertion order when companies are interleaved (R3)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('attempt-a1', 'company-a'));
    await repo.append(sampleEvent('attempt-b1', 'company-b'));
    await repo.append(sampleEvent('attempt-a2', 'company-a'));
    await repo.append(sampleEvent('attempt-b2', 'company-b'));

    const forA = await repo.listByCompany('company-a');
    expect(forA.map((entry) => entry.eventId)).toEqual(['evt:attempt-a1', 'evt:attempt-a2']);
    const forB = await repo.listByCompany('company-b');
    expect(forB.map((entry) => entry.eventId)).toEqual(['evt:attempt-b1', 'evt:attempt-b2']);
  });

  it('cross-tenant: list for A never returns company B events (R8)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('attempt-1', 'company-a'));
    await repo.append(sampleEvent('attempt-2', 'company-b'));
    await repo.append(sampleEvent('attempt-3', 'company-a'));

    const forA = await repo.listByCompany('company-a');
    expect(forA).toHaveLength(2);
    for (const entry of forA) {
      expect(entry.companyId).toBe('company-a');
    }
    expect(forA.map((entry) => entry.eventId)).toEqual(['evt:attempt-1', 'evt:attempt-3']);
  });

  it('a company with no events resolves to an empty list', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('attempt-1', 'company-a'));
    expect(await repo.listByCompany('company-b')).toEqual([]);
  });
});

describe('InMemoryBusinessEventRepository — duplicate eventId (R7)', () => {
  it('rejects a second append with the same eventId and preserves the ORIGINAL event', async () => {
    const repo = new InMemoryBusinessEventRepository();
    const original = sampleEvent('attempt-1');
    await repo.append(original);

    // Same eventId, different payload: the duplicate must be rejected, not merged.
    const duplicate: BusinessEvent = {
      ...original,
      payload: { attemptId: 'attempt-1', tampered: true },
    };
    await expect(repo.append(duplicate)).rejects.toThrow(/already/i);

    const stored = await repo.listByCompany('acme');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(original);
    expect(stored[0]?.payload).toEqual(original.payload);
  });

  it('allows DISTINCT eventIds for the same company (triangulation)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await expect(repo.append(sampleEvent('attempt-1'))).resolves.toEqual(sampleEvent('attempt-1'));
    await expect(repo.append(sampleEvent('attempt-2'))).resolves.toEqual(sampleEvent('attempt-2'));
    expect(await repo.listByCompany('acme')).toHaveLength(2);
  });
});

describe('InMemoryBusinessEventRepository — empty companyId (R8)', () => {
  it('rejects append with an empty companyId', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await expect(repo.append(sampleEvent('attempt-1', ''))).rejects.toThrow(/companyId/i);
    expect(await repo.listByCompany('acme')).toEqual([]);
  });

  it('rejects listByCompany with an empty companyId', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('attempt-1'));
    await expect(repo.listByCompany('')).rejects.toThrow(/companyId/i);
  });
});

describe('public surface + isolation (R1)', () => {
  it('index.ts exports the type, the port, and the fake — all functional', async () => {
    // Type-level: the index re-exports the same contracts as the source modules.
    expectTypeOf<IndexedBusinessEvent>().toEqualTypeOf<BusinessEvent>();
    expectTypeOf<IndexedRepository>().toEqualTypeOf<BusinessEventRepository>();

    // Runtime: the indexed fake works end-to-end.
    const repo: IndexedRepository = new IndexedFake();
    const event = sampleEvent('attempt-1');
    await repo.append(event);
    expect(await repo.listByCompany('acme')).toEqual([event]);
  });

  it('src has ZERO @io/* imports (no cross-package coupling)', () => {
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
    const tsFiles = readdirSync(srcDir, { recursive: true }).filter(
      (entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'),
    );
    expect(tsFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of tsFiles) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      if (/import\s+[^;]*@io\//.test(source) || /import\s*\(\s*['"]@io\//.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json declares NO runtime or dev dependencies (zero runtime deps)', () => {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      expect(pkg[field] ?? {}).toEqual({});
    }
  });
});
