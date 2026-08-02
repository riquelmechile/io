# Design: Work Dispatch

## Technical Approach

A1/B1/C1: additive `listActionableByCompany` + `ACTIONABLE_WORK_STATES`; deterministic content-bound keys; new `dispatch/` wired via existing `onActivate`. One oldest `accepted` Work per `activate`; empty/`no-llm-heartbeat` ⇒ zero LLM. Supervisor/worker cores byte-identical. Specs: `work-dispatch` (6) + `work-lifecycle` delta (1).

## Architecture Decisions

| Decision | Options | Choice + rationale |
|----------|---------|-------------------|
| Read port | A1 extend WorkRepository / A2 query port / A3 events | **A1** — additive, parity-covered; mirrors `MATERIAL_EVENT_TYPES` |
| Key/hash | B1 `wk:`+sha256 / B2 counter / B3 random | **B1** — same Work ⇒ replay; B2 loses anchor; B3 double-exec/DENY |
| Wiring | C1 dispatch+/buildSupervisorDispatch / C2 mutate tick / C3 branch runWorker | **C1** — uses `OnActivate`; C2/C3 break byte-identity |

## Data Flow / Tick Order (R4-001)

```
tickCompany
  ├─ cursor.get → evaluateHeartbeatGate → listByCompany → tailCursor
  ├─ activate? → await onActivate(companyId)          ← SIDE EFFECT FIRST
  │    └─ dispatchCompanyActivation
  │         ├─ reject empty companyId (before any read)
  │         ├─ listActionableByCompany (accepted, id ASC)
  │         ├─ none → {ok:true, dispatched:false}     (zero LLM)
  │         ├─ FIRST → key+hash → runWorker(...)
  │         │    ├─ {ok:false} typed → settle (NO throw)
  │         │    └─ thrown → PROPAGATE
  └─ tail? cursors.upsert(companyId, tail)            ← CHECKPOINT LAST
```

Thrown ⇒ cursor un-advanced ⇒ re-activate ⇒ journal replay (no double effect/receipt). Settled (ok, empty, typed fail) ⇒ cursor advances. `no-llm-heartbeat` skips `onActivate` (no read/worker/LLM).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `business-domain/.../transitions.ts` | Modify | `ACTIONABLE_WORK_STATES: readonly ['accepted']` |
| `business-domain/.../ports/repositories.ts` | Modify | `listActionableByCompany(companyId)` |
| `business-domain/.../ports/fakes.ts` | Modify | Map-filter; insertion order via Map iter |
| `business-domain/src/index.ts` | Modify | Re-export constant |
| `database/src/work-adapter.ts` | Modify | `WHERE company_id=$1 AND state=ANY($2) ORDER BY id ASC` + `parseWorkRow` |
| `database/sql/009_work_company_state_index.sql` | Create | `idx_work_company_state (company_id, state)` CONCURRENTLY IF NOT EXISTS (non-blocking; autocommit `execute()`, no tx) |
| `app/src/dispatch/{keys,types,dispatch}.ts` | Create | Keys/hash, deps/result, activation flow |
| `app/src/composition/supervisor-dispatch.ts` | Create | `buildSupervisorDispatch` |

**Byte-identical:** `supervisor.ts`, `tick.ts`, `supervisor/types.ts`, `worker.ts`, `cycle.ts`, `evaluate.ts`, `supervisor-deps.ts`, `worker-deps.ts`. Guarantee: NEW modules only; NEW root returns `{deps,onActivate}` for `startSupervisor`. Existing roots sibling-only, untouched.

## Interfaces / Contracts

```ts
// transitions.ts — mirrors MATERIAL_EVENT_TYPES
export const ACTIONABLE_WORK_STATES: readonly ['accepted'] = ['accepted'];

// WorkRepository additive
listActionableByCompany(companyId: string): Promise<readonly Work[]>;

// keys.ts — EXCLUDES state/version/outcome/deliverable/evidenceRefs
// (transitions copy content; only those mutate → hash transition-stable)
dispatchIdempotencyKeyFor(c,w) => `wk:${c}:${w}`
dispatchRequestHashFor(work) => createHash('sha256')
  .update(JSON.stringify({companyId,workId,delegationId,description}))
  .digest('hex')  // node:crypto builtin

// types.ts
DispatchDeps = { work: WorkRepository; worker: WorkerDeps; actor: string }
DispatchResult =
  | { ok:true; dispatched:false }
  | { ok:true; dispatched:true; workId:string; worker:WorkerResult }

// dispatch.ts
dispatchCompanyActivation(companyId, deps): Promise<DispatchResult>
// runWorker({companyId,actor,workId,expectedVersion:work.version,
//   idempotencyKey,requestHash}, deps.worker)
// attemptId via existing attemptIdFor — zero worker changes

// supervisor-dispatch.ts
buildSupervisorDispatch({connection,llm,sandboxRoot,principals,now?})
  => { deps: SupervisorDeps; onActivate: OnActivate }
// buildWorkerDeps + buildSupervisorDeps; actor = principals.executor
```

## Failure Classification (cursor)

| Outcome | Dispatch | Cursor | Notes |
|---------|----------|--------|-------|
| `{ok:true}` (effect/replayed) | settle dispatched | advances | UNIQUE blocks double receipt |
| Spec set: `invalid-plan`/`denied`/`recovery-required`/`invalid-transition`/`idempotency-conflict` | settle NO throw | advances | No hot LLM loop |
| Other `{ok:false}` (`not-found`,`cas-lost-retryable`,`attempt-in-flight`,`UNRESOLVED_…`,…) | settle NO throw | advances | Typed never throws |
| Thrown (net/timeout/LlmError/DB) | propagate | **un-advanced** | R4-001 retry |

**`invalid-plan` honesty:** Work stays `in_progress`, usually no journal row ⇒ Scope A orphan. Settle is correct (re-pick fails closed); recovery = Scope B.

## Scope B Boundary (OUT)

`recoverInFlightWork` needs `SandboxPort & {snapshotUndoLog()}` — only fakes implement it; shipped `FileDocumentSandbox` does not. Non-guarantee: post-claim failures MAY orphan `in_progress`; no exactly-once/auto-resume. Do not design recovery.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit keys | Determinism/scope/collision; hash stable across transitions | Pure + transition fixtures |
| Unit dispatch | Empty=zero LLM; oldest-first; settle vs throw | Fake WorkRepo + stub runWorker |
| Unit fake port | Filter/order/empty-id-before-read | InMemoryWorkRepository |
| PG | listActionable + migration 009 | Sequential live-PG (`--no-file-parallelism`); known parallelism flake |
| Parity | InMemory vs PG | Existing parity pattern |
| Composition | buildSupervisorDispatch wiring | Fakes / light integration |

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/executable-classification/process boundary.

## Migration / Rollout

`009` index only (CONCURRENTLY IF NOT EXISTS — non-blocking build, autocommit `execute()`, cannot run in a tx). No flag. Rollback: revert commits; `onActivate` → recorded no-op.

## Invariants

business-domain zero `@io/*`; `openai` only in `deepseek-client.ts`; no new runtime deps; company scope mandatory; cursor writes supervisor-only; gate/evaluator read-only unchanged.

## Open Questions

None.
