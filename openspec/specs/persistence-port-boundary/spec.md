# persistence-port-boundary Specification

## Purpose

Hexagonal outbound port boundary for evidence (R7) and audit (R16) storage inside the transitional `packages/trust-kernel/`. Defines repository port interfaces, a durable `PersistentRecord` type diverging from `InMemoryRecord`, in-memory fake adapters, and backward-compatible pipeline wiring — WITHOUT adding a real database. This is Increment 2's first persistence slice: it proves the port pattern all later aggregates reuse while preserving every existing behavior and the `integration: false` constraint. Real PostgreSQL, canonical extraction, other aggregates, crypto receipts, and real approval chains remain explicitly deferred.

## Requirements

### Requirement: Evidence Repository Port

The kernel MUST define an `EvidenceRepository` outbound port interface declaring a store operation (persist one evidence record) and a read operation (retrieve a stored record by its key), typed generically over the kernel record shape. The port MUST accept a session/transaction context so a downstream real adapter can enforce single-aggregate atomicity. The port MUST NOT import any database driver, ORM, or framework. [INF]

#### Scenario: Store then read round-trips

- GIVEN an evidence record and a repository implementing the port
- WHEN the record is stored then read by its key
- THEN the read MUST return the same record

#### Scenario: Port carries no driver types

- GIVEN the `EvidenceRepository` interface
- WHEN its imports are inspected
- THEN it MUST reference only generic kernel types and MUST NOT import `pg`, any ORM, or any framework

### Requirement: Audit Repository Port

The kernel MUST define an `AuditRepository` outbound port interface declaring an append operation (append one entry to the log) and a read operation (return the log in insertion order), typed generically over the kernel record shape with no driver/ORM/framework dependency. Append MUST preserve insertion order and MUST NOT mutate or drop prior entries.

#### Scenario: Append preserves insertion order

- GIVEN an audit repository with existing entries
- WHEN a new entry is appended
- THEN the returned log MUST list prior entries first in original order, followed by the new entry

#### Scenario: Prior entries immutable on append

- GIVEN a prior audit log
- WHEN an entry is appended
- THEN the prior log reference MUST remain unchanged (append returns a new state)

### Requirement: Persistent Record Type

The kernel MUST define a `PersistentRecord` type that diverges from `InMemoryRecord` by carrying a `persistent: true` literal and a durability disclosure. `InMemoryRecord` (`persistent: false`) and `PersistentRecord` (`persistent: true`) MUST coexist during the transition so the type system records which records are durable-capable. Both record types MUST declare their valid states explicitly. [INF]

#### Scenario: Persistent record carries true literal

- GIVEN a record produced through a repository port
- WHEN inspected
- THEN it MUST carry `persistent: true` as a literal and a durability disclosure

#### Scenario: In-memory and persistent types coexist

- GIVEN the kernel during transition
- WHEN record types are classified
- THEN both `InMemoryRecord` and `PersistentRecord` MUST be present, distinguished by their `persistent` literal

### Requirement: In-Memory Fake Adapters

The kernel MUST provide `InMemoryEvidenceRepository` and `InMemoryAuditRepository` fakes that satisfy their respective port interfaces using in-memory storage only. Fakes MUST NOT touch any database, network, daemon, or framework and MUST be usable as unit-test double under `integration: false`.

#### Scenario: Fake stores and returns records

- GIVEN `InMemoryEvidenceRepository` and `InMemoryAuditRepository`
- WHEN records are stored/appended then read
- THEN both MUST satisfy their port contracts and return the stored data

#### Scenario: Fake has no external I/O

- GIVEN either fake adapter
- WHEN its dependencies are inspected
- THEN it MUST depend only on in-memory data structures and MUST NOT import any driver, network, daemon, or framework

### Requirement: Backward-Compatible Pipeline Wiring

The evaluation pipeline MUST accept OPTIONAL evidence and audit repositories. When NO repository is provided, the pipeline MUST behave EXACTLY as the persistence-free kernel — evidence and audit remain `InMemoryRecord` with `persistent: false`, and every existing result is unchanged. When a repository IS provided, the pipeline MUST route the evidence record and audit entry through the corresponding ports, yielding durable-capable (`persistent: true`) records. [ADR-0001] [INF]

#### Scenario: No repository reproduces current behavior

- GIVEN the same evaluation input used today, with no repositories
- WHEN evaluated
- THEN the decision, evidence, audit log, receipt, and steps MUST be identical to the persistence-free kernel and records MUST carry `persistent: false`

#### Scenario: Repository present routes records

- GIVEN an evaluation with evidence and audit repositories injected
- WHEN it finalizes
- THEN the evidence record MUST be stored via the evidence port and the audit entry MUST be appended via the audit port, with records carrying `persistent: true`

### Requirement: Port Boundary Hygiene and Slice Exclusions

Port interfaces MUST be generic over the kernel record shape and MUST NOT import any database driver (`pg`), ORM, or business/agentic framework. The `ports/` directory MUST be exempted from the kernel boundary test, while the boundary test MUST still reject forbidden drivers, frameworks, and adapters elsewhere. This slice MUST NOT add real PostgreSQL storage, MUST NOT satisfy persistent R1–R17 obligations, MUST NOT extract the kernel into canonical packages, and MUST NOT add cryptographic receipts or real approval chains. [ADR-0002] [INF]

#### Scenario: Ports generic; drivers and frameworks still forbidden elsewhere

- GIVEN the kernel after this slice
- WHEN the boundary test runs
- THEN `ports/` imports MUST be permitted and `pg`/ORM/framework imports outside `ports/` MUST be rejected

#### Scenario: Deferred items remain deferred

- GIVEN this slice
- WHEN its scope is reviewed
- THEN real PG, canonical extraction, other aggregate ports, crypto receipts, and real approval chains MUST remain explicitly excluded and documented as downstream
