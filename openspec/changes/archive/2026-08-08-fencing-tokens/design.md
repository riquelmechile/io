# Design: Fencing Tokens (Zombie-Writer Protection)

## Technical Approach

Mint a monotonic fencing token at the Work claim CAS, store it on both the Work row and the idempotency journal row, and require it on every claim-owned terminal/retry write. Receipts/events keep their existing in-tx CAS protection (T1 shape unchanged). Replay stays token-free; resume keeps the same token; only a fresh claim bumps it. Maps to proposal Approach 1 and the three delta specs (work-lifecycle mint/check, worker-cycle claim→close threading, idempotency-journal store/gate).

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|---|---|---|---|
| Token crosses port boundary? | (A) token on `IdempotencyJournalPort` (B) keep DB-internal | A: token is a domain concept (claim ownership), threaded cleanly; B impossible — token originates at Work CAS (other table/adapter), journal cannot learn it without the port | **A** — `NewJournalEntry`/`JournalEntry` += `fencingToken`; `markRetryable(attemptId, fencingToken)`; `complete` stays token-free (status guard only → honest T2(ii) lands) |
| Work CAS evolution | (A) `updateIfVersion(work, ver, fencing?)` directive (B) new `claimWithFencing`/`completeWithFencing` | A: spec names `updateIfVersion` as the minting/checking CAS; one method, fake mirrors once; B triples surface + SQL-pin churn | **A** — `FencingDirective`; absent ⇒ version-only (plain transitions unchanged) |
| Conflict typing | new `'fencing-conflict'` vs reuse `'version-conflict'` | distinct reason diagnoses zombie vs race; both route to T2 reconcile identically | **new `'fencing-conflict'`** on `CasResult` |
| Claim mint mechanics | server-side `fencing_token=fencing_token+1 … RETURNING` | atomic, race-free under row lock; needs `query()` (reads row) not `execute()` | **RETURNING** in same statement |
| Terminal-check scope | every terminal CAS vs claim-owned only | spec "terminal-close CAS MUST match token" targets claim-owned closes; plain admin transitions have no claim (token 0 = epoch) | **claim-owned only** — directive supplied by worker finalize + idempotent completeWork; plain `applyWorkTransition` stays version-only |

## Data Flow

```
claim (startWork, directive 'claim')
  │ UPDATE work SET … fencing_token=fencing_token+1 WHERE ver=N RETURNING fencing_token
  └→ Work.fencingToken=N+1  (one winner; losers→version-conflict, no effect)
      ├→ resume: token retained (read from Work row; no re-claim, no increment)
      ├→ insertInFlight({…, fencingToken})  → journal.fencing_token=N+1 (pre-effect)
      ├→ terminal close (finalize, directive 'terminal', expectedFencingToken=N+1)
      │     UPDATE work … WHERE ver=N AND fencing_token=N+1  mismatch→fencing-conflict→T2 rollback
      └→ CAS-loss reconcile: markRetryable(attemptId, N+1)
            UPDATE … WHERE attempt_id AND status='in_flight' AND fencing_token=N+1
              stale token N→0 rows→reject (fake/PG parity)
```
Replay (completed + same hash): returns stored result, NO token, NO effect, NO receipt.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/database/sql/010_fencing_tokens.sql` | Create | `ALTER TABLE work ADD COLUMN IF NOT EXISTS fencing_token INTEGER NOT NULL DEFAULT 0`; same for `idempotency_journal`. Additive/idempotent. |
| `packages/business-domain/src/types.ts` | Modify | `Work` += `readonly fencingToken: number` (init 0). |
| `packages/business-domain/src/ports/repositories.ts` | Modify | `CasResult` += `'fencing-conflict'`; `updateIfVersion` += optional `FencingDirective`; export the type. |
| `packages/business-domain/src/ports/idempotency.ts` | Modify | `NewJournalEntry`/`JournalEntry` += `fencingToken`; `markRetryable(attemptId, fencingToken)`. |
| `packages/business-domain/src/ports/fakes.ts` | Modify | `InMemoryWorkRepository` (mint/check) + `InMemoryIdempotencyJournalRepository` + `DurableJournalFake` parity. |
| `packages/business-domain/src/use-cases/{start-work,result,complete-work}.ts` | Modify | `applyWorkTransition` += optional directive; `startWork` passes `{kind:'claim'}`; `CompleteWorkCommand` += optional `fencingToken`→terminal directive. |
| `packages/database/src/{work-adapter,idempotency-adapter,row-guards}.ts` | Modify | claim `RETURNING` mint; terminal `AND fencing_token=$X`; `insertInFlight` stores token; `markRetryable` token-gated; `complete` status-guarded (`AND status='in_flight'`); `parseWorkRow` validates `fencingToken` (non-negative int); SELECT lists += column. |
| `packages/app/src/worker/{worker,finalize,reconcile}.ts` | Modify | capture `work.fencingToken` at claim; thread to `reconcilePreEffect`→`insertInFlight`, `finalizeInFlightWorkAtomically` terminal CAS, `reconcilePostEffectFailure`→`markRetryable`. `FinalizeInput` += `fencingToken`. |
| `packages/app/test/daemon/byte-identity.test.ts` | Modify | re-pin `worker/worker.ts` baseline per slice; review model-normalization proof. |
| `packages/database/test/{sql-migrations,business-adapters,idempotency-adapter,business-pg-roundtrip}.test.ts` | Modify | add 010 block; update pinned SQL strings; apply 010 in live-PG setup. |

## Interfaces / Contracts

```ts
// ports/repositories.ts
export type FencingDirective =
  | { readonly kind: 'claim' }
  | { readonly kind: 'terminal'; readonly expectedFencingToken: number };
