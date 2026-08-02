import { describe, expect, it } from 'vitest';

import type { HeartbeatCursor } from '@io/business-domain/src/index.js';
import type { BusinessEvent } from '@io/business-domain/src/types.js';

import { RecordingEvents } from '../worker-helpers.js';
import { evaluateHeartbeatForCompany } from '../../src/heartbeat/evaluate.js';

/**
 * Read-only evaluator seam (heartbeat R6, R7): `evaluateHeartbeatForCompany`
 * MUST read the company's event stream EXACTLY ONCE and return the pure
 * domain decision — with ZERO writes/mutations (proven by
 * `appends.length === 0`). Tenant scoping (R7): an empty `companyId` is
 * rejected BEFORE any repository read.
 *
 * Decision table (spec scenarios 10, 11, 13):
 * - empty stream          → `no-llm-heartbeat` (no material novelty);
 * - unseen work.completed → `activate` with model `flash`;
 * - seen cursor           → `no-llm-heartbeat` (novelty is cursor-defined).
 */

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

describe('evaluateHeartbeatForCompany — read-only decision seam (R6)', () => {
  it('empty stream → no-llm-heartbeat, EXACTLY ONE tenant-scoped list, ZERO writes', async () => {
    const events = new RecordingEvents();

    const decision = await evaluateHeartbeatForCompany({ events }, 'acme');

    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });
    // Exactly one tenant-scoped read; the empty result is REAL (no events
    // were ever appended to this repository).
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(0);
  });

  it('unseen work.completed → activate flash, EXACTLY ONE list, ZERO writes', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    const writesBefore = events.appends.length;

    const decision = await evaluateHeartbeatForCompany({ events }, 'acme');

    expect(decision).toEqual({ kind: 'activate', model: 'flash' });
    expect(events.listCalls).toEqual(['acme']);
    // The EVALUATOR appended nothing — the stream holds only the seed writes.
    expect(events.appends).toHaveLength(writesBefore);
  });

  it('seen cursor → no-llm-heartbeat (novelty is cursor-defined, not recency)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    await events.append(sampleEvent('evt:2', 'work.completed'));
    const writesBefore = events.appends.length;
    const cursor: HeartbeatCursor = { lastEventId: 'evt:2' };

    const decision = await evaluateHeartbeatForCompany({ events }, 'acme', cursor);

    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(writesBefore);
  });

  it('cursor mid-stream with a LATER material event → activate (triangulation)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    await events.append(sampleEvent('evt:2', 'work.started'));
    await events.append(sampleEvent('evt:3', 'work.completed'));
    const writesBefore = events.appends.length;
    const cursor: HeartbeatCursor = { lastEventId: 'evt:1' };

    const decision = await evaluateHeartbeatForCompany({ events }, 'acme', cursor);

    expect(decision).toEqual({ kind: 'activate', model: 'flash' });
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(writesBefore);
  });

  it('one evaluation performs EXACTLY ONE listByCompany and ZERO writes', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    const writesBefore = events.appends.length;

    await evaluateHeartbeatForCompany({ events }, 'acme');

    expect(events.listCalls).toHaveLength(1);
    expect(events.appends).toHaveLength(writesBefore);
  });
});

describe('evaluateHeartbeatForCompany — tenant-scoped evaluation (R7)', () => {
  it('rejects an empty companyId BEFORE reading events (listCalls stays empty)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));

    await expect(evaluateHeartbeatForCompany({ events }, '')).rejects.toThrow(
      'a non-empty companyId is required',
    );

    // Rejected before any repository read — the seam never lists on an
    // empty tenant scope.
    expect(events.listCalls).toEqual([]);
    expect(events.appends).toHaveLength(1);
  });

  it('company A with unseen material events and company B with none → B no-llm (cross-tenant isolation)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    const writesBefore = events.appends.length;

    const companyA = await evaluateHeartbeatForCompany({ events }, 'company-a');
    const companyB = await evaluateHeartbeatForCompany({ events }, 'company-b');

    expect(companyA).toEqual({ kind: 'activate', model: 'flash' });
    expect(companyB).toEqual({ kind: 'no-llm-heartbeat' });
    expect(events.listCalls).toEqual(['company-a', 'company-b']);
    expect(events.appends).toHaveLength(writesBefore);
  });
});
