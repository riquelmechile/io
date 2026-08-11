# Exploration: Supervisor-Directed Recovery of Orphaned `in_progress` Work (Scope B)

> Phase: EXPLORE — this document maps the current state and surfaces decision options. It does NOT decide.
> Change name: `supervisor-recovery`. Roadmap: "Recovery dirigido por supervisor (Scope B)" (`recoverInFlightWork` para Work `in_progress` huérfano post-claim) — `docs/PASOS_SIGUIENTES_INCREMENTO_4.md:396,406,443,479`.

## Current State (architecture map)

### 1. Work lifecycle and state machine

- **State machine** — `packages/business-domain/src/transitions.ts:20-27`: `WORK_TRANSITIONS` is
  `proposed → [accepted, rejected]`, `accepted → [in_progress]`, `in_progress → [completed]`,
  `completed → [verified, rejected]`, `verified/rejected → []`. **`in_progress` has EXACTLY ONE legal
  outgoing edge: `completed`.** There is NO `in_progress → accepted` (re-queue) and NO
  `in_progress → rejected` (abort) edge today. Any recovery that moves orphaned Work out of
  `in_progress` requires a state-machine expansion (spec delta to `work-lifecycle` "Work State Machine").
- **Claim** — `packages/business-domain/src/use-cases/start-work.ts:13-18`: `startWork` =
  `applyWorkTransition('in_progress', cmd, work, undefined, { kind: 'claim' })`. `applyWorkTransition`
  (`packages/business-domain/src/use-cases/result.ts:111-136`) guards with `canTransitionWork`, checks
  `expectedVersion`, then CAS. Transition use cases: `accept-work.ts`, `reject-work.ts`,
  `verify-work.ts`, `complete-work.ts` (`:43`).
- **Work shape** — `packages/business-domain/src/types.ts:45-51,67-79`: `WorkState` =
  `proposed | accepted | in_progress | completed | verified | rejected`; `Work` carries `version`
  (init 1) and `fencingToken` (init 0, the pre-fencing epoch).
- **Work row** — `packages/database/sql/002_create_business_tables.sql`: `work` table has
  `created_at` ONLY — **no `updated_at`, no `claimed_at`, no lease/heartbeat/last-seen column**
  (verified: zero matches for `claimed_at|lease|heartbeat_at|last_seen|expires` across all migrations).
  Migration 003 adds `company_id` + `version`; migration 010 adds `fencing_token`.

### 2. Claim CAS + fencing token (zombie-writer protection)

- **`claimWithFencing`** — `packages/database/src/work-adapter.ts:159-196`: the claim is a single
  atomic `UPDATE work SET … version=version+1, fencing_token=fencing_token+1 WHERE work_id=$1 AND
  company_id=$2 AND version=$3 RETURNING fencing_token`. Winner mints the next monotonic token in the
  same statement (epoch 0 → 1 on first claim); losers get `version-conflict` and never mint.
- **`terminalWithFencing`** — `packages/database/src/work-adapter.ts:198+`: the terminal close CAS
  adds `AND fencing_token = $N`; a stale token yields a typed `fencing-conflict` and no terminal
  mutation persists (zombie writer rejected).
- **`FencingDirective`** — `packages/business-domain/src/ports/repositories.ts:63-65`:
  `{ kind: 'claim' } | { kind: 'terminal'; expectedFencingToken }`. There is no third directive;
  `updateIfVersion` (`work-adapter.ts:110-125`) dispatches claim/terminal/plain.
- **Journal token store** — `packages/database/src/idempotency-adapter.ts:140-152`: the claim token
  rides into the pre-effect `insertInFlight` INSERT (`$6`), making the journal row the
  claim-ownership record. **The reopen path (`idempotency-adapter.ts:102-120`, conditional UPDATE
  `status='aborted_retryable'` → `in_flight`) does NOT rewrite `fencing_token`** — the journal row
  keeps the ORIGINAL claim's token. This is benign today (resume never re-mints) but becomes a
  **token-drift hazard** if recovery re-claims from `accepted` (see Risks).
- **`markRetryable` claim-ownership gate** — `idempotency-adapter.ts:184-202`:
  `UPDATE … SET status='aborted_retryable' WHERE attempt_id=$1 AND status='in_flight' AND fencing_token=$5`
  — a stale token matches 0 rows and is rejected without mutation. This is the gate a zombie writer
  cannot pass, and the gate recovery MUST present the *retained stored token* through.
