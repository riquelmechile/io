import type { LlmClient, LlmRequest, LlmResponse } from './llm-client.js';

import { LLM_FAKE_DISCLOSURE } from './disclosure.js';

/**
 * In-memory test double for {@link LlmClient} (Req: FakeLlmClient Test Double).
 *
 * It returns configurable CANNED {@link LlmResponse} values in order (reusing
 * the last once exhausted), preserves `reasoningContent` verbatim so multi-turn
 * passthrough tests can assert the worker replays it, and records every request
 * in call order. Its methods return `Promise` (matching the async port contract)
 * while using in-memory structures only — NO network, NO real API, NO API key.
 *
 * It is NOT a real LLM and NOT network-backed (scenario 2): it honestly carries
 * {@link LLM_FAKE_DISCLOSURE}.
 */
export class FakeLlmClient implements LlmClient {
  private readonly responses: readonly LlmResponse[];
  private readonly _requests: LlmRequest[] = [];
  private cursor = 0;

  /** Honest disclosure: the fake is NOT a real LLM / NOT network-backed. */
  readonly disclosure = LLM_FAKE_DISCLOSURE;

  constructor(options: { responses: readonly LlmResponse[] }) {
    this.responses = options.responses;
  }

  /** Ordered log of every `complete` call. */
  get requests(): readonly LlmRequest[] {
    return this._requests;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this._requests.push(request);
    const last = this.responses[this.responses.length - 1];
    const response = this.responses[this.cursor] ?? last;
    if (response === undefined) {
      throw new Error('FakeLlmClient has no canned responses configured');
    }
    if (this.cursor < this.responses.length - 1) {
      this.cursor += 1;
    }
    return response;
  }
}
