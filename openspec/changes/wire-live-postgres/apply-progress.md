# Apply Progress: Wire Live PostgreSQL

**Slices**: 1 of 3 (`slice-1-async-port-migration`) ✅ + 2 of 3 (`slice-2-pg-connection-schema`) ✅
**Mode**: Strict TDD
**Overall**: Slices 1–2 complete; Slice 3 (integration round-trip + config flip) NOT started.
**Date**: 2026-07-30

---

# Slice 1 — Async Port & Pipeline Migration (tsc-gated, no new deps) ✅

**Status**: Complete — `pnpm check` GREEN, 233/233 tests (unchanged count)
**Work unit**: Async port & pipeline migration (tsc-gated, no new deps)

Migrated every persistence port + the evaluation pipeline + all fakes/adapters
+ every test call site from SYNCHRONOUS to ASYNC (`Promise`-returning). No new
dependencies, no `pg`, no schema, no integration flip (those are Slices 2–3).
Kernel stays driver-free; database stays driver-free this slice. The kernel
boundary test is UNCHANGED.

This resolves the CRITICAL sync/async debt (design D1): the `pg` driver is
TCP-based and fundamentally async, so a `Promise` return is the only honest
completion contract. `evaluate()` now returns `Promise<EvaluationResult>`;
`finalize`/`routeThroughPorts` `await` the routed save/append.

