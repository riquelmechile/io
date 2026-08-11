import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { DurableJournalFake, InMemoryWorkRepository } from '@io/business-domain/src/ports/fakes.js';
import type { JournalFakePersistence } from '@io/business-domain/src/ports/fakes.js';
import type { JournalEntry } from '@io/business-domain/src/ports/idempotency.js';
import { describe, expect, it } from 'vitest';

import { DurableSandboxFake } from '../src/sandbox/durable-sandbox-fake.js';
import type { EffectRecord, SandboxAction } from '../src/sandbox/sandbox-port.js';
import { recoverInFlightWork, type RecoverInput } from '../src/worker/recover.js';
import { acceptedWork } from './worker-helpers.js';

/**
 * B9 — Durable restart recovery (WC durable-restart; design "Post-effect /
 * restart" table): a worker that dies mid-cycle MUST recover from the DURABLE
 * (PostgreSQL-backed) journal in-flight row — the recovery anchor that
 * survives process death — consulting BOTH the journal and the durable sandbox
 * undo log (SoT, §9.8). These tests are NON-VACUOUS: the "restart" is a FRESH
 * `DurableJournalFake` + FRESH `DurableSandboxFake` over the SAME persisted
 * JSON files (acceptance note 3 model), so the in-flight row and the applied
 * effect really survive — a purely in-memory fake that wipes on restart would
 * prove nothing. Live-PostgreSQL durability is proven in Slice C.
 *
 *   - in-flight row + applied effect → reconcile to a terminal state: undo the
 *     effect (persisted) + mark the attempt retryable (aborted_retryable, own
 *     durable write — NEVER a failure-complete), → `cas-lost-retryable`.
 *   - in-flight row, no effect (crash before the effect) → W2: durable proof of
 *     no applied effect converts the attempt to the retryable marker WITHOUT
 *     undo → `cas-lost-retryable` (the row is never left `in_flight` forever).
 *   - completed row → the recorded result replays; aborted_retryable row →
 *     already reconciled; no row → W1 resume signal (the supervisor inserts
 *     fresh), never a fabricated resolution.
 */

const COMPANY = 'acme';
const KEY = 'close-2026-q3';
const HASH = 'hash-1';
const ATTEMPT = 'att:acme:close-2026-q3';
const WORK_ID = 'work-1';

const docAction: SandboxAction = {
  type: 'create-document',
  relativePath: 'docs/quarterly-close.md',
  content: 'closed for Q3 2026',
};

/** JSON-file-backed persistence (fs lives in the test — app src stays pure). */
function jsonFilePersistence(path: string): JournalFakePersistence {
  return {
    load() {
      return existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as readonly JournalEntry[])
        : [];
    },
    save(entries) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(entries));
    },
  };
}

function recoverInput(overrides: Partial<RecoverInput> = {}): RecoverInput {
  return {
    companyId: COMPANY,
    workId: WORK_ID,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    ...overrides,
  };
}

/** Crash site: claim the work (accepted → in_progress) + commit the in-flight
 * journal row + apply the effect through the DURABLE sandbox, then STOP (no
 * verify, no finalize — the worker died). The work repository is shared with
 * the recovering worker (work durability is live-PG, proven in Slice C; this
 * test proves the JOURNAL + UNDO-LOG durability that is the design's restart
 * anchor). */
async function crashAfterInsertInFlightAndEffect(
  journalPath: string,
  sandboxPath: string,
): Promise<{ work: InMemoryWorkRepository; effect: EffectRecord }> {
  const work = new InMemoryWorkRepository();
  await work.save(acceptedWork());
  const current = await work.get(COMPANY, WORK_ID);
  if (current === undefined) throw new Error('test setup: work not seeded');
  const claimed = await work.updateIfVersion({ ...current, state: 'in_progress' }, current.version);
  if (!claimed.ok) throw new Error('test setup: claim failed');
  const journal = new DurableJournalFake(jsonFilePersistence(journalPath));
  await journal.insertInFlight({
    companyId: COMPANY,
    idempotencyKey: KEY,
    requestHash: HASH,
    attemptId: ATTEMPT,
    fencingToken: 0,
  });
  const sandbox = new DurableSandboxFake(sandboxPath);
  // The crashed worker's execute call site stamped the attempt correlation:
  // the DURABLE undo-log entry carries THIS attempt's idempotencyKey so the
  // recovering worker can prove ownership (verification CRITICAL #1).
  const effect = await sandbox.execute(docAction, { idempotencyKey: KEY });
  return { work, effect };
}

