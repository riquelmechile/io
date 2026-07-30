/**
 * Honest persistence disclosure shared by this package's adapters and its
 * InMemoryDbConnection test double (D6). This is the SAME disclosure text used by
 * `@io/trust-kernel`'s `PERSISTENT_PORT_DISCLOSURE`.
 *
 * It is carried as a LOCAL constant rather than imported at runtime because the
 * package couples to the kernel TYPE-ONLY (D4: `import type` only -> literally
 * zero runtime deps; `dependencies: {}`). The boundary test asserts this local
 * value is byte-equal to the kernel's `PERSISTENT_PORT_DISCLOSURE`, so the two
 * cannot drift: a routed record is durable-capable, but its ACTUAL durability
 * depends on the adapter, and this slice does NOT satisfy persistent R1-R17.
 */
export const PERSISTENT_PORT_DISCLOSURE =
  'routed via repository port; durable-capable; actual durability depends on the adapter';
