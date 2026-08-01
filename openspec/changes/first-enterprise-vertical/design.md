# Design: First Enterprise Vertical

## Technical Approach

`@io/app` orchestrates the low-risk worker cycle (claim→authority→intent→effect OUTSIDE tx→reconcile→verify→terminal). Journal=attempt SoT; undo log=effect SoT (§9.8).

**Modified foundation (approved):** extend the idempotency journal with durable status `aborted_retryable` + `markRetryable` so finalize CAS-loss does not brick the key (foundation parity with complete-work.ts:103-108 rollback). Touches pure port/types/fake in `business-domain` and PG adapter+migration in `database`. `trust-kernel`/`llm-client` unchanged; `openai` stays in `deepseek-client.ts`; business-domain stays infra-free.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Home | Port+worker+wiring in `@io/app` | 6th package | One consumer |
| Effect | **create-document** under sandbox root | append-line; network | Inverse=`unlink` |
| Terminal | App `finalizeInFlightWorkAtomically` | `completeWorkAtomically` after pre-insert | Pre-committed intent; twin = CAS+receipt+complete in one tx |
| CAS-loss brick | Durable **`aborted_retryable`** marker (own commit) | `journal.complete(failure)` (bricks key) | Spec IJ-2/3; parity with foundation rollback-then-retry |
| Intent | `insertInFlight` committed before `execute` | Intent inside terminal tx | Spec WC-4 |
| Revocation | Deny-at-action-time; work stays `in_progress` | Auto-reject | ADR-0002 |
| Restart | Durable journal (PG/fake) + durable undo log | Wipe memory | Non-vacuous |
| LLM prefix | Hard-coded stable system prefix | §7.2 compiler | Paso 2 |

## Journal Port Change (approved domain)

```typescript
// packages/business-domain/src/ports/idempotency.ts
export type JournalStatus = 'in_flight' | 'completed' | 'aborted_retryable';

export interface IdempotencyJournalPort {
  lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined>;
  insertInFlight(entry: NewJournalEntry): Promise<void>;
  /** in_flight|aborted_retryable → completed + resultJson (replay seal). */
  complete(attemptId: string, resultJson: unknown): Promise<void>;
  /**
   * Finalize CAS-loss recovery: in_flight → aborted_retryable.
   * Clears resultJson. Rejects if missing or status is completed.
   * MUST be invoked in its OWN committed write (not inside a rolling-back finalize tx).
   */
  markRetryable(attemptId: string): Promise<void>;
}
```

**`insertInFlight` reopen rule** (controlled retry, no UNIQUE brick):
- no row → INSERT `in_flight`
- existing `aborted_retryable` + same `(companyId,key)` + **same** `requestHash` → UPDATE `status='in_flight'`, keep `attemptId` (receipt never issued on prior CAS loss; `att:` scheme stable)
- existing `aborted_retryable` + **different** hash → throw/conflict (caller DENYs)
- existing `in_flight` | `completed` → reject (UNIQUE / already recorded)

Fake mirrors all statuses + `markRetryable` + reopen; durable fake persists for restart.

## Migration `005_journal_retryable_status.sql`

004 has `status TEXT NOT NULL` (no CHECK). 005 adds idempotent CHECK:

```sql
-- packages/database/sql/005_journal_retryable_status.sql
ALTER TABLE idempotency_journal DROP CONSTRAINT IF EXISTS idempotency_journal_status_check;
ALTER TABLE idempotency_journal ADD CONSTRAINT idempotency_journal_status_check
  CHECK (status IN ('in_flight', 'completed', 'aborted_retryable'));
```

Down/rollback: drop CHECK (or restore two-value CHECK). Adapter:

```sql
UPDATE idempotency_journal SET status='aborted_retryable', result_json=NULL
WHERE attempt_id=$1 AND status='in_flight';
```

(`markRetryable` no-ops/throws if 0 rows updated.)

## Data Flow

```
parseCommand → startWork(CAS)
  → authority(delegation + isWindowActive + !revoked + checkSod + checkGrant)
  → llm.complete(STABLE_PREFIX+work) → parseLlmPlan
  → PRE-EFFECT journal.lookup(companyId, key):
       completed + same hash     → REPLAY resultJson; STOP
       completed + diff hash     → DENY idempotency-conflict; STOP
       aborted_retryable + same  → insertInFlight reopen → in_flight → execute
       aborted_retryable + diff  → DENY
       in_flight                 → post-effect/recovery path (no re-insert)
       none                      → insertInFlight COMMITTED → execute
  → sandbox.execute                    // OUTSIDE terminal tx
  → POST reconcile / verify
  → finalizeInFlightWorkAtomically(tx) // see CAS-loss
```

## Finalize CAS-loss — transaction boundary (closes the brick)

```
finalize tx T1:
  work.get → updateIfVersion(completed)
  if CAS ok  → receipts.save → journal.complete(success) → COMMIT
  if CAS lose → STOP before receipts.save → ROLLBACK T1
                // pre-committed in_flight SURVIVES (unlike foundation in-tx insert)

AFTER T1 rollback (separate committed writes — marker durability):
  (i) work still in_progress + effect applied:
        sandbox.undo(handle)
        T2: journal.markRetryable(attemptId)   // OWN commit → aborted_retryable
        return { ok:false, reason:'cas-lost-retryable' }  // controlled retry allowed
  (ii) work already terminal + effect applied:
        do NOT undo; do NOT markRetryable
        T2': journal.complete(attemptId, {ok:false, reason:'UNRESOLVED_REQUIRES_HUMAN'})
        return UNRESOLVED_REQUIRES_HUMAN   // never fabricate in_progress / undo
```

