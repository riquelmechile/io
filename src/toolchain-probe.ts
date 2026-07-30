/**
 * Non-product toolchain probe: reports deterministic, non-domain facts about the
 * active runtime so the harness proves the enforced Node 24 LTS + strict-ESM
 * configuration is live. Intentionally NOT product, domain, or business behavior.
 */
export interface ToolchainProfile {
  /** Major version of the running Node.js process. */
  readonly nodeMajor: number;
  /** Module system under which this module executes. */
  readonly moduleSystem: 'esm';
  /** Always false: the bootstrap ships no product package. */
  readonly productPackage: false;
}

/**
 * Derive the active toolchain profile from runtime facts: `nodeMajor` from
 * `process.version` (e.g. `v24.18.1` -> `24`); `moduleSystem` is `esm` because
 * this is an ECMAScript module (`"type": "module"` + `NodeNext`).
 */
export function toolchainProfile(): ToolchainProfile {
  const nodeMajor = Number.parseInt(process.version.slice(1), 10);

  return {
    nodeMajor,
    moduleSystem: 'esm',
    productPackage: false,
  };
}
