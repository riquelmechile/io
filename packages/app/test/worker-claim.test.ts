import { describe, expect, it } from 'vitest';

import { runWorker } from '../src/worker/worker.js';
import type { WorkerResult } from '../src/worker/types.js';
import { harness, seed, workerInput } from './worker-helpers.js';

/**
 * B1 — Worker scaffold + CAS claim (WC single-winner): the cycle claims Work
 * through the CAS `startWork` use case at the current `expectedVersion`.
 * Among concurrent claimants exactly ONE wins; every loser gets an explicit
 * `{ ok: false, reason: 'version-conflict' }` and MUST NOT proceed to an
 * effect. A claim never fails silently.
 */
describe('worker claim (WC single-winner)', () => {
  it('exactly one winner among concurrent claimants at the same expectedVersion; the loser gets version-conflict', async () => {
    const h = harness();
    await seed(h);

    const results = await Promise.all([
      runWorker(workerInput(), h, 'flash'),
      runWorker(workerInput(), h, 'flash'),
    ]);

    const winners = results.filter((r): r is Extract<WorkerResult, { ok: true }> => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    if (losers[0] !== undefined && !losers[0].ok) {
      expect(losers[0].reason).toBe('version-conflict');
    }
    // The winner's claim moved the work to in_progress via CAS (version +1).
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
    expect(stored?.version).toBe(2);
  });

  it('the losing claimant stops: no effect, no receipt, no journal write from the loser', async () => {
    const h = harness();
    await seed(h);

    const results = await Promise.all([
      runWorker(workerInput(), h, 'flash'),
      runWorker(workerInput(), h, 'flash'),
    ]);

    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toBeDefined();
    if (loser !== undefined && !loser.ok) expect(loser.reason).toBe('version-conflict');

    // Only the winner may reach the effect step (batch-1: at most the single
    // winner's effect + in-flight row); the loser stopped at the claim.
    expect(h.sandbox.executes.length).toBeLessThanOrEqual(1);
    expect(h.journal.snapshot().length).toBeLessThanOrEqual(1);
    expect(h.receipts.saves).toHaveLength(0);
  });

  it('a claim for a missing work is an explicit not-found result (never silent)', async () => {
    const h = harness();
    const result = await runWorker(workerInput({ workId: 'work-ghost' }), h, 'flash');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
  });
});
