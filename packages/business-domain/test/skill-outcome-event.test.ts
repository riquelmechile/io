import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ActivatedSkillRef,
  BusinessEvent,
  SkillOutcomeEventInput,
  SkillOutcomePayload,
} from '../src/index.js';
import { buildSkillOutcomeEvent } from '../src/index.js';

/**
 * Domain unit tests for the pure worker skill-outcome factory (business-event
 * delta: Pure Deterministic BusinessEvent, Idempotent Single Emission; skill
 * delta: Intent-Captured Skill Usage Outcomes). Identity `evt:sk:{attemptId}`
 * depends SOLELY on the attempt identity; `occurredAt` (caller-supplied close
 * timestamp) stays excluded from identity; `aggregateId` is exactly the closed
 * `workId`; the versioned payload preserves the intent-time selection, empty
 * included. `sk:` is exclusive to this builder (`source:'worker'`).
 */

const NOW = 1750000000000;

const baseInput = (overrides: Partial<SkillOutcomeEventInput> = {}): SkillOutcomeEventInput => ({
  companyId: 'acme',
  workId: 'work-1',
  attemptId: 'att:acme:attempt-1',
  occurredAt: NOW,
  activatedSkills: [{ skillId: 'sdlc-review', version: 3 }],
  ...overrides,
});

const build = (overrides?: Partial<SkillOutcomeEventInput>) =>
  buildSkillOutcomeEvent(baseInput(overrides));

describe('buildSkillOutcomeEvent — shape contract (Atomic Worker Terminal Emission)', () => {
  it('emits the exact worker shape: evt:sk:{attemptId} + routing/typing/payload fields', () => {
    expect(build()).toEqual({
      eventId: 'evt:sk:att:acme:attempt-1',
      companyId: 'acme',
      aggregateKind: 'work',
      aggregateId: 'work-1',
      eventType: 'work.skill-outcome',
      occurredAt: NOW,
      payload: { version: 1, activatedSkills: [{ skillId: 'sdlc-review', version: 3 }] },
      source: 'worker',
    });
    expectTypeOf(build()).toEqualTypeOf<BusinessEvent>();
  });
});

describe('buildSkillOutcomeEvent — identity determinism (eventId is SOLELY attemptId)', () => {
  it('different clocks change only occurredAt, never the eventId', () => {
    const first = build({ occurredAt: 1 });
    const second = build({ occurredAt: 2 ** 40 });

    expect(first.eventId).toBe('evt:sk:att:acme:attempt-1');
    expect(second.eventId).toBe(first.eventId);
    expect(first.occurredAt).toBe(1);
    expect(second.occurredAt).toBe(2 ** 40);
  });

  it('identical terminal-close facts rebuild an identical event (retry-stable)', () => {
    expect(build()).toEqual(build());
  });

  it('a different attemptId yields a DIFFERENT eventId', () => {
    const a = build();
    const b = build({ attemptId: 'att:beta:attempt-2' });

    expect(a.eventId).toBe('evt:sk:att:acme:attempt-1');
    expect(b.eventId).toBe('evt:sk:att:beta:attempt-2');
    expect(a.eventId).not.toBe(b.eventId);
  });

  it('occurredAt is the ONLY field that varies between rebuilds of the same attempt', () => {
    const first = build();
    const rebuilt = build({ occurredAt: NOW + 5000 });

    expect(rebuilt).toEqual({ ...first, occurredAt: rebuilt.occurredAt });
    expect(rebuilt.eventId).toBe(first.eventId);
  });
});

describe('buildSkillOutcomeEvent — aggregateId is the closed Work identity', () => {
  it('aggregateId mirrors the passed workId, independent of the attempt identity', () => {
    const event = build({ workId: 'work-42', attemptId: 'att:acme:attempt-1' });

    expect(event.aggregateKind).toBe('work');
    expect(event.aggregateId).toBe('work-42');
  });
});

describe('buildSkillOutcomeEvent — payload v1 preserves the intent-captured selection', () => {
  it('version is exactly 1 and activatedSkills preserve order and values', () => {
    const selection: readonly ActivatedSkillRef[] = [
      { skillId: 'b-skill', version: 1 },
      { skillId: 'a-skill', version: 2 },
    ];
    const event = build({ activatedSkills: selection });

    expect(event.payload).toEqual({ version: 1, activatedSkills: selection });
    const payload = event.payload as SkillOutcomePayload;
    expect(payload.version).toBe(1);
    expect(payload.activatedSkills).toEqual(selection);
  });

  it('the empty selection is recorded as a versioned payload with an empty list', () => {
    expect(build({ activatedSkills: [] }).payload).toEqual({ version: 1, activatedSkills: [] });
  });
});

describe('buildSkillOutcomeEvent — disjoint sk: namespace (exclusive worker ownership)', () => {
  it('sk: ids never collide with the hb:, att:, or acc: namespace grammars', () => {
    const workerAttemptId = 'evt:att:acme:attempt-1';
    const supervisorId = 'evt:hb:2b9e2adf9e63deee';
    const acceptorId = 'evt:acc:work-1';
    const skillOutcomeId = build().eventId;

    const segmentOf = (id: string) => id.split('evt:')[1]?.split(':')[0];
    const segments = [skillOutcomeId, workerAttemptId, supervisorId, acceptorId].map(segmentOf);
    expect(new Set(segments)).toEqual(new Set(['sk', 'att', 'hb', 'acc']));
    expect(skillOutcomeId).toBe('evt:sk:att:acme:attempt-1');
    expect(skillOutcomeId).not.toBe(workerAttemptId);
    expect(skillOutcomeId).not.toBe(supervisorId);
    expect(skillOutcomeId).not.toBe(acceptorId);
  });

  it('the sk: namespace is exclusive to the worker builder: source is exactly "worker"', () => {
    const event = build();

    expect(event.eventId).toMatch(/^evt:sk:/);
    expect(event.source).toBe('worker');
  });
});

describe('buildSkillOutcomeEvent — pure dependency surface (zero @io/*)', () => {
  it('imports only the local types module and never any @io/* package', () => {
    const source = readFileSync(new URL('../src/skill-outcome-event.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imported).toEqual(['./types.js']);
    expect(source).not.toMatch(/import\s+[^;]*@io\//);
  });
});
