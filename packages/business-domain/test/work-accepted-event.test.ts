import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { buildWorkAcceptedEvent } from '../src/index.js';
import type { BusinessEvent, Work } from '../src/types.js';

/**
 * Domain unit tests for the pure acceptor event factory (business-event delta:
 * Atomic Acceptance Event Emission, Idempotent Single Emission). Identity
 * `evt:acc:{workId}` depends SOLELY on `workId`; non-time routing/typing/payload
 * fields derive deterministically from the accepted Work facts; `occurredAt`
 * (injectable `now`) is the only clock-derived field and stays excluded from
 * identity. `acc:` is exclusive to this builder (`source:'acceptor'`), disjoint
 * from the `hb:` supervisor and `att:{companyId}:{idempotencyKey}` worker
 * namespaces.
 */

const NOW = 1750000000000;

const acceptedWork = (workId: string, overrides: Partial<Work> = {}): Work => ({
  workId,
  companyId: 'acme',
  delegationId: 'del-1',
  proposer: 'principal-2',
  description: 'execute the quarterly close',
  state: 'accepted',
  version: 2,
  fencingToken: 0,
  evidenceRefs: [],
  ...overrides,
});

const build = (work: Work, now?: () => number) => buildWorkAcceptedEvent(work, now);

describe('buildWorkAcceptedEvent — shape contract (Atomic Acceptance Event Emission)', () => {
  it('emits the exact acceptor event shape: evt:acc:{workId} + routing/typing/payload fields', () => {
    expect(build(acceptedWork('work-1'), () => NOW)).toEqual({
      eventId: 'evt:acc:work-1',
      companyId: 'acme',
      aggregateKind: 'work',
      aggregateId: 'work-1',
      eventType: 'work.accepted',
      occurredAt: NOW,
      payload: { workId: 'work-1', state: 'accepted', actor: 'principal-2' },
      source: 'acceptor',
    });
    expectTypeOf(build(acceptedWork('work-1'))).toEqualTypeOf<BusinessEvent>();
  });
});

describe('buildWorkAcceptedEvent — identity determinism (eventId is SOLELY workId)', () => {
  it('different clocks change only occurredAt, never the eventId', () => {
    const first = build(acceptedWork('work-1'), () => 1);
    const second = build(acceptedWork('work-1'), () => 2 ** 40);

    expect(first.eventId).toBe('evt:acc:work-1');
    expect(second.eventId).toBe(first.eventId);
    expect(first.occurredAt).toBe(1);
    expect(second.occurredAt).toBe(2 ** 40);
  });

  it('LLM-producible work facts (description/proposer) never enter identity', () => {
    const base = acceptedWork('work-1', { description: 'draft v1' });
    const llmVariant = acceptedWork('work-1', {
      description: 'a completely different generated output',
      proposer: 'llm-agent-9',
    });

    expect(build(base, () => NOW).eventId).toBe('evt:acc:work-1');
    expect(build(llmVariant, () => NOW + 1000).eventId).toBe('evt:acc:work-1');
  });

  it('a different workId yields a DIFFERENT eventId', () => {
    const a = build(acceptedWork('work-a'));
    const b = build(acceptedWork('work-b'));

    expect(a.eventId).toBe('evt:acc:work-a');
    expect(b.eventId).toBe('evt:acc:work-b');
    expect(a.eventId).not.toBe(b.eventId);
  });

  it('the clock is optional (defaults to the ambient clock) and never enters identity', () => {
    const withClock = build(acceptedWork('work-1'), () => NOW);
    const withoutClock = build(acceptedWork('work-1'));

    expect(withClock.eventId).toBe(withoutClock.eventId);
    expect(withoutClock.occurredAt).toBeGreaterThanOrEqual(NOW - 1);
  });

  it('occurredAt is the ONLY field that varies between rebuilds of the same acceptance', () => {
    const first = build(acceptedWork('work-1'), () => NOW);
    const rebuilt = build(acceptedWork('work-1'), () => NOW + 5000);

    expect(rebuilt).toEqual({ ...first, occurredAt: rebuilt.occurredAt });
    expect(rebuilt.eventId).toBe(first.eventId);
  });
});

describe('buildWorkAcceptedEvent — non-time fields deterministic from accepted Work facts', () => {
  it('routing/typing/payload fields are derived, never clock or LLM dependent', () => {
    const event = build(acceptedWork('work-1', { companyId: 'beta' }), () => NOW);

    expect(event.companyId).toBe('beta');
    expect(event.aggregateKind).toBe('work');
    expect(event.aggregateId).toBe('work-1');
    expect(event.eventType).toBe('work.accepted');
    expect(event.payload).toEqual({ workId: 'work-1', state: 'accepted', actor: 'principal-2' });
    expect(event.source).toBe('acceptor');
  });
});

describe('buildWorkAcceptedEvent — disjoint acc: namespace (exclusive ownership)', () => {
  it('any workId still yields the exact evt:acc:{workId} grammar (segment after evt: is always acc:)', () => {
    const attemptLike = build(acceptedWork('att:acme:attempt-1'));
    const hbLike = build(acceptedWork('hb:deadbeef'));

    expect(attemptLike.eventId).toBe('evt:acc:att:acme:attempt-1');
    expect(hbLike.eventId).toBe('evt:acc:hb:deadbeef');
    expect(attemptLike.eventId).toMatch(/^evt:acc:/);
    expect(hbLike.eventId).toMatch(/^evt:acc:/);
  });

  it('acceptor ids never collide with the hb: supervisor or att: worker namespace grammars', () => {
    const supervisorId = 'evt:hb:2b9e2adf9e63deee'; // buildHeartbeatDecisionEvent grammar
    const workerId = 'evt:att:acme:attempt-1'; // worker attempt grammar (full evt:att:{companyId}:{idempotencyKey})
    const acceptorId = build(acceptedWork('work-1')).eventId;

    const segmentOf = (id: string) => id.split('evt:')[1]?.split(':')[0];
    expect(new Set([segmentOf(acceptorId), segmentOf(supervisorId), segmentOf(workerId)])).toEqual(
      new Set(['acc', 'hb', 'att']),
    );
    expect(acceptorId).toBe('evt:acc:work-1');
    expect(acceptorId).not.toBe(supervisorId);
    expect(acceptorId).not.toBe(workerId);
  });

  it('the acc: namespace is exclusive to the acceptor builder: source is exactly "acceptor"', () => {
    const event = build(acceptedWork('work-1'));

    expect(event.eventId).toMatch(/^evt:acc:/);
    expect(event.source).toBe('acceptor');
  });
});

describe('buildWorkAcceptedEvent — pure dependency surface (zero @io/*)', () => {
  it('imports only the local types module and never any @io/* package', () => {
    const source = readFileSync(new URL('../src/work-accepted-event.ts', import.meta.url), 'utf8');
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imported).toEqual(['./types.js']);
    expect(source).not.toMatch(/import\s+[^;]*@io\//);
  });
});
