# Delta for db-connection-port

## ADDED Requirements

### Requirement: Atomic Transaction Boundary

The `DbConnection` port MUST provide
`transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T>` that runs
`fn` against a single transaction-scoped connection. The PG implementation MUST
acquire one client from the pool, issue `BEGIN`, run `fn`, `COMMIT` on success,
and `ROLLBACK` on any thrown error, releasing the client in `finally`. The
in-memory fake MUST snapshot table state before `fn` and restore it on throw so
partial-failure is observable in unit tests. A nested `transaction` call (a
`transaction` invoked inside `fn`) MUST throw `NestedTransactionError`;
savepoint support is deferred. The transaction boundary MUST carry zero
table/schema knowledge. [INF]

#### Scenario: Commit persists all statements

- GIVEN a `DbConnection` with `transaction`
- WHEN `fn` executes two writes and returns normally
- THEN both writes MUST be committed and visible after the transaction

#### Scenario: Rollback discards all statements

- GIVEN a `DbConnection` with `transaction`
- WHEN `fn` executes one write then throws
- THEN no write from `fn` MUST be visible after the transaction

#### Scenario: Nested transaction rejected

- GIVEN a `transaction` body
- WHEN it invokes `transaction` again inside `fn`
- THEN a `NestedTransactionError` MUST be thrown

### Requirement: Business Table Unique Constraints

The schema MUST enforce uniqueness on business keys: `UNIQUE(company_id)` where
the business key is the canonical identifier per table, and the Work, Delegation,
and BusinessReceipt tables MUST reject duplicate canonical-key inserts.
`business_receipt` MUST additionally enforce
`UNIQUE(work_id, terminal_event_id)` so a terminal event yields exactly one
receipt. Constraints MUST be added idempotently (`ADD CONSTRAINT IF NOT EXISTS`).
[INF]

#### Scenario: Duplicate business key rejected

- GIVEN a table with the UNIQUE constraint applied
- WHEN a second row with an existing canonical business key is inserted
- THEN the insert MUST be rejected by the database

#### Scenario: Duplicate terminal-event receipt rejected

- GIVEN a `business_receipt` row for `(work_id, terminal_event_id)`
- WHEN a second receipt with the same pair is inserted
- THEN the insert MUST be rejected

## MODIFIED Requirements

### Requirement: DbConnection Port Interface

The database package MUST define a `DbConnection` port with three operations:
`execute(sql, params)` -> `Promise<unknown>`, `query<T>(sql, params)` ->
`Promise<readonly DbRow[]>`, and `transaction<T>(fn: (tx: DbConnection) =>
Promise<T>)` -> `Promise<T>`. All three MUST be ASYNCHRONOUS (return `Promise`)
and `execute`/`query` MUST accept a readonly `params` array. The port interface
MUST NOT import any driver (`pg`), ORM, or framework, and params MUST use
PG-shaped `$N` positional placeholders (PostgreSQL 18.4 target). The port MUST
carry zero table/schema knowledge — SQL lives ONLY in adapters. [INF]

(Previously: the port had exactly two operations, `execute` and `query`, and
explicitly deferred transaction/session boundaries.)

#### Scenario: Asynchronous execute, query, and transaction

- GIVEN any `DbConnection` implementation
- WHEN `execute`, `query`, and `transaction` are called
- THEN all three MUST return a `Promise` (no synchronous return)

#### Scenario: No driver types or schema knowledge

- GIVEN the `DbConnection` interface module
- WHEN its imports and surface are inspected
- THEN it MUST NOT import `pg`/ORM/framework and MUST expose only raw SQL execution plus the transaction boundary, with no table or schema awareness
