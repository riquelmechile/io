# Tasks: PostgreSQL Adapter — Injectable DbConnection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300 (additions; +2 tsconfig `include` lines) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (2 work-unit commits) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (cached; not triggered — under budget) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Scaffold + `DbConnection` port + `InMemoryDbConnection` fake | PR 1 (commit 1) | `pnpm test packages/database/test/connection-fake` | N/A — library, `integration:false`, no transport/daemon/PG; vitest unit run is the only execution path | Delete `packages/database/{src/connection.ts,test/connection-fake.ts,test/connection-fake.test.ts,package.json}` + revert tsconfig includes; `pnpm install` |
| 2 | `PgEvidenceRepository` + `PgAuditRepository` + boundary guards + exports/docs | PR 1 (commit 2) | `pnpm test packages/database` | N/A — same (sync fake instant, no real PG) | Delete adapter `src/*.ts` + `test/*.test.ts`; leave port + fake intact |

## Phase 1: Package Scaffold & DbConnection Port (Req 1)

- [x] 1.1 Create `packages/database/package.json` — `@io/database`, `private:true`, `type:module`, `@io/trust-kernel` in devDependencies, `dependencies:{}` (D4). **No `pnpm-workspace.yaml` edit** — glob `packages/*` already covers it (Finding 1).
- [x] 1.2 Add `packages/database/**/*.ts` to `tsconfig.json` include; `packages/database/src/**/*.ts` to `tsconfig.build.json` include.
- [x] 1.3 RED `test/connection-port.test.ts` — `execute`/`query` return SYNCHRONOUS types (no `Promise`); module imports no `pg`/ORM/framework; surface has zero table/schema awareness (scenarios 1–2; threats: leakage, sync/async debt).
- [x] 1.4 GREEN `src/connection.ts` — `DbRow` type + `DbConnection { execute(sql, params): unknown; query<T>(sql, params): readonly T[] }` (D1/D2 — `DbExecuteResult` rejected; D3 PG-shaped).
- [x] 1.5 REFACTOR — `import type` only; JSDoc citing PG 18.4 target + zero-driver contract.

## Phase 2: InMemoryDbConnection Test Double (Req 4)

- [x] 2.1 RED `test/connection-fake.test.ts` — every `execute`/`query` recorded as `{sql,params}` in order; data written via `execute` round-trips via `query` synchronously (scenario 1).
- [x] 2.2 RED — fake discloses it is NOT durable and NOT real PostgreSQL (scenario 2; threat: honesty).
- [x] 2.3 GREEN `test/connection-fake.ts` — `InMemoryDbConnection implements DbConnection`: operations log + evidence row store + audit ordered store; export `DISCLOSURE` (D6).
- [x] 2.4 REFACTOR — shared `SELECT`-pattern parse; sync-only (no async).

## Phase 3: PgEvidenceRepository — Req 2 / R7

- [x] 3.1 RED `test/evidence-adapter.test.ts` — `save()` emits exact `INSERT INTO evidence (...) VALUES ($1..$8)` + param order `[actionId,principalId,riskClass,decision,reason,timestamp,persistent,disclosure]` (threat: SQL shape).
- [x] 3.2 RED — `get()` emits exact `SELECT ... AS "actionId" ... WHERE action_id = $1` and round-trips the record incl. `persistent: true` literal (threat: type confusion).
- [x] 3.3 GREEN `src/evidence-adapter.ts` — `PgEvidenceRepository implements EvidenceRepository<PersistentRecord>` over injected `DbConnection`; `session?` accepted/ignored (D2/D5; DbSession deferred, `S=unknown`).
- [x] 3.4 RED — adapter module carries `PERSISTENT_PORT_DISCLOSURE`; MUST NOT claim to satisfy R1–R17 (Req 5 scenario 1).
- [x] 3.5 GREEN — re-export `PERSISTENT_PORT_DISCLOSURE` (kernel, `import type`-safe) on adapter module (D6).
- [x] 3.6 REFACTOR — extract shared column-alias SQL builder (reused Phase 4).

## Phase 4: PgAuditRepository — Req 3 / R16

- [x] 4.1 RED `test/audit-adapter.test.ts` — `append()` emits exact `INSERT INTO audit (...) VALUES ($1..)`; `getLog()` emits `... ORDER BY id ASC` (threat: SQL shape).
- [x] 4.2 RED — `getLog()` preserves insertion order; a prior log reference MUST NOT be mutated/dropped (immu Req 3 scenario).
- [x] 4.3 GREEN `src/audit-adapter.ts` — `PgAuditRepository implements AuditRepository<PersistentRecord>`; `append` INSERTs one row then returns fresh `getLog()` (D2/D5).
- [x] 4.4 RED — adapter carries `PERSISTENT_PORT_DISCLOSURE`; MUST NOT claim R1–R17 (Req 5 scenario 1).
- [x] 4.5 GREEN — re-export `PERSISTENT_PORT_DISCLOSURE` (D6).
- [x] 4.6 REFACTOR — reuse SQL builder from 3.6.

## Phase 5: Boundary & Exclusion Guards (Req 5 scenario 2)

- [x] 5.1 RED `test/boundary.test.ts` — no `pg` import anywhere in `packages/database`; runtime `dependencies:{}`; `import type` only (threat: leakage).
- [x] 5.2 RED — no real PG connection opened; no migration files exist; `openspec/config.yaml` `integration:false` holds.
- [x] 5.3 RED — `packages/database` stays excluded from 8+12+10=30 canonical partition (extraction staging).
- [x] 5.4 GREEN — structural assertions pass against built package (no new prod code).

## Phase 6: Exports, Docs & Final Verification

- [x] 6.1 Create `src/index.ts` — public exports: `DbConnection`, `DbRow`, `PgEvidenceRepository`, `PgAuditRepository`.
- [x] 6.2 Create `README.md` — scope: first adapter slice only; sync/async debt + `DbSession` explicitly deferred; excluded from canonical partition.
- [x] 6.3 Run `pnpm check` (format-check → typecheck → build → lint → test); existing tests + new adapter tests green; kernel ports unchanged (read-only).