- **`complete` status guard, token-free** — `idempotency-adapter.ts:159-182`: only an `in_flight`
  row → `completed`; token-free so the honest T2(ii) stale-holder `UNRESOLVED_REQUIRES_HUMAN` close
  stays reachable.
- Migration: `packages/database/sql/010_fencing_tokens.sql`. The fencing-tokens archive explicitly
  pre-declared Scope B readiness: *"a recovery re-claim bumps the token, old tokens go stale"*
  (`openspec/changes/archive/2026-08-08-fencing-tokens/exploration.md:39`) and listed the supervisor
  wiring as OUT: *"`recoverInFlightWork` supervisor wiring (Scope B recovery — the READ-REPAIR half)"*
  (`…/archive-report.md:24`).

### 3. Supervisor (tick ordering, cursor, at-least-once)

- **`startSupervisor` / `tickAll`** — `packages/app/src/supervisor/supervisor.ts:37-68`: every
  interval, `deps.events.listCompanyIds()` → sequential per-company `tickCompany` (no `Promise.all`).
  Failures are logged/swallowed; the next interval re-evaluates from the un-advanced cursor.
- **`tickCompany`** — `packages/app/src/supervisor/tick.ts:30-45`: order is cursor read → gate →
  stream tail → `appendIfAbsent(heartbeat.decision)` → **`await onActivate(companyId, model)` FIRST**
  → **`cursors.upsert` LAST**. A throw in `onActivate` leaves the cursor unadvanced → at-least-once
  re-invocation next tick. `no-llm-heartbeat` skips `onActivate` and checkpoints directly.
- **`SupervisorDeps`** — `packages/app/src/supervisor/types.ts:14-17`: **only** `events` +
  `cursors`. The supervisor has NO work, journal, or sandbox dependency today. Supervisor-owned
  writes are ONLY cursor upserts + decision-event appends ("Pure Port and Supervisor-Only Writes",
  `openspec/specs/heartbeat/spec.md`). Recovery widens this surface — a new class of
  supervisor-owned writes needing its own spec boundary.
- **Composition** — `packages/app/src/composition/supervisor-deps.ts:16-21` (`buildSupervisorDeps`:
  event + cursor adapters only), `supervisor-dispatch.ts:27-53` (`buildSupervisorDispatch`:
  `onActivate` → `dispatchCompanyActivation`), production wiring at
  `packages/app/src/daemon/daemon.ts:76-77`.
- Spec: `openspec/specs/supervisor-timer/spec.md` "Sequential Checkpointed Tick" (append → callback
  → checkpoint), "Durable Cursor Recovery" (at-least-once evaluation), "Single-Instance Operation"
  (no multi-instance fencing).

### 4. Dispatch (how Work gets picked)

- **`dispatchCompanyActivation`** — `packages/app/src/dispatch/dispatch.ts:25-53`: picks the FIRST
  (oldest) actionable Work, derives `dispatchIdempotencyKeyFor(companyId, workId)` and
  `dispatchRequestHashFor(work)`, runs EXACTLY ONE `runWorker` cycle. Typed worker failures
  SETTLE (cursor advances); thrown errors propagate (cursor unadvanced → R4-001 re-activation).
- **`ACTIONABLE_WORK_STATES`** — `packages/business-domain/src/transitions.ts:36`:
  `readonly ['accepted']`. `listActionableByCompany` (`packages/database/src/work-adapter.ts:248-267`)
  filters `WHERE company_id = $1 AND state = ANY($2) ORDER BY id ASC` (migration 009,
  `(company_id, state)` index). **`in_progress` Work is invisible to dispatch by construction.**
- **Identity seam** — `packages/app/src/dispatch/keys.ts:18-42`: `dispatchIdempotencyKeyFor` =
  `wk:${companyId}:${workId}` (collision-guarded), `dispatchRequestHashFor` = SHA-256 over the
  STABLE canonical `{ companyId, workId, delegationId, description }` — identical across
  `accepted → in_progress → completed`. **This is the recovery key-derivation seam**: a supervisor
  holding only the orphaned Work row can reconstruct the full journal identity
  (`key = wk:…`, `hash = dispatchRequestHashFor(work)`) with zero worker memory.
