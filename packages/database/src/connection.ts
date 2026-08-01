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

/**
 * Injectable asynchronous SQL connection (Req 1). Exactly three operations.
 *
 * - {@link DbConnection.execute} runs a statement that does not return rows
 *   (INSERT/UPDATE/...). It returns `Promise<unknown>` (D2): callers that route
 *   a record via `save()` already hold that record and never read execute's
 *   result, so a richer `DbExecuteResult` would be unused surface. A real
 *   adapter may return a row count or void; the port does not promise either.
 * - {@link DbConnection.query} runs a statement that returns rows and casts each
 *   row to `T` in one step (D5: adapters alias columns so rows already match the
 *   record shape).
 * - {@link DbConnection.transaction} runs `fn` against a transactional
 *   connection and resolves with `fn`'s result (D1). The transaction-scoped
 *   connection exposes the SAME three operations; a nested `transaction` call on
 *   it MUST throw. Pool lifecycle (`close()`) stays OUTSIDE the port.
 *
 * All three are ASYNCHRONOUS (return `Promise`) and accept a readonly `params`
 * array bound positionally to `$1`, `$2`, ... placeholders.
 */
export interface DbConnection {
  execute(sql: string, params: readonly unknown[]): Promise<unknown>;
  query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]>;
  transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T>;
}
