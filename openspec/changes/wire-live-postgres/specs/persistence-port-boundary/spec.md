# Delta for persistence-port-boundary

## MODIFIED Requirements

### Requirement: Evidence Repository Port

The kernel MUST define an `EvidenceRepository` outbound port interface declaring an async store operation `save(record, session?)` -> `Promise<Readonly<R>>` (persist one evidence record) and an async read operation `get(actionId)` -> `Promise<R | undefined>` (retrieve a stored record by its key), typed generically over the kernel record shape. The port MUST accept a session/transaction context so a downstream real adapter can enforce single-aggregate atomicity. The port MUST NOT import any database driver, ORM, or framework. [INF]

(Previously: `save`/`get` were synchronous, returning the record directly.)

#### Scenario: Store then read round-trips

- GIVEN an evidence record and a repository implementing the port
- WHEN the record is stored then read by its key (both awaited)
- THEN the read MUST return the same record

#### Scenario: Port carries no driver types

- GIVEN the `EvidenceRepository` interface
- WHEN its imports are inspected
- THEN it MUST reference only generic kernel types and MUST NOT import `pg`, any ORM, or any framework

### Requirement: Audit Repository Port

The kernel MUST define an `AuditRepository` outbound port interface declaring an async append operation `append(record)` -> `Promise<readonly R[]>` (append one entry to the log) and an async read operation `getLog()` -> `Promise<readonly R[]>` (return the log in insertion order), typed generically over the kernel record shape with no driver/ORM/framework dependency. Append MUST preserve insertion order and MUST NOT mutate or drop prior entries.

(Previously: `append`/`getLog` were synchronous.)

#### Scenario: Append preserves insertion order

- GIVEN an audit repository with existing entries
- WHEN a new entry is appended (awaited)
- THEN the returned log MUST list prior entries first in original order, followed by the new entry

#### Scenario: Prior entries immutable on append

- GIVEN a prior audit log
- WHEN an entry is appended
- THEN the prior log reference MUST remain unchanged (append returns a new state)

### Requirement: In-Memory Fake Adapters

The kernel MUST provide `InMemoryEvidenceRepository` and `InMemoryAuditRepository` fakes that satisfy their respective async port interfaces using in-memory storage only. Fakes MUST return `Promise` (matching the async contract) but MUST NOT touch any database, network, daemon, or framework and MUST be usable as unit-test doubles under `integration: true`.

(Previously: fakes were synchronous.)

#### Scenario: Fake stores and returns records

- GIVEN `InMemoryEvidenceRepository` and `InMemoryAuditRepository`
- WHEN records are stored/appended then read (all awaited)
- THEN both MUST satisfy their port contracts and return the stored data

#### Scenario: Fake has no external I/O

- GIVEN either fake adapter
- WHEN its dependencies are inspected
- THEN it MUST depend only on in-memory data structures and MUST NOT import any driver, network, daemon, or framework

### Requirement: Backward-Compatible Async Pipeline Wiring

The evaluation pipeline MUST accept OPTIONAL async evidence and audit repositories. When NO repository is provided, the pipeline MUST behave EXACTLY as the persistence-free kernel — evidence and audit remain `InMemoryRecord` with `persistent: false`, and every existing decision, evidence, audit log, receipt, and step MUST be unchanged (the only observable difference is that `evaluate()` now returns `Promise<EvaluationResult>`). When a repository IS provided, the pipeline MUST `await` the evidence record store and the audit entry append through the corresponding ports, yielding durable-capable (`persistent: true`) records. [ADR-0001] [INF]

(Previously: repositories were synchronous and `evaluate()` was synchronous; behavior is identical modulo the now-required `await`.)

#### Scenario: No repository reproduces current behavior

- GIVEN the same evaluation input used today, with no repositories
- WHEN evaluated (awaited)
- THEN the decision, evidence, audit log, receipt, and steps MUST be identical to the persistence-free kernel and records MUST carry `persistent: false`

#### Scenario: Repository present routes records

- GIVEN an evaluation with evidence and audit repositories injected
- WHEN it finalizes
- THEN the evidence record MUST be stored via the evidence port and the audit entry MUST be appended via the audit port (both awaited), with records carrying `persistent: true`

### Requirement: Port Boundary Hygiene and Live-PG Permitted in Database Package

Port interfaces MUST be generic over the kernel record shape and MUST NOT import any database driver (`pg`), ORM, or business/agentic framework. The `ports/` directory MUST be exempted from the kernel boundary test, while the boundary test MUST still reject forbidden drivers, frameworks, and adapters elsewhere in the kernel. This slice now permits `pg` as a runtime dependency in the `packages/database/` package and enables integration tests (`integration: true`), but MUST NOT add real PostgreSQL storage inside the kernel, MUST NOT satisfy persistent R1–R17 obligations, MUST NOT extract the kernel into canonical packages, and MUST NOT add cryptographic receipts or real approval chains. [ADR-0002] [INF]

(Previously: deferred all real PostgreSQL storage and kept `integration: false`; now permits `pg` and live integration in the database package while the kernel itself stays driver-free.)

#### Scenario: Ports generic; drivers and frameworks still forbidden in the kernel

- GIVEN the kernel after this slice
- WHEN the boundary test runs
- THEN `ports/` imports MUST be permitted and `pg`/ORM/framework imports outside `ports/` MUST be rejected

#### Scenario: pg permitted in database package

- GIVEN the `packages/database/` package
- WHEN its dependency manifest and boundary test are inspected
- THEN `pg` MUST be an allowed runtime dependency and the database boundary test MUST NOT reject `pg` inside that package

#### Scenario: Deferred items remain deferred

- GIVEN this slice
- WHEN its scope is reviewed
- THEN real PG inside the kernel, canonical extraction, other aggregate ports, crypto receipts, real approval chains, outbox/inbox, and R1–R17 durability MUST remain explicitly excluded and documented as downstream