- Spec: `openspec/specs/work-dispatch/spec.md` "Deterministic Dispatch Identity", "One Oldest-First
  Cycle per Activation", "Failure Settlement Controls Cursor Progress".

### 5. Journal / idempotency

- **Status domain** — `in_flight | aborted_retryable | completed`
  (`packages/database/sql/005_journal_retryable_status.sql`).
- **Pre-effect decision table** — `packages/app/src/worker/reconcile.ts:23-47`
  (`decidePreEffect`): none → proceed (insert); completed+same hash → REPLAY; completed+diff → DENY;
  aborted_retryable+same hash → proceed (reopen, keeps original attemptId); aborted_retryable+diff →
  DENY; **in_flight → recovery** (never re-insert).
- **Atomic terminal close** — `packages/app/src/worker/finalize.ts:236-308`
  (`finalizeInFlightWorkAtomically`): T1 = one transaction (state guard → token-checked terminal CAS →
  one receipt → one `work.completed` event → `journal.complete`); on CAS loss → T2
  (`reconcilePostEffectFailure`, `finalize.ts:200-234`): work gone / terminal →
  `journal.complete(UNRESOLVED)`; in_progress + effect applied → `sandbox.undo` + token-gated
  `journal.markRetryable` → `cas-lost-retryable`; in_progress + no effect → clean replay →
  `recovery-required` (no undo, no marker).
- **Worker restart recovery** — `packages/app/src/worker/recover.ts:74-121`
  (`recoverInFlightWork`): worker-driven, keyed by idempotencyKey; consults journal + durable
  undo log (`SandboxPort & { snapshotUndoLog() }`); reuses `reconcilePostEffectFailure` with the
  **retained token read from the Work row** (`recover.ts:106-107`) — never re-mints.
- Specs: `openspec/specs/idempotency-journal/spec.md` (status domain, retryable marker,
  no-zombie controlled retry), `openspec/specs/worker-cycle/spec.md` (claim, atomic close,
  journal-anchored reconciliation, durable restart recovery).

### 6. The "intentional non-guarantee" tests (current contract boundary)

- **Spec**: `openspec/specs/work-dispatch/spec.md:79-86` — Requirement "Crash-Recovery
  Non-Guarantee": *"This capability MUST NOT guarantee exactly-once execution or automatic crash
  resumption. Post-claim failures MAY orphan excluded `in_progress` Work. Supervisor-driven
  `recoverInFlightWork` remains follow-up work because `FileDocumentSandbox` lacks
  `snapshotUndoLog`."*
- **Test (the RED→GREEN flip candidate)**: `packages/app/test/dispatch/dispatch.test.ts:215-231` —
  `excludes post-claim in_progress Work — never auto-resumed (R6)`: seeds an orphan
  `in_progress` v2 Work, asserts dispatch settles `{ ok: true, dispatched: false }`, zero LLM
  requests, zero journal rows, and the orphan stays `in_progress` v2 untouched. **This contract
  changes**: dispatch still MUST NOT auto-resume orphans (the worker-cycle path), but the
  supervisor now recovers them — the requirement and scenario must be reframed (moved/amended),
  not merely deleted.
- **Companion (unchanged)**: `packages/app/test/worker-restart.test.ts` — the worker-driven durable
  restart recovery (applied effect → `cas-lost-retryable`; no-effect branch at `:171-206` →
  `recovery-required` **with the journal row left `in_flight`** — a permanently-stuck window, see below).

### 7. The `recoverInFlightWork` seam — what exists and what is missing

- **Exists (worker-driven)**: `packages/app/src/worker/recover.ts`. Requires a sandbox with
  `snapshotUndoLog()` — implemented ONLY by the test fakes
  (`packages/app/src/sandbox/durable-sandbox-fake.ts:49-51`, `in-memory-sandbox.ts`).
