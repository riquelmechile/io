## Exploration: Fencing tokens (protection against zombie writers)

### Current State

**The claim (B1)** is `startWork` (business-domain use case) — `accepted → in_progress` via `applyWorkTransition` → `workRepo.updateIfVersion(next, current.version)` (`packages/business-domain/src/use-cases/result.ts`, `start-work.ts`). The PG CAS (`packages/database/src/work-adapter.ts:89`) is `UPDATE work SET … version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3` — one concurrent winner. **No token is minted; `version` is a claim-agnostic optimistic counter** (init 1, migration 003) bumped on EVERY transition, including non-claim ones (accept).

**Attempt identity is NOT a claim identity**: `attemptId = att:{companyId}:{idempotencyKey}` (deterministic per key, `packages/app/src/worker/intent.ts:27`), one attempt per key via `UNIQUE(company_id, idempotency_key)` (migration 004), and a retry/reopen KEEPS the original attemptId (`insertInFlight` conditional UPDATE, `idempotency-adapter.ts:102`). So journal writes cannot be claim-scoped by attemptId.

**The worker write surface** (`packages/app/src/worker/worker.ts`): journal lookup (read) → startWork CAS (claim) → authority (read) → intent (LLM, external) → `reconcilePreEffect` (journal claim) → sandbox effect (external FS) → verify → `finalizeInFlightWorkAtomically` (T1, `finalize.ts:224`): ONE tx of state-guard → `updateIfVersion` CAS → `receipts.save` → `events.append(work.completed)` → `journal.complete`. CAS loss throws `FinalizeCasLostError` → T2 (`reconcileCasLoss`/`reconcilePostEffectFailure`, POOL connection, separate committed writes): `journal.complete(UNRESOLVED)` or `sandbox.undo` + `journal.markRetryable`, or clean replay. The business-domain twin `completeWorkIdempotent` (`complete-work.ts:56`, wired via `completeWorkAtomically`) has the same shape.

**Verified zombie exposure TODAY** — every write a stale holder can attempt after losing the claim:

1. **Work-row writes** — already fenced *de facto*: version CAS rejects a stale `expectedVersion`. ✓
2. **Terminal close (worker T1 + completeWorkAtomically)** — guarded: state guard (`state='in_progress'`) + version CAS + atomic tx. A stale holder cannot CAS to `completed`. ✓
3. **Receipt insert** — only reachable inside T1/completeWork AFTER a successful CAS; `UNIQUE(receipt_id)` + `UNIQUE(work_id, terminal_event_id)` (004). ✓ (indirectly guarded)
4. **BusinessEvent append** — only inside T1/completeWork after CAS; `UNIQUE(event_id)` (006). ✓ (indirectly guarded)
5. **Journal writes — NOT guarded.** `journal.complete(attemptId)` (`idempotency-adapter.ts:150`) is an UNCONDITIONAL `UPDATE … WHERE attempt_id=$1` — no status guard, no ownership check, token-free. `markRetryable` guards only `status='in_flight'`. Because reopen keeps the original attemptId, a stale holder of a (company, key) can complete/markRetryable its deterministic attemptId row ANY TIME — including while the CURRENT holder's in_flight row is live — clobbering the row the current claim uses. **This is the real hole.**
6. **Heartbeat cursor upsert** — supervisor-owned, company-keyed, no work-claim token; workers never write cursors (`tick.ts`, `heartbeat-cursor-adapter.ts`). No worker-fencing exposure (two supervisors racing is a supervisor concern, out of scope).
7. **Sandbox effects** — external FS, cannot be DB-fenced; protected by the undo log + journal claim (`decision.kind === 'recovery'` on lost claim → never proceeds).

**Why now (Increment-3 named debt)**: version-CAS is implicit and only protects the Work row. `recoverInFlightWork` (`recover.ts`) exists but is NOT supervisor-wired (Scope B, read-repair half). When recovery reclaims an orphaned `in_progress` Work, the new claim MUST invalidate the old holder's outstanding writes. With version-CAS alone, the old holder's Work CAS fails but its journal.complete/markRetryable still succeed. A claim-scoped fencing token closes this and makes the guarantee explicit and testable.

