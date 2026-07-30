import type { PersistentRecord } from '@io/trust-kernel/src/index.js';

/**
 * Shared PG-shaped SQL builders for the PersistentRecord column set (Req 2/3).
 * Extracted so the evidence and audit adapters emit IDENTICAL column handling
 * from one source of truth (D5: column aliases map snake_case DB columns straight
 * to camelCase TypeScript fields; `$N` placeholders target PostgreSQL 18.4, D3).
 * SQL lives in adapters/builders, never in the connection port.
 */

/** Snake_case DB columns backing one PersistentRecord, in record-field order. */
const PERSISTENT_COLUMNS = [
  'action_id',
  'principal_id',
  'risk_class',
  'decision',
  'reason',
  'timestamp',
  'persistent',
  'disclosure',
] as const;

/** snake_case column -> camelCase output field, for SELECT ... AS "alias". */
const PERSISTENT_ALIASES: ReadonlyArray<{ readonly column: string; readonly alias: string }> = [
  { column: 'action_id', alias: 'actionId' },
  { column: 'principal_id', alias: 'principalId' },
  { column: 'risk_class', alias: 'riskClass' },
  { column: 'decision', alias: 'decision' },
  { column: 'reason', alias: 'reason' },
  { column: 'timestamp', alias: 'timestamp' },
  { column: 'persistent', alias: 'persistent' },
  { column: 'disclosure', alias: 'disclosure' },
];

/**
 * Build a parameterized INSERT for one PersistentRecord into `table`, binding
 * every field positionally as `$1..$8` in record-field order.
 */
export function insertPersistentRecord(table: string): string {
  const placeholders = PERSISTENT_COLUMNS.map((_, index) => `$${index + 1}`).join(',');
  return `INSERT INTO ${table} (${PERSISTENT_COLUMNS.join(', ')}) VALUES (${placeholders})`;
}

/** Bind a PersistentRecord's fields to `$1..$8` in the same order as the INSERT. */
export function persistentRecordParams(record: PersistentRecord): readonly unknown[] {
  return [
    record.actionId,
    record.principalId,
    record.riskClass,
    record.decision,
    record.reason,
    record.timestamp,
    record.persistent,
    record.disclosure,
  ];
}

/**
 * Build an aliased SELECT over `table` that maps each snake_case column to its
 * camelCase PersistentRecord field, followed by `tail` (e.g.
 * `WHERE action_id = $1` or `ORDER BY id ASC`).
 */
export function selectPersistentRecords(table: string, tail: string): string {
  const list = PERSISTENT_ALIASES.map((entry) =>
    entry.column === entry.alias ? entry.column : `${entry.column} AS "${entry.alias}"`,
  ).join(', ');
  return `SELECT ${list} FROM ${table} ${tail}`;
}
