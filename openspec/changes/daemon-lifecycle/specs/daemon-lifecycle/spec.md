# Delta for Daemon Lifecycle

## ADDED Requirements

### Requirement: Fail-Fast Boot Configuration

Before scheduling, the daemon MUST validate `DATABASE_URL`, `DEEPSEEK_API_KEY`, `IO_SANDBOX_ROOT`, a positive `IO_INTERVAL_MS`, and all four principal identifiers. Invalid configuration MUST name the offending setting and terminate boot with exit code 1. Missing `DEEPSEEK_API_KEY` MUST NOT degrade to a warning.

#### Scenario: Valid configuration permits boot
- GIVEN all required settings are valid
- WHEN boot configuration is validated
- THEN boot MUST proceed to the database readiness check

#### Scenario: Missing or invalid configuration rejects boot
- GIVEN a required setting is missing or invalid
- WHEN boot configuration is validated
- THEN the daemon MUST report that setting and exit with code 1
- AND the schedule MUST NOT start

### Requirement: Database Readiness and Migration Prerequisite

The daemon MUST complete a `SELECT 1` readiness probe before scheduling. It MUST NOT apply migrations; migrations 001–009 SHALL remain an operator prerequisite.

#### Scenario: Ready database allows scheduling
- GIVEN valid configuration and applied migrations 001–009
- WHEN the readiness probe succeeds
- THEN the supervisor schedule MUST start

#### Scenario: Probe failure rejects boot
- GIVEN an unreachable or unusable database
- WHEN the readiness probe fails
- THEN the daemon MUST report boot failure and exit with code 1
- AND the schedule MUST NOT start

### Requirement: Non-Overlapping Production Schedule

The production schedule MUST allow at most one tick in flight. Shutdown MUST stop future ticks and await the active tick.

#### Scenario: Tick overlap is suppressed
- GIVEN one tick remains in flight
- WHEN another interval becomes due
- THEN a concurrent tick MUST NOT start

#### Scenario: Drain waits for active work
- GIVEN shutdown begins during an in-flight dispatch
- WHEN the schedule is stopped and drained
- THEN no new tick MUST start
- AND drain MUST await dispatch and checkpoint settlement

### Requirement: Process Signal Handling

The first `SIGTERM` or `SIGINT` MUST request graceful shutdown. A second termination signal during shutdown MUST force immediate termination without awaiting cleanup.

#### Scenario: First signal starts graceful shutdown
- GIVEN the daemon is running
- WHEN it receives its first `SIGTERM` or `SIGINT`
- THEN it MUST begin graceful shutdown exactly once

#### Scenario: Second signal forces termination
- GIVEN graceful shutdown is pending
- WHEN another `SIGTERM` or `SIGINT` arrives
- THEN the process MUST terminate without awaiting drain or closure

### Requirement: Ordered Graceful Shutdown

Graceful shutdown MUST order: stop scheduling, drain work, close the database pool, close the LLM client, then exit 0. Resources MUST close even without an active tick.

#### Scenario: In-flight dispatch is drained before closure
- GIVEN a dispatch is in flight when shutdown starts
- WHEN shutdown progresses
- THEN dispatch and checkpoint completion MUST precede resource closure
- AND database closure MUST precede LLM closure and exit 0

#### Scenario: Pool closure permits process exit
- GIVEN no work remains in flight
- WHEN graceful shutdown runs
- THEN the database pool and LLM client MUST close
- AND the process MUST exit 0 rather than remain alive

### Requirement: Non-Invasive Runtime Boundary

The capability MUST add no runtime dependency and MUST preserve `supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`, and dispatch sources byte-identically. It SHALL use existing schedule and activation contracts.

#### Scenario: Existing verified cores remain unchanged
- GIVEN the daemon capability is added
- WHEN protected sources and runtime dependencies are compared with their baseline
- THEN every protected source MUST be byte-identical
- AND no new runtime dependency MUST be present

### Requirement: Deterministic Lifecycle Verification

Lifecycle behavior MUST be verifiable through an injected fake schedule and injected hooks without real timers.

#### Scenario: Controlled lifecycle execution
- GIVEN a fake schedule and controlled lifecycle hooks
- WHEN boot, tick, signal, and shutdown paths are exercised
- THEN outcomes and ordering MUST be observable without elapsed wall-clock time