### Affected Areas

- `packages/database/sql/010_fencing_tokens.sql` — NEW: `work.fencing_token` + `idempotency_journal.fencing_token` (additive, idempotent, `DEFAULT 0` = pre-fencing epoch, mirrors 003 pattern).
- `packages/database/src/work-adapter.ts` — claim CAS mints `fencing_token = fencing_token + 1 … RETURNING`; terminal-close CAS adds `AND fencing_token = $n`.
- `packages/database/src/idempotency-adapter.ts` — `insertInFlight` stores the token; `markRetryable` token-gated; `complete` gains a status guard (token-gating the in_flight→completed transition must NOT break the honest T2(ii) UNRESOLVED close — see Risks).
- `packages/database/src/row-guards.ts` — Work/journal row parse gains the token field (D7).
- `packages/business-domain/src/types.ts` — `Work` gains `fencingToken` (or a separate claim-token value threaded through the cycle).
- `packages/business-domain/src/ports/repositories.ts` + `use-cases/start-work.ts`, `result.ts`, `complete-work.ts` — claim mints / close validates the token; `UseCaseResult` may surface `fencing-conflict`.
- `packages/business-domain/src/ports/fakes.ts` — fake parity for the new CAS semantics.
- `packages/app/src/worker/worker.ts`, `finalize.ts`, `reconcile.ts` — thread the token from the claimed Work into finalize/journal ops.
- Tests: `business-pg-roundtrip.integration.test.ts`, `business-adapters.test.ts`, `worker-finalize.test.ts`, `worker-restart.test.ts`, `parity.test.ts`, `fakes.test.ts`.
- Specs: **MODIFIED** `work-lifecycle` (Work Execution Fields / Optimistic Concurrency via CAS), **MODIFIED** `worker-cycle` (Single-Winner Claim via CAS, Atomic Terminal Close, Journal-Anchored Reconciliation), **MODIFIED** `idempotency-journal` (claim-scoped writes). **NO delta**: `business-event` (guarded in-tx), `supervisor-timer` (cursor untouched), likely NO delta `work-dispatch` (token is read post-claim inside `runWorker`; dispatch already passes `expectedVersion`).

### Approaches

1. **Minimal correct slice: token minted server-side at claim, checked on claim-owned writes** — the claim CAS becomes `UPDATE work SET state='in_progress', version=version+1, fencing_token=fencing_token+1 WHERE … AND version=$3 AND state='accepted' RETURNING fencing_token` (DB-side monotonic per row, race-free); the terminal-close CAS adds `AND fencing_token = $token`; `insertInFlight` records the token; `markRetryable` is token-gated; `complete` gets a status guard. Receipts/events unchanged (already post-CAS).
   - Pros: closes every actual corruption window (fabricated close, journal clobber); Kleppmann-style claim token without an app-side sequence; retries/resumes keep the SAME token (no re-claim) so replay/reopen semantics survive; Scope B-ready (a recovery re-claim bumps the token, old tokens go stale); explicit, testable invariant.
   - Cons: touches Work + journal ports/adapters + worker cycle; must not break the honest T2(ii) UNRESOLVED close for a stale holder; migration 010 on live tables; Work type change must not leak into compiled context bytes.
   - Effort: Medium.

2. **Full fencing: lease-based epoch with store-level token validation on EVERY claim-owned write (including receipts/events)** — application- or store-issued monotonic epoch; every worker write (work CAS, receipt, event, journal) carries it.
   - Pros: maximal guarantee, textbook-faithful.
   - Cons: receipts/events are already guarded by the in-tx CAS — adding tokens there is redundant machinery; needs an app-side monotonic source (sequence/clock — racy) or a bigger store contract; largest blast radius for the same real-world safety as Approach 1.
   - Effort: High.

