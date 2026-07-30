/**
 * Synchronous, driver-free `DbConnection` port (Req 1; D1/D2/D3).
 *
 * This is the injectable seam between the kernel's repository adapters and a
 * future real PostgreSQL connection. It is intentionally SYNCHRONOUS (D1): the
 * in-memory fake completes instantly, so a synchronous `save()` returning
 * `Readonly<R>` does not lie about completion. The real `pg` driver is async —
 * resolving that sync/async tension at the live-I/O boundary is deferred
 * critical debt (see design.md "Sync/Async Debt"), NOT resolved here.
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
 * Injectable synchronous SQL connection (Req 1). Exactly two operations.
 *
 * - {@link DbConnection.execute} runs a statement that does not return rows
 *   (INSERT/UPDATE/...). It returns `unknown` (D2): callers that route a record
 *   via `save()` already hold that record and never read execute's result, so a
 *   richer `DbExecuteResult` would be unused surface. A real adapter may return a
 *   row count or void; the port does not promise either.
 * - {@link DbConnection.query} runs a statement that returns rows and casts each
 *   row to `T` in one step (D5: adapters alias columns so rows already match the
 *   record shape).
 *
 * Both are SYNCHRONOUS and accept a readonly `params` array bound positionally
 * to `$1`, `$2`, ... placeholders.
 */
export interface DbConnection {
  execute(sql: string, params: readonly unknown[]): unknown;
  query<T>(sql: string, params: readonly unknown[]): readonly T[];
}
