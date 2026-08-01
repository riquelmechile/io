# sandbox-port Specification

## Purpose

The sandbox port is the reversible driven effect boundary for the worker: the
single seam through which a low-risk external effect is executed and, when needed,
reversed. It comprises a driven port, a reversible in-memory fake, and a reversible
shipped adapter, plus an undo log that is the source of truth for whether an effect
ran (consulted during reconciliation). The composition root (`packages/app`) owns
the driven port, mirroring how business-domain owns its repository ports. [ADR-0003] [INF]

## ADDED Requirements

### Requirement: Reversible Driven Port

The sandbox MUST expose a driven port where `execute(action)` returns an effect
record plus an undo handle, and `undo(handle)` reverses that effect. The port MUST
be an application-layer driven port owned by the composition root. [REQ]

#### Scenario: Execute returns an effect record and undo handle

- GIVEN a reversible sandbox action
- WHEN `execute(action)` is invoked
- THEN it MUST return an effect record and an undo handle

#### Scenario: Undo reverses the effect

- GIVEN an effect previously executed with a returned handle
- WHEN `undo(handle)` is invoked
- THEN the effect MUST be reversed to its prior state

### Requirement: Universal Reversibility and Undo Log

Every executed effect MUST be reversible. The port MUST record exactly one undo-log
entry per executed effect, and that undo log MUST be the source of truth for whether
an effect was applied. [INF]

#### Scenario: One undo entry per executed effect

- GIVEN an effect executed through the port
- WHEN the execution completes
- THEN exactly one undo-log entry MUST be recorded for it

#### Scenario: Undo log reflects applied state

- GIVEN a cycle whose effect may or may not have run
- WHEN the undo log is consulted during reconciliation
- THEN it MUST truthfully indicate whether the effect was applied

### Requirement: Reversible Fake and Reversible Adapter

The sandbox MUST ship a reversible in-memory fake (mirroring the undo log and the
durability semantics required by restart tests) AND a reversible adapter
implementing the shipped low-risk effect (e.g. write/append a file or create a
document) with a concrete inverse. [REQ]

#### Scenario: Fake executes and undoes in memory

- GIVEN the reversible in-memory fake
- WHEN an effect is executed and then undone
- THEN the in-memory state MUST return to its prior value

#### Scenario: Adapter executes and undoes the real low-risk effect

- GIVEN the shipped reversible adapter and a concrete low-risk action
- WHEN the action is executed and then undone
- THEN the real effect MUST be applied and then reversed by its concrete inverse

#### Scenario: Fake mirrors durability for restart tests

- GIVEN the fake used in a restart test
- WHEN a process restart is simulated
- THEN the undo log and effect state MUST survive consistently with the durable journal

### Requirement: No Effect Leak on Failure

A post-effect failure or a failed verification MUST reverse the effect. No executed
effect MAY leak when the cycle does not reach a successful terminal state. [REQ]

#### Scenario: Post-effect failure reverses the effect

- GIVEN an effect applied before the terminal transaction failed
- WHEN the cycle is reconciled
- THEN the effect MUST be undone and no leak MUST remain

#### Scenario: Failed verification reverses the effect

- GIVEN an effect applied but verification subsequently failed
- WHEN the worker responds to the failed verification
- THEN the effect MUST be undone

### Requirement: Composition-Root Boundary

The sandbox MUST live in `packages/app`. It MUST NOT re-export `business-domain` or
`trust-kernel` internals, and `openai` MUST NOT leak past `deepseek-client.ts`. [INF]

#### Scenario: Sandbox does not re-export domain or kernel internals

- GIVEN the sandbox modules in `packages/app`
- WHEN their public exports are inspected
- THEN they MUST NOT re-export `business-domain` or `trust-kernel` internals

#### Scenario: openai confined to deepseek-client.ts

- GIVEN the workspace dependency graph
- WHEN `openai` imports are inspected
- THEN `openai` MUST appear only within `deepseek-client.ts`
