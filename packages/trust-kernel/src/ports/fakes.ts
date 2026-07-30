import type { PersistentRecord } from '../model.js';
import type { AuditRepository, EvidenceRepository } from './repositories.js';
import { PERSISTENT_PORT_DISCLOSURE } from './repositories.js';

/**
 * In-memory fake adapters for the persistence ports (Req 4). Map/array-backed,
 * immutable returns, NO database/network/daemon/framework. Usable as unit-test
 * doubles under `integration: false`. Each fake honestly supplies
 * {@link PERSISTENT_PORT_DISCLOSURE}: routed records are durable-capable, but
 * the in-memory adapter is NOT durable and does NOT satisfy R1-R17 (D6).
 */

/**
 * Return a NEW list with `entry` appended; never mutates `list`. The single
 * immutable-append path shared by {@link InMemoryAuditRepository} so no caller
 * can mutate a prior log reference.
 */
function withAppended<T>(list: readonly T[], entry: T): readonly T[] {
  return [...list, entry];
}

/**
 * In-memory {@link EvidenceRepository} fake (Req 4, R7). Map-backed; {@link save}
 * stores one record keyed by action id and returns an immutable view; {@link get}
 * retrieves it or `undefined`. Accepts the R7 session/transaction context
 * (accepted, not required). No external I/O.
 */
export class InMemoryEvidenceRepository<R extends PersistentRecord = PersistentRecord>
  implements EvidenceRepository<R>
{
  private readonly entries = new Map<string, R>();
  /** Honest disclosure: the in-memory adapter is durable-capable but NOT durable. */
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  save(record: R, _session?: unknown): Readonly<R> {
    this.entries.set(record.actionId, record);
    return record;
  }

  get(actionId: string): R | undefined {
    return this.entries.get(actionId);
  }
}

/**
 * In-memory {@link AuditRepository} fake (Req 4, R16). Array-backed; {@link append}
 * appends one entry preserving insertion order and returns a NEW log state
 * (the prior reference is never mutated); {@link getLog} returns the current log
 * in insertion order. No external I/O.
 */
export class InMemoryAuditRepository<R extends PersistentRecord = PersistentRecord>
  implements AuditRepository<R>
{
  private log: readonly R[] = [];
  /** Honest disclosure: the in-memory adapter is durable-capable but NOT durable. */
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  append(record: R): readonly R[] {
    this.log = withAppended(this.log, record);
    return this.log;
  }

  getLog(): readonly R[] {
    return this.log;
  }
}
