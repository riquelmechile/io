import { describe, expect, it } from 'vitest';

import { isWindowActive } from '../src/model.js';

/**
 * Activation window gate (Req 2, Req 4; ADR-0001). Temporal authority is active
 * ONLY when `start <= now < expiry`: a future `start` confers no authority, an
 * expired window confers none. `start == now` is active (inclusive lower
 * bound); `now == expiry` is inactive (exclusive upper bound). The gate is
 * applied wherever grant or assignment activity is decided.
 */

describe('isWindowActive(start, now, expiry)', () => {
  it('is inactive when the start is in the future (start > now)', () => {
    expect(isWindowActive(2000, 1500, 9000)).toBe(false);
  });

  it('is active when start <= now < expiry', () => {
    expect(isWindowActive(1000, 1500, 9000)).toBe(true);
  });

  it('is inactive when the window is expired (now >= expiry)', () => {
    expect(isWindowActive(1000, 9500, 9000)).toBe(false);
    expect(isWindowActive(1000, 9000, 9000)).toBe(false);
  });

  it('is active on the boundary start == now', () => {
    expect(isWindowActive(1500, 1500, 9000)).toBe(true);
  });

  it('is inactive on the boundary now == expiry', () => {
    expect(isWindowActive(1000, 9000, 9000)).toBe(false);
  });
});
