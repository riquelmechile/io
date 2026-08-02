# Exploration: work-dispatch — supervisor `onActivate` triggers a real worker cycle

Status: EXPLORATION ONLY. No proposal, spec, design, or tasks. No source edits.

## Current State

### Supervisor (supervisor-timer, archived)
- `packages/app/src/supervisor/supervisor.ts` — `startSupervisor(deps, options)` → `tickAll` (sequential, no `Promise.all`) → `tickCompany`. Failures are logged + swallowed; at-least-once.
- `packages/app/src/supervisor/tick.ts` — `tickCompany`: `if (!companyId) throw` (ADR-0002) → read cursor → `evaluateHeartbeatGate({events}, companyId, cursor)` → read stream tail (`deps.events.listByCompany` + pure `tailCursor`) → `activate` ⇒ `await onActivate?.(companyId)` (side effect FIRST) → persist checkpoint LAST (R4-001 crash-safety order). `no-llm-heartbeat` ⇒ upsert directly. `tailCursor([]) === undefined` ⇒ no checkpoint row.
- `packages/app/src/supervisor/types.ts` — `OnActivate = (companyId) => void | Promise<void>` (injectable, MAY be a recorded no-op); `SupervisorDeps = { events: BusinessEventRepository; cursors: HeartbeatCursorStore }`; timer `Schedule` seam (tests inject a manual pump).
- `packages/app/src/composition/supervisor-deps.ts` — `buildSupervisorDeps(connection)` → pool-bound `PgBusinessEventRepository` + `PgHeartbeatCursorRepository`. SIBLING of `buildWorkerDeps`; never called by it; pool-bound only (no tx twin).
- The supervisor is NOT auto-started from any runner/CLI (packages/app/src has no index/entry point; `src/llm/` is an empty stub dir). `onActivate` today is a RECORDED NO-OP everywhere; `runWorker` has zero production callers (only tests/harness).

### Heartbeat gate (heartbeat + heartbeat-activation, archived)
- `packages/app/src/heartbeat/cycle.ts` — `evaluateHeartbeatGate(deps, companyId, cursor)` — THIN delegate over the read-only evaluator; accepts ONLY `{events}`, non-empty companyId, optional cursor; NEVER a workId (empty-stream first-work deadlock structurally impossible).
- `packages/app/src/heartbeat/evaluate.ts` — `evaluateHeartbeatForCompany` — one tenant-scoped `listByCompany`, zero writes, no LLM, no clock.
- `packages/business-domain/src/heartbeat.ts` — pure `evaluateHeartbeat(events, cursor)`; `MATERIAL_EVENT_TYPES = ['work.completed']`; `hasMaterialNovelty` is cursor-defined (never clock-defined); `tailCursor`.
- **Clarification on "worker-cycle branching"**: `runWorker` (worker/worker.ts) contains NO heartbeat branching — it is byte-identical to its archived baseline and always runs `prepareIntent` (the LLM step). The activate/no-llm-heartbeat branch lives ENTIRELY at the supervisor/dispatch layer: `activate` ⇒ run the full worker cycle (Flash), `no-llm-heartbeat` ⇒ do nothing expensive. That is exactly where the §2 cost saving materializes.

