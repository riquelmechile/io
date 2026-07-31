# Tasks: Harden First Enterprise Vertical Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400–1800 (3 slices) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice A) → PR 2 (Slice B) → PR 3 (Slice C), all to main |
| Delivery strategy | exception-ok |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| A | SoD fix + window gate + company scope | PR 1 | `pnpm --filter @io/trust-kernel test` | `pnpm test` (411 stay GREEN) | sod.ts pair, model.ts helper, scope fields |
| B | transaction + UNIQUE + Work CAS versioning | PR 2 | `pnpm --filter @io/database test` | real PG integration (CI) | connection.ts method, 003 migration, version field |
| C | transition use cases + idempotency + guards | PR 3 | `pnpm --filter @io/business-domain test` | use-case fakes + PG journal | use-cases/, validation/, idempotency-adapter.ts |

> All `pnpm`/`tsc` commands require `export PATH="/data/node24/bin:$PATH"` first. Strict TDD: RED task then GREEN task per item.

## Phase 1 — Slice A: SoD + Activation Window (trust-kernel)

- [x] 1.1 RED: `sod.test.ts` — proposer==approver DENIES at low risk with `allowsLowCombination`, at every tier
- [x] 1.2 GREEN: add `['proposer','approver']` to `ABSOLUTE_PAIRS` in `packages/trust-kernel/src/sod.ts`
- [x] 1.3 RED: `model.test.ts` — `isWindowActive(futureStart, now, expiry)` returns false; `start<=now<expiry` true
- [x] 1.4 GREEN: add `isWindowActive(start, now, expiry)` to `packages/trust-kernel/src/model.ts`; export from `index.ts`
- [x] 1.5 RED: pipeline/grant/identity tests — future `start` DENIED at step 12; `grant.ts`/`identity.ts` exclude it
- [x] 1.6 GREEN: wire `isWindowActive` into `grant.ts` `isGrantActive`, `identity.ts` `resolveActiveIdentity`, `pipeline.ts` step 12 `expiryGate`
- [x] 1.7 Run `pnpm --filter @io/trust-kernel test` + `pnpm --filter @io/trust-kernel build` — 411 stay GREEN

## Phase 2 — Slice A: Company Scope (types + ports + adapters)

- [x] 2.1 RED: domain-type tests — Work/Delegation/BusinessReceipt require non-empty `companyId`; Work requires `version` (0 on create)
- [x] 2.2 GREEN: add `companyId` (+ Work `version`, Receipt `terminalEventId`) to `packages/business-domain/src/types.ts`
- [x] 2.3 RED: port tests — `get(id, companyId)` unscoped read impossible; cross-company returns undefined
- [x] 2.4 GREEN: update `ports/repositories.ts` signatures + `ports/fakes.ts`; add `WorkRepository.updateWithVersion`
- [x] 2.5 GREEN: update `packages/database/src/{work,delegation,business-receipt}-adapter.ts` — companyId param, terminal_event_id
- [x] 2.6 GREEN: update integration test fixtures to include companyId/version; run `pnpm --filter @io/database test`

## Phase 3 — Slice B: DbConnection.transaction (port + PG + fake)

- [x] 3.1 RED: `connection-fake.test.ts` — `transaction` commit persists both writes; throw → rollback restores snapshot
- [x] 3.2 GREEN: add `transaction<T>(fn)` to `DbConnection` in `packages/database/src/connection.ts`
- [x] 3.3 GREEN: `InMemoryDbConnection` snapshot/restore + nested-tx throws `NestedTransactionError`
- [x] 3.4 GREEN: `PgDbConnection.transaction` — `pool.connect()`, `BEGIN`/`COMMIT`/`ROLLBACK`, release in `finally`
- [x] 3.5 RED: nested `transaction` inside `fn` throws; GREEN: implement guard
- [x] 3.6 Integration: real PG `transaction` commit/rollback round-trip (CI)

## Phase 4 — Slice B: UNIQUE Constraints + Migration

- [x] 4.1 RED: integration — duplicate `company_id`/`work_id`/`receipt_id` insert rejected; duplicate `(work_id, terminal_event_id)` rejected
- [x] 4.2 GREEN: create `packages/database/sql/003_harden_business_tables.sql` — ADD COLUMN IF NOT EXISTS (company_id, version, terminal_event_id) + ADD CONSTRAINT IF NOT EXISTS UNIQUE + `idempotency_journal` table
- [x] 4.3 GREEN: apply 003 in integration `beforeAll` after 001/002

## Phase 5 — Slice B: Work Optimistic Concurrency (CAS)

- [x] 5.1 RED: `work-adapter.test.ts` — `updateWithVersion` with matching version → version+1; stale version → `VersionConflictError`; missing row → `NotFoundError`
- [x] 5.2 GREEN: implement `updateWithVersion` CAS `UPDATE ... WHERE work_id=$1 AND company_id=$2 AND version=$3; SET version=version+1`; probe on rowCount===0
- [x] 5.3 RED/ GREEN: integration CAS under real PG — two concurrent updates, exactly one wins

## Phase 6 — Slice C: Runtime Validation Guards

- [x] 6.1 RED: `validation/*.test.ts` — invalid command/row/transition/LLM-plan throw `ValidationError`
- [x] 6.2 GREEN: create `packages/business-domain/src/validation/{guards,errors}.ts` — `assertValidCommand`, `assertValidWorkRow`, `assertValidTransition` (reuse `canTransitionWork`), `assertValidLlmPlan`, `ValidationError`

## Phase 7 — Slice C: Transition Use Cases

- [x] 7.1 RED: `use-cases/propose.test.ts` — creates Work `proposed` v0 inside transaction; illegal/invalid rejected
- [x] 7.2 GREEN: create `packages/business-domain/src/use-cases/propose-work.ts` (validate → authority/SoD → persist)
- [x] 7.3 RED/GREEN per transition: `acceptWork`, `startWork`, `completeWork`, `verifyWork`, `rejectWork` — each validates, checks window, CAS-updates version, runs in `transaction`
- [x] 7.4 RED: self-approval at transition time → trust kernel DENIES → no persist; GREEN: wire `evaluate`/`checkSod` into use cases

## Phase 8 — Slice C: Idempotency Journal

- [x] 8.1 RED: idempotency-store tests — same key+hash replays; same key+diff hash → `IdempotencyConflictError`; pre-effect before side-effect
- [x] 8.2 GREEN: `IdempotencyStore` port in `ports/repositories.ts`; in-memory fake + PG adapter `packages/database/src/idempotency-adapter.ts`
- [x] 8.3 GREEN: wire `register`/`complete` into transition use cases (register before CAS; complete on commit)

## Phase 9 — Hygiene

- [x] 9.1 RED: CI integration tests no longer silently skipped when PG service present; GREEN: add Postgres service to `.github/workflows/`
- [x] 9.2 Update `README.md` to reflect hardened foundation + 5-package layout
- [x] 9.3 Full gate: `export PATH="/data/node24/bin:$PATH" && pnpm check && pnpm test && pnpm build`
