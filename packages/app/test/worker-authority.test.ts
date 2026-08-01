import { describe, expect, it } from 'vitest';

import { checkAuthority } from '../src/worker/authority.js';
import { runWorker } from '../src/worker/worker.js';
import type { WorkerDeps } from '../src/worker/types.js';
import {
  acceptedWork,
  activeDelegation,
  harness,
  principals,
  workerInput,
} from './worker-helpers.js';

/**
 * B2 — Authority at action time + SoD threading (WC authority): before any
 * effect the worker re-verifies the delegation (window active, NOT revoked),
 * the executor holds an active command-bound grant (`checkGrant`), and the
 * ABSOLUTE_PAIRS hold via the EXPORTED `checkSod` (verifier≠executor,
 * proposer≠approver) — at EVERY tier including low risk. A revoked, expired,
 * or out-of-window grant DENIES at action time and no effect runs.
 */

function ctx(
  overrides: Partial<{
    companyId: string;
    delegationId: string;
    principals: WorkerDeps['principals'];
    now: number;
  }> = {},
): Parameters<typeof checkAuthority>[0] {
  return {
    companyId: 'acme',
    delegationId: 'del-1',
    principals,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe('checkAuthority (WC authority)', () => {
  it('an active grant window with unrevoked delegation and distinct principals ALLOWs', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation());

    const decision = await checkAuthority(ctx(), { delegation: h.delegation });

    expect(decision).toEqual({ ok: true });
  });

  it('a revoked delegation DENIES at action time', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation({ state: 'revoked' }));

    const decision = await checkAuthority(ctx(), { delegation: h.delegation });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('revoked');
  });

  it('an expired / out-of-window grant DENIES (isWindowActive false)', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation());

    const decision = await checkAuthority(ctx({ now: 5_000_000_000_000 }), {
      delegation: h.delegation,
    });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('delegation-window-inactive');
  });

  it('a grant that does not reach the executor DENIES (checkGrant deny-by-default)', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation({ delegate: 'some-other-principal' }));

    const decision = await checkAuthority(ctx(), { delegation: h.delegation });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('grant-denied');
  });

  it('verifier == executor DENIES via the EXPORTED checkSod (absolute pair, even at low risk)', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation());

    const decision = await checkAuthority(
      ctx({ principals: { ...principals, verifier: principals.executor } }),
      {
        delegation: h.delegation,
      },
    );

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('sod-denied');
  });

  it('proposer == approver DENIES via checkSod', async () => {
    const h = harness();
    await h.delegation.save(activeDelegation());

    const decision = await checkAuthority(
      ctx({ principals: { ...principals, approver: principals.proposer } }),
      {
        delegation: h.delegation,
      },
    );

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('sod-denied');
  });

  it('a missing delegation DENIES (scoped not-found, never treated as allowed)', async () => {
    const h = harness();

    const decision = await checkAuthority(ctx(), { delegation: h.delegation });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('delegation-not-found');
  });
});

describe('deny-at-action-time through the cycle (WC authority)', () => {
  it('an active grant with distinct principals proceeds past authority', async () => {
    const h = harness();
    await h.work.save(acceptedWork());
    await h.delegation.save(activeDelegation());

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(true);
  });

  it('a revoked delegation DENIES the cycle at action time: no effect, no receipt, work stays in_progress', async () => {
    const h = harness();
    await h.work.save(acceptedWork());
    await h.delegation.save(activeDelegation({ state: 'revoked' }));

    const result = await runWorker(workerInput(), h);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('denied');
    expect(h.sandbox.executes).toHaveLength(0);
    expect(h.receipts.saves).toHaveLength(0);
    // Deny-at-action (ADR-0002): the committed claim stays in_progress.
    const stored = await h.work.get('acme', 'work-1');
    expect(stored?.state).toBe('in_progress');
  });

  it('verifier == executor DENIES the whole cycle: no effect runs', async () => {
    const h = harness();
    await h.work.save(acceptedWork());
    await h.delegation.save(activeDelegation());

    const result = await runWorker(workerInput(), {
      ...h,
      principals: { ...principals, verifier: principals.executor },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('denied');
    expect(h.sandbox.executes).toHaveLength(0);
  });

  it('an out-of-window grant DENIES the cycle at action time', async () => {
    const h = harness();
    await h.work.save(acceptedWork());
    await h.delegation.save(activeDelegation());

    const result = await runWorker(workerInput(), { ...h, now: () => 5_000_000_000_000 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('denied');
    expect(h.sandbox.executes).toHaveLength(0);
  });
});
