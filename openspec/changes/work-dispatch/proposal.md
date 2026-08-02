# Proposal: Work Dispatch — supervisor `onActivate` runs a real worker cycle

## Intent

`supervisor-timer` decides `activate` vs `no-llm-heartbeat`, but `onActivate` is a RECORDED NO-OP — `activate` dispatches nothing, so the §2 cost saving is unrealized. This slice: on `activate`, dispatch one worker cycle for the company's actionable Work — LLM only on material novelty.

## Scope

### In Scope
- Additive read port `WorkRepository.listActionableByCompany(companyId)` returning `accepted` Work in insertion order; constant `ACTIONABLE_WORK_STATES: readonly ['accepted']` (mirrors `MATERIAL_EVENT_TYPES`); migration `009` adds `idx_work_company_state (company_id, state)`. `in_progress` EXCLUDED.
- Key policy: `dispatchIdempotencyKeyFor = 'wk:' + companyId + ':' + workId`; `dispatchRequestHashFor = sha256(stable fields)` — deterministic + content-bound (replay-safe); `node:crypto`, no new dep.
- New `packages/app/src/dispatch/` (`keys`, `types`, `dispatch`) + `buildSupervisorDispatch` composition root wiring the EXISTING `onActivate` seam to one `runWorker` cycle per activation (oldest-first).
- Guarantee: re-activation NEVER double-executes or double-receipts (journal replay). Typed failures settle the cursor (no hot loop); thrown errors propagate (at-least-once).

### Out of Scope
- Orphaned `in_progress` recovery — DOCUMENTED GAP, follow-up Scope B (`recoverInFlightWork` needs the `snapshotUndoLog` seam `FileDocumentSandbox` lacks). No exactly-once / crash-resumption promise.
- Memory OS, minions, learning/promotion (Increment 8), CEO, crypto receipts, Pro escalation, fencing tokens, daemon auto-start.

## Capabilities

### New Capabilities
- `work-dispatch`: supervisor-driven dispatch — actionable-work selection, deterministic key/hash policy, one cycle per activation, typed-failure settlement vs thrown-error retry, replay guarantee, Scope B gap.

### Modified Capabilities
- `work-lifecycle`: `WorkRepository` gains additive tenant-scoped `listActionableByCompany` read + `ACTIONABLE_WORK_STATES` constant.

`supervisor-timer`, `worker-cycle`, `idempotency-journal` NOT modified — byte-identical, no requirement changes.

## Approach

Adopt exploration A1/B1/C1: additive read port + actionable-states constant; content-bound deterministic keys so re-activation replays through the existing journal table; dispatch as a pure port function wired via the `onActivate` seam, composing `buildWorkerDeps` + `buildSupervisorDeps`.

## Affected Areas

| Area (under `packages/`) | Impact | Description |
|------|--------|-------------|
| `business-domain/src/{ports/repositories,ports/fakes,transitions}.ts` | Modified | `listActionableByCompany` port + fake + `ACTIONABLE_WORK_STATES` |
| `database/src/work-adapter.ts`, `database/sql/009_work_company_state_index.sql` | Modified/New | PG insertion-ordered read + `parseWorkRow`; `(company_id, state)` index |
| `app/src/dispatch/`, `app/src/composition/supervisor-dispatch.ts` | New | Keys/hash, dispatch flow, `buildSupervisorDispatch` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Orphaned `in_progress` Work (post-claim failure) | High (by design) | Documented gap; Scope B; no exactly-once promise |
| Hash field-set drift → spurious DENY | Med | TDD stability test across transitions |

## Rollback Plan

Revert the commit(s): drop `dispatch/`, `supervisor-dispatch.ts`, migration `009`, port/adapter/fake/constant additions; `onActivate` returns to a recorded no-op. Supervisor/worker untouched.

## Dependencies

- Archived: `supervisor-timer`, `worker-cycle`, `work-lifecycle`, `idempotency-journal`.

## Success Criteria

- [ ] `activate` dispatches one cycle for the oldest `accepted` Work; heartbeat/no-work paths cost zero LLM.
- [ ] Re-activation replays: no double effect, no second receipt.
- [ ] `supervisor.ts`/`tick.ts`/`worker.ts`/`cycle.ts`/`evaluate.ts` byte-identical; `pnpm check` green.
