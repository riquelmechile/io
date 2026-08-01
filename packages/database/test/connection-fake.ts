import type { DbConnection } from '../src/connection.js';
import { PERSISTENT_PORT_DISCLOSURE } from '../src/disclosure.js';

/**
 * In-memory test double for {@link DbConnection} (Req 4). Map/array-backed,
 * NO database/network/daemon/framework. It does TWO jobs:
 *
 * 1. Records EVERY `execute`/`query` call as `{ sql, params }` in call order, so
 *    adapter tests can assert the exact PG-shaped SQL and `$N` param order.
 * 2. Stores rows written by `execute` (INSERT) so `query` (SELECT) round-trips
 *    them — letting save->get round-trip tests run without PG.
 *
 * Methods return `Promise` (matching the async port contract, D1) while using
 * in-memory structures only — no network, no real I/O, instant resolution. It
 * parses only the minimal PG-shaped SQL the adapters emit (INSERT ... VALUES
 * ($1,..) and SELECT ... AS "x" ... [WHERE col = $N (AND col = $M)?]
 * [ORDER BY col ASC|DESC]).
 * It is NOT durable and NOT real PostgreSQL (scenario 2): it honestly carries
 * {@link PERSISTENT_PORT_DISCLOSURE}.
 */
export class InMemoryDbConnection implements DbConnection {
  private readonly _operations: DbOperation[] = [];
  private readonly tables = new Map<string, Row[]>();
  private readonly idCounters = new Map<string, number>();

  /** Honest disclosure: the in-memory fake is NOT durable / NOT real PostgreSQL. */
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  /** Ordered, immutable log of every `execute`/`query` call (`{ sql, params }`). */
  get operations(): readonly DbOperation[] {
    return this._operations;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    this._operations.push({ sql, params });
    const insert = parseInsert(sql);
    if (insert) {
      const rows = this.table(insert.table);
      const row: Row = { id: this.nextId(insert.table) };
      insert.columns.forEach((column, index) => {
        row[column] = reviveValue(params[index]);
      });
      rows.push(row);
    }
    return undefined;
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this._operations.push({ sql, params });
    const select = parseSelect(sql);
    if (!select) return [];

    let rows = this.table(select.table);
    for (const condition of select.where) {
      const wanted = params[condition.param - 1];
      rows = rows.filter((row) => row[condition.column] === wanted);
    }
    if (select.orderBy) {
      const order = select.orderBy;
      rows = [...rows].sort((a, b) => compareForSort(a[order.column], b[order.column], order.dir));
    }

    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      select.items.forEach((item) => {
        out[item.alias] = row[item.column];
      });
      return out as T;
    });
  }

  private table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = [];
      this.tables.set(name, rows);
    }
    return rows;
  }

  private nextId(table: string): number {
    const next = (this.idCounters.get(table) ?? 0) + 1;
    this.idCounters.set(table, next);
    return next;
  }
}

/** One recorded operation: the SQL string and the bound params, in call order. */
export interface DbOperation {
  readonly sql: string;
  readonly params: readonly unknown[];
}

type Row = Record<string, unknown>;

interface ParsedInsert {
  readonly table: string;
  readonly columns: readonly string[];
}

interface SelectItem {
  readonly column: string;
  readonly alias: string;
}

interface ParsedSelect {
  readonly items: readonly SelectItem[];
  readonly table: string;
  readonly where: readonly { readonly column: string; readonly param: number }[];
  readonly orderBy?: { readonly column: string; readonly dir: 'ASC' | 'DESC' };
}

/** Parse `INSERT INTO <table> (c1, c2, ...) VALUES (...)`. Returns the columns. */
function parseInsert(sql: string): ParsedInsert | undefined {
  const match = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(sql);
  const table = match?.[1];
  const columns = match?.[2];
  if (!table || columns === undefined) return undefined;
  return { table, columns: columns.split(',').map((column) => column.trim()) };
}

/**
 * Parse `SELECT <list> FROM <table> [WHERE col = $N (AND col = $M)?]
 * [ORDER BY col ASC|DESC]`. Supports up to two equality WHERE conditions so
 * scoped reads (`WHERE company_id = $1 AND <id> = $2`, ADR-0002) round-trip.
 */
function parseSelect(sql: string): ParsedSelect | undefined {
  const match =
    /^SELECT\s+(.*?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\$(\d+)(?:\s+AND\s+(\w+)\s*=\s*\$(\d+))?)?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?\s*$/i.exec(
      sql,
    );
  const list = match?.[1];
  const table = match?.[2];
  if (!list || !table) return undefined;

  const items: SelectItem[] = list.split(',').map((part) => {
    const aliased = /^\s*(\w+)\s+AS\s+"([^"]+)"\s*$/i.exec(part);
    if (aliased) {
      const column = aliased[1];
      const alias = aliased[2];
      if (column && alias) return { column, alias };
    }
    const column = part.trim();
    return { column, alias: column };
  });

  const where: Array<{ readonly column: string; readonly param: number }> = [];
  const firstColumn = match?.[3];
  const firstParam = match?.[4];
  if (firstColumn && firstParam) where.push({ column: firstColumn, param: Number(firstParam) });
  const secondColumn = match?.[5];
  const secondParam = match?.[6];
  if (secondColumn && secondParam) where.push({ column: secondColumn, param: Number(secondParam) });

  const orderColumn = match?.[7];
  const orderDir = match?.[8];
  const orderBy =
    orderColumn && orderDir
      ? { column: orderColumn, dir: orderDir.toUpperCase() as 'ASC' | 'DESC' }
      : undefined;

  return { items, table, where, orderBy };
}

/** Compare two (numeric) row values for ORDER BY; non-numbers sort as 0. */
function compareForSort(a: unknown, b: unknown, dir: 'ASC' | 'DESC'): number {
  const left = typeof a === 'number' ? a : 0;
  const right = typeof b === 'number' ? b : 0;
  return dir === 'ASC' ? left - right : right - left;
}

/**
 * Simulate PG's JSONB auto-deserialization: when a param is a JSON string
 * (produced by the adapter's `JSON.stringify` for JSONB columns), parse it back
 * to a JS object so `query` round-trips return objects, matching real PG
 * behavior. Non-JSON strings, null, and primitives pass through unchanged.
 */
function reviveValue(value: unknown): unknown {
  if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}