- **Missing (production blocker, named in the roadmap)**: `packages/app/src/sandbox/sandbox-port.ts:38-45`
  — `SandboxPort` = `execute | undo | wasApplied`, **no `snapshotUndoLog`**. And
  `packages/app/src/sandbox/file-document-sandbox.ts:17-25` keeps its `UndoLog`
  (`packages/app/src/sandbox/undo-log.ts:10-12`) **IN MEMORY** (`Map`) — the applied-effect source
  of truth (§9.8) does NOT survive a production process crash. The durable sandbox only exists in
  tests (JSON-file persistence). **This is the single biggest prerequisite**: without a durable undo
  log, the supervisor cannot distinguish "effect applied" from "effect never ran" for a crashed
  worker, and lease-fencing (below) forbids re-running effects without proof of non-execution.
- **No supervisor-facing discovery exists**: no `listInFlightByCompany`, no `in_progress` query
  path, no orphan/stale marker anywhere in the codebase (grep: zero hits for
  `recover_in_flight|orphan` outside the docs/tests above).
- **No journal index by workId**: the journal is keyed by `(company_id, idempotency_key)`; the
  workId→key bridge is the deterministic `wk:${companyId}:${workId}` dispatch key.

## The orphan lifecycle today (crash windows)

A claimed Work (`in_progress`, token N) can be orphaned in three distinct windows after the claim CAS
(`worker.ts` steps 1→5):

| Window | Crash point | Journal row | Undo log (durable) | Current disposition |
|---|---|---|---|---|
| W1 | after claim CAS, before `insertInFlight` | **none** | empty | `recoverInFlightWork` → `UNRESOLVED_REQUIRES_HUMAN` (`recover.ts:78-83`) — "never fabricate". SAFEST to recover: the effect provably never ran (`insertInFlight` precedes the effect) |
| W2 | after `insertInFlight`, before `execute` | `in_flight` | empty | clean replay → `recovery-required`, **row left `in_flight`** — every same-key retry dead-ends (`attempt-in-flight` → `recovery`) forever (test `worker-restart.test.ts:171-206` pins this) |
| W3 | after `execute` (effect applied), before terminal close | `in_flight` | 1 applied entry | applied → undo + `markRetryable(retained token)` → `cas-lost-retryable` — BUT only when the undo log survived; production `FileDocumentSandbox` loses it on crash |

Recovery safety is strictly ordered by the undo log: W1 is provably effect-free, W2 is provably
effect-free (empty durable log), W3 needs the durable log to distinguish "applied" from "lost".

## The seams recovery must plug into

1. **Supervisor tick** (`supervisor.ts` / `tick.ts` / `SupervisorDeps`): the cadence anchor; the
   per-company sequential pass + durable cursor give at-least-once delivery. Today
   `SupervisorDeps` lacks work/journal/sandbox — a widening of the supervisor's dependency surface
   and a new class of supervisor-owned writes.
2. **Dispatch** (`dispatchCompanyActivation` + `ACTIONABLE_WORK_STATES`): `in_progress` is invisible
   to the actionable queue; **a re-queued Work produces NO `work.completed` novelty, so the
   heartbeat gate will return `no-llm-heartbeat` and the re-queued Work will NEVER be dispatched**
   (`MATERIAL_EVENT_TYPES = ['work.completed']` only; `heartbeat.decision` deliberately undeclared).
   Recovery therefore needs its own dispatch trigger (direct resume call, or a recovery-triggered
   activation), not the heartbeat economy.
3. **Journal** (`insertInFlight` reopen / `markRetryable` / `complete`): the double-execution guard.
   A re-dispatch is safe ONLY after the attempt is terminal (`completed` → replay) or retryable
   (`aborted_retryable` → reopen). An `in_flight` row with a live attempt must be reconciled first
   (W2 needs a way to convert `in_flight` → `aborted_retryable` WITHOUT undo — the current
   `markRetryable` is specced for the applied-effect CAS-loss case; W1 needs nothing journal-side).
4. **Fencing gate** (`claimWithFencing` / `terminalWithFencing` / `markRetryable` token gate): every
   recovery write MUST present the retained stored token (`recover.ts:106-107` pattern). A recovery
   re-claim from `accepted` mints token N+1 → old-holder writes (terminal CAS, markRetryable) fail
   the gate → zombie is fenced. But the minted token must then be re-synced to the journal row or
   the gate rejects the LEGITIMATE holder on a later CAS-loss (token drift, see Risks).
5. **Sandbox undo log** (`sandbox-port.ts` + `file-document-sandbox.ts`): the missing
   `snapshotUndoLog` + in-memory `UndoLog` are the named blocker (`work-dispatch/spec.md:81`).
   Without durable applied-state, W3 recovery cannot prove non-execution and must escalate.

