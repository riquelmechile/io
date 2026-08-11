# Delta for sandbox-port

## MODIFIED Requirements

### Requirement: Universal Reversibility and Undo Log

Every executed effect MUST be reversible. `SandboxPort` MUST expose `snapshotUndoLog()` returning the currently applied effect records, and MUST record exactly one undo-log entry per executed effect. The shipped production adapter MUST persist that evidence so it survives a process restart and can truthfully distinguish applied from unapplied effects. Physical-media durability across OS or hardware failure is a non-goal; this capability requires process-restart durability only. [REQ] [INF]
(Previously: The undo log was the applied-effect source of truth, but the port did not expose snapshots and the production log did not survive restart.)

#### Scenario: One undo entry per executed effect
- GIVEN an effect executed through the port
- WHEN the execution completes
- THEN exactly one undo-log entry MUST be recorded for it

#### Scenario: Undo log reflects applied state
- GIVEN a cycle whose effect may or may not have run
- WHEN the undo log is consulted during reconciliation
- THEN it MUST truthfully indicate whether the effect was applied

#### Scenario: Execute persists recovery evidence
- GIVEN the shipped production adapter
- WHEN `execute(action)` succeeds
- THEN its undo-log entry MUST be persisted before success is reported

#### Scenario: Restart reconstructs the undo log
- GIVEN persisted undo entries from a prior process
- WHEN a new production adapter instance opens the same effect store
- THEN it MUST reconstruct those entries for recovery

#### Scenario: Snapshot returns applied entries
- GIVEN applied and subsequently undone effects
- WHEN `snapshotUndoLog()` is called
- THEN it MUST return the currently applied entries and exclude undone entries
