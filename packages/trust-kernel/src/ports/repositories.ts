import type { PersistentRecord } from '../model.js';

/**
 * Outbound persistence port interfaces (R7 evidence, R16 audit). Generic over
 * the kernel record shape and (for evidence) a session/transaction context, so
 * a downstream real adapter can enforce single-aggregate atomicity WITHOUT the
 * kernel importing any driver, ORM, or framework (D3/D4). Every import here is
 * type-only and relative -> erased by tsc -> zero runtime dependencies and a
 * unchanged {@link ../../../../package.json}.
 */

/**
 * Honest disclosure for records routed through a repository port (D6). A routed
 * record is durable-capable (`persistent: true`) but its ACTUAL durability
 * depends on the adapter: the default in-memory fake is NOT durable and does
 * NOT satisfy persistent R1-R17 obligations. This deliberately avoids claiming
 * "durable in PostgreSQL" until a real durable adapter exists.
 */
export const PERSISTENT_PORT_DISCLOSURE =
  'routed via repository port; durable-capable; actual durability depends on the adapter';

/**
 * Outcome of routing an evaluation's records through the ports: the routed
 * durable-capable evidence record (R7) and audit entry (R16), when a repository
 * was provided for each. Absent when no repository is injected.
 */
export interface PersistenceOutcome {
  readonly evidenceRecord?: PersistentRecord;
  readonly auditRecord?: PersistentRecord;
}

/**
 * Outbound port for evidence storage (R7). Generic over the record shape `R`
 * (default {@link PersistentRecord}) and a session/transaction context `S`
 * (default `unknown`) so a downstream real adapter can enforce single-aggregate
 * atomicity. {@link save} persists one record and returns an immutable view;
 * {@link get} retrieves a stored record by its action id, or `undefined`.
 *
 * MUST NOT import any database driver, ORM, or framework (D3/D4).
 */
export interface EvidenceRepository<R = PersistentRecord, S = unknown> {
  save(record: R, session?: S): Readonly<R>;
  get(actionId: string): R | undefined;
}

/**
 * Outbound port for audit storage (R16). Generic over the record shape `R`
 * (default {@link PersistentRecord}). {@link append} appends one entry to the
 * log, preserves insertion order, and returns a NEW log state; it MUST NOT
 * mutate or drop prior entries. {@link getLog} returns the log in insertion
 * order.
 *
 * MUST NOT import any database driver, ORM, or framework (D3/D4).
 */
export interface AuditRepository<R = PersistentRecord> {
  append(record: R): readonly R[];
  getLog(): readonly R[];
}
