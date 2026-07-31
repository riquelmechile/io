import { describe, expect, it } from 'vitest';

import { isWindowActive } from '../src/model.js';

/**
 * Activation window gate (Req: Activation Window Gate). A window is active only
 * when start <= now AND expiry > now. Future-start grants/assignments are NOT
 * active even when structurally valid and unexpired.
 */
describe('isWindowActive', () => {
  it('returns false when start is in the future', () => {
    expect(isWindowActive(2000, 1500, 9000)).toBe(false);
  });

  it('returns true when start <= now < expiry', () => {
    expect(isWindowActive(1000, 1500, 9000)).toBe(true);
  });

  it('returns false when now equals expiry (half-open end)', () => {
    expect(isWindowActive(1000, 9000, 9000)).toBe(false);
  });

  it('returns true when now equals start (inclusive start)', () => {
    expect(isWindowActive(1500, 1500, 9000)).toBe(true);
  });

  it('returns false when now is past expiry', () => {
    expect(isWindowActive(1000, 9500, 9000)).toBe(false);
  });
});
