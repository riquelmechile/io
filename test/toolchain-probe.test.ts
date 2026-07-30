import { describe, expect, it } from 'vitest';

import { toolchainProfile } from '../src/toolchain-probe.js';

describe('toolchain profile', () => {
  it('reports the enforced Node 24 LTS major and ESM module system', () => {
    const profile = toolchainProfile();

    expect(profile.nodeMajor).toBe(24);
    expect(profile.moduleSystem).toBe('esm');
  });

  it('identifies as the non-product root toolchain, not a product package', () => {
    const profile = toolchainProfile();

    expect(profile.productPackage).toBe(false);
  });
});
