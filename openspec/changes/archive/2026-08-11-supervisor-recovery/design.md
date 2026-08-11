# Design: Supervisor Recovery

> Implements proposal `supervisor-recovery` (decisions D1–D5). Builds on the
> seams mapped in `exploration.md`. Every choice is grounded in current code;
> symbol citations use `file:symbol`.

## Technical Approach

Recovery is a **second side-effect in the sequential checkpointed tick**. The
supervisor core (`tick.ts`) keeps its minimal `{events, cursors}` surface and
gains one optional `onRecovery(companyId)` call (sibling to `onActivate`). The
recovery logic (discover → reconcile → resume) lives in the composition root
(`supervisor-dispatch.ts`), closed over `work`/`journal`/`sandbox` — the same
pattern `onActivate` already uses to close over `dispatchDeps`. An operator
designates orphaned Work via a boolean marker (`recovery_requested`, NOT a state
transition); the tick discovers it, reconciles the journal attempt to the
`aborted_retryable` retry boundary using the **retained stored token**, then
dispatches a direct resume that reuses the deterministic dispatch identity and
the worker's claimed-work body. The production sandbox gains a durable undo log
(file-backed JSON) so W3 can prove whether the effect ran.

```
tick: cursor → gate → tail → appendIfAbsent(decision)
        → onActivate(companyId, model)   [normal accepted Work]
        → onRecovery?.(companyId)        [NEW: designated orphans]
        → cursors.upsert(tail)           [checkpoint LAST]
```

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Durable undo log | **File-backed JSON** at `<rootDir>/.io/undo-log.json` storing `{counter, undoLog}` | PG table; append-only log | Effect (a file) and its evidence MUST share one durability domain. PG would split them → crash between `wx` write and PG INSERT reopens the double-execution window. The FS IS the effect store; co-locate the evidence. Mirrors `DurableSandboxFake.persist` (`durable-sandbox-fake.ts:53`). |
| 2 | Operator designation | **Boolean column `work.recovery_requested`** + partial index, set by a non-transition CAS use-case | New state edge; separate queue table | `WORK_TRANSITIONS` (`transitions.ts:20`) stays `in_progress→['completed']`. Designation is operational metadata, not a lifecycle transition. Plain `updateIfVersion` (version+1, no fencing directive, state unchanged) — the bump fences a zombie's terminal CAS. Matches `fencing_token` additive-default-inert precedent (`010_fencing_tokens.sql`). |
| 3 | W2 journal abort | **Widen `markRetryable` usage** to the no-effect case | New `abortInFlight` port method | `markRetryable` SQL (`idempotency-adapter.ts:195`) is already `in_flight→aborted_retryable` token-matched; it never undoes. W2 needs exactly that with no preceding `undo`. A second method duplicates the SQL and risks fake/PG divergence. Spec delta widens the specced trigger; the port signature is unchanged. |
| 4 | Supervisor wiring | **`onRecovery` callback** closed over recovery deps; `SupervisorDeps` unchanged | Widen `SupervisorDeps` type | Mirrors `onActivate`→`dispatchDeps` (`supervisor-dispatch.ts:50`). Keeps `tick.ts`/`supervisor.ts` minimal; the widened surface is owned by the composition root. |
| 5 | Recovery dispatch | **`dispatchRecovery`** runs the claimed-work body (authority→finalize) on the in_progress Work, skipping the claim gate | Reuse `dispatchCompanyActivation` | `ACTIONABLE_WORK_STATES=['accepted']` (`transitions.ts:36`) makes `in_progress` invisible to normal dispatch by construction. The claim gate (`worker.ts:77-132`) re-claims (`accepted→in_progress`) and would `invalid-transition` on an already-in_progress Work (W1) or re-mint a token (drift). Direct resume reuses `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor` (`keys.ts`) for journal identity. |
| 6 | Token consistency | **Read `work.fencingToken` fresh; never re-mint** | Re-claim from `accepted` | `recoverInFlightWork` (`recover.ts:106-107`) already does this. No re-claim ⇒ Work token == journal `fencing_token` ⇒ `markRetryable` gate (`fencing_token=$5`) matches. Eliminates the token-drift hot-retry hazard (`exploration.md` threat 3). |
| 7 | W1 resume entry | **`dispatchRecovery` enters at pre-effect reconcile** (no journal row ⇒ `decidePreEffect` `none→proceed` ⇒ fresh `insertInFlight` with retained token) | Insert-then-mark in recovery | Matches proposal D3 "W1 resumes with no journal/effect." W2/W3 converge first to `aborted_retryable` (the retry boundary), then the SAME `dispatchRecovery` entry reopens. Uniform seam. |

## Data Flow

