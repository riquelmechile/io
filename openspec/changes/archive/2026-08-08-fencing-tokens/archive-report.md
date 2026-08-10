# Archive Report: fencing-tokens

## Change Summary

Implemented zombie-writer protection via monotonic fencing tokens: mint at Work claim CAS, thread through journal `insertInFlight`/`markRetryable`, check at claim-owned terminal close. Five stacked commits delivered via stacked-to-main chain, fully verified PASS — 7/7 requirements, 36/36 scenarios, 0 blockers, 0 critical. Fixed the pre-existing live-PG race flake (`insertInFlight` targeted `ON CONFLICT` not arbitrating `UNIQUE(attempt_id)`). Zero new runtime dependencies, one additive migration (DEFAULT 0 columns inert at epoch).

**Change name**: `fencing-tokens`
**Date archived**: 2026-08-08
**Branch**: main
**Verify verdict**: **PASS** — 7/7 requirements, 36/36 scenarios, 0 critical, 0 blockers

## Intent & Scope

Ship a monotonic fencing token (`fencingToken`) on Work and idempotency journal rows. The token is minted server-side within the claim CAS (`fencing_token + 1 … RETURNING`), stored on journal entry insert, checked at claim-owned terminal close (`AND fencing_token = $N`), and gated on `markRetryable`. Replay stays token-free; resume retains the same token; only a fresh claim bumps it. Honest T2(ii) stale-holder UNRESOLVED close stays reachable via `complete`'s status guard. Migration 010 is additive, `DEFAULT 0` = pre-fencing epoch.

### In Scope
- Migration 010: `work.fencing_token` + `idempotency_journal.fencing_token` (additive, idempotent, DEFAULT 0)
- Claim CAS mints N+1; terminal-close CAS checks; `Work.fencingToken` in types, row-guards, fakes
- Journal: `insertInFlight` stores token; `markRetryable` token-gated; `complete` status-guarded (non-in_flight reject)
- Worker threads token claim → finalize/reconcile; byte-identity re-pins
- Delta specs: `work-lifecycle`, `worker-cycle`, `idempotency-journal`

### Out of Scope
- `recoverInFlightWork` supervisor wiring (recovery Scope B)
- §13.3 authority-tier SoD, riskClass producer, skill outcome events, Memory OS
- `business-event`/`supervisor-timer` deltas, heartbeat-cursor fencing, KV-cache/prefix changes

## Slices & Commits

Delivery was re-sliced into five reviewable stacked commits after the provider lens-context budget rejected the monolithic candidates. Every commit passed native RDD review (4R lenses on high-risk candidates, 1 lens on medium). Maintainer-approved `size:exception` for both slices (session review budget 800; actual Slice 1 ~1307 lines, Slice 2 ~1400 lines — test-dominant port-signature ripple).

| Slice | Commit | Description |
|-------|--------|-------------|
| PR1 (migration) | `b83b5ec` | `feat(database): add fencing_token columns to work and idempotency_journal` — migration 010, additive/idempotent, DEFAULT 0 |
| PR2 (domain types) | `2725346` | `feat(business-domain): add Work.fencingToken, FencingDirective, CasResult` — types, ports, fakes, row-guards, validation |
| PR3 (use-cases) | `58ceb06` | `feat(business-domain): thread FencingDirective through start-work, complete-work` — applyWorkTransition directive, terminal CAS |
| PR4 (PG adapters) | `2bd67cd` | `feat(database): PG work-adapter claim-mint/check, idempotency-adapter token store/gate` — SQL pins, RETURNING, status guard |
| PR5 (app threading) | `03532b7` | `feat(app): thread fencingToken through worker claim→finalize→reconcile` — finalize CAS, reconcile markRetryable, byte-identity re-pin |

All five commits reviewed via native RDD, pushed to `origin/main` (`03532b7`).

## Capabilities Modified

### `work-lifecycle` — MODIFIED (2 requirements)