export type CasResult =
  | { ok: true; value: Work }
  | { ok: false; reason: 'version-conflict' | 'fencing-conflict'; current?: Work };
updateIfVersion(work: Work, expectedVersion: number, fencing?: FencingDirective): Promise<CasResult>;
// ports/idempotency.ts
insertInFlight(entry: NewJournalEntry /* +fencingToken */): Promise<JournalClaimResult>;
markRetryable(attemptId: string, fencingToken: number): Promise<void>;
complete(attemptId: string, resultJson: unknown): Promise<void>; // unchanged: status guard, NO token
```
```sql
-- claim mint (query(): reads RETURNING)
UPDATE work SET state=$5, version=version+1, fencing_token=fencing_token+1 …
  WHERE work_id=$1 AND company_id=$2 AND version=$3 RETURNING fencing_token AS "fencingToken";
-- terminal check        … WHERE work_id=$1 AND company_id=$2 AND version=$3 AND fencing_token=$9
-- journal markRetryable UPDATE idempotency_journal SET status=$2, result_json=$4
                           WHERE attempt_id=$1 AND status=$3 AND fencing_token=$5
-- journal complete      UPDATE idempotency_journal SET status=$2, result_json=$3
                           WHERE attempt_id=$1 AND status='in_flight'   -- status guard, NO token
```

## Testing Strategy

| Layer | What | File |
|---|---|---|
| Unit | claim mints N+1 from epoch 0; stale terminal token→fencing-conflict (no mutation); markRetryable stale-token reject; complete status-guard (non-in_flight reject) + token-free; resume keeps token; replay token-free | `business-domain/test/fakes.test.ts`, `test/idempotency.test.ts` |
| Unit | pinned SQL: claim RETURNING, terminal `AND fencing_token`, markRetryable token-gated, complete status-guard | `database/test/business-adapters.test.ts`, `test/idempotency-adapter.test.ts` |
| Parity | fake vs PG: outcomes/versions/tokens/stored-states for claim, stale-close, matching/stale/token-0 retry | `app/test/parity.test.ts` |
| Worker | exactly-one-winner; stale-token close rolls back Work+journal+receipt+event; CAS-loss+applied→markRetryable(token); same-token resume bytes==baseline | `app/test/worker-finalize.test.ts`, `worker-reconcile.test.ts`, `worker-restart.test.ts` |
| Migration | 010 ships, additive, IF NOT EXISTS, DEFAULT 0 on both tables | `database/test/sql-migrations.test.ts` |
| Integration (live PG, `--no-file-parallelism`) | end-to-end claim→close; stale-token rollback; marker survives restart | `database/test/business-pg-roundtrip.integration.test.ts` |
| Byte-identity | worker.ts re-pinned; token never enters compiled context (intent.ts untouched) | `app/test/daemon/byte-identity.test.ts` |

Every scenario across the three delta specs maps to a row above (work-lifecycle→fakes/business-adapters/parity; worker-cycle→worker-*; idempotency-journal→idempotency.*).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary.

## Migration / Rollout

Two stacked-to-main slices, each <400 lines, alone-verifiable:

- **Slice 1 — Work-level fencing**: migration 010 (both columns), `Work.fencingToken`+`parseWorkRow`, `FencingDirective`+`CasResult`, PG work-adapter mint/check, fake parity, `startWork`/`applyWorkTransition`/`completeWork` terminal directive, worker claim-capture + finalize terminal CAS, byte-identity re-pin. **Acceptance**: claim mints N+1; stale token cannot close Work; plain transitions unaffected; journal.fencing_token inert at 0.
- **Slice 2 — Journal fencing**: port signature (`NewJournalEntry`/`JournalEntry`/`markRetryable`), PG idempotency-adapter (store/gate/status-guard), fake+Durable parity, `reconcilePreEffect`+`finalize` markRetryable token threading, worker insertInFlight token, second byte-identity re-pin. **Acceptance**: stale-token markRetryable rejected; complete status-guarded (non-in_flight reject); honest T2(ii) UNRESOLVED lands token-free; controlled retry retains token N.

Rollback: revert slice 2 then 1; `DEFAULT 0` columns are inert (epoch = legacy); no backfill; optional `DROP COLUMN`.

## Coordination Notes

- **Fake↔PG parity**: every SQL change mirrored in `InMemoryWorkRepository`/`InMemoryIdempotencyJournalRepository`/`DurableJournalFake`; `parity.test.ts` is the gate.
- **Byte-identity pin**: worker.ts is protected and changes in BOTH slices (claim-capture S1, journal-token S2). Re-pin `PROTECTED_SOURCES['worker/worker.ts']` per slice; the PR2 model-normalization proof needs review (token threading is a new, orthogonal drift axis — extend or replace the proof). dispatch.ts/tick.ts/supervisor.ts/intent.ts UNCHANGED (token never leaves the cycle, never enters compiled context).
- **`completeWorkAtomically` vs `finalizeInFlightWorkAtomically`**: spec names the former; shipped worker uses the latter. Both terminal CAS paths get the terminal directive for spec compliance; finalize is primary.
- **SQL-string pinning**: `business-adapters.test.ts`/`idempotency-adapter.test.ts` assert exact SQL — update assertions alongside adapter SQL.

## Open Questions

- [ ] Byte-identity: extend the worker.ts model-normalization proof to also strip token threading, or replace it with a direct pin?
- [ ] Should `completeWork`'s plain (non-idempotent) path gain a token-checked terminal CAS, or stay version-only by design for unclaimed admin closes? (Current design: version-only.)