```
Operator ──requestRecovery(CAS)──→ work.recovery_requested=true (v+1)
                                         │
   tick ──listRecoveryRequestedByCompany──→ [designated orphans]
                                         │
   per orphan:  work.get → in_progress?
         │ no  └→ clear marker (done/gone)
         │ yes
         ▼
   recoverInFlightWork(journal+sandbox+undoLog, retainedToken)
         │ W1 (no row)          → dispatchRecovery (pre-effect inserts fresh)
         │ W2 (in_flight,no fx) → markRetryable(retainedToken) → dispatchRecovery (reopen)
         │ W3 (in_flight,fx)    → sandbox.undo → markRetryable → dispatchRecovery (reopen)
         │ missing evidence / undo fail → UNRESOLVED close (escalate)
         ▼
   dispatchRecovery: authority → intent(LLM) → reconcilePreEffect → effect → verify → finalize
         │
   clear marker (LAST) → cursor.upsert (checkpoint)
```

A throw anywhere after `appendIfAbsent` and before `upsert` leaves the cursor
unadvanced → at-least-once re-tick. Recovery is idempotent: a re-tick re-runs
`recoverInFlightWork`, which no-ops on `aborted_retryable` (`recover.ts:88-93`)
and terminal-Work; the marker is cleared only on success.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/database/sql/011_recovery_designation.sql` | Create | `ALTER TABLE work ADD COLUMN recovery_requested BOOLEAN NOT NULL DEFAULT false` + partial index `WHERE recovery_requested AND state='in_progress'`. Idempotent, additive. |
| `packages/app/src/sandbox/sandbox-port.ts` | Modify | Add `snapshotUndoLog(): readonly EffectRecord[]` to `SandboxPort`. |
| `packages/app/src/sandbox/file-document-sandbox.ts` | Modify | Add `durabilityPath` (default `<rootDir>/.io/undo-log.json`); persist `{counter, undoLog}` after `execute`/`undo`; `restore()` on construct; add `snapshotUndoLog()`. Documents survive by being real files; only the undo log + counter are persisted. |
| `packages/business-domain/src/ports/repositories.ts` | Modify | Add `listRecoveryRequestedByCompany(companyId)` + `setRecoveryRequest(companyId, workId, expectedVersion, requested)` to `WorkRepository`. |
| `packages/business-domain/src/use-cases/request-recovery.ts` | Create | Non-transition CAS use-case (plain `updateIfVersion`, state unchanged, version+1). |
| `packages/app/src/worker/finalize.ts` | Modify | `reconcilePostEffectFailure` no-effect branch: `markRetryable(retainedToken)` (no undo) → `cas-lost-retryable` (was `recovery-required`, row left `in_flight`). Unsticks W2. |
| `packages/app/src/worker/recover.ts` | Modify | W1 branch (`entry===undefined`): instead of `UNRESOLVED`, signal resume (the `dispatchRecovery` seam inserts fresh). Type widened. |
| `packages/app/src/worker/worker.ts` | Modify | Extract post-claim body (steps 2–7) to `runClaimedWork(work, deps, model)`; `runWorker` calls it after the claim gate. Byte-identity pins re-verified. |
| `packages/app/src/dispatch/dispatch.ts` | Modify | Add `dispatchRecovery(companyId, work, deps, model)` → `runClaimedWork` with `dispatchIdempotencyKeyFor`/`dispatchRequestHashFor` identity. |
| `packages/app/src/supervisor/types.ts` | Modify | Add `OnRecovery = (companyId) => void|Promise<void>`; add `onRecovery?` to `StartSupervisorOptions`. `SupervisorDeps` UNCHANGED. |
| `packages/app/src/supervisor/tick.ts` | Modify | Invoke `await onRecovery?.(companyId)` AFTER `onActivate`, BEFORE `cursors.upsert`. |
| `packages/app/src/composition/supervisor-dispatch.ts` | Modify | Build `onRecovery` closure over recovery deps (work/journal/sandbox); wire `requestRecovery` admin entry. |
| `packages/database/src/work-adapter.ts` | Modify | PG `listRecoveryRequestedByCompany` + `setRecoveryRequest`; parse `recovery_requested` in `parseWorkRow`. |
| `packages/business-domain/src/ports/fakes.ts` | Modify | `InMemoryWorkRepository` gains the two methods (parity). |
| `packages/app/src/composition/worker-deps.ts` | Modify | Construct `FileDocumentSandbox` with durability path. |

## Interfaces / Contracts

```typescript
// sandbox-port.ts — port gains one read (collapses RecoverDeps intersection)
export interface SandboxPort {
  execute(action: SandboxAction): Promise<EffectRecord>;
  undo(handle: UndoHandle): Promise<void>;
  wasApplied(handleId: string): Promise<boolean>;
  snapshotUndoLog(): readonly EffectRecord[]; // NEW — effect SoT evidence
}