3. **Defer/harden-only** — document version-CAS as the fence; add a `status='in_flight'` guard to `journal.complete` as a cheap stop-gap; defer the token to the Scope B recovery change.
   - Pros: near-zero diff; honest given recovery is not wired yet.
   - Cons: leaves the named Increment-3 debt open; a status guard alone does NOT stop a stale holder from completing its own in_flight row with fabricated data; recovery + fencing would then ship together as a larger change.
   - Effort: Low.

### Recommendation

**Approach 1** (minimal correct slice), token minted server-side in the claim CAS and checked on the terminal-close CAS + journal writes. It is the smallest slice that closes the actual hole (unfenced journal writes) while keeping receipts/events protected by the existing in-tx CAS, and it is structurally Scope B-ready. Slice split for the 800-line stacked-to-main budget (each slice autonomous, each < 400 authored lines):

- **Slice 1 — Work-level fencing**: migration 010 (`work.fencing_token`), `Work.fencingToken` in domain + row-guards + fakes, claim mint (`RETURNING fencing_token`), terminal-close CAS token check, worker threads the token from claim → finalize. Deltas: `work-lifecycle` (MODIFIED), `worker-cycle` (MODIFIED — claim + atomic close). Verifiable alone: stale-token close rejected; fresh claim works.
- **Slice 2 — Journal fencing**: migration 010 extension (`idempotency_journal.fencing_token`), `insertInFlight` stores token, `markRetryable` token-gated, `complete` status-guarded; `reconcile.ts`/`finalize.ts` thread the token. Deltas: `idempotency-journal` (MODIFIED), `worker-cycle` (MODIFIED — reconciliation). Verifiable alone: stale-holder markRetryable rejected; honest T2(ii) UNRESOLVED close still lands.

### Risks

- **Replay/idempotency interaction**: the replay branch (completed + same hash) never re-claims and must NOT require a token; the resume path (in_flight/aborted_retryable, no re-claim) keeps the SAME token. Spec wording must pin this down or retries brick.
- **Honest T2(ii) close vs token gating**: `reconcilePostEffectFailure` closes a STALE holder's attempt with `journal.complete(UNRESOLVED)` when the work already went terminal — that close is DESIRED even for a stale holder. A blanket token check on `complete` would break it; the fence belongs on the in_flight→completed transition and on `markRetryable` (the corruption window), with `complete` narrowed by a status guard only. Design must resolve this explicitly.
- **CAS contention**: the token check adds a WHERE column to an already row-locked CAS — no meaningful new contention.
- **Migration on live tables**: additive `ADD COLUMN IF NOT EXISTS … DEFAULT 0` (003 pattern, idempotent, no migration runner); existing in_progress rows land in the pre-fencing epoch (token 0); greenfield/dev-only data — document backfill semantics.
- **KV-cache/prefix**: the token is write-protection metadata, never LLM context. `Work` entering `compileContext` must not change compiled bytes — guard with the context-compiler byte-identity tests; protected cores (cycle.ts, evaluate.ts, supervisor.ts, gate body) are untouched by this change.
- **Byte-identity constraints**: work-lifecycle/worker-cycle specs change, but no protected file body changes; parity tests (fake vs PG) must stay in sync for the new CAS semantics.

### Scope Boundary

- **IN**: `work.fencing_token` (mint at claim, check at terminal close), journal fencing (`insertInFlight` stores, `markRetryable` token-gated, `complete` status-guarded), worker-cycle token threading, migration 010, tests, spec deltas (work-lifecycle, worker-cycle, idempotency-journal).
- **OUT**: `recoverInFlightWork` supervisor wiring (Scope B recovery — the READ-REPAIR half), §13.3 separation-of-duties (riskClass producer), heartbeat-cursor fencing (supervisor-owned), `business-event` delta, KV-cache/prefix changes, any new runtime dependency.

### Ready for Proposal

Yes — the hole is localized (journal writes are the only token-free claim-owned writes), the minting mechanism is race-free (DB-side bump at the existing claim CAS), and the slice split fits the 800-line stacked budget. Tell the user: the proposal should pin the T2(ii) honest-close exception and the resume-keeps-token rule, or those two edges will drive churn in spec/design.