### Worker cycle (worker-cycle, archived)
- `packages/app/src/worker/worker.ts` — `runWorker(input, deps)`: `parseCommand` (requires `companyId`, `actor`, `workId`, `idempotencyKey`, `requestHash`) → resume-aware journal claim (`journal.lookup` BEFORE the CAS; own attempt ⇒ resume without re-claim; terminal Work ⇒ replay/DENY/UNRESOLVED via journal) → `startWork` CAS (`accepted → in_progress`) → `checkAuthority` (window/revoked/SoD) → `prepareIntent` (compileContext + LLM + `parseLlmPlan`; derives `attemptId = att:${companyId}:${idempotencyKey}` and `evidenceId = ev:${companyId}:${idempotencyKey}`) → `reconcilePreEffect` (journal insertInFlight BEFORE the effect; replay/DENY/recovery/proceed) → effect OUTSIDE any tx → `verifyEffect` → terminal close `finalizeInFlightWorkAtomically` (T1: CAS + one receipt + `journal.complete` + one `work.completed` event in ONE transaction; T2 honest reconciliation on CAS loss).
- `packages/app/src/worker/types.ts` — `WorkerDeps` (work, delegation, skills, events, receipts, journal, sandbox, llm, principals, now?, connection?, repositories?).
- `packages/app/src/worker/reconcile.ts` — `decidePreEffect` table: none→proceed; diff hash→DENY; completed+same→REPLAY; aborted_retryable+same→proceed (reopen keeps ORIGINAL attemptId); in_flight+same→recovery.
- `packages/app/src/worker/recover.ts` — `recoverInFlightWork` (durable-restart recovery, journal-anchored + durable undo log). Requires `SandboxPort & { snapshotUndoLog() }` — currently only `DurableSandboxFake` implements it; the shipped `FileDocumentSandbox` does NOT.
- `packages/business-domain/src/transitions.ts` — `WORK_TRANSITIONS`: `proposed → accepted → in_progress → completed → verified | rejected`; `canTransitionWork`; terminal states reject everything.

### Work repository (work-lifecycle, archived)
- `packages/business-domain/src/ports/repositories.ts` — `WorkRepository = { save, get(companyId, workId), updateIfVersion }`. **NO read port for "is there actionable work for this company?"** — nothing lists works by company/state; `get` requires a workId; the event log only records terminal `work.completed` facts (never proposed/accepted).
- `packages/database/src/work-adapter.ts` — `PgWorkRepository` over `DbConnection`; `save` insert-only; `get` scoped `WHERE company_id = $1 AND work_id = $2`; `updateIfVersion` atomic CAS `WHERE … AND version = $3`. Runtime row validation via `parseWorkRow` (D7).
- Schema: `work` (002) has indexes `idx_work_work_id`, `idx_work_delegation_id`; `uq_work_work_id` (004). **No `(company_id, state)` index** — the actionable-work query would full-scan per company.
- In-memory fake: `InMemoryWorkRepository` (business-domain/src/ports/fakes.ts:76) — map-backed, has save/get/updateIfVersion; parity with PG is enforced by the parity suite.

### Idempotency journal (idempotency-journal, archived)
- `packages/business-domain/src/ports/idempotency.ts` — `IdempotencyJournalPort = { lookup, insertInFlight, complete, markRetryable }`; `JournalClaimResult = {ok:true} | {ok:false, reason:'attempt-in-flight'}`; statuses `in_flight | completed | aborted_retryable`; UNIQUE(company_id, idempotency_key) + UNIQUE(attempt_id) (004); sentinel `UNRESOLVED_REQUIRES_HUMAN` handled via `isUnresolvedJournalResult`.
- `packages/database/src/idempotency-adapter.ts` — `PgIdempotencyJournalRepository`; `insertInFlight` reopens `aborted_retryable` rows via CONDITIONAL UPDATE (keeps original attemptId); `ON CONFLICT DO NOTHING` turns same-key races into typed `attempt-in-flight`.
- Key/hash are CALLER-SUPPLIED today: the harness passes literal `E2E_IDEMPOTENCY_KEY` / `E2E_REQUEST_HASH`. The worker derives only the ATTEMPT id (`attemptIdFor`) and EVIDENCE id from the caller's key. A supervisor-initiated dispatch is a NEW caller class that must derive key + hash deterministically.
- Atomicity is caller-enforced: `completeWorkAtomically` (database/src/complete-work-flow.ts) wraps the terminal close in ONE `DbConnection.transaction`.

### Seam boundaries / invariants (verified)
- `business-domain` has ZERO `@io/*` imports (structural boundary tests + inline purity comments).
- `openai` is confined to `packages/llm-client/src/deepseek-client.ts` (app-boundary.test.ts scans all src trees).
- `runWorker`, `heartbeat/cycle.ts`, `heartbeat/evaluate.ts` MUST stay byte-identical (worker-cycle + heartbeat specs; supervisor-timer "Non-Invasive Activation Seam").
- Cursor writes belong ONLY to the supervisor; the gate/evaluator stay read-only.
- New runtime deps: none required (`node:crypto` is a Node builtin, already used by test code; no package.json change).
- Every business-domain port method is tenant-scoped by a mandatory non-empty `companyId` (ADR-0002) and rejects empty before any store read.