- **Work Execution Fields** — MODIFIED: adds `fencingToken` (init 0, valid pre-fencing epoch); business-domain MUST retain zero `@io/*` imports. Three scenarios preserved.
- **Optimistic Concurrency via Compare-And-Swap** — MODIFIED: claim transition mints token server-side within CAS; terminal-close CAS checks version AND fencing token; typed `fencing-conflict`; fake/PG parity. Replaced 3 scenarios → 6 scenarios.

### `worker-cycle` — MODIFIED (3 requirements)

- **Single-Winner Claim via Compare-And-Swap** — MODIFIED: winner mints/returns next server-side fencing token; losers receive `version-conflict` without executing effect; resume retains token; token absent from compiled bytes. Added same-token resume scenario.
- **Atomic Terminal Close** — MODIFIED: token-checked Work CAS; stale token rolls back every terminal mutation atomically; replay token-free. Added stale-token rollback scenario.
- **Journal-Anchored Reconciliation** — MODIFIED: CAS loss calls token-gated `markRetryable` with retained token; irreconcilable state completes as `UNRESOLVED_REQUIRES_HUMAN` without token ownership. Added stale reconciliation token rejection scenario.

### `idempotency-journal` — MODIFIED (2 requirements)

- **Journal Status Domain and Pre-Effect Lookup Decision Table** — MODIFIED: `insertInFlight` stores claim fencing token; `complete` transitions only `in_flight` (rejects other statuses without mutation, no token required); lookup resolves absent/fresh, matching-completed/token-free REPLAY, mismatching-completed DENY, in-flight attempt-in-flight; existing rows default to token 0. Added status guard, completion reject, pre-fencing row scenarios.
- **Retryable Marker on Finalize CAS Loss** — MODIFIED: `markRetryable` changes `in_flight` to `aborted_retryable` ONLY when supplied token equals stored token; stale token rejected; controlled retry retains same token without re-claim. Added stale token rejection, fake/PG parity, controlled retry scenarios.

## Verify Result

| Metric | Result |
|--------|--------|
| Requirements compliant | 7/7 |
| Scenarios compliant | 36/36 |
| Blockers | 0 |
| Critical | 0 |
| Full suite | **1243 passed / 6 skipped** (1249 total) |
| Build gate (`pnpm check`) | **Green** — format, typecheck, build, lint all passed |
| Live PostgreSQL | **2 files / 50 tests passed sequential** (incl. race hammer 25/25, 0 throws) |
| Output sha256 | `44091f800d46ea11363afcbf89e87822c75eb727bf8ec4b3bc0d4d536279f0a2` |
| Evidence revision | `03532b78c42973547142f776be0ce78f49b24e18` |

## Specs Synced

Three MODIFIED delta specs merged into canonical capability specs:

| Domain | Action | Requirements Modified | Scenarios Replaced | Scenarios New |
|--------|--------|----------------------|-------------------|---------------|
| `work-lifecycle` | Updated | 2 | 6 | +3 (CAS: 3→6) |
| `worker-cycle` | Updated | 3 | 13 | +1 (claim: 2→3, close: 4→5, reconcile: 4→5) |
| `idempotency-journal` | Updated | 2 | 14 | +6 (lookup: 5→8, marker: 3→6) |

Synced paths:
- `openspec/specs/work-lifecycle/spec.md`
- `openspec/specs/worker-cycle/spec.md`
- `openspec/specs/idempotency-journal/spec.md`

## Key Decisions

1. **Server-side token increment + RETURNING** — Atomic under row lock, race-free. Uses `query()` (not `execute()`) to read the returned BIGINT. Refuted R4-001 concern (BIGINT decodes as string) with read-only refuter showing `pg-connection.ts:26-43` pool-level OID 20 → Number parser; live-PG numeric assertions confirm.

2. **FencingDirective as optional parameter** — `updateIfVersion(work, ver, fencing?)` evolves the existing CAS method. Absent ⇒ version-only (plain transitions unchanged). One method surface vs. tripled alternative.

3. **Distinct `'fencing-conflict'` reason** — Diagnoses zombie-writer vs. ordinary race. Both route to T2 reconcile identically.

