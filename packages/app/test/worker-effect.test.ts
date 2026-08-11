import type { DbConnection } from '@io/database/src/connection.js';
import { describe, expect, it } from 'vitest';
import { InMemorySandbox } from '../src/sandbox/in-memory-sandbox.js';
import type {
  EffectRecord,
  SandboxAction,
  SandboxPort,
  UndoHandle,
} from '../src/sandbox/sandbox-port.js';
import { executeEffect } from '../src/worker/effect.js';
import { runWorker } from '../src/worker/worker.js';
import { harness, seed, workerInput } from './worker-helpers.js';

/**
 * B5 — Effect outside the terminal transaction (WC effect-outside-tx; §9.8):
 * `sandbox.execute` runs AFTER the intent commit and OUTSIDE any terminal
 * transaction. In batch 1 the finalize twin (B7) does not exist yet, so the
 * boundary is: the effect phase opens NO transaction, the attempt stays
 * in_flight, and no close/marker/receipt happens inside the effect scope.
 */

/** DbConnection double that tracks whether a transaction is open. */
class TrackingDbConnection implements DbConnection {
  transactionCalls = 0;
  private inTransaction = false;

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    // Batch-1 cycle never opens a transaction, so this throw path is inert;
    // the parameters are part of the port contract.
    void sql;
    void params;
    throw new Error('not used in batch 1');
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    void sql;
    void params;
    return [];
  }

  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const previous = this.inTransaction;
    this.inTransaction = true;
    try {
      return await fn(this);
    } finally {
      this.inTransaction = previous;
    }
  }

  isInTransaction(): boolean {
    return this.inTransaction;
  }
}

/** Sandbox double that records whether execute ran inside a transaction. */
class InTxAwareSandbox implements SandboxPort {
  executeInsideTransaction: boolean | undefined;
  private readonly inner = new InMemorySandbox();

  constructor(
    private readonly inTx: () => boolean,
    private readonly trace?: string[],
  ) {}

  async execute(action: SandboxAction): Promise<EffectRecord> {
    this.executeInsideTransaction = this.inTx();
    this.trace?.push(`sandbox:execute:${action.relativePath}`);
    return this.inner.execute(action);
  }

  async undo(handle: UndoHandle): Promise<void> {
    return this.inner.undo(handle);
  }

  async wasApplied(handleId: string): Promise<boolean> {
    return this.inner.wasApplied(handleId);
  }

  snapshotUndoLog(): readonly EffectRecord[] {
    return this.inner.snapshotUndoLog();
  }
}

describe('effect outside the terminal transaction (WC effect-outside-tx)', () => {
  it('sandbox.execute runs AFTER the intent commit and OUTSIDE the finalize transaction', async () => {
    const h = harness();
    await seed(h);
    const conn = new TrackingDbConnection();
    const sandbox = new InTxAwareSandbox(() => conn.isInTransaction(), h.trace);

    const result = await runWorker(workerInput(), { ...h, connection: conn, sandbox }, 'flash');

    expect(result.ok).toBe(true);
    // §9.8: the external effect and the durable bookkeeping never share a
    // transaction. Since B7 the terminal close (T1) opens EXACTLY ONE
    // transaction — and the effect NEVER runs inside it (the sandbox observes
    // no open transaction at execute time). Batch 1 asserted transactionCalls
    // === 0 because no terminal tx existed yet; the B7 twin is that tx.
    expect(conn.transactionCalls).toBe(1);
    expect(sandbox.executeInsideTransaction).toBe(false);
    const insertIdx = h.trace.findIndex((entry) => entry.startsWith('journal:insertInFlight'));
    const executeIdx = h.trace.findIndex((entry) => entry.startsWith('sandbox:execute'));
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(executeIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeLessThan(executeIdx);
  });

  it('the effect phase leaves the attempt in_flight: no close, no marker, no receipt inside the effect scope', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h, 'flash');

    expect(result.ok).toBe(true);
    const entry = await h.journal.lookup('acme', 'close-2026-q3');
    expect(entry?.status).toBe('in_flight');
    expect(
      h.journal.log.some(
        (logged) => logged.startsWith('complete:') || logged.startsWith('markRetryable:'),
      ),
    ).toBe(false);
    expect(h.receipts.saves).toHaveLength(0);
  });

  it('executeEffect is the single effect seam: receives only sandbox + action + the attempt key, applies it, and stamps the correlation on the record', async () => {
    const sandbox = new InMemorySandbox();
    const action: SandboxAction = {
      type: 'create-document',
      relativePath: 'docs/b.md',
      content: 'beta',
    };

    const record = await executeEffect(sandbox, action, 'close-2026-q3');

    expect(record.applied).toBe(true);
    // The durable record carries the attempt correlation (spec "Undo evidence
    // is attempt-correlated"): recovery filters the undo log BY this key.
    expect(record.idempotencyKey).toBe('close-2026-q3');
    expect(await sandbox.wasApplied(record.undo.handleId)).toBe(true);
  });
});
