import { describe, expect, expectTypeOf, it } from 'vitest';

import { LlmError } from '../src/llm-client.js';

/**
 * LlmError (Req: LlmError Distinguishes Failed vs Unknown). The adapter MUST
 * classify failures into two states: 'failed' (confirmed server rejection, e.g.
 * 4xx) and 'unknown' (timeout/disconnect where success is ambiguous per §9.8).
 * Reconciliation is deferred to the worker (Change 3).
 */
describe('LlmError (Req: LlmError Distinguishes Failed vs Unknown)', () => {
  describe('carries state and message', () => {
    it('is an Error subclass with the given message', () => {
      const err = new LlmError('failed', '400 Bad Request');

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(LlmError);
      expect(err.message).toBe('400 Bad Request');
    });

    it("state is exactly 'failed' | 'unknown'", () => {
      const failed = new LlmError('failed', 'rejected');
      const unknown = new LlmError('unknown', 'timed out');

      expect(failed.state).toBe('failed');
      expect(unknown.state).toBe('unknown');
      expectTypeOf<LlmError['state']>().toEqualTypeOf<'failed' | 'unknown'>();
    });

    it('preserves an optional cause for diagnostics (triangulation)', () => {
      const root = new Error('ETIMEDOUT');
      const err = new LlmError('unknown', 'request timed out', { cause: root });

      expect(err.cause).toBe(root);
    });

    it('has the name LlmError so it is identifiable in logs', () => {
      const err = new LlmError('failed', 'auth');

      expect(err.name).toBe('LlmError');
    });
  });
});