4. **Claim-owned terminal CAS only** — Plain admin transitions stay version-only (token 0 = epoch). Directive supplied by worker finalize + idempotent `completeWork`.

5. **Five stacked commits after monolithic rejection** — Original two-slice plan (<400 each) rejected by provider lens-context budget. Re-sliced into five reviewable units; four commits exceed 400 changed lines (size:exception approved). Test-dominant ripple from port-signature changes drove the line counts.

6. **No-target ON CONFLICT DO NOTHING fixes race flake** — The pre-existing `insertInFlight` targeted `ON CONFLICT (attempt_id)` which did not arbitrate `UNIQUE(attempt_id)`. Deterministic `RaceArbitratingConnection` double + 45/45 and 25/25 live hammers prove fix.

## Risks & Deferred Items

### Known Transient Flakes
1. **Live-LLM `invalid-plan` flake** — Not introduced by this change; inherited from worker-cycle live E2E. Bounded retry (max 2 attempts) handles it. No impact on fencing behavior.

### Review Budget Deviations (approved by maintainer)
2. **Four of five commits exceed 400 changed-line budget** — Committed sizes: 412, 630, 320, 871, 647. Caused by test-dominant port-signature ripple (every affected file needs adapter SQL pins, fake parity, worker integration tests). Runtime/spec behavior unaffected; design's `<400` promise was not met. Size:exception approved by maintainer (session review budget 800; actual Slice 1 ~1307, Slice 2 ~1400).

### Historical TDD Process Warnings
3. **Three task-level REDs were non-demonstrative** — Tasks 1.6, 2.6, and 2.7 did not independently demonstrate behavioral RED because earlier tasks had already landed the behavior. Tests are substantive and pass now; process evidence is partially vacuous. Non-blocking.

### Lint Warnings (pre-existing pattern)
4. **Nine Biome warnings remain in tests** — Six non-null assertions in `app/test/parity.test.ts`, one unused type import in `worker-reconcile.test.ts`, two unused transaction parameters in the live race hammer. Pre-existing pattern in test code; not runtime failures. Low-priority cleanup.

### R4-001 False Positive + Correction Story
5. **R4-001 (resilience CRITICAL) claimed BIGINT tokens would decode as strings** — REFUTED by read-only refuter: `pg-connection.ts:26-43` shows pool-level OID 20 → Number parser; live-PG numeric assertions confirmed. The bounded correction added defense-in-depth: a fail-loud numeric guard on the claim-mint `RETURNING` boundary in `work-adapter.ts` + sabotage test in `business-adapters.test.ts`. This is a lesson in review rigor — the CRITICAL finding was incorrect but the defense-in-depth addition was valuable.

### Dormant Features
6. **riskClass producer still absent** — By design. Pro escalation (§13.2) is dormant until a risk-signal producer exists. Cost-safe; default remains flash. A follow-up change should introduce the producer.
7. **§13.3 SoD pending** — Authority-tier separation of duties remains deferred. Not blocked by fencing tokens.

## Purity & Invariants Preserved

- All nine protected core sources byte-identical to baseline (`cycle.ts`, `evaluate.ts`, `supervisor.ts`, gate body, `authority.ts`, context-compiler, migrations, `llm-client` port/adapters).
- Zero new runtime dependencies in any package manifest.
- `business-domain` isolation intact (zero `@io/*` imports).
- `openai` ownership boundary unchanged (confined to `packages/llm-client/src/deepseek-client.ts`).
- Context dependency boundary intact (`packages/context` deps = `@io/business-domain` only).
- Token absent from compiled-context source (`packages/context/src` scan: zero `fencingToken`/`fencing_token` matches).
- Dispatch/tick/supervisor/intent/heartbeat source unchanged since `ce0fe4e`.
- Both tiers share the same stable context prefix (KV-cache intact).
- Conventional commits used throughout, no AI attribution.

---

*Archive report written: 2026-08-08. The SDD cycle for `fencing-tokens` is complete.*