**Honest twin claim:** keeps CAS+receipt+complete **in one tx** on success. Does **not** inherit D6's "CAS-loss rolls back in_flight". Compensating parity = **`markRetryable` in T2** (durable, restart-safe) + undo when work still completable.

## Reconciliation tables

**Pre-effect lookup**

| Journal | Action |
|---|---|
| completed + same hash | REPLAY; no effect |
| completed + diff hash | DENY |
| aborted_retryable + same hash | reopen via `insertInFlight` → fresh effect path |
| aborted_retryable + diff hash | DENY |
| none | `insertInFlight` → execute |
| in_flight + same hash | recovery path (no re-insert) |

**Post-effect / restart**

| Journal | Applied | Work | Action |
|---|---|---|---|
| in_flight | true | `in_progress` | undo + `markRetryable` (not failure-complete) |
| in_flight | false | `in_progress` | continue effect→verify→terminal |
| in_flight | true | **terminal** | no undo; `complete(UNRESOLVED…)`; `UNRESOLVED_REQUIRES_HUMAN` |
| in_flight | disagree | any | `UNRESOLVED_REQUIRES_HUMAN` |
| aborted_retryable | any | `in_progress` | controlled retry (pre-effect reopen) |

Other post-effect failures (verify fail, terminal throw) with work still `in_progress` + applied: same as CAS-loss (i) — undo + `markRetryable`.

## SandboxPort

```typescript
type SandboxAction = { type:'create-document'; relativePath:string; content:string };
type UndoHandle = { handleId:string; action:SandboxAction; applied:true };
type EffectRecord = { effectId:string; action:SandboxAction; absolutePath:string; applied:boolean; undo:UndoHandle };
interface SandboxPort {
  execute(action:SandboxAction): Promise<EffectRecord>;
  undo(handle:UndoHandle): Promise<void>;
  wasApplied(handleId:string): Promise<boolean>;
}
```

FileDocumentSandbox (exclusive create, undo=`unlink`); InMemorySandbox; DurableSandboxFake (JSON durabilityPath).

## Foundation Calls

| Step | API |
|---|---|
| Claim | `startWork` |
| Authority | `DelegationRepository.get`; `isWindowActive`; !revoked; `checkSod`+`ABSOLUTE_PAIRS`; `checkGrant` |
| Intent | `LlmClient.complete`; `parseLlmPlan`/`parseCommand`; `evidenceId`; `journal.lookup` then `insertInFlight` (incl. reopen) |
| Effect | `SandboxPort.execute` outside terminal tx |
| Verify | Distinct verifier; fail→undo+`markRetryable` if still in_progress |
| Terminal | finalize T1; CAS-loss → T2 `markRetryable` or UNRESOLVED path |
| Marker | `journal.markRetryable(attemptId)` own commit |

**SoD:** `WorkerPrincipals={proposer,approver,executor,verifier}` — four distinct E2E IDs.

**Prefix:** `STABLE_SYSTEM_PREFIX` system message + dynamic user tail; FakeLlmClient canned `LlmPlanShape` with create-document step.

## File Changes

| File | Action | Notes |
|---|---|---|
| `business-domain/src/ports/idempotency.ts` | Modify | `JournalStatus` + `markRetryable` |
| `business-domain/src/ports/fakes.ts` | Modify | status domain, markRetryable, insert reopen |
| `business-domain/test/*` | Modify/Create | journal unit + status domain |
| `database/sql/005_journal_retryable_status.sql` | Create | CHECK three statuses |
| `database/src/idempotency-adapter.ts` | Modify | `markRetryable` SQL; insert reopen UPDATE |
| `database/test/*` | Modify/Create | adapter + migration + PG marker durability |
| `packages/app/package.json` + `src/**` + `test/**` | Create | sandbox, worker, wiring, boundary |
| `tsconfig*.json`, `pnpm-workspace.yaml` | Modify | include app; honesty comment |

## Testing

| Layer | What |
|---|---|
| Unit A | Journal status domain, markRetryable, lookup table, insert reopen; sandbox port/fake/adapter |
| Unit B | Worker cycle over fakes; lifecycle; boundary; **parity**: app replay/DENY ≡ `completeWork`; **parity**: CAS-loss→markRetryable→retry wins ≡ foundation rollback-then-retry |
| Integration C | Live PG 18.4: marker durable across restart; single receipt across retry; E2E happy; replay/DENY |

**47 scenarios:** idempotency-journal 13→A (+C durability/receipt); sandbox-port 11→A; worker-cycle 23→B (+C E2E/replay/receipt/restart).

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/PR/executable classification.

## Slices (all `size:exception`)

| Slice | Delivers | Forecast | TDD |
|---|---|---|---|
| **A** | Journal marker (port+fake+005+adapter+tests) + app shell + SandboxPort/fake/adapter | ~450–550 | RED journal+sandbox → GREEN |
| **B** | Worker cycle + reconcile/finalize CAS-loss paths + lifecycle unit + boundary + parity | ~500–600 | RED cycle → GREEN fakes |
| **C** | E2E wiring; live PG marker restart, retry receipt, happy, replay/DENY | ~550–700 | RED integration → GREEN |

Build order A→B→C (marker is foundation; worker depends on it).

## Migration / Rollout

1. Apply `005_journal_retryable_status.sql` (idempotent).
2. Ship domain port/fake + adapter + app.

**Rollback:** revert 005 (drop/restore CHECK); revert journal port/fake/adapter/tests; delete `packages/app` sources + new specs. Existing completed/in_flight rows remain valid.

## Open Questions

None blocking.