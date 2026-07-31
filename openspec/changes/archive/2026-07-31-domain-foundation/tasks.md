# Tasks: Domain Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~750–900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (business-domain pkg) → PR 2 (PG adapters+schema) → PR 3 (integration) |
| Delivery strategy | exception-ok |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Threat matrix: N/A (no routing/shell/subprocess/VCS/exec classification — design §Threat Matrix). No RED threat tests.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `packages/business-domain/` complete: types, state machines, ports, fakes, unit tests (pure, zero deps) | PR 1 base=main | `pnpm test packages/business-domain` | N/A — pure in-memory, no I/O | delete `packages/business-domain/`, revert tsconfig includes |
| 2 | 4 PG adapters, SQL DDL, database wiring, adapter unit tests via InMemoryDbConnection | PR 2 base=PR 1 | `pnpm test packages/database` | mocked DbConnection in unit tests | remove 4 adapter files, SQL, revert `database/index.ts` + `package.json` |
| 3 | Real PG integration round-trip for all 4 types | PR 3 base=PR 2 | `pnpm test packages/database` | live PG 18.4 `localhost:5432` (io/io_dev) | remove `business-pg-roundtrip.integration.test.ts` |

## Phase 1 — Package Scaffold

- [x] 1.1 Create `packages/business-domain/package.json` — private, ESM, zero deps, mirror trust-kernel. [D1]
- [x] 1.2 Modify `tsconfig.json`: add `packages/business-domain/**/*.ts` to `include`. [D1]
- [x] 1.3 Modify `tsconfig.build.json`: add `packages/business-domain/src/**/*.ts` to `include`. [D1]
- [x] 1.4 Run `pnpm install`; verify `tsc --noEmit` passes.

## Phase 2 — Domain Types + State Machines (TDD)

- [x] 2.1 RED — `test/transitions.test.ts`: table-driven Delegation transitions — valid: draft→active, active→revoked, active→expired; invalid: draft→revoked/expired, revoked→*, expired→*. [delegation-lifecycle/State Machine: draft→active, invalid rejected, terminal frozen]
- [x] 2.2 RED — `test/transitions.test.ts`: table-driven Work transitions — valid: proposed→accepted, proposed→rejected, accepted→in_progress, in_progress→completed, completed→verified/rejected; invalid paths; terminals reject all. [work-lifecycle/State Machine: full happy path, invalid rejected, terminal frozen]
- [x] 2.3 RED — `test/types.test.ts`: assert Company requires `companyId`+`purpose` (non-omit); Delegation requires all 8 fields; Work requires `workId`+`delegationId`+`proposer`+`description`+`state`+`evidenceRefs`; BusinessReceipt requires all 9 fields. Empty `delegationId` unconstructable at type level. [company-identity/Minimal Identity; delegation-lifecycle/Authority Fields; work-lifecycle/Execution Fields; business-receipt/Receipt Links Authority]
- [x] 2.4 GREEN — `src/types.ts`: Company, AuthorityScope, Budget, DelegationState, Delegation, Deliverable, WorkOutcome, WorkState, Work, BusinessReceipt. [D2; D3]
- [x] 2.5 GREEN — `src/transitions.ts`: `DELEGATION_TRANSITIONS` + `canTransitionDelegation()`; `WORK_TRANSITIONS` + `canTransitionWork()`. [D4]
- [x] 2.6 GREEN — `src/index.ts`: barrel exports (types + transitions). Zero cross-aggregate imports.
- [x] 2.7 REFACTOR — `pnpm check` GREEN; assert no Work import in Delegation, no Delegation import in Work; `dependencies: {}` unchanged. [delegation-lifecycle/Aggregate Separation; work-lifecycle/Neutral Authority Reference; delegation-lifecycle/Work Does Not Grant Authority]

## Phase 3 — Repository Ports + Fakes (TDD)

- [x] 3.1 RED — `test/fakes.test.ts`: `save()`→`get()` round-trip for all 4 types — field-level equality incl. nested objects. `get(unknownId)`→`undefined`. [company-identity; delegation-lifecycle; work-lifecycle; business-receipt/Immutable Receipt: persisted]
- [x] 3.2 RED — `test/fakes.test.ts`: BusinessReceipt duplicate save rejected; original unchanged. [business-receipt/Single Issuance: first succeeds, duplicate rejected]
- [x] 3.3 GREEN — `src/ports/repositories.ts`: 4 async interfaces (CompanyRepository, DelegationRepository, WorkRepository, BusinessReceiptRepository). [D2]
- [x] 3.4 GREEN — `src/ports/fakes.ts`: 4 Map-backed implementations; BusinessReceiptRepository rejects duplicate `receiptId`.
- [x] 3.5 GREEN — update `src/index.ts`: export ports + fakes.
- [x] 3.6 REFACTOR — `pnpm test packages/business-domain` GREEN.

## Phase 4 — PG Adapters + Schema (TDD)

- [x] 4.1 RED — `packages/database/test/business-adapters.test.ts`: InMemoryDbConnection records SQL+params; assert exact `$N` binding order, `AS "camelCase"` aliases for all 4 adapters. [design §PG Adapter Pattern]
- [x] 4.2 RED — same file: save→get round-trip through InMemoryDbConnection; field-level equality incl. JSONB objects; nullable JSONB (deliverable, outcome) null→undefined. [design §Testing Strategy]
- [x] 4.3 GREEN — `sql/002_create_business_tables.sql`: 4 tables (SERIAL PK, snake_case, JSONB nested) + indices. Idempotent. [D6; design §SQL DDL]
- [x] 4.4 GREEN — `src/company-adapter.ts`: `PgCompanyRepository`. [D5]
- [x] 4.5 GREEN — `src/delegation-adapter.ts`: `PgDelegationRepository`. [D5]
- [x] 4.6 GREEN — `src/work-adapter.ts`: `PgWorkRepository`. [D5]
- [x] 4.7 GREEN — `src/business-receipt-adapter.ts`: `PgBusinessReceiptRepository`. [D5]
- [x] 4.8 GREEN — modify `src/index.ts`: export 4 adapter classes.
- [x] 4.9 GREEN — modify `package.json`: add `"@io/business-domain": "workspace:*"` to devDependencies. [D2]
- [x] 4.10 REFACTOR — `pnpm check` GREEN; adapters confined to `@io/database`; business-domain still zero deps.

## Phase 5 — Integration Tests (Real PG)

- [x] 5.1 RED — `test/business-pg-roundtrip.integration.test.ts`: connect via PgDbConnection; `beforeAll` execute `002` DDL; `beforeEach` TRUNCATE 4 tables RESTART IDENTITY; `afterAll` close(); save→get byte-identical for all 4 types. [business-receipt/Immutable Receipt: persisted; No update path]
- [x] 5.2 GREEN — implement round-trip; skip/pending when PG unreachable.
- [x] 5.3 REFACTOR/FINAL — verify all 363 existing tests pass; `pnpm check` + integration GREEN against live PG 18.4.

## Final State (verified 2026-07-31)

- **Completion**: 22/22 tasks complete (all phases green).
- **Verify**: PASS WITH WARNINGS — verify-report obs #5760 (topic `sdd/domain-foundation/verify-report`). 12/12 requirements, 24/24 scenarios covered (20 COMPLIANT, 4 PARTIAL), 363/363 tests green, 11 live-PG integration tests ran (not skipped), 0 CRITICAL findings.
- **Archive**: specs synced to `openspec/specs/{company-identity,delegation-lifecycle,work-lifecycle,business-receipt}/spec.md`; change moved to `openspec/changes/archive/2026-07-31-domain-foundation/`.