## The Gap

`activate` today is a recorded no-op: the supervisor decides `activate` but nothing runs. This slice makes `onActivate` dispatch ONE real worker cycle for the activating company — picking actionable (`accepted`) Work, deriving a deterministic idempotency key + request hash so re-activation (at-least-once) replays rather than double-executes, and invoking the UNCHANGED `runWorker`. `no-llm-heartbeat` stays cheap (gate read + tail read + cursor upsert; no work query, no LLM).

Three open design questions, each resolved below: (1) the actionable-work read port, (2) the idempotency-key policy for supervisor-initiated cycles, (3) the dispatch wiring.

## Approaches

### Q1 — The "actionable work" read port

**Approach A1: Extend `WorkRepository` with an additive read (recommended).**
Add `listActionableByCompany(companyId): Promise<readonly Work[]>` to the port, backed by a declared domain constant `ACTIONABLE_WORK_STATES: readonly ['accepted']` (mirrors the `MATERIAL_EVENT_TYPES` / `isMaterialEvent` precedent in `heartbeat.ts`). PG: `SELECT … FROM work WHERE company_id = $1 AND state = ANY($2) ORDER BY id ASC` (insertion order — the established `listByCompany` pattern). Fake: filter the map. New migration `009` adds `CREATE INDEX IF NOT EXISTS idx_work_company_state ON work (company_id, state)`.
- Pros: additive (existing callers untouched); one port/fake/adapter — parity suite covers it for free; "actionable" is a declared domain constant, honest and extensible; company-scoped by construction (ADR-0002).
- Cons: `WorkRepository` gains a read method (it was transition-focused); "accepted-only" semantics are baked into the port (documented in the constant).
- Effort: Low-Medium.

**Approach A2: Dedicated query port** (e.g., `WorkQueryRepository` added to `SupervisorDeps` as a separate `workQuery` seam).
- Pros: keeps `WorkRepository` transition-focused; supervisor's read need is explicit in its dep surface.
- Cons: second adapter class + second fake + second export for ONE method; two "work stores" to keep in parity; more surface for no behavioral gain.
- Effort: Medium.

**Approach A3: Reuse existing surfaces.** `WorkRepository.get` requires a workId (supervisor has none); `BusinessEventRepository` records only terminal facts. Not viable without an extension — rejected.

