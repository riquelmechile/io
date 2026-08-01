import { describe, expect, it } from 'vitest';

import { evidenceId } from '../src/evidence-id.js';

/**
 * Stable business evidence identity tests (design D8): the evidence identity
 * of an idempotent operation is `ev:${companyId}:${idempotencyKey}` — STABLE
 * across retries and NEVER derived from an actionId, nonce, or now()-based
 * value. A retried operation (same company + same key) must reference the SAME
 * identity, so the receipt path can deduplicate evidence across attempts.
 */
describe('evidenceId (D8)', () => {
  it('is ev:<companyId>:<idempotencyKey>', () => {
    expect(evidenceId('acme', 'key-1')).toBe('ev:acme:key-1');
  });

  it('is STABLE across retries: repeated calls with the same inputs return the identical id', () => {
    const first = evidenceId('acme', 'close-2026-07');
    const second = evidenceId('acme', 'close-2026-07');
    expect(second).toBe(first);
  });

  it('is NOT derived from now/actionId/nonce: a later call with the same inputs is unchanged', () => {
    // If the id were now()-based, two calls separated in time would differ.
    const earlier = evidenceId('acme', 'key-1');
    const later = evidenceId('acme', 'key-1');
    expect(later).toBe(earlier);
  });

  it('changes when the company changes (tenant-scoped identity)', () => {
    expect(evidenceId('acme', 'key-1')).not.toBe(evidenceId('other-corp', 'key-1'));
  });

  it('changes when the idempotency key changes (attempt-scoped identity)', () => {
    expect(evidenceId('acme', 'key-1')).not.toBe(evidenceId('acme', 'key-2'));
  });

  it('never collides with a receiptId or attemptId namespace (triangulation)', () => {
    expect(evidenceId('acme', 'key-1')).toMatch(/^ev:/);
    expect(evidenceId('acme', 'key-1')).not.toMatch(/^(att:|rcpt:)/);
  });
});
