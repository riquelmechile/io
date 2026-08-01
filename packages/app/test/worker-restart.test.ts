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
 *   - in-flight row, no effect (crash before the effect) → clean replay:
 *     NO undo, NO marker → `recovery-required` (design "continue
 *     effect→verify→terminal" row).
 *   - completed row → the recorded result replays; aborted_retryable row →
 *     already reconciled; no row → nothing durable to recover (never fabricate).
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
  });
  const sandbox = new DurableSandboxFake(sandboxPath);
  const effect = await sandbox.execute(docAction);
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

  it('crash after insertInFlight but BEFORE the effect → clean replay: recovery-required, NO undo, NO marker', async () => {
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
      });
      // NO effect was executed: the durable undo log is empty.
      const sandbox = new DurableSandboxFake(sandboxPath);

      const result = await recoverInFlightWork({ work, journal, sandbox }, recoverInput());

      expect(result).toMatchObject({ ok: false, reason: 'recovery-required' });
      // No marker was set (the row stays in_flight) and nothing was undone.
      expect((await journal.lookup(COMPANY, KEY))?.status).toBe('in_flight');
      expect(await sandbox.wasApplied('undo-never')).toBe(false);
      expect((await work.get(COMPANY, WORK_ID))?.state).toBe('in_progress');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
