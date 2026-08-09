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
 * ($1,..), UPDATE ... SET ... WHERE col = $N (AND col = $M (AND col = $K)?)?,
 * and SELECT ... AS "x" ... [WHERE col = $N (AND col = $M)?]
 * [ORDER BY col ASC|DESC]). A parsed UPDATE returns `{ rowCount }` so CAS
 * adapters can detect 0-row conflicts exactly like PG's `QueryResult.rowCount`.
 * `transaction(fn)` (D1) snapshots `tables` + `idCounters` on entry, runs `fn`
 * against a transaction-scoped connection, keeps the changes when `fn`
 * succeeds, and restores the snapshot + rethrows the ORIGINAL error when `fn`
 * throws (nested transactions are forbidden and reject). It is NOT durable and
 * NOT real PostgreSQL (scenario 2): it honestly carries
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
      return { rowCount: 1 };
    }
    const update = parseUpdate(sql);
    if (update) {
      return { rowCount: applyUpdate(this, update, params).rowCount };
    }
    return undefined;
  }

  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    this._operations.push({ sql, params });
    // UPDATE … RETURNING (fencing claim mint): an UPDATE that returns rows, so
    // query() — not execute() — is the honest port call. Parse the RETURNING
    // list, apply the update, and project the RETURNING columns of the matched
    // rows (exactly like PostgreSQL). 0 matched rows ⇒ [].
    const returning = parseUpdateReturning(sql);
    if (returning) {
      const update = parseUpdate(returning.updateSql);
      if (!update) return [];
      const { rows } = applyUpdate(this, update, params);
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        returning.items.forEach((item) => {
          out[item.alias] = row[item.column];
        });
        return out as T;
      });
    }
    const select = parseSelect(sql);
    if (!select) return [];

    let rows = this.table(select.table);
    for (const condition of select.where) {
      const wanted = params[condition.param - 1];
      rows = rows.filter((row) =>
        condition.any
          ? Array.isArray(wanted) && wanted.includes(row[condition.column])
          : row[condition.column] === wanted,
      );
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

  /**
   * Simulate honest atomicity in-memory (D1, spec scenario 3): snapshot the
   * tables and id counters, run `fn` against a transaction-scoped connection
   * that records operations and rejects nesting, keep the changes when `fn`
   * succeeds, and restore the snapshot + rethrow the ORIGINAL error when `fn`
   * throws. The assertion log (`operations`) is NOT rolled back — like a real
   * database's statement history, it records what was CALLED, not committed
   * state.
   */
  async transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    const tablesSnapshot = structuredClone(this.tables);
    const countersSnapshot = structuredClone(this.idCounters);
    const tx: DbConnection = {
      execute: (sql: string, params: readonly unknown[]) => this.execute(sql, params),
      query: <TRow>(sql: string, params: readonly unknown[]) => this.query<TRow>(sql, params),
      transaction: () =>
        // The port contract is ASYNC-only; nesting is forbidden, so the guard
        // rejects (await surfaces it) exactly like the PG implementation.
        Promise.reject(new Error('nested transactions are forbidden')),
    };
    try {
      return await fn(tx);
    } catch (error) {
      this.restore(tablesSnapshot, countersSnapshot);
      throw error;
    }
  }

  /** Replace the live tables/counters with pristine clones of the snapshot. */
  private restore(tablesSnapshot: Map<string, Row[]>, countersSnapshot: Map<string, number>): void {
    this.tables.clear();
    for (const [name, rows] of tablesSnapshot) {
      this.tables.set(name, structuredClone(rows));
    }
    this.idCounters.clear();
    for (const [name, counter] of countersSnapshot) {
      this.idCounters.set(name, counter);
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

  /** Public read of a table's rows (module-level helpers apply UPDATEs). */
  tableRows(name: string): Row[] {
    return this.table(name);
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

/** A parsed `UPDATE … RETURNING col AS "alias", …` (fencing claim mint). */
interface ParsedUpdateReturning {
  /** The UPDATE statement WITHOUT the RETURNING clause (parseUpdate-parseable). */
  readonly updateSql: string;
  /** The RETURNING projection: DB column → output alias. */
  readonly items: readonly { readonly column: string; readonly alias: string }[];
}

/** Apply a parsed UPDATE to the fake's table; returns the matched (mutated) rows. */
function applyUpdate(
  db: InMemoryDbConnection,
  update: ParsedUpdate,
  params: readonly unknown[],
): { rows: readonly Row[]; rowCount: number } {
  const rows = db.tableRows(update.table);
  const matched = rows.filter((row) =>
    update.where.every((condition) => row[condition.column] === params[condition.param - 1]),
  );
  for (const row of matched) {
    for (const set of update.sets) {
      if (set.increment) {
        row[set.column] = Number(row[set.column]) + 1;
      } else {
        row[set.column] = reviveValue(params[set.param - 1]);
      }
    }
  }
  return { rows: matched, rowCount: matched.length };
}

/** Parse `UPDATE … RETURNING <list>` into the UPDATE SQL + RETURNING items. */
function parseUpdateReturning(sql: string): ParsedUpdateReturning | undefined {
  const match = /^(UPDATE\s+.*?)\s+RETURNING\s+(.+)$/is.exec(sql);
  const updateSql = match?.[1];
  const list = match?.[2];
  if (!updateSql || !list) return undefined;
  const items = list.split(',').map((part) => {
    const aliased = /^\s*(\w+)\s+AS\s+"([^"]+)"\s*$/i.exec(part);
    if (aliased) {
      const column = aliased[1];
      const alias = aliased[2];
      if (column && alias) return { column, alias };
    }
    const column = part.trim();
    return { column, alias: column };
  });
  return { updateSql, items };
}

interface ParsedInsert {
  readonly table: string;
  readonly columns: readonly string[];
}

/** One SET assignment: a plain `col = $N` or a `col = col + 1` increment. */
interface UpdateSet {
  readonly column: string;
  readonly param: number;
  readonly increment: boolean;
}

interface ParsedUpdate {
  readonly table: string;
  readonly sets: readonly UpdateSet[];
  readonly where: readonly { readonly column: string; readonly param: number }[];
}

interface SelectItem {
  readonly column: string;
  readonly alias: string;
}

interface ParsedSelect {
  readonly items: readonly SelectItem[];
  readonly table: string;
  readonly where: readonly {
    readonly column: string;
    readonly param: number;
    /** True when the condition is `col = ANY($N)` (array membership). */
    readonly any?: boolean;
  }[];
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
 * Parse `UPDATE <table> SET col = $N, ..., col = col + 1
 * WHERE col = $N (AND col = $M (AND col = $K (AND col = $L)?)?)?`. Supports
 * plain `$N` SET assignments plus the CAS increment form (`version = version +
 * 1`), and up to FOUR equality WHERE conditions so CAS updates
 * (`WHERE work_id = $1 AND company_id = $2 AND version = $3`) and the journal
 * reopen (`WHERE company_id = $1 AND idempotency_key = $2 AND status = $3 AND
 * request_hash = $6`) round-trip.
 */
function parseUpdate(sql: string): ParsedUpdate | undefined {
  const match =
    /^UPDATE\s+(\w+)\s+SET\s+(.*?)\s+WHERE\s+(\w+)\s*=\s*\$(\d+)(?:\s+AND\s+(\w+)\s*=\s*\$(\d+))?(?:\s+AND\s+(\w+)\s*=\s*\$(\d+))?(?:\s+AND\s+(\w+)\s*=\s*\$(\d+))?\s*$/i.exec(
      sql,
    );
  const table = match?.[1];
  const setClause = match?.[2];
  if (!table || setClause === undefined) return undefined;

  const sets: UpdateSet[] = [];
  for (const part of setClause.split(',')) {
    const assignment = part.trim();
    const plain = /^(\w+)\s*=\s*\$(\d+)$/i.exec(assignment);
    if (plain) {
      sets.push({ column: plain[1] ?? '', param: Number(plain[2]), increment: false });
      continue;
    }
    const increment = /^(\w+)\s*=\s*\w+\s*\+\s*1$/i.exec(assignment);
    if (increment) {
      sets.push({ column: increment[1] ?? '', param: -1, increment: true });
      continue;
    }
    return undefined;
  }

  const where: Array<{ readonly column: string; readonly param: number }> = [];
  for (const [column, param] of [
    [match?.[3], match?.[4]],
    [match?.[5], match?.[6]],
    [match?.[7], match?.[8]],
    [match?.[9], match?.[10]],
  ] as const) {
    if (column && param) where.push({ column, param: Number(param) });
  }
  if (where.length === 0) return undefined;

  return { table, sets, where };
}

/**
 * Parse `SELECT <list> FROM <table> [WHERE col = $N (AND col = $M | AND col =
 * ANY($M))?] [ORDER BY col ASC|DESC]`. Supports up to two WHERE conditions so
 * scoped reads (`WHERE company_id = $1 AND <id> = $2`, ADR-0002) and the
 * actionable read (`WHERE company_id = $1 AND state = ANY($2)`, work-dispatch)
 * round-trip. An `ANY($N)` condition filters by array membership — the param is
 * the JS array the adapter binds for `state = ANY($2)`.
 */
function parseSelect(sql: string): ParsedSelect | undefined {
  const match =
    /^SELECT\s+(.*?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\$(\d+)(?:\s+AND\s+(\w+)\s*=\s*(?:ANY\(\$(\d+)\)|\$(\d+)))?)?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?\s*$/i.exec(
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

  const where: Array<{
    readonly column: string;
    readonly param: number;
    readonly any?: boolean;
  }> = [];
  const firstColumn = match?.[3];
  const firstParam = match?.[4];
  if (firstColumn && firstParam) where.push({ column: firstColumn, param: Number(firstParam) });
  const secondColumn = match?.[5];
  const secondAnyParam = match?.[6];
  const secondPlainParam = match?.[7];
  if (secondColumn) {
    if (secondAnyParam)
      where.push({ column: secondColumn, param: Number(secondAnyParam), any: true });
    else if (secondPlainParam)
      where.push({ column: secondColumn, param: Number(secondPlainParam) });
  }

  const orderColumn = match?.[8];
  const orderDir = match?.[9];
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
