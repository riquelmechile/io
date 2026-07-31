# Tasks: Wire Live PostgreSQL

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~620–720 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Slice 1 (async) → Slice 2 (pg+schema+boundary) → Slice 3 (integration+config) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Threat matrix: N/A (no routing/shell/subprocess/VCS/exec classification — design §Threat Matrix). No RED threat tests.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Async ports+pipeline+fakes+adapters+~50 test awaits (tsc-gated, no new deps) | PR 1 base=main | `pnpm test` | N/A — pure in-memory, no I/O | revert src+tests to sync; zero dep/config churn |
| 2 | PgDbConnection + pg dep + schema DDL + boundary allowlist + docker-compose | PR 2 base=PR 1 | `pnpm test packages/database` | `docker compose up -d`; mocked `pg.Pool` in unit tests | remove pg-connection.ts, sql/, pg dep, compose; revert boundary allowlist |
| 3 | Real-PG integration round-trip + config flip + final guard | PR 3 base=PR 2 | `pnpm test packages/database` | live PG 18.4 `localhost:5432` (io/io_dev) | remove pg-roundtrip.test.ts; `integration: true`→`false` |

## Phase 1 — Slice 1: Async Port & Pipeline Migration (tsc-gated, no new deps)

- [x] 1.1 RED — `test/connection-port.test.ts`: flip execute/query type assertions from "NOT a Promise" to "returns Promise<...>". [spec db-connection-port/DbConnection]
- [x] 1.2 RED — `ports.test.ts`: assert `save/get/append/getLog` return Promise. [spec persistence-port-boundary]
- [x] 1.3 GREEN — `src/connection.ts`: `execute`→`Promise<unknown>`, `query<T>`→`Promise<readonly T[]>`; strip "synchronous" JSDoc.
- [x] 1.4 GREEN — `ports/repositories.ts`: all four port methods → `Promise` (D1).
- [x] 1.5 GREEN — `ports/fakes.ts`: mark `InMemoryEvidenceRepository`/`InMemoryAuditRepository` methods `async` (bodies unchanged).
- [x] 1.6 GREEN — `test/connection-fake.ts`: mark `InMemoryDbConnection.execute/query` async; update disclosure doc.
- [x] 1.7 GREEN — `pipeline.ts`: `evaluate`/`finalize`/`routeThroughPorts` → `async`; `await` the save+append in `routeThroughPorts` (9 finalize return sites unchanged). [spec trust-kernel/Pipeline; D1]
- [x] 1.8 GREEN — `evidence-adapter.ts`+`audit-adapter.ts`: methods async; `await conn.execute/query`.
- [x] 1.9 GREEN — add `await` at all test call sites: pipeline.test.ts(12), ports.test.ts(13), evidence-adapter.test.ts(9), audit-adapter.test.ts(16), connection-fake.test.ts. tsc flags every miss.
- [x] 1.10 REFACTOR — `pnpm check` (biome+tsc+vitest) GREEN; kernel boundary test untouched; `dependencies: {}` unchanged.

## Phase 2 — Slice 2: PgDbConnection, pg Dep, Schema, Boundary Allowlist

- [x] 2.1 RED — new `test/pg-connection.test.ts`: implements async DbConnection; lazy pool (no Pool at construct); execute/query delegate to `pool.query`; `close()` ends pool, NOT on port; errors propagate. Mocked `pg.Pool`, no real PG. [spec db-connection-port/PgDbConnection; D2/D6]
- [x] 2.2 GREEN — `package.json`: `dependencies: { pg }` (pin v8.x, types included). [D4 — pg ONLY in @io/database]
- [x] 2.3 GREEN — new `src/pg-connection.ts`: `PgDbConnection` (lazy `getPool()`) + `pgConnectionString()` (DATABASE_URL env-default). Per design code block.
- [x] 2.4 GREEN — `src/index.ts`: export `PgDbConnection` (public surface).
- [x] 2.5 RED — assert `sql/001_create_tables.sql` exists with evidence+audit columns + `idx_evidence_action_id`. [spec db-connection-port/Schema]
- [x] 2.6 GREEN — new `sql/001_create_tables.sql`: evidence + audit tables (8 cols + SERIAL id) + index (design DDL verbatim, D7).
- [x] 2.7 RED/GREEN — `test/boundary.test.ts`: dependencies→allowlist `{pg}`; exempt `src/pg-connection.ts` from forbidden-import + realPgTokens; assert sql file exists; public surface adds PgDbConnection. (config `integration:false` assertion STAYS this slice.)
- [x] 2.8 — new `docker-compose.yml` (postgres:18.4, io/io_dev, port 5432, healthcheck, .pgdata volume). Design §docker-compose.
- [x] 2.9 REFACTOR — `pnpm check` GREEN; `pg` confined to `@io/database`; kernel still driver-free (kernel boundary test unchanged).

## Phase 3 — Slice 3: Integration Round-Trip + Config Flip + Final Guard

- [x] 3.1 RED — new `test/pg-roundtrip.test.ts`: connect via PgDbConnection; `beforeAll` execute DDL; `beforeEach` `TRUNCATE evidence, audit RESTART IDENTITY`; `afterAll` close(); evidence save→get byte-identical; audit append×N→getLog insertion order+immutability. [spec db-connection-port/Integration]
- [x] 3.2 GREEN — implement round-trip; skip/pending when PG unreachable (spec MUST — see risk note).
- [x] 3.3 RED — `test/boundary.test.ts`: config assertion → `/integration:\s*true/`.
- [x] 3.4 GREEN — `openspec/config.yaml`: `integration: false` → `true` (D8).
- [x] 3.5 REFACTOR/FINAL — verify deferred items absent (DbSession, migration runner, pool tuning, R1–R17); kernel boundary test UNCHANGED (rejects `pg`, ports pass on merit); `pnpm check` + integration GREEN against live PG.
