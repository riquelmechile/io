import { describe, expect, it, vi } from 'vitest';

import { acceptedWork, cannedPlan } from '../worker-helpers.js';
import { runLiveCycleWithBoundedRetry } from './live-retry.js';
import type { BoundedRetryOptions } from './live-retry.js';
import type { WorkerResult } from '../../src/worker/types.js';

/**
 * Gate-closed unit proof of the TEST-ONLY bounded reliability retry (spec Req 5,
 * design "Bounded reliability retry"): the helper drives a fresh idempotency
 * key per attempt, retries ONLY `invalid-plan`, and hard-caps at 2 model
 * completions. Worker source is untouched by construction — the retry lives in
 * this test-local helper, so it can be proven deterministically with fakes
 * (zero API spend) while the double-gated live E2E wires the SAME helper to the
 * real DeepSeekClient.
 */

/** A minimal terminal-success WorkerResult (structure only — never asserted by
 * the helper beyond `ok`). */
function okResult(): WorkerResult {
  const action = { type: 'create-document' as const, relativePath: 'docs/a.md', content: 'x' };
  return {
    ok: true,
    work: acceptedWork(),
    attemptId: 'att:unit',
    evidenceId: 'ev:unit',
    effect: {
      effectId: 'eff:unit',
      action,
      absolutePath: '/tmp/unit/a.md',
      applied: true,
      idempotencyKey: 'wk:acme:work-1',
      undo: { handleId: 'und:unit', action, applied: true },
    },
    plan: cannedPlan(),
  };
}

function invalidPlanResult(): WorkerResult {
  return { ok: false, reason: 'invalid-plan', detail: 'model output is not valid JSON' };
}

function options(
  runAttempt: BoundedRetryOptions['runAttempt'],
  extra: Partial<BoundedRetryOptions> = {},
): BoundedRetryOptions {
  const resetWork = vi.fn(async () => undefined);
  return {
    keyForAttempt: (attemptNumber) => `live-${attemptNumber}-unit`,
    runAttempt,
    resetWork,
    ...extra,
  };
}

describe('runLiveCycleWithBoundedRetry (test-only reliability retry — Req 5)', () => {
  it('retries invalid-plan with a FRESH idempotency key (Req 5 "Invalid first plan retries safely")', async () => {
    const runAttempt = vi
      .fn<BoundedRetryOptions['runAttempt']>()
      .mockResolvedValueOnce(invalidPlanResult())
      .mockResolvedValueOnce(okResult());
    const opts = options(runAttempt);

    const outcome = await runLiveCycleWithBoundedRetry(opts);

    // Retried once: two completions, two DISTINCT fresh keys, reset between.
    expect(runAttempt).toHaveBeenCalledTimes(2);
    expect(outcome.attempts).toBe(2);
    expect(outcome.keys).toEqual(['live-1-unit', 'live-2-unit']);
    expect(new Set(outcome.keys).size).toBe(2);
    expect(opts.resetWork).toHaveBeenCalledTimes(1);
    // Terminal success reached via the SECOND (fresh-key) attempt.
    expect(outcome.result.ok).toBe(true);
  });

  it('is BOUNDED: two invalid-plan completions, NO third completion (Req 5 "Retry is bounded")', async () => {
    const runAttempt = vi
      .fn<BoundedRetryOptions['runAttempt']>()
      .mockResolvedValueOnce(invalidPlanResult())
      .mockResolvedValueOnce(invalidPlanResult());
    const opts = options(runAttempt);

    const outcome = await runLiveCycleWithBoundedRetry(opts);

    // Exactly two attempts — a third completion NEVER happens.
    expect(runAttempt).toHaveBeenCalledTimes(2);
    expect(outcome.attempts).toBe(2);
    // The reset ran after attempt 1 (attempt < max), NOT after attempt 2.
    expect(opts.resetWork).toHaveBeenCalledTimes(1);
    // The final result is the typed invalid-plan — the live E2E asserts
    // terminal success on top of this and FAILS LOUDLY when it is not.
    expect(outcome.result).toEqual(invalidPlanResult());
  });

  it('NEVER retries a non-invalid-plan failure (design "Never retry non-invalid-plan")', async () => {
    const denied: WorkerResult = { ok: false, reason: 'denied', detail: 'grant revoked' };
    const runAttempt = vi.fn<BoundedRetryOptions['runAttempt']>().mockResolvedValue(denied);
    const opts = options(runAttempt);

    const outcome = await runLiveCycleWithBoundedRetry(opts);

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
    expect(opts.resetWork).not.toHaveBeenCalled();
    expect(outcome.result).toEqual(denied);
  });

  it('stops immediately on terminal success (single completion, no reset)', async () => {
    const runAttempt = vi.fn<BoundedRetryOptions['runAttempt']>().mockResolvedValue(okResult());
    const opts = options(runAttempt);

    const outcome = await runLiveCycleWithBoundedRetry(opts);

    expect(runAttempt).toHaveBeenCalledTimes(1);
    expect(outcome.attempts).toBe(1);
    expect(opts.resetWork).not.toHaveBeenCalled();
    expect(outcome.result.ok).toBe(true);
  });
});
