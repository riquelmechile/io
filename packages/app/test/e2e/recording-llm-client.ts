import type { LlmClient, LlmRequest, LlmResponse } from '@io/llm-client/src/index.js';

/**
 * TEST-LOCAL `LlmClient` recorder (design decision "Response capture — test
 * recorder"; NOT exported from app src — this file lives under `test/`): wraps
 * any {@link LlmClient} (the `FakeLlmClient` in CI, the `DeepSeekClient` in the
 * opt-in live E2E), delegates `complete` unchanged, and records the last
 * request / last response / call count so a live E2E can assert model echo,
 * KV-cache usage accounting and the forwarded cohort `user` WITHOUT surfacing
 * `LlmResponse` on the worker result (which would change worker semantics).
 */
export class RecordingLlmClient implements LlmClient {
  private readonly inner: LlmClient;
  private _lastRequest: LlmRequest | undefined;
  private _lastResponse: LlmResponse | undefined;
  private _callCount = 0;

  constructor(inner: LlmClient) {
    this.inner = inner;
  }

  /** The most recent request handed to the wrapped client (undefined before the
   * first call). */
  get lastRequest(): LlmRequest | undefined {
    return this._lastRequest;
  }

  /** The most recent response resolved by the wrapped client. */
  get lastResponse(): LlmResponse | undefined {
    return this._lastResponse;
  }

  /** Number of `complete` calls delegated so far. */
  get callCount(): number {
    return this._callCount;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this._callCount += 1;
    const response = await this.inner.complete(request);
    this._lastRequest = request;
    this._lastResponse = response;
    return response;
  }
}