### Slice 1 Files Changed (15)

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/ports/repositories.ts` | Modified | `EvidenceRepository.save/get` + `AuditRepository.append/getLog` → `Promise` (D1). JSDoc updated to async. |
| `packages/trust-kernel/src/ports/fakes.ts` | Modified | `InMemoryEvidenceRepository`/`InMemoryAuditRepository` methods → `async` (bodies unchanged, instant in-memory resolution). |
| `packages/trust-kernel/src/pipeline.ts` | Modified | `evaluate`/`finalize`/`routeThroughPorts` → `async`; `await` save+append in routing; 9 `return finalize(...)` sites unchanged (returning a Promise from an async fn adopts it). |
| `packages/trust-kernel/test/pipeline.test.ts` | Modified | 4 describe-scope `evaluate()` → `beforeAll(async …)`; in-`it` calls → `await` + `async` callbacks. |
| `packages/trust-kernel/test/ports.test.ts` | Modified | Added Promise `expectTypeOf` assertions (folded into existing `it`, count unchanged); inline repo impls → `async`; all call sites `await`. |
| `packages/database/src/connection.ts` | Modified | `DbConnection.execute`→`Promise<unknown>`, `query<T>`→`Promise<readonly T[]>`; stripped "synchronous" JSDoc. |
| `packages/database/src/evidence-adapter.ts` | Modified | `save`/`get` → `async`; `await conn.execute/query`. |
| `packages/database/src/audit-adapter.ts` | Modified | `append`/`getLog` → `async`; `await conn.execute`. |
| `packages/database/src/index.ts` | Modified | JSDoc "SYNCHRONOUS" → "ASYNC" (no surface change). |
| `packages/database/test/connection-fake.ts` | Modified | `InMemoryDbConnection.execute/query` → `async`; disclosure doc updated. |
| `packages/database/test/connection-port.test.ts` | Modified | Flipped execute/query type assertions: "NOT a Promise" → "returns Promise<…>". |
| `packages/database/test/connection-fake.test.ts` | Modified | `await` on execute/query + `async` callbacks. |
| `packages/database/test/evidence-adapter.test.ts` | Modified | `await` on save/get + `async` callbacks. |
| `packages/database/test/audit-adapter.test.ts` | Modified | `await` on append/getLog + `async` callbacks. |
| `biome.json` | Modified | Toolchain hygiene: `vcs.useIgnoreFile` + `.pgdata` negation so Biome stops traversing the running PG container's unreadable `.pgdata/18/docker` volume (gitignored). |

### Slice 1 TDD Cycle Evidence

The async migration is a REFACTOR: existing tests define behavior, only
signatures change. RED is captured at the TYPE level (the contract the design
says tsc must enforce: "tsc catches every missing await").

| Task | RED (test demands async) | GREEN (production satisfies) | REFACTOR |
|------|--------------------------|------------------------------|----------|
| 1.1 connection-port | Flipped execute/query `expectTypeOf` to demand `Promise` → `tsc` failed. | `connection.ts` signatures → `Promise`. | — |
| 1.2 ports | Added `expectTypeOf` demanding `Promise` → `tsc` failed. | `repositories.ts` interfaces → `Promise`. | — |
| 1.3–1.8 production | (covered by 1.1/1.2 RED) | All ports/fakes/connection-fake/pipeline/adapters migrated async; tsc clean. | — |
| 1.9 test awaits | tsc flagged every missing `await`. | Added `await` + `async` at every call site. | — |
| 1.10 full check | — | — | `pnpm check` GREEN (233/233). |

---

# Slice 2 — PgDbConnection, pg Dep, Schema, Boundary Allowlist ✅

**Status**: Complete — `pnpm check` GREEN, 257/257 tests (233 → 257; +24 net, +1 file)
**Work unit**: `slice-2-pg-connection-schema` — PgDbConnection + pg dep + schema DDL + boundary allowlist + docker-compose

Added the live PostgreSQL adapter: a `PgDbConnection` over a lazy `pg.Pool`
implementing the async `DbConnection` port; the evidence/audit schema DDL; the
`pg` runtime dependency confined to `@io/database`; a `docker-compose.yml`
formalizing the dev container; and an updated database boundary test that
allowlists `pg` (confined to `pg-connection.ts`) while keeping `integration:false`
(Slice 3 flips it) and the kernel boundary test UNCHANGED (kernel still
driver-free). No real-PG round-trip test yet (Slice 3).

### Slice 2 Files Changed (7) + pnpm-lock.yaml

| File | Action | What was done |
|------|--------|---------------|
| `packages/database/package.json` | Modified | `dependencies: { pg: "^8.22.0" }`; `devDependencies` adds `@types/pg: "^8.20.0"` (pg 8.x ships NO bundled types). |
| `pnpm-lock.yaml` | Modified | `pg@8.22.0` + transitive deps + `@types/pg@8.20.0` resolved. |
| `packages/database/src/pg-connection.ts` | Created | `PgDbConnection implements DbConnection` (lazy `getPool()`, `execute`/`query` delegate to `pool.query`, `close()` ends pool — NOT on the port) + `pgConnectionString()` (DATABASE_URL env-default). Per design code block. |
| `packages/database/src/index.ts` | Modified | Exports `PgDbConnection` (public surface now 4 runtime keys). `pgConnectionString` stays a module export used directly by the future Slice-3 test. |
| `packages/database/sql/001_create_tables.sql` | Created | `evidence` + `audit` tables (id SERIAL PK + 8 PersistentRecord cols; timestamp BIGINT, persistent BOOLEAN) + `idx_evidence_action_id`. Design DDL verbatim (D7). Validated against live PG 18.4. |
| `packages/database/test/pg-connection.test.ts` | Created | 15 unit tests over a MOCKED `pg.Pool` (`vi.hoisted` + `vi.mock('pg')`): lazy pool, execute/query delegation + readonly-param spread, query returns result.rows, error propagation, close() ends pool + port-has-no-close (`expectTypeOf<keyof DbConnection>()`), pgConnectionString env-default. No real PG. |
| `packages/database/test/boundary.test.ts` | Modified | `dependencies`→allowlist `{pg}`; `devDependencies` allowlist kernel+`@types/pg`; `pg` confined to ONE src file (exempt from forbidden-import + realPgTokens); schema DDL assertions; public surface adds `PgDbConnection`. `integration:false` assertion STAYS (Slice 3). Kernel coupling still type-only. |
| `docker-compose.yml` | Created | postgres:18.4, io/io_dev/io_dev, port 5432, healthcheck, `.pgdata:/var/lib/postgresql` (parent mount — see deviations). |

### Slice 2 TDD Cycle Evidence (Strict TDD)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `test/pg-connection.test.ts` | Unit (mocked pg) | N/A (new file) | ✅ 13 fail: `Cannot find module pg-connection.js` | ✅ 15/15 pass | ✅ lazy/execute/query/close/error/env × multiple cases | ✅ clean |
| 2.2–2.4 | (covered by 2.1) | — | — | — | ✅ pg dep + pg-connection.ts + export | — | — |
| 2.5 | `test/boundary.test.ts` (schema describe) | Unit | ✅ boundary 23/23 pre-edit | ✅ 5 schema asserts fail (no sql file: `expected '' to match /SERIAL/`) | ✅ after sql file | ✅ 5 cases (file/tables/PK/columns/index) | ✅ clean |
| 2.6 | — | — | — | — | ✅ `sql/001_create_tables.sql` created; schema 5/5 | — | — |
| 2.7 | `test/boundary.test.ts` | Unit | ✅ | ✅ deps/forbidden/realPgTokens/surface fail post-2.2–2.4 | ✅ boundary 32/32 GREEN | ✅ allowlist + scoped exemption + confinement asserts | ✅ clean |
| 2.8 | (no test — compose not asserted) | — | — | — | ✅ docker-compose.yml created | ➖ N/A (infra artifact) | ✅ — |
| 2.9 | full suite | — | — | — | — | — | ✅ `pnpm check` GREEN |

RED capture (2.1): `pnpm vitest run pg-connection.test.ts` → `13 failed | 2 passed` (the 2 are compile-erased `expectTypeOf` bodies); `Error: Cannot find module '.../src/pg-connection.js'`.
RED capture (2.5): `expected '' to match /id\s+SERIAL\s+PRIMARY\s+KEY/i` (readSql() returns '' until the file exists).

### Slice 2 Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `pnpm vitest run packages/database` → **91 passed** (pg-connection 15 + boundary 32 + connection-port + connection-fake + evidence-adapter + audit-adapter). Full `pnpm test` → **257 passed (16 files)**. |
| Runtime harness command/scenario + result | Manual DDL validation against live PG (NOT a committed test): `docker exec -i io-postgres psql -U io -d io_dev < sql/001_create_tables.sql` → `CREATE TABLE`/`CREATE INDEX`×1; `\dt` → evidence+audit; `pg_indexes` → `evidence_pkey` + `idx_evidence_action_id`. Schema is valid PG 18.4. The real round-trip harness is Slice 3. |
| Rollback boundary | Remove `packages/database/{src/pg-connection.ts,sql/,test/pg-connection.test.ts}`, `docker-compose.yml`; revert `package.json` (`dependencies:{}`, drop `@types/pg`); `pnpm install`; revert `boundary.test.ts` + `index.ts`. Kernel untouched; `integration` stays `false`. |

### Slice 2 Deviations from Design

- **`pg` ships no bundled TypeScript declarations** (verified: `pg@8.22.0` has no
  `types`/`typings` field; `engines.node >= 16.0.0` — Node 24-compatible). So
  `@types/pg@8.20.0` is required as a TYPE-ONLY devDependency. The design's
  boundary table listed `devDependencies` as "unchanged" assuming pg bundled
  types. Adding `@types/pg` preserves the type-only boundary principle (zero
  runtime coupling added); the boundary test was updated to allowlist it.
- **`execute` returns the query result instead of discarding it.** The design
  snippet wrote `await pool.query(...)` with no return, which fails `tsc` strict
  (TS2355: a `Promise<unknown>` function must return a value). The port JSDoc
  explicitly says a real adapter "may return a row count or void" — so returning
  the `pool.query` result is spec-compliant and type-safe. The 2.1 test asserts
  `resolves.toBe(result)` (proving delegation at the value level). This is the
  design's open question ("apply-time strictness") resolved.
- **`docker-compose.yml` mounts `./.pgdata:/var/lib/postgresql` (parent), not the
  design's `:/var/lib/postgresql/data`.** The running container already created
  `.pgdata/18/docker` (its PGDATA is `/var/lib/postgresql/18/docker`); mounting
  to the design's `/var/lib/postgresql/data` would point default-PGDATA at the
  non-empty `.pgdata` (contains `18/`) → `docker compose up` would fail initdb.
  Mounting to the parent (matching the running container's own mount target) lets
  default PGDATA initialise a clean `.pgdata/data` cluster without clobbering the
  existing layout. Image/credentials/ports/healthcheck match the design verbatim.
- Everything else matches `design.md` verbatim (D2 lazy Pool, D6 close() off the
  port, D7 snake_case DDL + aliases, D4 pg confined to `@io/database`, kernel
  boundary test UNCHANGED, `integration:false` retained).

### Slice 2 Test Counts

- Before: 233 (15 files)
- After: **257** (16 files) — +24 net. pg-connection.test.ts adds 15; boundary
  net +9 (23→32, the contract rewrites). All 233 originals still pass — no
  regressions; the kernel boundary test is byte-unchanged.

### Slice 2 `pnpm check` Result

**GREEN** — all five gates:
```
biome format .            → Checked 43 files, No fixes applied
tsc -p tsconfig.json      → clean
tsc -p tsconfig.build.json → clean
biome lint .              → Checked 43 files, No fixes applied
vitest run                → 257 passed (16 files)
```

---

# Remaining — Slice 3: Integration Round-Trip + Config Flip (NOT started)

- **3.1** RED `test/pg-roundtrip.test.ts`: connect via PgDbConnection; beforeAll
  execute DDL; beforeEach `TRUNCATE evidence, audit RESTART IDENTITY`; afterAll
  close(); evidence save→get byte-identical; audit append×N→getLog order+immutability.
- **3.2** GREEN: implement round-trip; skip/pending when PG unreachable (spec MUST).
- **3.3** RED `boundary.test.ts`: config assertion → `/integration:\s*true/`.
- **3.4** GREEN `openspec/config.yaml`: `integration: false` → `true` (D8).
- **3.5** REFACTOR/FINAL: verify deferred items absent (DbSession, migration runner,
  pool tuning, R1–R17); kernel boundary UNCHANGED; `pnpm check` + integration GREEN.
