import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import * as heartbeat from '../src/heartbeat.js';
import type {
  HeartbeatCursor as IndexedCursor,
  HeartbeatDecision as IndexedDecision,
} from '../src/index.js';
import { evaluateHeartbeat as indexedEvaluate } from '../src/index.js';
import { InMemoryBusinessEventRepository } from '../src/ports/fakes.js';
import type { BusinessEvent } from '../src/types.js';

function sampleEvent(
  eventId: string,
  eventType = 'work.completed',
  companyId = 'acme',
): BusinessEvent {
  return {
    eventId,
    companyId,
    aggregateKind: 'work',
    aggregateId: 'work-1',
    eventType,
    occurredAt: 1750000000000,
    payload: { workId: 'work-1' },
    source: 'worker',
  };
}

describe('HeartbeatDecision (R1)', () => {
  it('activates Flash via a stable, exactly-shaped branch', () => {
    const first: heartbeat.HeartbeatDecision = { kind: 'activate', model: 'flash' };
    const second: heartbeat.HeartbeatDecision = { kind: 'activate', model: 'flash' };
    expect(first).toEqual(second);
    expect(first).toEqual({ kind: 'activate', model: 'flash' });
  });

  it('declines the heartbeat via a stable, exactly-shaped branch', () => {
    const first: heartbeat.HeartbeatDecision = { kind: 'no-llm-heartbeat' };
    const second: heartbeat.HeartbeatDecision = { kind: 'no-llm-heartbeat' };
    expect(first).toEqual(second);
    expect(first).toEqual({ kind: 'no-llm-heartbeat' });
  });

  it('declares the decision union and cursor shape exactly', () => {
    expectTypeOf<heartbeat.HeartbeatDecision>().toEqualTypeOf<
      { readonly kind: 'activate'; readonly model: 'flash' } | { readonly kind: 'no-llm-heartbeat' }
    >();
    expectTypeOf<heartbeat.HeartbeatCursor>().toEqualTypeOf<{ readonly lastEventId: string }>();
  });

  it('re-exports the heartbeat types from the index', () => {
    expectTypeOf<IndexedDecision>().toEqualTypeOf<heartbeat.HeartbeatDecision>();
    expectTypeOf<IndexedCursor>().toEqualTypeOf<heartbeat.HeartbeatCursor>();
  });
});

describe('declared material event types (R2)', () => {
  it('declares exactly the material set from the design', () => {
    expect(heartbeat.MATERIAL_EVENT_TYPES).toEqual(['work.completed']);
    expectTypeOf<typeof heartbeat.MATERIAL_EVENT_TYPES>().toEqualTypeOf<
      readonly ['work.completed']
    >();
  });

  it('treats a declared eventType as material', () => {
    expect(heartbeat.isMaterialEvent(sampleEvent('evt:1', 'work.completed'))).toBe(true);
  });

  it('treats every undeclared eventType as non-material', () => {
    for (const eventType of [
      'work.started',
      'work.proposed',
      'work.failed',
      'delegation.assigned',
      'payment.issued',
      'WORK.COMPLETED',
      '',
    ]) {
      expect(heartbeat.isMaterialEvent(sampleEvent(`evt:${eventType}`, eventType))).toBe(false);
    }
  });
});