describe('durable restart recovery (WC durable-restart)', () => {
  it('crash after insertInFlight+effect → a FRESH worker over the same durable files reads the in-flight row and reconciles to a terminal state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-restart-'));
    try {
      const journalPath = join(dir, 'journal.json');
      const sandboxPath = join(dir, 'sandbox.json');
      const { work, effect } = await crashAfterInsertInFlightAndEffect(journalPath, sandboxPath);

      // NON-VACUOUS restart: fresh journal + fresh sandbox over the SAME files.
      const journal = new DurableJournalFake(jsonFilePersistence(journalPath));
      const sandbox = new DurableSandboxFake(sandboxPath);
      expect((await journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
      expect(await sandbox.wasApplied(effect.undo.handleId)).toBe(true);

      const result = await recoverInFlightWork({ work, journal, sandbox }, recoverInput());

      expect(result).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
      // Reconciles to a terminal state: the attempt is durably closed with the
      // retryable marker — NOT a failure-complete that bricks the key.
      const row = await journal.lookup(COMPANY, KEY);
      expect(row?.status).toBe('aborted_retryable');
      expect(row?.attemptId).toBe(ATTEMPT);
      // No leak: the effect was reversed, and the reversal PERSISTED — a THIRD
      // fresh sandbox over the same file still sees it undone.
      expect(await sandbox.wasApplied(effect.undo.handleId)).toBe(false);
      const third = new DurableSandboxFake(sandboxPath);
      expect(await third.wasApplied(effect.undo.handleId)).toBe(false);
      // The work was NOT fabricated into terminal.
      expect((await work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
      // The marker allows a controlled retry: same-key same-hash reopen succeeds.
      await journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 0,
      });
      expect((await journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the in-flight row is DURABLE: a fresh DurableJournalFake over the same file sees it (fake mirrors PG durability — the restart is non-vacuous)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-restart-'));
    try {
      const journalPath = join(dir, 'journal.json');
      const first = new DurableJournalFake(jsonFilePersistence(journalPath));
      await first.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 0,
      });

      const second = new DurableJournalFake(jsonFilePersistence(journalPath)); // restart
      const row = await second.lookup(COMPANY, KEY);
      expect(row?.status).toBe('in_flight');
      expect(row?.requestHash).toBe(HASH);
      expect(row?.attemptId).toBe(ATTEMPT);
      // A purely in-memory fake that wiped on re-instantiation would fail this.
      expect(existsSync(journalPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('W1: NO journal row (entry===undefined) → NEW typed outcome { ok:false, reason:"resume" } — the supervisor inserts fresh; token retained, NO journal write (spec "W1 resumes with no journal row")', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-restart-'));
    try {
      const sandboxPath = join(dir, 'sandbox.json');
      const work = new InMemoryWorkRepository();
      await work.save(acceptedWork());
      const current = await work.get(COMPANY, WORK_ID);
      if (current === undefined) throw new Error('test setup: work not seeded');
      // The claim mints token 1; the worker crashed BEFORE the pre-effect
      // insertInFlight — no journal row exists and the undo log is empty.
      const claimed = await work.updateIfVersion(
        { ...current, state: 'in_progress' },
        current.version,
        { kind: 'claim' },
      );
      if (!claimed.ok) throw new Error('test setup: claim failed');
      const journal = new DurableJournalFake(jsonFilePersistence(join(dir, 'journal.json')));
      const sandbox = new DurableSandboxFake(sandboxPath);

      const result = await recoverInFlightWork({ work, journal, sandbox }, recoverInput());

      // W1 (design D7): a RESUMABLE disposition — NOT UNRESOLVED_REQUIRES_HUMAN.
      // The caller (supervisor recovery) inserts a fresh attempt at the
      // pre-effect reconcile; recovery never fabricates a journal row/effect.
      expect(result).toEqual({ ok: false, reason: 'resume' });
      // NO journal write: the key still has NO row (nothing fabricated).
      expect(await journal.lookup(COMPANY, KEY)).toBeUndefined();
      // Token retained: the minted claim token was never re-minted by recovery.
      const after = await work.get(COMPANY, WORK_ID);
      expect(after?.state).toBe('in_progress');
      expect(after?.fencingToken).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('crash after insertInFlight but BEFORE the effect → W2 retryable: cas-lost-retryable with the aborted_retryable marker, NO undo (previously dead-ended at recovery-required with the row stuck in_flight)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-restart-'));
    try {
      const journalPath = join(dir, 'journal.json');
      const sandboxPath = join(dir, 'sandbox.json');
      const work = new InMemoryWorkRepository();
      await work.save(acceptedWork());
      const current = await work.get(COMPANY, WORK_ID);
      if (current === undefined) throw new Error('test setup: work not seeded');
      const claimed = await work.updateIfVersion(
        { ...current, state: 'in_progress' },
        current.version,
      );
      if (!claimed.ok) throw new Error('test setup: claim failed');
      const journal = new DurableJournalFake(jsonFilePersistence(journalPath));
      await journal.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 0,
      });
      // NO effect was executed: the durable undo log is empty.
      const sandbox = new DurableSandboxFake(sandboxPath);

      const result = await recoverInFlightWork({ work, journal, sandbox }, recoverInput());

      // W2 un-sticks (design D3): durable proof of no applied effect converts
      // the in_flight row to the retryable marker WITHOUT undo — the row is
      // NEVER left in_flight forever (the pre-slice dead-end).
      expect(result).toMatchObject({ ok: false, reason: 'cas-lost-retryable' });
      // The marker PERSISTED durably: a fresh journal over the same file sees it.
      const row = await journal.lookup(COMPANY, KEY);
      expect(row?.status).toBe('aborted_retryable');
      expect(row?.attemptId).toBe(ATTEMPT);
      const restarted = new DurableJournalFake(jsonFilePersistence(journalPath));
      expect((await restarted.lookup(COMPANY, KEY))?.status).toBe('aborted_retryable');
      // NO undo was called (nothing to reverse — W2 abort requires no undo).
      expect(await sandbox.wasApplied('undo-never')).toBe(false);
      expect((await work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the claim fencing token SURVIVES a restart WITH the marker: the aborted_retryable row restores with token N, and the controlled retry uses N (fake mirrors PG durability — task 2.5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'io-restart-'));
    try {
      const journalPath = join(dir, 'journal.json');
      const first = new DurableJournalFake(jsonFilePersistence(journalPath));
      await first.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 7,
      });
      await first.markRetryable(ATTEMPT, 7);

      // RESTART: a FRESH fake over the same file — the marker AND its claim
      // token survive (a purely in-memory wipe would lose both).
      const second = new DurableJournalFake(jsonFilePersistence(journalPath));
      const row = await second.lookup(COMPANY, KEY);
      expect(row?.status).toBe('aborted_retryable');
      expect(row?.attemptId).toBe(ATTEMPT);
      expect(row?.fencingToken).toBe(7);

      // The controlled retry after the restart reopens and RETAINS token N —
      // never re-minted, never incremented (spec "Controlled retry retains its
      // token").
      await second.insertInFlight({
        companyId: COMPANY,
        idempotencyKey: KEY,
        requestHash: HASH,
        attemptId: ATTEMPT,
        fencingToken: 99, // a fresh claim WOULD mint higher — the retry must not adopt it
      });
      const reopened = await second.lookup(COMPANY, KEY);
      expect(reopened?.status).toBe('in_flight');
      expect(reopened?.fencingToken).toBe(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
