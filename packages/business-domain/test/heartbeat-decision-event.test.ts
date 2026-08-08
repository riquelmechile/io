import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { buildHeartbeatDecisionEvent } from '../src/index.js';
import type { HeartbeatCursor, HeartbeatDecision } from '../src/heartbeat.js';

/**
 * Domain unit tests for the supervisor heartbeat-decision event factory
 * (business-event delta: Model-Independent Event Facts, Idempotent Single
 * Emission). Identity `evt:hb:{sha256(companyId \0 (cursor ?? '') \0 kind).hex.slice(0,16)}`
 * depends ONLY on gate inputs — never clocks, LLM output, randomness, or
 * generated identifiers. `occurredAt` is the only clock-derived field.
 */

const NOW = 1750000000000;
const cursor = (lastEventId: string): HeartbeatCursor => ({ lastEventId });
const build = (companyId: string, decision: HeartbeatDecision, c?: HeartbeatCursor) =>
  buildHeartbeatDecisionEvent(companyId, decision, c, () => NOW);

describe('buildHeartbeatDecisionEvent — shape contract', () => {
  it('emits the exact supervisor decision-event shape (eventId digest + all fields)', () => {
    expect(build('acme', { kind: 'no-llm-heartbeat' }, cursor('evt:5'))).toEqual({
      eventId: 'evt:hb:2b9e2adf9e63deee', // sha256('acme\0evt:5\0no-llm-heartbeat').slice(0,16)
      companyId: 'acme',
      aggregateKind: 'heartbeat',
      aggregateId: 'acme',
      eventType: 'heartbeat.decision',
      occurredAt: NOW,
      payload: { decision: 'no-llm-heartbeat', cursor: 'evt:5' },
      source: 'supervisor',
    });
  });

  it('payload is { decision, model?, cursor }: model "flash" ONLY on activate; absent cursor → null', () => {
    const activate = build('acme', { kind: 'activate', model: 'flash' });
    const decline = build('acme', { kind: 'no-llm-heartbeat' });

    expect(activate.payload).toEqual({ decision: 'activate', model: 'flash', cursor: null });
    expect(decline.payload).toEqual({ decision: 'no-llm-heartbeat', cursor: null });
    expect('model' in decline.payload).toBe(false);
    // Absent cursor also uses the ∅ (empty-string) identity preimage.
    expect(activate.eventId).toBe('evt:hb:9cf220a0090c3378'); // sha256('acme\0\0activate')
  });

  it('payload.model reflects the decision tier: a pro activation emits "pro", not a hardcoded tier', () => {
    const proActivate = build('acme', { kind: 'activate', model: 'pro' });
    expect(proActivate.payload).toEqual({ decision: 'activate', model: 'pro', cursor: null });
    // The tier is payload-only: it never enters the eventId identity (same company/cursor/kind).
    const flashActivate = build('acme', { kind: 'activate', model: 'flash' });
    expect(proActivate.eventId).toBe(flashActivate.eventId);
  });

  it('both decision branches produce evt:hb:{16-hex} ids with full type fidelity', () => {
    const activate: HeartbeatDecision = { kind: 'activate', model: 'flash' };
    const decline: HeartbeatDecision = { kind: 'no-llm-heartbeat' };
    expect(build('acme', activate, cursor('evt:1')).eventId).toMatch(/^evt:hb:[0-9a-f]{16}$/);
    expect(build('acme', decline, cursor('evt:1')).eventId).toMatch(/^evt:hb:[0-9a-f]{16}$/);
    expectTypeOf(activate).toEqualTypeOf<{
      readonly kind: 'activate';
      readonly model: 'flash' | 'pro';
    }>();
  });
});

describe('buildHeartbeatDecisionEvent — identity determinism (Idempotent Single Emission)', () => {
  it('different clocks change only occurredAt, never the eventId', () => {
    const first = buildHeartbeatDecisionEvent(
      'acme',
      { kind: 'activate', model: 'flash' },
      cursor('evt:5'),
      () => 1,
    );
    const second = buildHeartbeatDecisionEvent(
      'acme',
      { kind: 'activate', model: 'flash' },
      cursor('evt:5'),
      () => 2 ** 40,
    );

    expect(first.eventId).toBe('evt:hb:a589ceca3b9555b4'); // sha256('acme\0evt:5\0activate')
    expect(second.eventId).toBe(first.eventId);
    expect(first.occurredAt).toBe(1);
    expect(second.occurredAt).toBe(2 ** 40);
  });

  it('the clock is optional (defaults to the ambient clock) and never enters identity', () => {
    const withClock = build('acme', { kind: 'no-llm-heartbeat' }, cursor('evt:2'));
    const withoutClock = buildHeartbeatDecisionEvent(
      'acme',
      { kind: 'no-llm-heartbeat' },
      cursor('evt:2'),
    );

    expect(withClock.eventId).toBe(withoutClock.eventId);
    expect(withoutClock.occurredAt).toBeGreaterThanOrEqual(NOW - 1);
  });

  it('different identity inputs (company/cursor/kind) yield DIFFERENT ids (collision-free preimage)', () => {
    const ids = new Set([
      build('acme', { kind: 'no-llm-heartbeat' }, cursor('evt:5')).eventId,
      build('other', { kind: 'no-llm-heartbeat' }, cursor('evt:5')).eventId,
      build('acme', { kind: 'no-llm-heartbeat' }, cursor('evt:6')).eventId,
      build('acme', { kind: 'activate', model: 'flash' }, cursor('evt:5')).eventId,
    ]);
    expect(ids.size).toBe(4);
  });

  it('a rebuilt event (retry) keeps byte-identical id + payload, differing only in occurredAt', () => {
    const first = build('acme', { kind: 'no-llm-heartbeat' }, cursor('evt:2'));
    const rebuilt = buildHeartbeatDecisionEvent(
      'acme',
      { kind: 'no-llm-heartbeat' },
      cursor('evt:2'),
      () => NOW + 5000,
    );

    expect(rebuilt.eventId).toBe(first.eventId);
    expect(rebuilt.payload).toEqual(first.payload);
    expect(rebuilt).toEqual({ ...first, occurredAt: rebuilt.occurredAt });
  });
});

describe('buildHeartbeatDecisionEvent — pure dependency surface', () => {
  it('imports only node:crypto and the local heartbeat/types modules (zero @io/*)', () => {
    const source = readFileSync(
      new URL('../src/heartbeat-decision-event.ts', import.meta.url),
      'utf8',
    );
    const imported = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(imported.sort()).toEqual(['./heartbeat.js', './types.js', 'node:crypto'].sort());
    expect(source).not.toMatch(/import\s+[^;]*@io\//);
  });
});
