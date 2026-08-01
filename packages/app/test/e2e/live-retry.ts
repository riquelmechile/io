import type { WorkerResult } from '../../src/worker/types.js';

/**
 * TEST-LOCAL bounded reliability retry (design "Bounded reliability retry",
 * spec Req 5; NOT exported from app src — this file lives under `test/`): the
 * ONLY retry logic in the whole change. Worker source
 * (`packages/app/src/worker/*`) is untouched by construction — retry ownership
 * is test code.
 *
 * Contract (spec Req 5 scenarios):
 * - retries ONLY `invalid-plan` (any other terminal/typed result breaks the
 *   loop — never retried);
 * - uses a FRESH idempotency key per attempt (`live-${n}-${uuid}`);
 * - resets the owned scratch-DB Work row to accepted/v1 between attempts via
 *   the caller-supplied `resetWork` (raw SQL — `save` is INSERT-only and
 *   `updateIfVersion` only increments);
 * - hard-caps at `maxAttempts` (2) model completions — a third completion is
 *   impossible by construction.
 *
 * The callbacks let the same mechanism drive the real `DeepSeekClient` in the
 * double-gated live E2E and a `FakeLlmClient` in the gate-closed integration
 * test (first attempt invalid-plan, second valid) — one source of truth.
 */
export interface BoundedRetryOptions {
  /** Fresh idempotency key for attempt number n (1-based). */
  readonly keyForAttempt: (attemptNumber: number) => string;
  /** Run ONE full worker cycle with the given idempotency key. */
  readonly runAttempt: (idempotencyKey: string) => Promise<WorkerResult>;
  /** Reset the owned scratch-DB Work row to accepted/v1 (raw SQL). Called
   * between attempts ONLY when an attempt returned `invalid-plan`. */
  readonly resetWork: () => Promise<void>;
  /** Hard cap of model completions (default 2 — the design's bound). */
  readonly maxAttempts?: number;
}

export interface BoundedRetryOutcome {
  /** The last attempt's result: terminal success, or the typed failure after
   * the bound (the caller asserts success or fails loudly). */
  readonly result: WorkerResult;
  /** Number of attempts actually run (1..maxAttempts). */
  readonly attempts: number;
  /** The fresh keys used, in attempt order (all distinct). */
  readonly keys: readonly string[];
}

export async function runLiveCycleWithBoundedRetry(
  options: BoundedRetryOptions,
): Promise<BoundedRetryOutcome> {
  const maxAttempts = options.maxAttempts ?? 2;
  const keys: string[] = [];
  let result: WorkerResult | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const idempotencyKey = options.keyForAttempt(attempt);
    keys.push(idempotencyKey);
    result = await options.runAttempt(idempotencyKey);
    if (result.ok || result.reason !== 'invalid-plan') break;
    if (attempt < maxAttempts) {
      await options.resetWork();
    }
  }
  if (result === undefined) {
    throw new Error('runLiveCycleWithBoundedRetry: maxAttempts must be >= 1');
  }
  return { result, attempts: keys.length, keys };
}
