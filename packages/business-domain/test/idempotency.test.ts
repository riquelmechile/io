import { describe, expect, it } from 'vitest';

import { evidenceId } from '../src/evidence-id.js';
import type { Work } from '../src/types.js';
import type { CompleteWorkCommand, CompleteWorkDeps } from '../src/use-cases/index.js';
import { completeWork } from '../src/use-cases/index.js';
import {
  InMemoryBusinessReceiptRepository,
  InMemoryIdempotencyJournalRepository,
  InMemoryWorkRepository,
} from '../src/ports/fakes.js';

/**
 * Idempotency unit tests (design D6, business-receipt spec). The complete-work
 * use case wired to the journal port: same key + same request hash → REPLAY
 * (stored result, effect NOT re-run); same key + different hash → DENY
 * `{ok:false, reason:'idempotency-conflict'}`; new key → record attempt
 * (in_flight, pre-effect) → CAS → receipt (terminal_event_id = attempt_id) →
 * journal complete. Pre-flight failures (not-found / invalid-transition /
 * version-conflict / missing receipt fields) leave NO journal row. The
 * atomicity of the whole flow in ONE transaction is proven against live PG
 * (business-pg-roundtrip integration suite); these tests pin the decision
 * logic with the in-memory fakes.
 */

async function setup(): Promise<{
  work: InMemoryWorkRepository;
  receipts: InMemoryBusinessReceiptRepository;
  journal: InMemoryIdempotencyJournalRepository;
  deps: CompleteWorkDeps;
}> {
  const work = new InMemoryWorkRepository();
  const receipts = new InMemoryBusinessReceiptRepository();
  const journal = new InMemoryIdempotencyJournalRepository();
  const workObj: Work = {
    workId: 'work-1',
    companyId: 'acme',
    delegationId: 'del-1',
    proposer: 'principal-2',
    description: 'execute the close',
    state: 'in_progress',
    version: 2,
    evidenceRefs: ['evid-a'],
  };
  await work.save(workObj);
  return { work, receipts, journal, deps: { work, receipts, journal } };
}

function completeCmd(overrides: Partial<CompleteWorkCommand> = {}): CompleteWorkCommand {
  return {
    companyId: 'acme',
    actor: 'principal-1',
    workId: 'work-1',
    idempotencyKey: 'key-1',
    requestHash: 'hash-1',
    policyHash: 'sha256:policy-hash',
    artifactHash: 'sha256:artifact-hash',
    outcome: { result: 'closed successfully', success: true },
    evidenceRefs: ['evid-b'],
    ...overrides,
  };
}

function expectOk<T>(
  result: { ok: boolean } & ({ ok: true; value: T } | { ok: false; reason: string }),
): T {
  if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
  return result.value;
}

describe('idempotent completeWork — fresh key (D6)', () => {
  it('completes the work, issues the receipt with terminal_event_id = attempt id + stable evidence id, and closes the journal entry', async () => {
    const { deps, work, receipts, journal } = await setup();

    const value = expectOk(await completeWork(completeCmd(), deps));

    expect(value.state).toBe('completed');
    expect(value.version).toBe(3);
    expect(value.outcome).toEqual({ result: 'closed successfully', success: true });
    expect(value.evidenceRefs).toEqual(['evid-a', 'evid-b']);

    // The work advanced via CAS exactly once.
    const stored = await work.get('acme', 'work-1');
    expect(stored?.state).toBe('completed');
    expect(stored?.version).toBe(3);

    // Receipt: terminal close per D5/D6 — terminal_event_id = the attempt id.
    const receipt = await receipts.get('acme', 'rcpt:att:acme:key-1');
    expect(receipt).toBeDefined();
    expect(receipt?.terminalEventId).toBe('att:acme:key-1');
    expect(receipt?.terminalState).toBe('completed');
    expect(receipt?.companyId).toBe('acme');
    expect(receipt?.actor).toBe('principal-1');
    expect(receipt?.evidenceRefs).toContain(evidenceId('acme', 'key-1'));

    // Journal closed with the stored result.
    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.attemptId).toBe('att:acme:key-1');
    expect(entry?.requestHash).toBe('hash-1');
  });
});

describe('idempotent completeWork — replay (D6)', () => {
  it('the SAME key + hash REPLAYS the stored result and does NOT re-execute the effect', async () => {
    const { deps, work, journal } = await setup();

    const first = expectOk(await completeWork(completeCmd(), deps));
    const second = expectOk(await completeWork(completeCmd(), deps));

    expect(second).toEqual(first);
    expect(second.version).toBe(3); // NOT 4 — the effect did not run twice.
    expect((await work.get('acme', 'work-1'))?.version).toBe(3);
    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('completed');
  });
});

describe('idempotent completeWork — DENY (D6)', () => {
  it('the SAME key with a DIFFERENT request hash is DENIED: {ok:false, reason:idempotency-conflict}', async () => {
    const { deps } = await setup();
    await completeWork(completeCmd(), deps);

    const result = await completeWork(completeCmd({ requestHash: 'hash-DIFFERENT' }), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('idempotency-conflict');
  });

  it('an in_flight attempt under the same key is never replayed: {ok:false, reason:attempt-in-flight}', async () => {
    const { deps, journal } = await setup();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
    });

    const result = await completeWork(completeCmd(), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('attempt-in-flight');
  });
});

describe('idempotent completeWork — pre-flight failures leave NO journal row', () => {
  it('an unknown work returns {ok:false, reason:not-found} and records nothing', async () => {
    const { deps, journal } = await setup();

    const result = await completeWork(completeCmd({ workId: 'missing' }), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('not-found');
    expect(await journal.lookup('acme', 'key-1')).toBeUndefined();
  });

  it('a transition the state machine forbids returns invalid-transition and records nothing', async () => {
    const { deps, journal, work } = await setup();
    await work.save({
      workId: 'work-2',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'p',
      description: 'already done',
      state: 'completed',
      version: 1,
      evidenceRefs: [],
    });

    const result = await completeWork(completeCmd({ workId: 'work-2' }), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-transition');
    expect(await journal.lookup('acme', 'key-1')).toBeUndefined();
  });

  it('a stale expectedVersion returns version-conflict and records nothing', async () => {
    const { deps, journal } = await setup();

    const result = await completeWork(completeCmd({ expectedVersion: 1 }), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('version-conflict');
      expect(result.current?.version).toBe(2);
    }
    expect(await journal.lookup('acme', 'key-1')).toBeUndefined();
  });

  it('missing receipt fields (policyHash/artifactHash) return invalid-command and record nothing', async () => {
    const { deps, journal } = await setup();

    const result = await completeWork(
      completeCmd({ policyHash: undefined, artifactHash: undefined }),
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
    expect(await journal.lookup('acme', 'key-1')).toBeUndefined();
  });

  it('an idempotencyKey without a requestHash is invalid-command and records nothing', async () => {
    const { deps, journal } = await setup();

    const result = await completeWork(completeCmd({ requestHash: undefined }), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('invalid-command');
    expect(await journal.lookup('acme', 'key-1')).toBeUndefined();
  });
});