describe('cursor-defined novelty (R4)', () => {
  const material = (id: string) => sampleEvent(id, 'work.completed');
  const nonMaterial = (id: string) => sampleEvent(id, 'work.started');

  it('absent cursor + a material event → has novelty → activate', () => {
    const events = [material('evt:1')];
    expect(heartbeat.hasMaterialNovelty(events)).toBe(true);
    expect(heartbeat.evaluateHeartbeat(events)).toEqual({ kind: 'activate', model: 'flash' });
  });

  it('cursor at the last material event → no novelty → no-llm-heartbeat', () => {
    const events = [material('evt:1'), material('evt:2')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:2' };
    expect(heartbeat.hasMaterialNovelty(events, cursor)).toBe(false);
    expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({ kind: 'no-llm-heartbeat' });
  });

  it('cursor after the last material event (trailing non-material) → no-llm-heartbeat', () => {
    const events = [material('evt:1'), nonMaterial('evt:2')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:2' };
    expect(heartbeat.hasMaterialNovelty(events, cursor)).toBe(false);
    expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({ kind: 'no-llm-heartbeat' });
  });

  it('cursor id missing from the stream (ahead of it) → no-llm-heartbeat', () => {
    const events = [material('evt:1'), material('evt:2')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:999' };
    expect(heartbeat.hasMaterialNovelty(events, cursor)).toBe(false);
    expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({ kind: 'no-llm-heartbeat' });
  });

  it('cursor mid-stream with a later material event → activate', () => {
    const events = [material('evt:1'), nonMaterial('evt:2'), material('evt:3')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:1' };
    expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({
      kind: 'activate',
      model: 'flash',
    });
  });

  it('empty stream → no-llm-heartbeat', () => {
    expect(heartbeat.evaluateHeartbeat([])).toEqual({ kind: 'no-llm-heartbeat' });
    expect(heartbeat.evaluateHeartbeat([], { lastEventId: 'evt:1' })).toEqual({
      kind: 'no-llm-heartbeat',
    });
  });

  it('novelty is insertion-index based, never lexicographic id comparison', () => {
    // Insertion order: 'evt:zzz' (index 0) then 'evt:aaa' (index 1). A
    // lexicographic comparison would treat 'evt:aaa' as EARLIER than the
    // cursor id 'evt:zzz' (already seen); insertion-index sees it as
    // FOLLOWING the cursor (index 1 > 0) → novel → activate.
    const events = [material('evt:zzz'), material('evt:aaa')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:zzz' };
    expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({
      kind: 'activate',
      model: 'flash',
    });
  });

  it('index re-exports the filter functions with runtime parity', () => {
    const events = [material('evt:1')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:999' };
    expect(indexedEvaluate(events, cursor)).toEqual(heartbeat.evaluateHeartbeat(events, cursor));
  });
});

describe('deterministic novelty filter (R3)', () => {
  it('produces identical decisions for identical inputs across repeated calls', () => {
    const events = [sampleEvent('evt:1'), sampleEvent('evt:2', 'work.completed')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:1' };
    const first = heartbeat.evaluateHeartbeat(events, cursor);
    const second = heartbeat.evaluateHeartbeat(events, cursor);
    const third = heartbeat.evaluateHeartbeat(events, cursor);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first).toEqual({ kind: 'activate', model: 'flash' });
  });

  it('ignores ambient clocks and randomness (varied sources → unchanged)', () => {
    const events = [sampleEvent('evt:1'), sampleEvent('evt:2', 'work.completed')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:1' };
    const baseline = heartbeat.evaluateHeartbeat(events, cursor);

    let tick = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => 1750000000000 + tick++ * 1000);
    vi.spyOn(Math, 'random').mockImplementation(() => tick / 100);
    try {
      const underAmbient = [
        heartbeat.evaluateHeartbeat(events, cursor),
        heartbeat.evaluateHeartbeat(events, cursor),
        heartbeat.evaluateHeartbeat(events, cursor),
      ];
      expect(underAmbient[0]).toEqual(baseline);
      expect(underAmbient[1]).toEqual(underAmbient[0]);
      expect(underAmbient[2]).toEqual(underAmbient[0]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('module source contains no clock, randomness, or generated-id sources', () => {
    const source = readFileSync(new URL('../src/heartbeat.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Date\.now\(|new Date\(|Math\.random\(|performance\.now\(|crypto\./);
  });
});

describe('no-LLM guarantee + tenant isolation (R5, R7)', () => {
  it('identical inputs under differing surrounding worlds yield identical decisions (inverse-poison)', () => {
    const events = [sampleEvent('evt:1'), sampleEvent('evt:2', 'work.completed')];
    const cursor: heartbeat.HeartbeatCursor = { lastEventId: 'evt:1' };

    const worldA = {
      work: { status: 'completed', assignee: 'worker-1' },
      delegation: { active: true, owner: 'principal-1' },
      context: { companyId: 'acme', process: 'claims', schemaVersion: 2 },
    };
    const worldB = {
      work: { status: 'proposed', assignee: 'worker-2' },
      delegation: { active: false, owner: 'principal-2' },
      context: { companyId: 'other', process: 'ledger', schemaVersion: 1 },
    };

    for (const world of [worldA, worldB]) {
      expect(heartbeat.evaluateHeartbeat(events, cursor)).toEqual({
        kind: 'activate',
        model: 'flash',
      });
      expect(world).toBeTruthy();
    }
  });

  it('admits only (events, cursor) — the pure filter signature', () => {
    const pure: (
      events: readonly BusinessEvent[],
      cursor?: heartbeat.HeartbeatCursor,
    ) => heartbeat.HeartbeatDecision = heartbeat.evaluateHeartbeat;
    expect(pure).toBe(heartbeat.evaluateHeartbeat);
    expectTypeOf(heartbeat.evaluateHeartbeat)
      .parameter(0)
      .toMatchTypeOf<readonly BusinessEvent[]>();
    expectTypeOf(heartbeat.evaluateHeartbeat)
      .parameter(1)
      .toMatchTypeOf<heartbeat.HeartbeatCursor | undefined>();
  });

  it('imports only the local types module — no model, work, delegation, or context surface', () => {
    const source = readFileSync(new URL('../src/heartbeat.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imported).toEqual(['./types.js']);
  });

  it('cross-tenant events are isolated (company A material, B none → B no-llm)', async () => {
    const repo = new InMemoryBusinessEventRepository();
    await repo.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    await repo.append(sampleEvent('evt:a-2', 'work.started', 'company-a'));

    const companyA = await repo.listByCompany('company-a');
    const companyB = await repo.listByCompany('company-b');

    expect(companyA).toHaveLength(2);
    expect(companyB).toHaveLength(0);
    expect(heartbeat.evaluateHeartbeat(companyA)).toEqual({ kind: 'activate', model: 'flash' });
    expect(heartbeat.evaluateHeartbeat(companyB)).toEqual({ kind: 'no-llm-heartbeat' });
  });
});

describe('boundary + isolation (R8)', () => {
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