## Decision options (NOT decisions — for the propose phase)

### D1 — Recovery cadence

1. **Piggyback on the existing supervisor tick** — recovery runs per-company inside the sequential
   tick pass (before or after `onActivate`), reusing `listCompanyIds()` + cursor durability.
   - Pros: zero new timers; one process, one cadence; at-least-once via the existing cursor contract.
   - Cons: widens `SupervisorDeps` and the tick's failure domain; recovery and activation share a
     cursor — a recovery failure uncheckpointing the tick could re-run activation (harmless via
     idempotency, but wasteful); recovery writes need explicit placement relative to
     `appendIfAbsent(decision)`/`onActivate`/`upsert` order.
   - Effort: Low-Medium.
2. **Separate sweep/timer (second daemon pass or own interval)** — an independent pass listing
   orphaned Work and recovering it.
   - Pros: decoupled failure domain; no interference with the heartbeat economy (no decision-event
     appends, no cursor coupling); can run at a coarser cadence.
   - Cons: new timer + discovery path (needs its own company/work enumeration and its own
     checkpoint); two writers to the same tables (supervisor tick + sweep) need coordination
     discipline; more moving parts in the daemon lifecycle.
   - Effort: Medium-High.

### D2 — Orphan detection ("stuck" vs "legitimately in-flight")

1. **Age/lease column on `work` (e.g. `claimed_at` or `lease_expires_at`)** + grace threshold.
   - Pros: cheap, direct, no new writer surface (set once at claim); a `(state, claimed_at)`
     predicate is indexable.
   - Cons: **migration on the work table**; the repo's `now` is today reserved/unused in the
     supervisor (heartbeat novelty is cursor-defined, NEVER clock-defined — this introduces the
     first clock-dependent business decision); grace tuning is a false-positive tradeoff — a slow
     (LLM-latency) but alive worker past the grace is "recovered" while still running (zombie risk,
     see Threats); expiry alone MUST NOT authorize re-running effects (lease-fencing contract).
   - Effort: Medium.
2. **Heartbeat last-seen (new column or table, worker writes periodically)**.
   - Pros: better liveness signal than static age; narrows the false-positive window.
   - Cons: **new worker write surface per phase** (the worker currently writes nothing periodic);
     still expiry-based (same lease-fencing caveat); more schema + more latency paths.
   - Effort: High.
3. **Journal-row age (use `idempotency_journal.created_at`)** — detect via the attempt's own row.
   - Pros: zero new schema; works for W2/W3 (rows exist); the journal already stores `created_at`.
   - Cons: **misses W1 entirely** (no row); still clock-defined; couples detection to a row that may
     legitimately age (long-running attempts).
   - Effort: Low.
4. **Fencing-token staleness / no signal** — there is NO liveness signal in the current schema; the
   token is static while `in_progress`. Detection MUST add a signal (options 1-3) or be
   operator-triggered (manual claim of "this work is orphaned" — e.g. an admin transition), which
   pairs naturally with escalation but gives no automation.
   - Effort: Low (manual) / High (automated without a signal).

### D3 — Recovery action semantics (what recovery does to the orphan)

1. **Re-queue to `accepted` (new transition) + re-dispatch via the actionable queue.**
   - Pros: full reuse of `dispatchCompanyActivation`/`runWorker`; the journal replay/reopen table
     then guards double execution; explicit, auditable state.
   - Cons: requires the state-machine expansion (`in_progress → accepted`); the re-dispatch
     re-claims and **mints a new token while the journal row keeps the old token → token drift**
     (reopen doesn't rewrite `fencing_token`; a later CAS-loss `markRetryable` with the new token is
     rejected by the claim-ownership gate → hot retry risk); W2's `in_flight` row must be closed
     first or the cycle dead-ends at `recovery-required`; the heartbeat economy will not dispatch
     the re-queued Work (no novelty) — recovery must trigger its own dispatch.
   - Effort: Medium-High.
