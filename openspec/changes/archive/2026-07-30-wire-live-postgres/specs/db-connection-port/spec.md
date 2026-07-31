# Delta for db-connection-port

## ADDED Requirements

### Requirement: PgDbConnection Implementation

The package MUST provide a `PgDbConnection` implementing the async `DbConnection` port over a `pg.Pool`. Its constructor MUST accept a PostgreSQL connection string; `execute(sql, params)` MUST delegate to `pool.query(sql, [...params])` and resolve once the statement completes; `query<T>(sql, params)` MUST delegate and return `result.rows` as a readonly array. The implementation MUST be exported from the package index. A `close()` lifecycle method (ending the pool) MAY be provided, but MUST NOT be part of the `DbConnection` port interface — pool lifecycle, sizing, and health checks stay outside the port. [INF]

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

### Requirement: Database Schema for Evidence and Audit

The package MUST ship a schema definition creating `evidence` and `audit` tables whose columns cover the `PersistentRecord` fields: `action_id`, `principal_id`, `risk_class`, `decision`, `reason`, `timestamp`, `persistent`, and `disclosure` (plus an `id` primary key). The schema MUST use PostgreSQL DDL (PG 18.4 target) and MUST define an index on `evidence(action_id)`. Both tables MUST use `$N`-compatible column types for adapter parameter binding. [INF]

#### Scenario: Schema supports round-trip of PersistentRecord

- GIVEN the schema applied to a database
- WHEN a `PersistentRecord` is inserted into `evidence` then selected back
- THEN every field (`action_id`, `principal_id`, `risk_class`, `decision`, `reason`, `timestamp`, `persistent`, `disclosure`) MUST survive the round-trip intact

#### Scenario: Schema index present

- GIVEN the applied schema
- WHEN its DDL is inspected
- THEN an index on `evidence(action_id)` MUST exist

### Requirement: Integration Test Round-Trip Against Real PostgreSQL

An integration test MUST connect to a real PostgreSQL instance (PG 18.4), create the evidence and audit schema, and round-trip a `PersistentRecord` through the adapters (evidence `save` → `get`; audit `append` → `getLog`), asserting persisted rows match. The test MUST isolate state via `TRUNCATE` (or equivalent reset) in `beforeEach` so repeated runs do not interfere. The test MUST be skipped or marked pending when no live PostgreSQL is reachable.

#### Scenario: Round-trip against real PG

- GIVEN a live PG instance and the schema created
- WHEN a record is saved and re-read through the real adapters
- THEN the re-read record MUST equal the saved record, proving a durable round-trip

#### Scenario: Test isolation via TRUNCATE

- GIVEN a prior test run that left rows in `evidence`/`audit`
- WHEN a new test run starts
- THEN `TRUNCATE` in `beforeEach` MUST leave both tables empty before the test body executes

#### Scenario: Skipped when PG unreachable

- GIVEN no reachable PostgreSQL instance
- WHEN the integration test is run
- THEN it MUST skip (or mark pending) rather than fail the suite

## MODIFIED Requirements

### Requirement: DbConnection Port Interface

The database package MUST define a `DbConnection` port with exactly two operations: `execute(sql, params)` -> `Promise<DbExecuteResult>` (`rowCount`) and `query<T>(sql, params)` -> `Promise<readonly DbRow[]>`. Both MUST be ASYNCHRONOUS (return `Promise`) and accept a readonly `params` array. The port interface MUST NOT import any driver (`pg`), ORM, or framework, and params MUST use PG-shaped `$N` positional placeholders (PostgreSQL 18.4 target). The port MUST carry zero table/schema knowledge — SQL lives ONLY in adapters. [INF]

(Previously: `execute`/`query` were SYNCHRONOUS, returning `DbExecuteResult` and `readonly DbRow[]` directly.)

#### Scenario: Asynchronous execute and query

- GIVEN any `DbConnection` implementation
- WHEN `execute(sql, params)` and `query(sql, params)` are called
- THEN both MUST return a `Promise` resolving to `DbExecuteResult` and `readonly DbRow[]` respectively (no synchronous return)

#### Scenario: No driver types or schema knowledge

- GIVEN the `DbConnection` interface module
- WHEN its imports and surface are inspected
- THEN it MUST NOT import `pg`/ORM/framework and MUST expose only raw SQL execution with no table or schema awareness

### Requirement: PgEvidenceRepository Adapter

