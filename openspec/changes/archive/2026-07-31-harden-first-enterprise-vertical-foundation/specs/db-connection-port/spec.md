# Delta for db-connection-port

## MODIFIED Requirements

### Requirement: DbConnection Port Interface

The database package MUST define a `DbConnection` port with exactly three operations: `execute(sql, params)` -> `Promise<DbExecuteResult>` (`rowCount`), `query<T>(sql, params)` -> `Promise<readonly DbRow[]>`, and `transaction<T>(fn: (conn: DbConnection) => Promise<T>)` -> `Promise<T>`. All MUST be ASYNCHRONOUS (return `Promise`); `execute`/`query` accept a readonly `params` array. The `transaction` operation MUST run `fn` against a transactional connection and resolve with `fn`'s result. The port interface MUST NOT import any driver (`pg`), ORM, or framework, and params MUST use PG-shaped `$N` positional placeholders (PostgreSQL 18.4 target). The port MUST carry zero table/schema knowledge — SQL lives ONLY in adapters. [INF]
(Previously: the port exposed exactly two operations, `execute` and `query`, with no transaction primitive.)

#### Scenario: Asynchronous execute and query

- GIVEN any `DbConnection` implementation
- WHEN `execute(sql, params)` and `query(sql, params)` are called
- THEN both MUST return a `Promise` resolving to `DbExecuteResult` and `readonly DbRow[]` respectively (no synchronous return)

#### Scenario: No driver types or schema knowledge

- GIVEN the `DbConnection` interface module
- WHEN its imports and surface are inspected
- THEN it MUST NOT import `pg`/ORM/framework and MUST expose only raw SQL execution with no table or schema awareness

#### Scenario: Transaction signature on the port

- GIVEN any `DbConnection` implementation
- WHEN `transaction(fn)` is called with a function receiving a transactional `conn`
- THEN it MUST return a `Promise<T>` resolving with `fn`'s result, and the port MUST remain driver-free

### Requirement: PgDbConnection Implementation

The package MUST provide a `PgDbConnection` implementing the async `DbConnection` port over a `pg.Pool`. Its constructor MUST accept a PostgreSQL connection string; `execute(sql, params)` MUST delegate to `pool.query(sql, [...params])` and resolve once the statement completes; `query<T>(sql, params)` MUST delegate and return `result.rows` as a readonly array. `transaction(fn)` MUST acquire a client (`pool.connect()`), issue `BEGIN`, run `fn` against a transaction-scoped connection exposing `{ execute, query }`, then `COMMIT` and release the client on success; if `fn` throws it MUST `ROLLBACK`, release the client, and rethrow the original error. A `transaction` call made on the transaction-scoped connection (nesting) MUST throw. The implementation MUST be exported from the package index. A `close()` lifecycle method (ending the pool) MAY be provided, but MUST NOT be part of the `DbConnection` port interface — pool lifecycle, sizing, and health checks stay outside the port. [INF]
(Previously: PgDbConnection implemented only `execute` and `query`; there was no transaction support.)

#### Scenario: Execute and query against live PG via pg.Pool

- GIVEN a running PostgreSQL 18.4 instance and a `PgDbConnection` built from its connection string
- WHEN `execute(INSERT ...)` then `query(SELECT ...)` are awaited
- THEN the inserted row MUST be returned by the subsequent query against the SAME live database

#### Scenario: Connection string drives the pool

- GIVEN two `PgDbConnection` instances built from different connection strings
- WHEN each executes a write
- THEN each MUST affect only the database its connection string targets

#### Scenario: close() ends the pool but is not part of the port

- GIVEN a `PgDbConnection`
- WHEN its `close()` is awaited
- THEN the underlying pool MUST be ended, and the `DbConnection` port interface MUST NOT declare `close()`

#### Scenario: Transaction commit persists

- GIVEN a live PG instance and a `PgDbConnection`
- WHEN `transaction(tx => tx.execute(INSERT ...))` succeeds and is awaited
- THEN the `COMMIT` MUST persist the insert so a later `query` outside the transaction returns the row

#### Scenario: Transaction error rolls back with no partial write

- GIVEN a live PG instance and a `transaction` whose `fn` writes a row then throws
- WHEN the transaction is awaited
- THEN it MUST `ROLLBACK`, rethrow the error, and a later `query` MUST NOT return the partially written row

#### Scenario: Nested transaction throws

- GIVEN a transaction-scoped connection inside `transaction(fn)`
- WHEN `transaction(...)` is called again on that scoped connection
- THEN it MUST throw (nested transactions are forbidden)

### Requirement: InMemoryDbConnection Test Double

The package MUST provide an `InMemoryDbConnection` satisfying the async `DbConnection` port: it records every `execute`/`query` call (full `{ sql, params }`) into an assertion log AND stores results so `query` round-trips data written by `execute`. Its `transaction(fn)` MUST simulate honest atomicity in-memory: on entry it MUST snapshot its tables/counters, run `fn` against a transaction-scoped connection, keep the changes if `fn` succeeds, and restore the snapshot and rethrow if `fn` throws; a nested `transaction` on the scoped connection MUST throw. Its methods MUST return `Promise` (matching the async port contract) while using in-memory structures only — no network, no real I/O.

#### Scenario: Records operations and round-trips data

- GIVEN an `InMemoryDbConnection`
- WHEN records are stored via awaited `execute` and retrieved via awaited `query`
- THEN every operation's `{ sql, params }` MUST be recorded in order AND the stored data MUST round-trip

#### Scenario: Honest non-durable disclosure

- GIVEN the `InMemoryDbConnection` double
- WHEN classified
- THEN it MUST disclose that it is NOT durable and NOT real PostgreSQL

#### Scenario: Fake transaction commit keeps and error restores

- GIVEN an `InMemoryDbConnection`
- WHEN a successful `transaction` writes a row, and a separate `transaction` writes a row then throws
- THEN the successful write MUST be kept AND the throwing transaction MUST restore the prior snapshot (no partial row) and rethrow

#### Scenario: Fake mirrors PostgreSQL transaction semantics

- GIVEN the `InMemoryDbConnection` and a `PgDbConnection`
- WHEN the same transaction scenarios (commit, rollback-on-error, nested-throws) are run against both
- THEN the fake MUST produce the same observable outcomes as PostgreSQL (commit persists, error leaves no partial write, nesting throws)
