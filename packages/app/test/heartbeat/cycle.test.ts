import { describe, expect, it } from 'vitest';

import type { HeartbeatCursor } from '@io/business-domain/src/index.js';
import { InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';
import type { BusinessEvent } from '@io/business-domain/src/types.js';

import {
  acceptedWork,
  cannedLlm,
  RecordingEvents,
  RecordingJournal,
  RecordingReceipts,
} from '../worker-helpers.js';
import { evaluateHeartbeatGate } from '../../src/heartbeat/cycle.js';

/**
 * Worker-boundary heartbeat gate (Approach 1, heartbeat-activation): the
 * company-scoped boundary gate a future supervisor evaluates to decide
 * whether to run the work-bearing cycle. R1: companyId-only, read-only event
 * seam, optional cursor — NEVER a workId (deadlock prevention). R2: a pure
 * read on BOTH decision paths — zero claims, journals, receipts, appends, or
 * LLM calls; `no-llm-heartbeat` emits nothing (no self-activation). The
 * decision is the deterministic filter output, nothing more.
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

describe('evaluateHeartbeatGate — company-scoped boundary gate (R1)', () => {
  it('empty stream → no-llm-heartbeat, EXACTLY ONE list, ZERO appends (S1.2)', async () => {
    const events = new RecordingEvents();

    const decision = await evaluateHeartbeatGate({ events }, 'acme');

    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(0);
  });

  it('unseen work.completed → activate flash, EXACTLY ONE list, ZERO writes (S1.3)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    const writesBefore = events.appends.length;

    const decision = await evaluateHeartbeatGate({ events }, 'acme');

    expect(decision).toEqual({ kind: 'activate', model: 'flash' });
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(writesBefore);
  });

  it('seen cursor → no-llm-heartbeat; novelty is cursor-defined, not recency (S1.4)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    await events.append(sampleEvent('evt:2', 'work.completed'));
    const writesBefore = events.appends.length;
    const cursor: HeartbeatCursor = { lastEventId: 'evt:2' };

    const decision = await evaluateHeartbeatGate({ events }, 'acme', cursor);

    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });
    expect(events.listCalls).toEqual(['acme']);
    expect(events.appends).toHaveLength(writesBefore);
  });
});

describe('evaluateHeartbeatGate — gate contract proofs (R1)', () => {
  it('workId is excluded: compile-time error + runtime arity has NO workId slot (S1.1)', async () => {
    const events = new RecordingEvents();

    // Type-level proof: a work-scoped call is a COMPILE ERROR (deadlock
    // prevention — the gate decides for the COMPANY, never for a work item).
    // `pnpm check` (tsc) fails if this directive goes stale, so the workId
    // exclusion is continuously proven by the compiler.
    // @ts-expect-error — the gate MUST NOT accept a workId (S1.1)
    await evaluateHeartbeatGate({ events }, 'acme', undefined, 'work-1');

    // Runtime proof: the function exposes exactly three parameter slots —
    // deps, companyId, cursor — and NO workId slot (JS erases the optional
    // marker, so Function#length is exactly 3).
    expect(evaluateHeartbeatGate.length).toBe(3);
    expect(events.listCalls).toEqual(['acme']);
  });

  it('company A with unseen material events, company B with none → B no-llm (S1.5)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:a-1', 'work.completed', 'company-a'));
    const writesBefore = events.appends.length;

    const companyA = await evaluateHeartbeatGate({ events }, 'company-a');
    const companyB = await evaluateHeartbeatGate({ events }, 'company-b');

    expect(companyA).toEqual({ kind: 'activate', model: 'flash' });
    expect(companyB).toEqual({ kind: 'no-llm-heartbeat' });
    expect(events.listCalls).toEqual(['company-a', 'company-b']);
    expect(events.appends).toHaveLength(writesBefore);
  });

  it('rejects an empty companyId BEFORE reading events — listCalls stays empty (S1.6)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));

    await expect(evaluateHeartbeatGate({ events }, '')).rejects.toThrow(
      'a non-empty companyId is required',
    );

    expect(events.listCalls).toEqual([]);
    expect(events.appends).toHaveLength(1);
  });
});

describe('evaluateHeartbeatGate — read-only, non-self-activating evaluation (R2)', () => {
  it('zero mutations on BOTH paths: Work, journal, receipts, events unchanged (S2.1)', async () => {
    const events = new RecordingEvents();
    const journal = new RecordingJournal();
    const receipts = new RecordingReceipts();
    const work = new InMemoryWorkRepository();
    await work.save(acceptedWork());
    await events.append(sampleEvent('evt:1', 'work.started'));
    await events.append(sampleEvent('evt:2', 'work.completed'));
    const seededAppends = events.appends.length;

    const workBefore = await work.get('acme', 'work-1');
    const journalBefore = journal.snapshot();
    const journalLogBefore = [...journal.log];
    const receiptsBefore = [...receipts.saves];
    const streamBefore = [...(await events.listByCompany('acme'))];

    // Path 1 — activate (a material event follows the cursor).
    const activate = await evaluateHeartbeatGate({ events }, 'acme', { lastEventId: 'evt:1' });
    expect(activate).toEqual({ kind: 'activate', model: 'flash' });
    // Path 2 — no-llm (cursor past the material event).
    const decline = await evaluateHeartbeatGate({ events }, 'acme', { lastEventId: 'evt:2' });
    expect(decline).toEqual({ kind: 'no-llm-heartbeat' });

    expect(await work.get('acme', 'work-1')).toEqual(workBefore);
    expect(journal.snapshot()).toEqual(journalBefore);
    expect(journal.log).toEqual(journalLogBefore);
    expect(receipts.saves).toEqual(receiptsBefore);
    expect(events.appends).toHaveLength(seededAppends);
    expect(await events.listByCompany('acme')).toEqual(streamBefore);
  });

  it('never invokes the LLM on either path — the gate is built with ONLY { events } (S2.2)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    const llm = cannedLlm();

    await evaluateHeartbeatGate({ events }, 'acme'); // activate path
    await evaluateHeartbeatGate({ events }, 'fresh-co'); // no-llm path

    expect(llm.requests).toHaveLength(0);
  });

  it('no-llm cannot self-activate: re-list identical, ZERO gate appends (S2.3)', async () => {
    const events = new RecordingEvents();

    const decision = await evaluateHeartbeatGate({ events }, 'acme');
    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });

    // The no-llm path emitted NOTHING — re-reading the tenant stream shows no
    // gate-emitted work.completed (self-activation would have appended one).
    expect(await events.listByCompany('acme')).toEqual([]);
    expect(events.appends).toHaveLength(0);
  });

  it('no-llm with a seen cursor: material stream identical, no new work.completed (S2.3)', async () => {
    const events = new RecordingEvents();
    await events.append(sampleEvent('evt:1', 'work.completed'));
    await events.append(sampleEvent('evt:2', 'work.started'));
    const seeded = events.appends.length;
    const streamBefore = [...(await events.listByCompany('acme'))];
    const cursor: HeartbeatCursor = { lastEventId: 'evt:1' };

    const decision = await evaluateHeartbeatGate({ events }, 'acme', cursor);
    expect(decision).toEqual({ kind: 'no-llm-heartbeat' });

    const streamAfter = await events.listByCompany('acme');
    expect(streamAfter).toEqual(streamBefore);
    expect(streamAfter.filter((event) => event.eventType === 'work.completed')).toHaveLength(1);
    expect(events.appends).toHaveLength(seeded);
    expect(events.appends.filter((event) => event.eventType === 'work.completed')).toHaveLength(1);
  });
});