// repositories.ts — designation is a marker, NOT a Work field (domain Work type unchanged)
export interface WorkRepository {
  // ...existing...
  listRecoveryRequestedByCompany(companyId: string): Promise<readonly Work[]>; // NEW
  setRecoveryRequest(companyId: string, workId: string, expectedVersion: number,
                     requested: boolean): Promise<CasResult>; // NEW — plain CAS, state unchanged
}

// IdempotencyJournalPort — UNCHANGED (markRetryable already covers W2 via spec widening)

// supervisor/types.ts — callback seam, deps unchanged
export type OnRecovery = (companyId: string) => void | Promise<void>;
```

Fake↔PG parity: `InMemoryWorkRepository` ≡ `PgWorkRepository` for both new
methods; `FileDocumentSandbox.snapshotUndoLog` ≡ `DurableSandboxFake` ≡
`InMemorySandbox`. Durability parity is on **undo-log survival**, not the
effects map (production has real files; the fake has a virtual FS).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | W1/W2/W3 reconcile matrix | `recoverInFlightWork` over a durable sandbox fake + durable journal fake; assert per-window disposition + token retention + marker clear. |
| Unit | Designation CAS | `requestRecovery` bumps version, state unchanged, fences a stale-version zombie. |
| Unit | `dispatchRecovery` resume | Reuses `wk:` key + hash; no re-claim; cohort prefix unchanged (assert context untouched). |
| Unit | Tick ordering | `onRecovery` runs after `onActivate`, before `upsert`; a throw leaves cursor unadvanced. |
| Integration | PG designation + discovery | Live PG `listRecoveryRequestedByCompany` (partial index) + `setRecoveryRequest` CAS parity with fake. |
| Integration | Durable undo log restart | `FileDocumentSandbox` survives a simulated restart (re-construct over same path); undo log + counter restored. |
| E2E | Full recovery | Designate an orphaned in_progress Work → tick recovers → Work completes, one receipt, journal completed. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary in the threat-matrix sense. The
relevant threats (zombie writer, double execution, token drift) are handled by
the existing fencing gate + the durable undo log + retained-token resume (see
Risks).

## Migration / Rollout

Migration 011 is additive + inert (default `false`, like `fencing_token`).
Operator prerequisite (daemon applies NO migrations). Rollback: stop designating
orphaned Work; normal dispatch and the existing cursor/recovery contract are
unaffected. The W2 reconcile change (finalize no-effect → markRetryable) is
uniform across CAS-loss/verify-fail/restart — a behavior change covered by the
`worker-restart.test.ts:171-206` RED→GREEN flip.

## Open Questions

- [ ] fsync hardening: `writeFileSync` (the existing fake model) gives OS page-cache durability, not fsync-to-disk. Accept the window or add explicit `fdatasyncSync` for the undo log? (Recommend: spec-phase decision; architecturally file-backed JSON is fixed.)
- [ ] Does the domain `Work` type carry `recoveryRequested`, or stays pure (marker = DB-only + port methods)? Recommend: keep `Work` pure.
- [ ] Escalation marker state: on `UNRESOLVED_REQUIRES_HUMAN`, clear `recovery_requested` (re-designation = new operator action) or leave for audit? Recommend: clear (idempotent re-designation).

## Invariants Preserved

- **business-domain zero `@io/*`**: new port methods + `requestRecovery` use-case stay pure. ✓
- **openai confined to `deepseek-client.ts`**: recovery touches no LLM client. ✓
- **`packages/context` deps === `@io/business-domain`**: recovery does not import context. ✓
- **No new runtime deps**: file JSON via `node:fs` (already used). ✓
- **Cohort §7.2/§7.3 prefix**: recovery passes `companyId` → `dispatchIdempotencyKeyFor` → prefix `io:{companyId}:{process}:v{schemaVersion}` unchanged; no context compilation touched. ✓
- **Supervisor Single-Instance**: one `onRecovery` per company per tick, sequential. ✓
- **`now`/clock UNUSED in supervisor**: designation is a boolean operator action (D2), not age/lease/heartbeat. No clock-dependent rule introduced. ✓
- **Supervisor writes**: cursor upserts + decision appends remain supervisor-owned; recovery writes (journal markRetryable, marker, resume) are a NEW class legitimated by the `onRecovery` spec boundary (supervisor-timer delta). ✓
- **Abort never seals a key**: W2 uses `markRetryable` (`aborted_retryable`), never `journal.complete`. ✓
