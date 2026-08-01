# Archive Report: first-enterprise-vertical

## Change Summary

Assembled the first enterprise vertical on top of the archived harden foundation, introducing three new capabilities — a worker cycle with CAS-based claim and journal-anchored reconciliation, a reversible sandbox port for low-risk external effects, and an idempotency journal with durable retryable marker for finalize CAS-loss recovery. The change delivered 18 requirements across 47 scenarios, implemented as three stacked slices (A→B→C), verified PASS against live PostgreSQL 18.4.

**Change name**: `first-enterprise-vertical`
**Date archived**: 2026-08-01
**Branch**: `main` at `d022616`
**Verify verdict**: **PASS**

## Intent & Scope

Build the first complete enterprise vertical end-to-end: claim work via CAS, validate authority at action time, record intent before effect, execute the effect outside the terminal transaction, reconcile post-effect failures via journal + undo log, verify with SoD, and close atomically — all while preserving the harden foundation invariants (CAS, SoD, single receipt). The change also introduced a reversible sandbox port (`packages/app/src/sandbox/`) and extended the idempotency journal with a durable `aborted_retryable` marker for CAS-loss recovery without idempotency-key brick.

## Slices & Commits

| Slice | Commit | Description |
|-------|--------|-------------|
| A | `eaf6161` | Journal `aborted_retryable` marker + reversible SandboxPort + `@io/app` shell |
| B | `1e1b0da` | Worker core + finalize twin + resume-aware claim |
| C | `d022616` | E2E vs live PG + intrinsic finalize atomicity + CI guard |

Planning commit: `e386458`.

## Foundation-Parity Decision (User-Owned)

The finalize CAS-loss "idempotency-key brick" was closed with a **durable retryable journal marker** (`aborted_retryable`) rather than fail-closed UNRESOLVED or documenting the divergence. This is a domain change to the archived harden foundation: a retried request after CAS loss gets a controlled retry window instead of being permanently blocked. The user explicitly chose this over alternatives (fail-closed UNRESOLVED, documented divergence). The marker is consistent with the persistence-recovery contract — neither a completed marker nor an orphan pending state.

## Corrections Integrated During Apply

All three corrections were caught by adversarial review and tested before merge:

1. **Resume-aware claim (BLOCKER)** — A retry of an `in_progress` Work died at `startWork` with `invalid-transition`, bricking the key. Fixed by consulting the journal before the CAS claim so the cycle's own `in_flight`/`aborted_retryable` Work resumes without re-claiming.

2. **Terminal-resume double-receipt guard (WARNING)** — The resume branch could re-apply an effect and issue a second receipt for a terminal Work. Fixed by routing terminal Works to honest replay/DENY/UNRESOLVED plus a finalize T1 state guard.

3. **Finalize T1 real atomicity (BLOCKER)** — T1 ignored the tx-scoped connection and ran pool-bound adapters in autocommit (atomic only behind a test decorator). Fixed with a tx-scoped repository factory mirroring `completeWorkAtomically`; the `TxRoutingConnection` decorator retired.

## Verify Result

| Metric | Result |
|--------|--------|
| Requirements compliant | 18/18 |
| Scenarios compliant | 47/47 |
| Worker-cycle scenarios | 10/23 |
| Sandbox-port scenarios | 5/11 |
| Idempotency-journal scenarios | 3/13 |
| Blockers | 0 |
| Critical | 0 |
| Warning | 0 |
| Suggestion | 0 |
| Full suite | **757 passed / 3 skipped** |
| E2E vs live PG 18.4 | **9/9, 0 skips** |

Skipped tests (3 pre-existing): 2 DeepSeek external-API + 1 local CI guard. None are integration tests.

## Specs Synced

Three NEW delta specs promoted to canonical capability specs:

| Domain | Action | Requirements | Scenarios |
|--------|--------|--------------|-----------|
| `worker-cycle` | Created | 10 | 23 |
| `sandbox-port` | Created | 5 | 11 |
| `idempotency-journal` | Created | 3 | 13 |

Synced paths:
- `openspec/specs/worker-cycle/spec.md`
- `openspec/specs/sandbox-port/spec.md`
- `openspec/specs/idempotency-journal/spec.md`

## Purity & Invariants Preserved

- The harden foundation (CAS, SoD, business receipts, runtime guards) was assembled but NOT modified.
- Reconciliation is journal-anchored: idempotency journal = source of truth for attempt state; sandbox undo log = source of truth for whether the effect ran (§9.8).
- External effect and durable bookkeeping never share one transaction.
- Single-winner CAS claim prevents duplicate execution.
- Exactly one receipt per `(work_id, terminal_event_id)` enforced by UNIQUE constraint.
- Composition-root boundary: sandbox lives in `packages/app`, does not re-export `business-domain` or `trust-kernel` internals; `openai` confined to `deepseek-client.ts`.

## Delivery Honesty

This repo has no native review gate (`gentle-ai review-integration/v2` returns `not_applicable`). Each slice received independent adversarial review via a general read-only agent:

- **Slice A**: CLEAN
- **Slice B**: BLOCKER found → fixed → re-reviewed CLEAN
- **Slice C**: CLEAN

Verification PASSED (see above). Delivery evidence: adversarial-review-per-slice + verify PASS. No native receipt fabricated.

## Deferred Follow-Ups

### Code Cleanup
1. **Delete dead `TxRoutingConnection` code** in `packages/app/test/e2e/harness.ts` — retired decorator, never instantiated in production wiring. Pure dead code removal.

### Observations to Monitor
2. **Unit repository-factory footgun** — when overriding `work` ⇒ must override `repositories`. Documented and handled at every call site today; keep an eye on this as the app grows.

3. **Crash-before-effect recovery gap** — via `runWorker`, recovery ends at `recovery-required`. The orchestration that continues/clears the `in_flight` row is a future step. B9 durable restart is the reconciliation anchor.

### Hardens from Previous Archive (Still Open)
4. **Journal `result_json` replay row-guard** — remains open from the harden archive.
5. **Typed same-key race loser** — remains open from the harden archive.
6. **Journal transaction-boundary doc** — remains open from the harden archive.

### Production Readiness
7. **Production composition root** — when the app runs for real, wire the repository factory with PG adapters (as the E2E harness does) so finalize T1 stays atomic. Currently only wired in the E2E harness.

---

*Archive report written: 2026-08-01. The SDD cycle for `first-enterprise-vertical` is complete.*
