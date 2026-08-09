import { describe, expect, it } from 'vitest';

import { evidenceId } from '../src/evidence-id.js';
import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  JournalStatus,
} from '../src/ports/idempotency.js';
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
    fencingToken: 0,
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
      fencingToken: 0,
    });

    const result = await completeWork(completeCmd(), deps);

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe('attempt-in-flight');
  });
});

/** Journal whose claim always loses — simulates a same-key race loser at the
 * claim boundary: the pre-effect lookup sees nothing, but insertInFlight returns
 * the typed lost-claim result (a concurrent attempt owns the key). */
class LostClaimJournal implements IdempotencyJournalPort {
  async lookup(): Promise<JournalEntry | undefined> {
    return undefined;
  }
  async insertInFlight(): Promise<JournalClaimResult> {
    return { ok: false, reason: 'attempt-in-flight' };
  }
  async complete(): Promise<void> {}
  async markRetryable(): Promise<void> {}
}

describe('idempotent completeWork — same-key race loser (D6)', () => {
  it('a lost claim at the journal boundary returns typed attempt-in-flight — no throw, no effect', async () => {
    const { deps, work, receipts } = await setup();

    const result = await completeWork(completeCmd(), { ...deps, journal: new LostClaimJournal() });

    expect(result).toEqual({ ok: false, reason: 'attempt-in-flight' });
    // No effect ran: the work is untouched and NO receipt was issued.
    expect((await work.get('acme', 'work-1'))?.state).toBe('in_progress');
    expect((await work.get('acme', 'work-1'))?.version).toBe(2);
    expect(await receipts.get('acme', 'rcpt:att:acme:key-1')).toBeUndefined();
  });
});

describe('JournalStatus domain (IJ marker-distinct)', () => {
  it('the port type admits exactly in_flight | completed | aborted_retryable (compile-time)', () => {
    // Compile-time RED until the port adds the third value: tsc rejects the
    // assignment while the union has only two statuses (pnpm typecheck gate).
    const marker: JournalStatus = 'aborted_retryable';
    expect(marker).toBe('aborted_retryable');
  });
});

