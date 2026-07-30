# db-connection-port Specification

## Purpose

Injectable synchronous `DbConnection` port plus the PostgreSQL-shaped adapters implementing the kernel `EvidenceRepository<R>` / `AuditRepository<R>` ports, in the new Technical-Infrastructure package `packages/database/`. Proves the adapter side of `persistence-port-boundary` without live PostgreSQL: the connection is synchronous and driver-free, SQL is PG-shaped (`$N`), and an in-memory fake enables unit testing under `integration: false`. Real `pg` wiring, migrations, transactions, and sync/async resolution are deferred.

## Requirements

### Requirement: DbConnection Port Interface

The database package MUST define a `DbConnection` port with exactly two operations: `execute(sql, params)` -> `DbExecuteResult` (`rowCount`) and `query(sql, params)` -> `readonly DbRow[]`. Both MUST be SYNCHRONOUS and accept a readonly `params` array. The port MUST NOT import any driver (`pg`), ORM, or framework, and params MUST use PG-shaped `$N` positional placeholders (PostgreSQL 18.4 target). The connection MUST carry zero table/schema knowledge — SQL lives ONLY in adapters. [INF]

#### Scenario: Synchronous execute and query

- GIVEN any `DbConnection` implementation
- WHEN `execute(sql, params)` and `query(sql, params)` are called
- THEN both MUST return synchronously (no `Promise`) as `DbExecuteResult` and `readonly DbRow[]` respectively

#### Scenario: No driver types or schema knowledge

- GIVEN the `DbConnection` interface module
- WHEN its imports and surface are inspected
- THEN it MUST NOT import `pg`/ORM/framework and MUST expose only raw SQL execution with no table or schema awareness

### Requirement: PgEvidenceRepository Adapter

The package MUST provide a `PgEvidenceRepository` implementing `EvidenceRepository<PersistentRecord>` against an injected `DbConnection`. `save(record)` MUST build a parameterized `INSERT INTO evidence (...) VALUES ($1, ...)` binding every field via `$N` params and execute it through the connection; `get(key)` MUST build a `SELECT ... WHERE action_id = $1` and query the connection. Returned records MUST be immutable views carrying `persistent: true`.

#### Scenario: Save builds parameterized INSERT and round-trips

- GIVEN a `PgEvidenceRepository` backed by `InMemoryDbConnection`
- WHEN a record is saved then read by its key
- THEN the saved record MUST round-trip identically and the executed SQL MUST be a single `INSERT INTO evidence` with all values bound as `$N` params

### Requirement: PgAuditRepository Adapter

The package MUST provide a `PgAuditRepository` implementing `AuditRepository<PersistentRecord>` against an injected `DbConnection`. `append(entry)` MUST build a parameterized `INSERT INTO audit (...) VALUES ($1, ...)` and execute it; `getLog()` MUST build a `SELECT ... ORDER BY id ASC` and query the connection. Append MUST preserve insertion order and MUST NOT mutate or drop prior entries.

#### Scenario: getLog preserves insertion order

- GIVEN several audit entries appended via the adapter
- WHEN `getLog()` is called
- THEN it MUST return entries in insertion order (prior entries first) and MUST NOT drop or reorder earlier entries

### Requirement: InMemoryDbConnection Test Double

The package MUST provide an `InMemoryDbConnection` satisfying `DbConnection`: it records every `execute`/`query` call (full `{ sql, params }`) into an assertion log AND stores results so `query` round-trips data written by `execute`. It MUST be synchronous, in-memory structures only.

#### Scenario: Records operations and round-trips data

- GIVEN an `InMemoryDbConnection`
- WHEN records are stored via `execute` and retrieved via `query`
- THEN every operation's `{ sql, params }` MUST be recorded in order AND the stored data MUST round-trip synchronously

#### Scenario: Honest non-durable disclosure

- GIVEN the `InMemoryDbConnection` double
- WHEN classified
- THEN it MUST disclose that it is NOT durable and NOT real PostgreSQL

### Requirement: Honest Disclosure and Slice Exclusions

Both adapters MUST attach the SAME `PERSISTENT_PORT_DISCLOSURE` used by the kernel — this slice does NOT satisfy persistent R1–R17 (the connection is still an in-memory fake, not real PostgreSQL). The package MUST NOT import `pg`, MUST NOT open a real PG connection, MUST NOT run schema migrations, and integration tests MUST stay disabled (`integration: false`). The sync `DbConnection` matches the synchronous port contract; resolving the sync/async tension at the real I/O boundary is deferred to the live-PG slice.

#### Scenario: Adapters reuse kernel disclosure; R1–R17 unsatisfied

- GIVEN the evidence and audit adapter records
- WHEN inspected
- THEN they MUST carry `PERSISTENT_PORT_DISCLOSURE` and MUST NOT claim to satisfy persistent R1–R17

#### Scenario: Exclusions enforced

- GIVEN the `packages/database/` package and `openspec/config.yaml`
- WHEN dependencies and tests are inspected
- THEN no `pg` import, no real PG connection, no migrations, and `integration: false` MUST hold