Recommendation: **A1.** The read is additive, tenant-scoped, fake+PG parity-covered, and the actionable-state constant mirrors the established materiality pattern. `in_progress` is deliberately EXCLUDED (a claimed Work belongs to a worker; `runWorker`'s resume-aware claim + the `never hijack another worker's Work` invariant make supervisor-side re-picking of in_progress Work fail closed — see Risks/Edge cases).

### Q2 — Idempotency-key policy for supervisor-initiated cycles

**Approach B1: Deterministic per-work key + content hash (recommended).**
- Key: `dispatchIdempotencyKeyFor(companyId, workId) = 'wk:' + companyId + ':' + workId`. Deterministic across re-activations and restarts; company-scoped (ADR-0002); workId is globally unique (`uq_work_work_id`), so the key is collision-free even embedded with companyId.
- requestHash: `dispatchRequestHashFor(work) = sha256(canonical stable fields)` — e.g. `sha256(JSON.stringify({companyId, workId, delegationId, description}))`. STABLE across state transitions (transitions copy content; `updateIfVersion` rewrites the same description/deliverable values), so a re-activation of the same Work replays; content-bound so a genuinely different payload under the same key DENIES (defensive; structurally prevented by the key embedding workId).
- The worker derives `attemptId = att:${companyId}:${key}` and `evidenceId = ev:…` from our key via the EXISTING `attemptIdFor` — one attempt per key, receipt-traceable terminal_event_id, zero worker changes.
- `node:crypto` (builtin) — no new runtime dep.
- Pros: replay on re-activation is journal-guaranteed (same key + same hash ⇒ `decidePreEffect` REPLAY / completed-row replay); no double effect, no second receipt (`UNIQUE(work_id, terminal_event_id)`); deterministic (inverse-poison: same Work always same key/hash); no worker mutation.
- Cons: hash must be defined over the right stable field set (documented; transitions must not change it — verified: transitions only change `state`/`version`/`outcome`/`deliverable`/`evidenceRefs` accumulation, and the hash field set deliberately excludes those).
- Effort: Low.

**Approach B2: Key = per-company counter/sequence** (e.g., `wk:${companyId}:${n}` with n persisted).
- Pros: key per activation, not per work.
- Cons: requires a NEW durable counter store (cursor-like table) + read-modify-write; breaks the "same work ⇒ same key" replay property (a crash mid-cycle would advance the counter and LOSE the replay anchor); strictly worse. Rejected.

**Approach B3: No key policy — pass a random/static key.**
- Random ⇒ every re-activation is a new key ⇒ double-execution risk (violates at-least-once); static company-level key ⇒ different Work under one key ⇒ DENY storms. Rejected.

Recommendation: **B1.**

### Q3 — Dispatch wiring

**Approach C1: New `dispatch/` module + composition root; `onActivate` wired with a closure (recommended).**
- New `packages/app/src/dispatch/` with `keys.ts` (B1 derivations), `types.ts` (`DispatchDeps = { work: WorkRepository; worker: WorkerDeps; actor: string }`), `dispatch.ts` (`dispatchCompanyActivation(companyId, deps): Promise<DispatchResult>`):
  1. reject empty `companyId` before any read (ADR-0002);
  2. `const works = await deps.work.listActionableByCompany(companyId)`; none ⇒ return `{ ok: true, dispatched: false }` (zero LLM cost — the §2 saving on the no-work path);
  3. pick the FIRST (insertion order); derive key + hash;
  4. `await runWorker({ companyId, actor: deps.actor, workId, expectedVersion: work.version, idempotencyKey: key, requestHash: hash }, deps.worker)`;
  5. map a TYPED `{ok:false}` worker result to a settled `DispatchResult` (no throw — the activation is consumed, no hot retry loop); let THROWN errors (LlmError, DB failures) propagate — the tick leaves the cursor un-persisted ⇒ next tick re-activates (at-least-once).
- New `packages/app/src/composition/supervisor-dispatch.ts` — `buildSupervisorDispatch({ connection, llm, sandboxRoot, principals, now? })` ⇒ `{ deps: SupervisorDeps; onActivate: OnActivate }`, composing `buildWorkerDeps` (worker root) + `buildSupervisorDeps` (supervisor root) + the dispatch closure (actor = `principals.executor`, the harness precedent). BOTH existing roots stay untouched and sibling-only.
- Pros: `supervisor.ts`/`tick.ts`/`types.ts` byte-identical (onActivate is already the seam — its spec contract "MAY be a recorded no-op" still holds); `runWorker`/`cycle.ts`/`evaluate.ts` untouched; dispatch is a pure, unit-testable function over ports; failures compose with the existing at-least-once/R4-001 order; no new runtime deps.
- Cons: one new module + one new composition root (small, additive).
- Effort: Medium.

**Approach C2: Grow the supervisor** — add a `dispatch` seam to `SupervisorDeps` and call it from `tick.ts` on `activate`.
- Pros: dispatch is explicit inside the supervisor flow.
- Cons: mutates supervisor/tick/types (re-verify supervisor unit + integration suites); couples the supervisor module to worker concerns; contradicts the non-invasive-seam spirit and the byte-identity assertions; no behavioral gain over C1. Rejected.

**Approach C3: Branch inside `runWorker`** (skip prepareIntent/LLM on no-llm-heartbeat).
- Pros: would centralize the cost branch.
- Cons: FORBIDDEN — `runWorker` must stay byte-identical (worker-cycle spec "Work-Bearing Cycle Preservation"); the gate takes no workId by design; also the work-bearing path must always activate. Rejected.

Recommendation: **C1.** Scope for THIS slice: dispatch ONLY `accepted` Work via `runWorker` (one cycle per activation, oldest-first). Driving `recoverInFlightWork` for `in_progress`+attempt Work is a larger follow-up (see Risks — the shipped `FileDocumentSandbox` lacks the `snapshotUndoLog` seam that recovery requires).

## Edge Cases

1. **Re-activation replay** — same company/work re-picked (crash before cursor persist, Work still `accepted`): same key + same hash ⇒ `decidePreEffect` REPLAY (or a completed-row replay after a terminal close) ⇒ NO double effect, NO second receipt. This is the exact reason B1 exists.
2. **Crash-safety vs R4-001 order** — cursor persists only after `onActivate` (the whole cycle) returns. Crash pre-claim ⇒ Work still `accepted` ⇒ re-dispatch runs `runWorker` → clean claim. Crash post-claim (effect applied, journal `in_flight`, Work `in_progress`) ⇒ next activation finds NO actionable Work (in_progress excluded) ⇒ the Work is orphaned until the durable-restart recovery path (`recoverInFlightWork`) runs — which is NOT supervisor-driven this slice. **Documented gap** (Scope A); the honest guarantee this slice makes is: re-activation never double-executes and never double-receipts; resumption of crashed in-progress cycles is a worker-level concern surfaced in a follow-up (Scope B).
3. **Terminal vs in-progress** — the read port returns ONLY `accepted`; `completed`/`verified`/`rejected` are excluded (done), `in_progress` excluded (claimed — `runWorker` fails closed on in_progress-without-attempt via `startWork` invalid-transition; "never hijack another worker's Work").
4. **Empty company / no actionable work** — a discovered company (≥1 event) with zero `accepted` Work ⇒ dispatch no-ops ⇒ zero LLM cost. This plus `no-llm-heartbeat` is the full §2 saving.
5. **Empty stream** — `tailCursor([]) === undefined` ⇒ no checkpoint row (already handled defensively); companies with no events are not discoverable (`listCompanyIds` lists only companies WITH events).
6. **Settled vs transient failure policy** — typed worker failures (`invalid-plan`, `denied`, `recovery-required`, `invalid-transition`, `idempotency-conflict`) return a settled DispatchResult ⇒ cursor advances (no hot retry loop, no repeated LLM spend on a deterministically-failing Work). Thrown errors (LlmError network/timeout, DB errors) propagate ⇒ retryable. `invalid-plan` leaves Work `in_progress` + (usually) no journal row ⇒ orphan under Scope A (same gap as #2; the bounded-retry precedent in the live E2E is test-only).
7. **Multiple actionable Works** — one per activation, oldest-first; the next `work.completed` renews novelty ⇒ next activation consumes the next Work. Matches the one-cycle-per-activation cost model (the model is the expensive resource).
8. **Concurrent same-key races** — journal UNIQUE(company_id, idempotency_key) + CAS + `ON CONFLICT DO NOTHING` ⇒ typed `attempt-in-flight`, exactly-one-effect, even under duplicate activation (single-instance supervisor assumed; fencing out of scope per supervisor-timer).

## Affected Areas (files/ports/adapters that will change)

| File | Change |
|---|---|
| `packages/business-domain/src/ports/repositories.ts` | ADD `listActionableByCompany(companyId)` to `WorkRepository` (port, zero `@io/*`) |
| `packages/business-domain/src/transitions.ts` | ADD declared `ACTIONABLE_WORK_STATES: readonly ['accepted']` constant (mirrors `MATERIAL_EVENT_TYPES`) |
| `packages/business-domain/src/ports/fakes.ts` | `InMemoryWorkRepository.listActionableByCompany` (map filter, company-scoped) |
| `packages/database/src/work-adapter.ts` | `PgWorkRepository.listActionableByCompany` — `WHERE company_id = $1 AND state = ANY($2) ORDER BY id ASC` + `parseWorkRow` guard (D7) |
| `packages/database/sql/009_work_company_state_index.sql` | NEW migration: `CREATE INDEX IF NOT EXISTS idx_work_company_state ON work (company_id, state)` (idempotent, re-apply safe, per 001–008 pattern) |
| `packages/app/src/dispatch/keys.ts` | NEW: `dispatchIdempotencyKeyFor`, `dispatchRequestHashFor` (pure; `node:crypto`) |
| `packages/app/src/dispatch/dispatch.ts` | NEW: `dispatchCompanyActivation(companyId, deps)` (pick → key/hash → runWorker → typed result) |
| `packages/app/src/dispatch/types.ts` | NEW: `DispatchDeps`, `DispatchResult` |
| `packages/app/src/composition/supervisor-dispatch.ts` | NEW: `buildSupervisorDispatch` → `{ deps: SupervisorDeps; onActivate: OnActivate }` (composes both existing roots) |
| Tests | `business-domain/test` (transitions/use-cases/fakes parity), `database/test` (work-adapter unit + `sql-migrations.test.ts` 009 block + live-PG roundtrip), `app/test/dispatch/*` (unit w/ fakes + live-PG sequential integration), `app/test/composition/supervisor-dispatch.test.ts` |

**Deliberately UNTOUCHED:** `supervisor.ts` / `tick.ts` / `supervisor/types.ts` (byte-identical; onActivate seam suffices), `worker.ts` / `cycle.ts` / `evaluate.ts` / `worker/*` (byte-identical), `supervisor-deps.ts` / `worker-deps.ts` (existing roots), `heartbeat-cursor` store, `llm-client`, `context`, `package.json` (no new deps).

## Recommendation

- **Read port (A1):** additive `WorkRepository.listActionableByCompany(companyId)` returning `accepted` Work in insertion order, with `ACTIONABLE_WORK_STATES` as a declared domain constant and migration `009` adding the `(company_id, state)` index.
- **Key policy (B1):** `wk:${companyId}:${workId}` idempotency key + `sha256` of stable Work fields as requestHash — deterministic, content-bound, replay-safe, zero worker changes.
- **Dispatch wiring (C1):** new `dispatch/` module + `buildSupervisorDispatch` composition root wiring the existing `onActivate` seam to one worker cycle per activation; supervisor and worker sources stay byte-identical; typed failures settle (cursor advances), thrown errors retry (at-least-once).

This is the smallest honest slice that makes the §2 cost saving REAL: `activate` ⇒ exactly one dispatched worker cycle; `no-llm-heartbeat` ⇒ zero expensive work; re-activation ⇒ journal replay, never double-execution.

## Risks

- **Orphaned `in_progress` Work (highest):** any post-claim failure (crash mid-cycle, `invalid-plan`, LLM failure) leaves Work `in_progress` with a journal row that THIS slice's dispatch will never re-pick; the existing `recoverInFlightWork` (durable-restart recovery) exists but is not supervisor-driven and the shipped `FileDocumentSandbox` lacks the `snapshotUndoLog` seam it requires. Mitigate: document the gap + guarantee scope in the proposal; treat supervisor-driven recovery as the explicit follow-up slice (Scope B). Do NOT silently promise exactly-once or automatic crash resumption.
- **Hash stability:** `dispatchRequestHashFor` must exclude transition-mutated fields (`state`, `version`, `outcome`, `evidenceRefs` accumulation, `deliverable` mutation); a wrong field set would DENY legitimate re-activations. Mitigate: TDD a stability test across `accepted → in_progress → completed` transitions.
- **Ordering dependency:** one cycle per activation assumes a steady-state loop (completed#N ⇒ activate ⇒ next accepted Work); a company with many accepted Works and no completed event never activates (gate is `work.completed`-novelty driven, by design). Acceptable this slice; document it.
- **Hot-loop avoidance:** typed-failure settlement policy must be explicit in the spec, or a deterministically-failing Work re-runs the LLM every interval (cost + log noise).
- **Review budget:** new port + constant + adapter method + 2 modules + composition root + ~4 test files; forecast Low-Medium 400-line risk (well under the guard) unless Scope B (recovery driving) is added — keep it OUT of this slice.

## Ready for Proposal

Yes. The orchestrator should tell the user: exploration complete; proposal should scope dispatch to `accepted` Work only, adopt the `wk:` key + content-hash policy, keep supervisor/worker byte-identical via the `onActivate` seam + a new `dispatch/` module and `buildSupervisorDispatch` composition root, add migration 009, and explicitly document the orphaned-in_progress gap as a follow-up (Scope B). No source files were modified.