describe('journal fake — UNRESOLVED sentinel parity with PG (F1/F4)', () => {
  it('lookup passes through the NON-Work UNRESOLVED_REQUIRES_HUMAN sentinel — never throws (mirrors the PG adapter via the shared recognizer)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 0,
    });
    await journal.complete('att:acme:key-1', { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
  });

  it('isUnresolvedJournalResult recognizes ONLY the sentinel shape (a Work / null / array are not it)', async () => {
    const { isUnresolvedJournalResult } = await import('../src/ports/idempotency.js');
    expect(isUnresolvedJournalResult({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' })).toBe(
      true,
    );
    expect(isUnresolvedJournalResult({ ok: true, note: 'done' })).toBe(false);
    expect(isUnresolvedJournalResult({ ok: false, reason: 'something-else' })).toBe(false);
    expect(isUnresolvedJournalResult(null)).toBe(false);
    expect(isUnresolvedJournalResult(['UNRESOLVED_REQUIRES_HUMAN'])).toBe(false);
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
      fencingToken: 0,
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

describe('journal fencing token (task 2.1) — token store / token-0 / tenant scope / complete status guard', () => {
  it('insertInFlight stores the claim token PRE-effect: the in_flight row carries the token, no stored result yet', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('in_flight');
    expect(entry?.fencingToken).toBe(7);
    expect(entry?.resultJson).toBeUndefined();
  });

  it('lookup is TOKEN-FREE: replay / DENY / attempt-in-flight resolve without any token argument', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });
    await journal.complete('att:acme:key-1', { state: 'completed', version: 3 });

    // Replay: the completed row reads back WITHOUT a token in the lookup call.
    const completed = await journal.lookup('acme', 'key-1');
    expect(completed?.status).toBe('completed');
    expect(completed?.fencingToken).toBe(7);

    // attempt-in-flight: a second claim on the SAME key loses WITHOUT a token check.
    const claim = await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1-again',
      fencingToken: 8,
    });
    expect(claim).toEqual({ ok: false, reason: 'attempt-in-flight' });
  });

  it('tenant scope: a lookup under another company sees no row', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });

    expect(await journal.lookup('other-co', 'key-1')).toBeUndefined();
  });

  it('token 0 is VALID (pre-fencing epoch): an unclaimed / legacy close inserts and stays at 0', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    const claim = await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-0',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-0',
      fencingToken: 0,
    });
    expect(claim).toEqual({ ok: true });
    expect((await journal.lookup('acme', 'key-0'))?.fencingToken).toBe(0);
  });

  it('complete REJECTS a non-in_flight row WITHOUT mutation: completed stays completed, marker stays aborted_retryable', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 0,
    });
    await journal.complete('att:acme:key-1', { ok: true, note: 'done' });
    // A second complete on the COMPLETED row must reject and leave it unchanged.
    await expect(journal.complete('att:acme:key-1', { ok: true, note: 'again' })).rejects.toThrow(
      /in_flight|not/i,
    );
    expect((await journal.lookup('acme', 'key-1'))?.status).toBe('completed');
    expect((await journal.lookup('acme', 'key-1'))?.resultJson).toEqual({ ok: true, note: 'done' });

    // Mark retryable, then complete on the MARKER row must reject and leave it unchanged.
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-2',
      requestHash: 'hash-2',
      attemptId: 'att:acme:key-2',
      fencingToken: 0,
    });
    await journal.markRetryable('att:acme:key-2', 0);
    await expect(journal.complete('att:acme:key-2', { ok: true })).rejects.toThrow(
      /in_flight|not/i,
    );
    expect((await journal.lookup('acme', 'key-2'))?.status).toBe('aborted_retryable');
  });

  it('token-free honest UNRESOLVED T2(ii) close lands: complete(attemptId, sentinel) succeeds WITHOUT any token check', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 3,
    });
    // NO token argument — the honest stale-holder close is token-free by contract.
    await journal.complete('att:acme:key-1', { ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('completed');
    expect(entry?.resultJson).toEqual({ ok: false, reason: 'UNRESOLVED_REQUIRES_HUMAN' });
  });

  it('completeWork threads the claim token into the journal row: cmd.fencingToken lands on the stored entry', async () => {
    const work = new InMemoryWorkRepository();
    await work.save({
      workId: 'work-2',
      companyId: 'acme',
      delegationId: 'del-1',
      proposer: 'principal-2',
      description: 'claim-owned close',
      state: 'in_progress',
      version: 2,
      fencingToken: 5,
      evidenceRefs: ['evid-a'],
    });
    const receipts = new InMemoryBusinessReceiptRepository();
    const journal = new InMemoryIdempotencyJournalRepository();

    const value = expectOk(
      await completeWork(completeCmd({ workId: 'work-2', fencingToken: 5 }), {
        work,
        receipts,
        journal,
      }),
    );

    expect(value.state).toBe('completed');
    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.fencingToken).toBe(5);
  });
});

describe('markRetryable token gate (task 2.2) — matching marks, stale rejects, retry retains N', () => {
  it('matching token marks the attempt retryable and RETAINS token N (no increment, no re-claim)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });

    await journal.markRetryable('att:acme:key-1', 7);

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('aborted_retryable');
    expect(entry?.fencingToken).toBe(7); // retained — a controlled retry uses N, never a fresh claim
    expect(entry?.resultJson).toBeUndefined();
  });

  it('a STALE token cannot mark retryable: rejected WITHOUT mutation — status and stored token preserved', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });

    await expect(journal.markRetryable('att:acme:key-1', 3)).rejects.toThrow(/fencing|token/i);

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('in_flight');
    expect(entry?.fencingToken).toBe(7);
  });

  it('the marker is distinct from in_flight and completed (spec: neither)', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });
    await journal.markRetryable('att:acme:key-1', 7);

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('aborted_retryable');
    expect(entry?.status).not.toBe('in_flight');
    expect(entry?.status).not.toBe('completed');
  });

  it('a controlled retry retains token N: reopening the marker keeps N — a fresh claim token is NOT adopted (spec "Controlled retry retains its token")', async () => {
    const journal = new InMemoryIdempotencyJournalRepository();
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1',
      fencingToken: 7,
    });
    await journal.markRetryable('att:acme:key-1', 7);

    // Same-key retry resumes: reopen (same hash) — the ORIGINAL token N is
    // retained even though a fresh claim WOULD mint a higher token.
    await journal.insertInFlight({
      companyId: 'acme',
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      attemptId: 'att:acme:key-1-retry',
      fencingToken: 9,
    });

    const entry = await journal.lookup('acme', 'key-1');
    expect(entry?.status).toBe('in_flight');
    expect(entry?.attemptId).toBe('att:acme:key-1'); // original kept
    expect(entry?.fencingToken).toBe(7); // N retained — never incremented
  });
});
