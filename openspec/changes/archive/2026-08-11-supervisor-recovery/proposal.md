# Proposal: Supervisor Recovery

## Intent / Why

Post-claim crashes strand `in_progress` Work outside normal dispatch. This turns a tested non-guarantee into safe recovery of proven orphan attempts, reducing intervention and stuck work.

## Scope

### In Scope
- Durable `FileDocumentSandbox` undo snapshots: W1/W2/W3 require durable effect evidence.
- Operator-designated recovery on the existing supervisor tick, with direct resume.
- Token-matched W2 journal abort: `in_flight → aborted_retryable`.
- Revised non-guarantee/tests; normal dispatch excludes `in_progress` Work.

### Out of Scope / Non-goals
- Memory OS, learning/promotion, receipt crypto/signing, §13.3 SoD, `riskClass`, skill-outcome events, and daemon lifecycle.
- Crash-before-claim, post-T1 crashes, cohort/cache or LLM context, and multi-instance fencing.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sandbox-port`: durable undo evidence.
- `idempotency-journal`: W2 abort-to-retryable.
- `worker-cycle`: W1/W2/W3 reconciliation and escalation.
- `work-dispatch`: direct recovery resume and revised non-guarantee.
- `supervisor-timer`: recovery in sequential ticks.
- `io-persistence-recovery-contract`: orphan recovery matrix.

## Approach

**D1 — Cadence.** Piggyback on the sequential checkpointed tick: it reuses at-least-once delivery without another timer or lifecycle.

**D2 — Detection.** Use explicit operator designation, not age/lease/journal age/heartbeat. There is no credible liveness signal; grace can misclassify a slow live worker. Designation confirms it is stopped and avoids a clock-dependent business rule.

**D3 — Action.** Reconcile in place and resume without reclaiming, retaining the token. W1 resumes only with no journal/effect; W2 aborts retryably; W3 undoes the durable effect then retries. Missing evidence or failed undo escalates; re-execution requires durable non-execution proof.

**D4 — Idempotency.** At-least-once, re-runnable recovery uses the existing journal, never exactly-once. `aborted_retryable` is the retry boundary; abort never seals a key.

**D5 — Boundaries.** Recovery owns dispatch because heartbeat novelty cannot re-dispatch it. It touches no LLM context, preserving the pure cohort prefix and all dependency invariants.

## First Slice / Vertical

Deliver durable snapshots plus operator-designated W1: tick discovery, no-attempt/effect proof, retained-token resume, and restart-safe dispatch. Then W2/W3.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `packages/app/src/{supervisor,sandbox,worker}/` | Modified | Recovery, evidence, resume |
| `packages/database/` | Modified | Journal abort/retry |

## Key Risks & Open Questions

| Risk | Severity | Mitigation |
|---|---|---|
| Zombie writer | High | Operator designation; durable proof |
| Double execution | High | Durable undo log; otherwise escalate |
| Token drift | Medium-High | No reclaim |

No open product question; operator designation is the safety tradeoff.

## Rollback Plan

Disable recovery; retain normal dispatch and auditable records. Never auto-retry unresolved attempts.

## Dependencies

- No runtime dependencies; durable undo storage precedes activation.

## Success Criteria

- [ ] W1/W2/W3 recover safely or escalate honestly.
- [ ] No duplicate effect, token mint, or heartbeat dependency.
