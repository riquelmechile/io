# Tasks: Harden First Enterprise Vertical Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1050–1250 total (A ~330 / B ~380 / C ~390) |
| 400-line budget risk | High total; Medium-High per slice (C highest) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (A) → PR2 (B) → PR3 (C), stacked-to-main |
| Delivery strategy / Chain | auto-chain / stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

All test/build commands run with `PATH=/data/node24/bin` (Node 24).

| Unit | Goal | PR | Focused test | Runtime harness | Rollback boundary |
|------|------|----|--------------|-----------------|-------------------|
| A | Authority + scope | PR1 | `pnpm vitest run packages/trust-kernel packages/business-domain` | N/A — pure domain + fakes; live PG lands in B | Revert PR1: sod/model/grant/identity/pipeline + companyId + scoped repos |
| B | Persistence + concurrency | PR2 | `pnpm vitest run packages/database` | `pnpm vitest run packages/database/test/*integration*` vs docker PG 18.4 | Revert PR2: connection/pg-connection/fake/adapters/004; A stays |
| C | Use cases + idempotency + validation | PR3 | `pnpm check` | `business-pg-roundtrip.integration.test.ts` (atomic close) | Revert PR3: use-cases/validation/row-guards/journal; A+B stay |

## Phase 1: Slice A — Authority + Scope (PR1)

- [x] 1.1 RED trust-kernel/sod.test.ts: self-approve, self-verify, low proposer=approver DENY, distinct-ok (SoD ×4).
- [x] 1.2 GREEN trust-kernel/sod.ts: append `['proposer','approver']` to ABSOLUTE_PAIRS (D2).
- [x] 1.3 RED trust-kernel/{model,grant,identity,pipeline}.test.ts: future-start inactive, active passes, expired fails, start==now active, now==expiry inactive (Window ×5).
- [x] 1.4 GREEN trust-kernel/model.ts: add `isWindowActive(start,now,expiry)=start<=now<expiry`; wire into grant.ts, identity.ts, pipeline.ts expiryGate.
- [x] 1.5 RED trust-kernel/pipeline.test.ts: deferred steps carry non-ALLOW marker (DEFERRED), no silent ALLOW; pass-through documented; any-failure→DENY; evaluate awaited (Pipeline ×4).
- [x] 1.6 GREEN trust-kernel/pipeline.ts: passThrough records non-ALLOW marker (widen StepResult if needed).
- [x] 1.7 RED business-domain/{types,fakes}.test.ts: non-empty companyId required (Delegation/Work/Receipt), Work version init 1, empty companyId rejected, scoped get wrong-company→not-found (Company ×3, Delegation-fields ×3, Work-fields ×3).
- [x] 1.8 GREEN business-domain/types.ts: add companyId (×3) + Work.version; ports/repositories.ts scoped get(companyId,id); ports/fakes.ts enforce scope + reject empty companyId.
- [x] 1.9 RED+GREEN business-domain delegation-window tests: future inactive, in-window active, expired inactive, validFrom==now active (Delegation-window ×4).
- [x] 1.10 RED+GREEN database/business-adapters.test.ts + {delegation,work,business-receipt}-adapter.ts: company_id INSERT/SELECT, scoped get WHERE company_id=$N, receipt carries companyId (scope ×adapters).
- [x] 1.11 Verify A: `pnpm check` green; no cross-aggregate import.
- [x] 1.12 GREEN database/sql/003_harden_columns.sql: additive company_id/version columns so Slice A adapters are coherent with live PG (coherence fix found during live-PG verification).

## Phase 2: Slice B — Persistence + Concurrency (PR2)

