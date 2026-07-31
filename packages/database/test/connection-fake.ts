import { NestedTransactionError, type DbConnection } from '../src/connection.js';
import { PERSISTENT_PORT_DISCLOSURE } from '../src/disclosure.js';

/**
 * In-memory test double for {@link DbConnection} (Req 4). Map/array-backed,
 * NO database/network/daemon/framework. It does TWO jobs:
 *
 * 1. Records EVERY `execute`/`query` call as `{ sql, params }` in call order, so
 *    adapter tests can assert the exact PG-shaped SQL and `$N` param order.
 * 2. Stores rows written by `execute` (INSERT/UPDATE) so `query` (SELECT) round-trips
 *    them — letting save->get round-trip tests run without PG.
 *
 * `transaction(fn)` snapshots table state and restores on throw. Nested
 * transactions throw {@link NestedTransactionError}.
 */
export class InMemoryDbConnection implements DbConnection {
  private readonly _operations: DbOperation[] = [];
  private readonly tables = new Map<string, Row[]>();
  private readonly idCounters = new Map<string, number>();
  private inTransaction = false;

  /** Honest disclosure: the in-memory fake is NOT durable / NOT real PostgreSQL. */
  readonly disclosure = PERSISTENT_PORT_DISCLOSURE;

  /** Ordered, immutable log of every `execute`/`query` call (`{ sql, params }`). */
  get operations(): readonly DbOperation[] {
    return this._operations;
  }

  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    this._operations.push({ sql, params });
    const trimmed = sql.trim();
    if (/^BEGIN\b/i.test(trimmed) || /^COMMIT\b/i.test(trimmed) || /^ROLLBACK\b/i.test(trimmed)) {
      return { rowCount: 0 };
    }
    const insert = parseInsert(sql);
    if (insert) {
      const rows = this.table(insert.table);
      const row: Row = { id: this.nextId(insert.table) };
      insert.columns.forEach((column, index) => {
        row[column] = reviveValue(params[index]);
      });
      rows.push(row);
      return { rowCount: 1 };
    }
    const update = parseUpdate(sql);
    if (update) {
      let rows = this.table(update.table);
      for (const clause of update.where) {
        const wanted = params[clause.param - 1];
        rows = rows.filter((row) => row[clause.column] === wanted);
      }
      for (const row of rows) {
        for (const set of update.sets) {
          if (set.expr === 'version + 1') {
            const current = typeof row.version === 'number' ? row.version : 0;
            row.version = current + 1;
          } else if (set.param !== undefined) {
            row[set.column] = reviveValue(params[set.param - 1]);
          }
        }
      }
      return { rowCount: rows.length };
    }
    return { rowCount: 0 };
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this._operations.push({ sql, params });
    const select = parseSelect(sql);
    if (!select) return [];

    let rows = this.table(select.table);
    for (const where of select.wheres) {
      const wanted = params[where.param - 1];
      rows = rows.filter((row) => row[where.column] === wanted);
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

  async transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new NestedTransactionError();
    }
    this.inTransaction = true;
    const snapshot = this.snapshot();
    try {
      const result = await fn(this);
      return result;
    } catch (err) {
      this.restore(snapshot);
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  private snapshot(): Map<string, Row[]> {
    const copy = new Map<string, Row[]>();
    for (const [name, rows] of this.tables) {
      copy.set(
        name,
        rows.map((row) => ({ ...row })),
      );
    }
    return copy;
  }

  private restore(snapshot: Map<string, Row[]>): void {
    this.tables.clear();
    for (const [name, rows] of snapshot) {
      this.tables.set(
        name,
        rows.map((row) => ({ ...row })),
      );
    }
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

interface WhereClause {
  readonly column: string;
  readonly param: number;
}

interface ParsedSelect {
  readonly items: readonly SelectItem[];
  readonly table: string;
  readonly wheres: readonly WhereClause[];
  readonly orderBy?: { readonly column: string; readonly dir: 'ASC' | 'DESC' };
}

interface UpdateSet {
  readonly column: string;
  readonly param?: number;
  readonly expr?: string;
}

interface ParsedUpdate {
  readonly table: string;
  readonly sets: readonly UpdateSet[];
  readonly where: readonly WhereClause[];
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
 * Parse a simple UPDATE ... SET ... WHERE col = $N [AND col = $N ...]
 * Supports `version = version + 1` expression used by CAS.
 */
function parseUpdate(sql: string): ParsedUpdate | undefined {
  const match = /^UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/i.exec(sql.trim());
  if (!match) return undefined;
  const table = match[1];
  const setPart = match[2];
  const wherePart = match[3];
  if (!table || !setPart || !wherePart) return undefined;

  const sets: UpdateSet[] = setPart.split(',').map((part) => {
    const trimmed = part.trim();
    const exprMatch = /^(\w+)\s*=\s*(version\s*\+\s*1)$/i.exec(trimmed);
    if (exprMatch?.[1]) {
      return { column: exprMatch[1], expr: 'version + 1' };
    }
    const paramMatch = /^(\w+)\s*=\s*\$(\d+)$/i.exec(trimmed);
    if (paramMatch?.[1] && paramMatch[2]) {
      return { column: paramMatch[1], param: Number(paramMatch[2]) };
    }
    return { column: trimmed.split(/\s*=/)[0]?.trim() ?? trimmed };
  });

  const where: WhereClause[] = [];
  const whereRe = /(\w+)\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null = whereRe.exec(wherePart);
  while (m) {
    const column = m[1];
    const param = m[2];
    if (column && param) where.push({ column, param: Number(param) });
    m = whereRe.exec(wherePart);
  }

  return { table, sets, where };
}

/** Parse `SELECT <list> FROM <table> [WHERE ...] [ORDER BY col ASC|DESC]`. */
function parseSelect(sql: string): ParsedSelect | undefined {
  const match =
    /^SELECT\s+(.*?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?\s*$/i.exec(
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

  const wheres: WhereClause[] = [];
  const wherePart = match?.[3];
  if (wherePart) {
    const whereRe = /(\w+)\s*=\s*\$(\d+)/g;
    let m: RegExpExecArray | null = whereRe.exec(wherePart);
    while (m) {
      const column = m[1];
      const param = m[2];
      if (column && param) wheres.push({ column, param: Number(param) });
      m = whereRe.exec(wherePart);
    }
  }

  const orderColumn = match?.[4];
  const orderDir = match?.[5];
  const orderBy =
    orderColumn && orderDir
      ? { column: orderColumn, dir: orderDir.toUpperCase() as 'ASC' | 'DESC' }
      : undefined;

  return { items, table, wheres, orderBy };
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
