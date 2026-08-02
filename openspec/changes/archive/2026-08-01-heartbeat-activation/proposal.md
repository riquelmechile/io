# Proposal: Heartbeat Activation — Worker-Boundary Gate

## Intent

Roadmap Rev 4 names "act on the heartbeat decision" (§13.2) as the next slice. The deterministic pre-gate filter is fully spec'd; nothing consumes its decision.

**Reachability caveat (read first).** The roadmap's literal branch — skip `prepareIntent`/`llm.complete` on `no-llm-heartbeat` — is a **deadlock, not implementable as stated**: the only material type (`work.completed`) is produced by the worker's OWN finalize T1, so a no-llm gate on a work-bearing cycle deadlocks the first work (fresh company → empty stream → no-llm → never claimed → never emits). No-llm only matters for **workless wake-ups**, producible only by a future supervisor/timer (none in `src`). **This slice ships gate + proofs; production savings arrive when the supervisor lands (deferred).**

## Scope

### In Scope
- New boundary gate `packages/app/src/heartbeat/cycle.ts`: takes ONLY `companyId` (+ `WorkerDeps.events`, optional cursor); returns the existing `HeartbeatDecision` via `evaluateHeartbeatForCompany`.
- `runWorker` byte-identical: work-bearing cycles always activate.
- Tests: boundary decision table, zero-mutation proofs, tenant isolation, live-PG integration extension.

### Out of Scope (deferred)
- Supervisor/timer producing workless wake-ups (the no-llm exit's only production consumer); cursor persistence (its concern).
- Pro escalation (§13.2/§13.3); Memory OS; learning/promotion; reconcile-before-intent reorder; branching `runWorker` to skip the LLM (deadlock); workless `runWorker` mode / relaxing the workId guard; timer/cadence.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `worker-cycle`: add a heartbeat-gate requirement — companyId-scoped boundary gate over the deterministic seam, read-only, no-llm emits nothing; work-bearing cycles unchanged. `heartbeat` is UNCHANGED (seam already compliant; this slice only adds a consumer — no delta).

## Approach

Approach 1 (exploration): worker-boundary gate over the read-only seam. The actionable Work IS the activation signal; the gate is the future supervisor's entry (`activate` → pick work → `runWorker`).

## Hard Invariants

- **Deadlock prevention:** gate takes ONLY `companyId`, never a workId — structurally blocking the empty-stream deadlock and future-supervisor trap.
- **Zero mutations on no-llm:** read-only (R6/R7); no claim, journal, receipt, event, or LLM.
- **No self-activation:** no-llm MUST NOT emit `work.completed` (sole material type).
- **Terminal close intact:** finalize T1 (CAS + receipt + journal.complete + work.completed) unchanged; idempotency holds; `runWorker` byte-identical.
- **Boundaries:** pure filter output; no new deps; `openai` confined to `llm-client`; `business-domain` zero `@io/*`; compiler untouched; no capital/secrets surface (doc principle 1).

## Affected Areas

- `packages/app/src/heartbeat/cycle.ts` — New: boundary gate (~25–35 lines).
- `packages/app/test/heartbeat/cycle.test.ts` — New: decision table + zero-mutation proofs (~60–90).
- `packages/app/test/heartbeat/heartbeat.integration.test.ts` — Modified: gate returns `activate` post-cycle (~15–25).
- `packages/app/src/worker/worker.ts` — Unchanged (byte-identical).

~100–150 authored lines → **single PR** (under the 400-line budget).

## Risks

- **Deadlock trap on future supervisor** (Med): companyId-only signature; spec encodes work = signal.
- **Unreachable in production** (High): documented caveat; plumbing + proofs only.
- **Self-activation loop** (Low): zero-mutation proofs; no-llm emits nothing.

## Rollback Plan

Revert the single PR: delete `cycle.ts` + `cycle.test.ts`, restore the integration test. Nothing else is touched — side-effect-free.

## Dependencies

None beyond the existing compliant seam.

## Success Criteria

- [ ] Decision table: empty stream → no-llm; unseen `work.completed` → activate; seen cursor → no-llm.
- [ ] Zero mutations both paths (no append; `FakeLlmClient.requests.length === 0`).
- [ ] Live-PG: gate returns `activate` after a full `runWorker` cycle.
- [ ] `pnpm test` (sequential PG) + `pnpm check` green vs ~968-test baseline.