The package MUST provide a `PgEvidenceRepository` implementing `EvidenceRepository<PersistentRecord>` against an injected async `DbConnection`. `save(record)` MUST return `Promise<Readonly<PersistentRecord>>`, building a parameterized `INSERT INTO evidence (...) VALUES ($1, ...)` binding every field via `$N` params and executing it through the awaited connection; `get(key)` MUST return `Promise<PersistentRecord | undefined>`, building a `SELECT ... WHERE action_id = $1` and querying the awaited connection. Returned records MUST be immutable views carrying `persistent: true`.

(Previously: `save`/`get` were synchronous against the synchronous `DbConnection`.)

#### Scenario: Save builds parameterized INSERT and round-trips

- GIVEN a `PgEvidenceRepository` backed by an async `DbConnection`
- WHEN a record is saved then read by its key
- THEN the saved record MUST round-trip identically and the executed SQL MUST be a single `INSERT INTO evidence` with all values bound as `$N` params

### Requirement: PgAuditRepository Adapter

The package MUST provide a `PgAuditRepository` implementing `AuditRepository<PersistentRecord>` against an injected async `DbConnection`. `append(entry)` MUST return `Promise<readonly PersistentRecord[]>`, building a parameterized `INSERT INTO audit (...) VALUES ($1, ...)` and executing it through the awaited connection; `getLog()` MUST return `Promise<readonly PersistentRecord[]>`, building a `SELECT ... ORDER BY id ASC` and querying the awaited connection. Append MUST preserve insertion order and MUST NOT mutate or drop prior entries.

(Previously: `append`/`getLog` were synchronous against the synchronous `DbConnection`.)

#### Scenario: getLog preserves insertion order

- GIVEN several audit entries appended via the adapter
- WHEN `getLog()` is awaited
- THEN it MUST return entries in insertion order (prior entries first) and MUST NOT drop or reorder earlier entries

### Requirement: InMemoryDbConnection Test Double

The package MUST provide an `InMemoryDbConnection` satisfying the async `DbConnection` port: it records every `execute`/`query` call (full `{ sql, params }`) into an assertion log AND stores results so `query` round-trips data written by `execute`. Its methods MUST return `Promise` (matching the async port contract) while using in-memory structures only — no network, no real I/O.

(Previously: `InMemoryDbConnection` was synchronous.)

#### Scenario: Records operations and round-trips data

- GIVEN an `InMemoryDbConnection`
- WHEN records are stored via awaited `execute` and retrieved via awaited `query`
- THEN every operation's `{ sql, params }` MUST be recorded in order AND the stored data MUST round-trip

#### Scenario: Honest non-durable disclosure

- GIVEN the `InMemoryDbConnection` double
- WHEN classified
- THEN it MUST disclose that it is NOT durable and NOT real PostgreSQL

### Requirement: Honest Disclosure and Live-PG Slice Boundary

Both adapters MUST attach the SAME `PERSISTENT_PORT_DISCLOSURE` used by the kernel. The package MUST allow `pg` as a runtime dependency, MUST permit a real PostgreSQL connection via `PgDbConnection`, and integration tests MUST be enabled (`integration: true`). This slice still MUST NOT satisfy persistent R1–R17: it proves a real PG round-trip but excludes transaction/session (`DbSession`) boundaries, migration runner/versioning, connection-pool lifecycle tuning (min/max, health checks), and single-aggregate atomicity enforcement. Disclosure MUST state that R1–R17 durability obligations remain deferred to downstream hardening.

(Previously: the package MUST NOT import `pg`, MUST NOT open a real PG connection, MUST NOT run schema migrations, and kept `integration: false`; it resolved none of the sync/async tension, deferring it to the live-PG slice.)

#### Scenario: Adapters reuse kernel disclosure; R1–R17 unsatisfied

- GIVEN the evidence and audit adapter records
- WHEN inspected
- THEN they MUST carry `PERSISTENT_PORT_DISCLOSURE` and MUST NOT claim to satisfy persistent R1–R17

#### Scenario: Live-PG inclusions and exclusions enforced

- GIVEN the `packages/database/` package and `openspec/config.yaml`
- WHEN dependencies, code, and config are inspected
- THEN `pg` MUST be a runtime dependency, a real PG connection via `PgDbConnection` MUST be permitted, `integration: true` MUST hold, AND transaction/session boundaries, migration runner, and pool-lifecycle tuning MUST remain absent
