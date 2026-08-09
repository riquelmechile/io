import { describe, expect, it } from 'vitest';

import { runWorker } from '../src/worker/worker.js';
import type { WorkerResult } from '../src/worker/types.js';
import { harness, seed, workerInput } from './worker-helpers.js';

/**
 * B1 — Worker scaffold + CAS claim (WC single-winner + fencing): the cycle
 * claims Work through the CAS `startWork` use case at the current
 * `expectedVersion`. Among concurrent claimants exactly ONE wins — and (fencing
 * change) that winner mints the NEXT server-side fencing token atomically in
 * the same CAS (epoch 0 → 1); every loser gets an explicit
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

  it('the WINNER mints and returns the next server-side fencing token (0 → 1) (fencing: claim mint at CAS)', async () => {
    const h = harness();
    await seed(h);

    const result = await runWorker(workerInput(), h, 'flash');

    expect(result.ok).toBe(true);
    if (!result.ok || 'replayed' in result) return;
    // The claim CAS minted the token and the cycle captured it on the Work.
    expect(result.work.fencingToken).toBe(1);
    expect(result.work.version).toBe(2);
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.fencingToken).toBe(1);
  });

  it('the LOSER never mints: version-conflict with no token bump on the stored work (fencing: single winner)', async () => {
    const h = harness();
    await seed(h);

    const results = await Promise.all([
      runWorker(workerInput(), h, 'flash'),
      runWorker(workerInput(), h, 'flash'),
    ]);

    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(1);
    // The stored token advanced exactly once (the winner's mint): 0 → 1. The
    // loser's failed claim did NOT mint a second token.
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.fencingToken).toBe(1);
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
