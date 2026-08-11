# Delta for work-dispatch

## ADDED Requirements

### Requirement: Designated Recovery Dispatch

`dispatchRecovery` MUST directly resume designated `in_progress` Work through the claimed-work cycle without listing actionable Work, re-claiming, minting a fencing token, or changing Work state first. It MUST reuse the deterministic dispatch key and request hash. Recovery MUST NOT add, remove, reorder, or otherwise alter LLM context or the cohort §7.2/§7.3 prefix. Expected recovery failures MUST be returned as typed values rather than thrown control flow. [REQ] [INF]

#### Scenario: Recovery resumes without re-claim
- GIVEN designated `in_progress` Work with retained token N
- WHEN recovery dispatch runs
- THEN it MUST execute the claimed-work cycle with N and MUST NOT claim or mint a token

#### Scenario: Recovery reuses dispatch identity
- GIVEN the same Work before claim and during recovery
- WHEN dispatch identity is derived
- THEN both key and request hash MUST be identical

#### Scenario: Recovery preserves LLM context
- GIVEN compiled context for the claimed Work
- WHEN recovery dispatch prepares intent
- THEN context bytes and cohort prefix MUST equal the normal claimed-work baseline

## MODIFIED Requirements

### Requirement: Crash-Recovery Non-Guarantee

This capability MUST NOT guarantee exactly-once execution or automatic crash resumption by normal activation dispatch. Normal actionable selection MUST continue to exclude `in_progress` Work. A separate supervisor-owned recovery path MAY resume only explicitly designated orphan Work after safe reconciliation; undesignated or unresolved Work MUST remain excluded. [REQ]
(Previously: Supervisor recovery was follow-up work because the production sandbox lacked durable undo snapshots.)

#### Scenario: Normal dispatch never auto-resumes an orphan
- GIVEN a post-claim failure leaves `in_progress` Work
- WHEN a later activation lists actionable Work
- THEN normal dispatch MUST exclude it and MUST NOT invoke recovery

#### Scenario: Supervisor recovery is a separate path
- GIVEN the orphan is explicitly designated and safely reconciled
- WHEN supervisor recovery dispatches it
- THEN it MAY resume without making `in_progress` actionable to normal dispatch
