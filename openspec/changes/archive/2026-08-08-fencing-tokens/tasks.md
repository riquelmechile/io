# Tasks: Fencing Tokens

TDD: RED→GREEN per task. `T=PATH=/data/node24/bin:$PATH pnpm test`; live-PG adds `--no-file-parallelism`. Est. ~580 lines (PR1 ≈320, PR2 ≈260); slices <400.

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Mint at claim CAS; check at terminal CAS | PR 1→main | `$T packages/app/test/worker-claim.test.ts` | `$T packages/database/test/business-pg-roundtrip.integration.test.ts --no-file-parallelism` (claim→close) | Revert PR 1; 010 columns inert at DEFAULT 0 |
| 2 | Journal token store; markRetryable gate; token-free complete | PR 2→main | `$T packages/database/test/idempotency-adapter.test.ts` | Same file: stale-rollback + marker-restart | Revert PR 2; journal token column inert at 0 |

## Phase 1: Slice 1 — Work-Level Fencing (PR 1)

- [x] 1.1 RED `packages/database/test/sql-migrations.test.ts`: 010 adds `fencing_token` INT NOT NULL DEFAULT 0, IF NOT EXISTS, to work + idempotency_journal. GREEN: create `packages/database/sql/010_fencing_tokens.sql`.
- [x] 1.2 RED `packages/business-domain/test/types.test.ts`: proposed Work, token 0, valid; `validation.test.ts`: empty `delegationId`/`companyId` rejected. GREEN: `Work.fencingToken` in `packages/business-domain/src/types.ts`.
- [x] 1.3 RED `packages/business-domain/test/fakes.test.ts`: claim mints 1 from epoch; stale terminal token → `fencing-conflict`, no mutation; version bump/conflict; single winner. GREEN: `FencingDirective` + `'fencing-conflict'` in `src/ports/repositories.ts`; mint/check in `src/ports/fakes.ts`.
- [x] 1.4 RED: `startWork` returns minted token; `completeWork` terminal directive rejects stale token. GREEN: directive in `packages/business-domain/src/use-cases/{start-work,result,complete-work}.ts`.
- [x] 1.5 RED `packages/database/test/business-adapters.test.ts`: pin claim `RETURNING` + terminal `AND fencing_token` SQL. GREEN: `packages/database/src/work-adapter.ts` claim via `query()`; `row-guards.ts` parseWorkRow token ≥0; SELECT lists.
- [x] 1.6 RED `packages/app/test/worker-claim.test.ts`: one winner gets N+1; loser `version-conflict`, no effect/receipt. GREEN: `packages/app/src/worker/worker.ts` captures token at claim.
- [x] 1.7 RED `packages/app/test/worker-finalize.test.ts`: stale-token close rolls back Work+journal+receipt+event. GREEN: terminal directive in `packages/app/src/worker/finalize.ts`; re-pin `packages/app/test/daemon/byte-identity.test.ts`.
- [x] 1.8 RED `packages/app/test/parity.test.ts`: fake vs PG claim/stale-close outcomes, tokens, states match. GREEN: wire gate.
- [x] 1.9 RED `packages/database/test/business-pg-roundtrip.integration.test.ts`: e2e claim→close, terminal Work + one receipt. GREEN: apply 010 in live-PG setup.

## Phase 2: Slice 2 — Journal Fencing (PR 2, on PR 1)

- [x] 2.1 RED `packages/business-domain/test/idempotency.test.ts`: `insertInFlight` stores token pre-effect; lookup (replay/DENY/in-flight) token-free; tenant scope; token-0 valid; `complete` rejects non-`in_flight`; token-free UNRESOLVED T2(ii) lands. GREEN: `fencingToken` on `NewJournalEntry`/`JournalEntry` in `src/ports/idempotency.ts` + `src/ports/fakes.ts`.
- [x] 2.2 RED idempotency.test.ts: `markRetryable` match → `aborted_retryable`; stale rejected unchanged; retry retains N. GREEN: gated fake `markRetryable(attemptId, token)`.
- [x] 2.3 RED `packages/database/test/idempotency-adapter.test.ts`: pin insert token column, `markRetryable AND fencing_token`, `complete AND status='in_flight'` (no token). GREEN: `packages/database/src/idempotency-adapter.ts`.
- [x] 2.4 RED `packages/app/test/worker-reconcile.test.ts`: CAS-loss+applied → `markRetryable(N)` persists; stale rejected; unresolvable → UNRESOLVED; no-effect → token-free replay. GREEN: `packages/app/src/worker/reconcile.ts` threading; `FinalizeInput += fencingToken`.
- [x] 2.5 RED `packages/app/test/worker-restart.test.ts`: marker survives restart; resume bytes == baseline. GREEN: `worker.ts` insertInFlight token; re-pin byte-identity proof.
- [x] 2.6 RED `packages/app/test/parity.test.ts`: journal matching/stale/token-0 parity. GREEN: extend gate.
- [x] 2.7 RED `packages/database/test/business-pg-roundtrip.integration.test.ts`: stale-token rollback e2e; marker survives restart. GREEN: thread token in live-PG cycle.

## Phase 3: Verification Gate

- [x] 3.1 Per slice: `PATH=/data/node24/bin:$PATH pnpm check` GREEN (tsc, biome, vitest). Evidence: 5 stacked commits (b83b5ec, 2725346, 58ceb06, 2bd67cd, 03532b7), each gated GREEN pre-commit; final fresh run 2026-08-08: exit 0, 1243 passed | 6 skipped (live-PG suites ran).
- [x] 3.2 Verify zero `@io/*` imports in business-domain; dispatch/tick/supervisor/intent unchanged; token absent from compiled bytes. Evidence (2026-08-08): 0 actual `@io/*` import statements in packages/business-domain/src (doc comments only); `git diff ce0fe4e..HEAD` = 0 lines for dispatch/supervisor/intent/heartbeat src; 0 fencingToken/fencing_token matches in packages/context/src; 0 package.json changes since ce0fe4e (no new runtime deps); openai confined to packages/llm-client/src/deepseek-client.ts (0 violations).