2. **Journal reconcile in place (reuse `recoverInFlightWork`) + direct resume via a recovery
   dispatch seam** — recovery reconciles the attempt (markRetryable with the retained token), then
   invokes `runWorker` directly on the orphaned Work (state stays `in_progress`; the resume branch
   at `worker.ts:82-126` handles `in_progress` + `aborted_retryable` without re-claiming → **no
   token drift**, tokens stay consistent).
   - Pros: token-consistent (reuses the resume path exactly as the worker restart does); journal
     semantics unchanged (controlled retry = reopen); smallest semantic delta.
   - Cons: a NEW dispatch entry point that bypasses `listActionableByCompany` (dispatch today is
     "oldest accepted"); supervisor needs work/journal/sandbox deps; W2 needs the
     in_flight-without-undo conversion decision (extend `markRetryable` usage or add a journal
     abort capability).
   - Effort: Medium.
3. **Abort / escalate** — W3 without a durable undo log (and any case where the attempt cannot be
   proven effect-free) MUST escalate: complete honestly as `UNRESOLVED_REQUIRES_HUMAN` (journal) and
   either leave Work `in_progress` flagged or reject it. Abort-to-`rejected` requires the state
   machine expansion too; **abort MUST NOT use `journal.complete(attemptId, normal-result)`** — that
   seals the key and makes future retries REPLAY the abort disposition (idempotency poisoning).
   - Pros: honest, safe, matches "never fabricate" + lease-fencing; minimal new machinery.
   - Cons: availability loss (recoverable work is human-escalated); leaves `in_progress` work around
     unless a new terminal edge is added.
   - Effort: Low (pure escalation) / Medium (with abort transition).
4. **Fencing interaction (ALL options)**: recovery writes present the **retained stored token**
   (never re-mint unless re-claiming from `accepted`, and then the journal token MUST be re-synced).
   A recovery re-claim intentionally bumps the Work token so any surviving zombie's terminal
   close/`markRetryable` is rejected by the gate — this is the Scope-B-ready behavior the
   fencing-tokens change designed for.

### D4 — At-least-once / idempotency interplay

- Double execution is prevented by the EXISTING journal table (`decidePreEffect`, `reconcile.ts`):
  `completed`+same-hash REPLAYS, `aborted_retryable`+same-hash reopens, `in_flight` → recovery.
  Recovery adds NO new exactly-once claim — the repo's contract stays at-least-once.
- The W2 permanent-stuck window is the sharp edge: `in_flight` + no-effect currently resolves to
  `recovery-required` with the row NEVER closed (`worker-restart.test.ts:198-200` pins it). A
  supervisor recovery for W2 must convert `in_flight` → `aborted_retryable` (nothing to undo;
  `markRetryable` with the retained token works mechanically, but its SPEC semantics are
  "applied-effect CAS-loss" — extending them is a spec decision) or introduce a dedicated journal
  abort. Without this, re-queue + re-dispatch loops forever at `recovery-required`.
- The recovery pass MUST be idempotent itself: a crashed recovery (after reconcile, before
  re-dispatch) must be re-runnable — the journal marker/terminal row makes it so.

### D5 — Scope boundary

- **IN**: supervisor-driven discovery + recovery of orphaned `in_progress` Work (W1/W2/W3); the
  durable undo-log prerequisite for the production sandbox (`snapshotUndoLog` + durable
  `FileDocumentSandbox`); the W2 journal-close decision; the recovery dispatch trigger; the
  reframed non-guarantee requirement/scenario + the RED→GREEN test flips; spec deltas
  (`work-lifecycle` if the state machine expands, `worker-cycle`, `idempotency-journal`,
  `work-dispatch`, `supervisor-timer` if the tick widens, `persistence-recovery-contract` interplay).
- **OUT (explicitly)**: Memory OS; learning/promotion (Increment 8); receipts crypto/signing
  (deferred — MUST NOT be claimed); §13.3 authority-tier SoD; `riskClass` producer; skill-outcome
  BusinessEvents; daemon/process lifecycle; crash-BEFORE-claim (accepted Work is already
  re-dispatchable — no recovery needed); crash AFTER T1 commit but before response (the replay path
  already handles it); cohort/cache-prefix behavior (recovery touches no LLM context — §7.2/§7.3
  cache-poisoning invariant is unaffected); multi-instance supervisor fencing (supervisor-timer
  "Single-Instance Operation" stays).

## Threat surface