- [ ] 2.1 RED database/connection-port.test.ts: transaction(fn) resolves Promise<T> of fn result; port driver-free; execute/query async (Port ×3).
- [ ] 2.2 GREEN database/connection.ts: add `transaction<T>(fn:(conn)=>Promise<T>):Promise<T>` (D1).
- [ ] 2.3 RED database/pg-connection.test.ts + integration: commit persists, error rolls back no partial, nested throws, live round-trip, conn-string isolation, close() not on port (PG ×6).
- [ ] 2.4 GREEN database/pg-connection.ts: pool.connect→BEGIN→tx {execute,query,transaction:rejectNested}→fn→COMMIT+release; throw→ROLLBACK+release+rethrow.
- [ ] 2.5 RED database/connection-fake.test.ts: commit keeps / error restores+rethrows; nested throws; records+round-trips; non-durable disclosure; mirrors PG (Fake ×4).
- [ ] 2.6 GREEN database/test/connection-fake.ts: snapshot tables+idCounters, restore on throw; add UPDATE parse for CAS; nested throws.
- [ ] 2.7 RED+GREEN database/sql/004_harden_constraints.sql: terminal_event_id column + UNIQUE indexes (company/delegation/work/receipt + work×terminal) + idempotency_journal (company_id/version columns already present via 003; column additions use IF NOT EXISTS) (design 004).
- [ ] 2.8 RED business-domain/fakes.test.ts + database/business-adapters.test.ts: CAS success N→N+1; stale→{ok:false,reason:'version-conflict',current?}; concurrent single winner (CAS ×3).
- [ ] 2.9 GREEN business-domain/ports/{repositories,fakes}.ts + database/work-adapter.ts: updateIfVersion (PG `UPDATE … version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3`, 0 rows→conflict); fake compares version; save insert-only.
- [ ] 2.10 RED+GREEN business-domain/types.ts + database/business-receipt-adapter.ts: terminalEventId; INSERT/SELECT terminal_event_id+company_id; UNIQUE(work_id,terminal_event_id) — first ok, dup receiptId rejected, dup work×terminal rejected (Receipt ×5).
- [ ] 2.11 GREEN database/{delegation,work,business-receipt}-adapter.ts: reject empty companyId (PG/fake validation parity) — follow-up from Slice A adversarial review WARNING.
- [ ] 2.12 Verify B: `pnpm vitest run packages/database` + PG integration green (not skipped).

## Phase 3: Slice C — Use Cases + Idempotency + Validation (PR3)

- [ ] 3.1 RED business-domain/use-cases.test.ts: accept proposed→accepted, version N→N+1, {ok:true,value}; conflict→{ok:false,reason:'version-conflict'} no throw; raw save not transition path (Use-cases ×3).
- [ ] 3.2 GREEN business-domain/use-cases/{result,propose,accept,start,complete,verify,reject}-work.ts,index.ts: six transitions, deps=ports only (zero @io/*), typed result, no throw-for-control-flow (D3); demote raw save.
- [ ] 3.3 RED+GREEN idempotency (D6) database/idempotency-adapter.ts + use-case wiring: lookup→replay(same hash)/DENY(diff)/continue; atomic close in one tx (journal in_flight→CAS→receipt terminal_event_id=attempt_id→complete); throw→rollback. Tests: replay, diff-hash DENY, no partial write.
- [ ] 3.4 RED business-domain/validation.test.ts: valid→{ok:true,value}, invalid→{ok:false,reason} no throw, runtime-not-type-only (Contract ×3); parseCommand valid/invalid (Command ×2).
- [ ] 3.5 GREEN business-domain/validation/command.ts: parseCommand(unknown) runtime checks, no @io/* import.
- [ ] 3.6 RED+GREEN business-domain/validation/llm-plan.ts: parseLlmPlan plain {steps:{action,args}[],intent?} valid/malformed; NO @io/llm-client import; plan non-authority (LLM ×3).
- [ ] 3.7 RED+GREEN database/row-guards.ts + test: valid row passes, corrupt row rejected with reason (PG-rows ×2).
- [ ] 3.8 GREEN evidenceId (D8): stable `ev:${companyId}:${idempotencyKey}` across retries (not actionId/nonce/now).
- [ ] 3.9 Hygiene: README/workspace honesty comment + CI runs PG integration visibly (fail if unavailable, no silent skip).
- [ ] 3.10 Verify C: `pnpm check` green; 411 tests; domain-pure (no @io/* in business-domain).
