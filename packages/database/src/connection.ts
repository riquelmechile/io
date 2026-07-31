/**
 * Asynchronous, driver-free `DbConnection` port (Req 1; D1/D2/D3).
 *
 * This is the injectable seam between the kernel's repository adapters and a
 * real PostgreSQL connection. It is ASYNCHRONOUS (D1): the `pg` driver is
 * TCP-based and fundamentally async, so a `Promise` return is the only honest
 * completion contract — a synchronous bridge would lie about completion. Both
 * the in-memory fake and a future `pg.Pool` adapter resolve a `Promise`.
 *
 * The port carries ZERO table/schema knowledge: SQL lives ONLY in the adapters
 * (evidence-adapter.ts / audit-adapter.ts). It imports NO driver (`pg`), ORM, or
 * framework (D4) and exposes only raw SQL execution. Params use PostgreSQL-shaped
 * `$N` positional placeholders, targeting PostgreSQL 18.4 (D3).
 */

/**
 * One database row as returned by {@link DbConnection.query}: an immutable,
 * column-name-keyed bag of opaque values. Column aliases (e.g. `AS "actionId"`)
 * shape the keys; the connection does not interpret them.
 */
export interface DbRow {
  readonly [column: string]: unknown;
}

/** Raised when `transaction` is invoked inside an active transaction body. */
export class NestedTransactionError extends Error {
  constructor(message = 'nested transactions are not supported') {
    super(message);
    this.name = 'NestedTransactionError';
  }
}

/**
 * Injectable asynchronous SQL connection (Req 1). Three operations:
 *
 * - {@link DbConnection.execute} runs a statement that does not return rows
 *   (INSERT/UPDATE/...). It returns `Promise<unknown>` (D2).
 * - {@link DbConnection.query} runs a statement that returns rows and casts each
 *   row to `T` in one step.
 * - {@link DbConnection.transaction} runs `fn` against a single transaction-scoped
 *   connection; commits on success, rolls back on throw. Nested calls throw
 *   {@link NestedTransactionError}.
 *
 * All three are ASYNCHRONOUS (return `Promise`) and accept a readonly `params`
 * array bound positionally to `$1`, `$2`, ... placeholders.
 */
export interface DbConnection {
  execute(sql: string, params: readonly unknown[]): Promise<unknown>;
  query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]>;
  transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T>;
}