1. **Zombie writer (severity: HIGH)** — a falsely-detected "orphan" is actually a slow-but-alive
   worker. Recovery re-claims (token bump): the zombie's terminal CAS and `markRetryable` are then
   rejected by the fencing gate (good), but the zombie may still be MID-EFFECT on the filesystem when
   recovery re-runs the effect → duplicate/partial effect. Mitigation: recovery re-runs effects ONLY
   on durable-log proof of non-execution; otherwise escalate (D3-3). Detection grace must exceed the
   worst legitimate cycle latency.
2. **Double execution (severity: HIGH)** — W3 with the in-memory production `UndoLog`: crash loses
   the applied-state SoT; recovery believes "no effect ran" and re-runs → duplicate document create
   (the sandbox `wx` exclusive create FAILS on a second create of the same path — a partial safety
   net, but the effect may be re-invocable with a different path or the failure may surface late).
   Mitigation: durable undo log is a HARD prerequisite, not a nice-to-have.
3. **Token drift (severity: MEDIUM-HIGH)** — re-queue + re-claim mints a new Work token while the
   journal row keeps the old token (reopen does not rewrite `fencing_token`). A later CAS-loss
   `markRetryable(newToken)` matches 0 rows and THROWS → the throw propagates through dispatch → the
   supervisor tick fails → unadvanced cursor → infinite hot retry on every tick. Mitigation: either
   resume-without-reclaim (D3-2) or resync the journal token on reopen (journal port change + fake/PG
   parity).
4. **Lost work / availability (severity: MEDIUM)** — conservative escalation (D3-3) strand
   recoverable work in `in_progress`+`UNRESOLVED` until a human acts; W1/W2 re-queues that then
   never dispatch (heartbeat has no novelty for re-queued Work) strand work silently. Recovery must
   own its dispatch trigger end-to-end.
5. **Thundering herd on recovery (severity: MEDIUM)** — a large orphan backlog re-queued in one
   pass: dispatch runs ONE cycle per activation, so per-tick LLM cost is bounded, but a burst of
   recovery dispatches can still spike LLM/effect volume; a recovery crash mid-batch must restart
   cleanly (idempotent markers) and not re-recover already-recovered work.
6. **Journal idempotency poisoning (severity: MEDIUM)** — an abort that uses
   `journal.complete(attemptId, disposition)` seals the key: future retries REPLAY the abort. Any
   recovery terminal action must keep the key retryable (`aborted_retryable`) or accept the seal as
   an explicit design decision.
7. **State-machine widening (severity: MEDIUM)** — adding `in_progress → accepted | rejected` edges
   changes the aggregate contract; every transition use case + spec scenario + parity test (fake vs
   PG) must cover the new edges; byte-identity pins (`worker.ts` is a protected source) must be
   re-verified if `runWorker` changes.
8. **Supervisor deps widening (severity: LOW-MEDIUM)** — `SupervisorDeps` gains work/journal/sandbox;
   the "supervisor writes ONLY cursors" invariant (heartbeat spec) is touched; composition roots
   (`supervisor-deps.ts`, `supervisor-dispatch.ts`, `daemon.ts`) and the daemon's fail-fast boot must
   stay consistent; two writers (tick + recovery) to the same tables need single-writer discipline.

## Ready for Proposal

Yes — the change is well-bounded by the fencing-tokens groundwork. The propose phase must decide
D1–D5, with the durable-undo-log prerequisite (D5 IN) and the W2 journal-close decision as the two
non-negotiable design forks.

## Key Learnings

1. The production `FileDocumentSandbox` keeps its `UndoLog` in memory, so the applied-effect source of truth does not survive a process crash; a durable undo log is the hard prerequisite for supervisor recovery.
2. `in_progress` Work is invisible to dispatch and re-queued Work emits no `work.completed` novelty, so the heartbeat gate will never re-dispatch it — recovery must trigger its own dispatch.
3. The deterministic dispatch key `wk:${companyId}:${workId}` and stable request hash let a supervisor reconstruct the full journal identity from an orphaned Work row alone.
4. Reopening an `aborted_retryable` journal row does not rewrite `fencing_token`, so a re-claim from `accepted` creates token drift that the `markRetryable` claim-ownership gate would reject.
5. The W2 window (in_flight journal row, no effect, no marker) currently dead-ends permanently at `recovery-required` and needs a journal-close decision before supervisor recovery can progress it.
