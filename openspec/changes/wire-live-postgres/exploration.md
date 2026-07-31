## Exploration: Wire Live PostgreSQL

### Current State

The trust-kernel persistence ports (`EvidenceRepository<R,S>`, `AuditRepository<R>`) and the database package `DbConnection` port are all **synchronous**. The pipeline's `finalize()` calls `save()`/`append()` as plain function calls; `evaluate()` is a sync function returning `EvaluationResult`. The adapters (`PgEvidenceRepository`, `PgAuditRepository`) and the test double (`InMemoryDbConnection`) are all sync.

Real PostgreSQL is running (`io-postgres` container, PG 18.4) but — critically — the `packages/database/` package has **zero runtime dependencies** (`dependencies: {}`). No `pg` driver, no schema, no integration tests. The sync/async tension was explicitly deferred as "CRITICAL debt" in the prior design.

PG has NO tables yet: `\dt` returns empty.

### The Core Decision: Option 2 (sync bridge) is NOT viable

**Can `pg` be called synchronously? NO.** The `pg` driver is TCP-based; Node.js has no synchronous TCP socket API. A `pg.Client` query always returns a `Promise`. There are three theoretical "sync bridge" approaches:

| Approach | Viable? | Why not |
|----------|---------|---------|
| `Atomics.wait()` + Worker thread | ❌ | Blocks the event loop entirely; loses all concurrency; structured clone overhead per query; widely acknowledged anti-pattern |
| `child_process.execSync('psql ...')` | ❌ | Shell injection risk; text-output parsing; horrible error handling; defeats parameterized queries |
| Callback-based `pg` (ancient v6) | ❌ | `pg` v8+ is Promise-only; even callbacks don't make TCP sync |

**Verdict: The sync bridge is a lie about completion. Option 1 (async ports) is the only honest path.**

### What Changes When Ports Become Async

**Port interfaces** — return types change:

```
EvidenceRepository<R>.save(record, session?) → Promise<Readonly<R>>
EvidenceRepository<R>.get(actionId)          → Promise<R | undefined>
AuditRepository<R>.append(record)            → Promise<readonly R[]>
AuditRepository<R>.getLog()                  → Promise<readonly R[]>
DbConnection.execute(sql, params)            → Promise<unknown>
DbConnection.query<T>(sql, params)           → Promise<readonly T[]>
```

**Pipeline** — `evaluate()` becomes async:

```
evaluate(input): Promise<EvaluationResult>
finalize(...)                                 → async (call await save/append inside)
routeThroughPorts(...)                        → async
```

7 call sites in `evaluate()` call `finalize(...)` — all become `return await finalize(...)` or `return finalize(...)`.

**Three in-memory implementations** — signatures change, but no actual I/O:

- `InMemoryEvidenceRepository.save/get` → `async` (still returns instantly, no real change)
- `InMemoryAuditRepository.append/getLog` → `async`
- `InMemoryDbConnection.execute/query` → `async`

**Callers** — every `evaluate()` call needs `await`:

- `packages/trust-kernel/test/pipeline.test.ts` — 12 call sites
- `packages/trust-kernel/test/ports.test.ts` — 14 call sites
- `packages/database/test/evidence-adapter.test.ts` — 6 call sites
- `packages/database/test/audit-adapter.test.ts` — 4 call sites

**Boundary tests** — assertions invalidated:

- `packages/database/test/connection-port.test.ts` — type assertions asserting `NOT Promise` become asserting `IS Promise`
- `packages/database/test/boundary.test.ts` — `dependencies: {}` fails once `pg` is added; forbidden-import scan across ALL files fails if a new driver file imports `pg`; "no real PG connection" scan fails for the new driver

### New Components

| Component | File | Description |
|-----------|------|-------------|
| PgDbConnection | `packages/database/src/pg-connection.ts` | NEW — implements async `DbConnection` using `pg.Pool`; accepts connection string |
| Schema (evidence + audit) | `packages/database/sql/001_create_tables.sql` | NEW — `CREATE TABLE evidence (...)` and `CREATE TABLE audit (...)` matching PersistentRecord fields |
| Integration test | `packages/database/test/pg-roundtrip.test.ts` | NEW — connects to real PG, creates schema, round-trips a record |
| Docker compose | `docker-compose.yml` | NEW — formalizes the running PG container |

### Schema Design

```sql
CREATE TABLE evidence (
  id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  persistent BOOLEAN NOT NULL,
  disclosure TEXT NOT NULL
);
CREATE INDEX idx_evidence_action_id ON evidence (action_id);

CREATE TABLE audit (
  id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  persistent BOOLEAN NOT NULL,
  disclosure TEXT NOT NULL
);
```

### PgDbConnection Approach

Use `pg.Pool` (not single `Client`) for connection reuse:

```ts
export class PgDbConnection implements DbConnection {
  private readonly pool: Pool;
  constructor(connectionString: string) { this.pool = new Pool({ connectionString }); }
  async execute(sql: string, params: readonly unknown[]): Promise<unknown> {
    await this.pool.query(sql, [...params]);
  }
  async query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    const result = await this.pool.query(sql, [...params]);
    return result.rows as readonly T[];
  }
  async close(): Promise<void> { await this.pool.end(); }
}
```

`close()` is NOT part of the `DbConnection` interface — lifecycle management stays outside the port.

### Affected Areas

- `packages/trust-kernel/src/ports/repositories.ts` — EvidenceRepository/AuditRepository become async
- `packages/trust-kernel/src/ports/fakes.ts` — InMemoryEvidenceRepository/InMemoryAuditRepository become async
- `packages/trust-kernel/src/pipeline.ts` — evaluate()/finalize()/routeThroughPorts() become async
- `packages/trust-kernel/test/pipeline.test.ts` — add await to evaluate() calls
- `packages/trust-kernel/test/ports.test.ts` — add await to evaluate() calls
- `packages/database/src/connection.ts` — DbConnection becomes async
- `packages/database/src/evidence-adapter.ts` — save()/get() become async
- `packages/database/src/audit-adapter.ts` — append()/getLog() become async
- `packages/database/src/pg-connection.ts` — NEW: real PG driver implementation
- `packages/database/src/index.ts` — export PgDbConnection
- `packages/database/test/connection-fake.ts` — InMemoryDbConnection becomes async
- `packages/database/test/connection-fake.test.ts` — NO change needed (internally consistent)
- `packages/database/test/evidence-adapter.test.ts` — add await
- `packages/database/test/audit-adapter.test.ts` — add await
- `packages/database/test/connection-port.test.ts` — update type assertions
- `packages/database/test/boundary.test.ts` — update deps/forbidden-import/exclusions assertions
- `packages/database/test/pg-roundtrip.test.ts` — NEW integration test
- `packages/database/package.json` — add `pg` to dependencies
- `openspec/config.yaml` — `integration: false` → `true`
- `docker-compose.yml` — NEW

### Approaches

1. **Async Ports (Option 1) — the only honest path**
   - Make ALL port methods async (`Promise<R>` returns)
   - Propagate through pipeline, adapters, fakes, tests
   - Add `PgDbConnection` using `pg.Pool`
   - Add schema + integration test
   - Pros: honest, clean, no lies about completion; same pattern used by every Node.js/TS PG integration
   - Cons: touches kernel boundary (was stable); every caller must `await`
   - Effort: **Medium** — ~360 lines total, manageable single PR

2. **Sync bridge (Option 2) — NOT viable**
   - Keep ports sync; make PgDbConnection block on async `pg` calls
   - Pros: none (keeps kernel stable at the cost of lying about completion)
   - Cons: blocks event loop; no real Node.js mechanism for sync TCP I/O; lies about completion; breaks under load; all "pros" are illusory
   - Effort: **High (if attempted honestly) or impossible (if done correctly)**

### Recommendation

**Adopt Option 1 — Async Ports.** Option 2 is not technically viable in Node.js 24/TypeScript 6. The async migration is the honest path and — while it touches many files — the changes are mechanical:

1. Add `async` keywords and `Promise<>` return types
2. `pg.Pool`-based `PgDbConnection`
3. Schema SQL + integration test
4. Update boundary tests

The estimated total change is ~340-380 lines (under the 400-line review budget), making a single PR feasible with `auto-chain` as contingency.

### Scope for This Change (Single PR)

This change covers:
- ✅ Async migration of ALL port interfaces (kernel + database)
- ✅ Async migration of ALL in-memory implementations (fakes + test double)
- ✅ Async migration of pipeline (`evaluate()` returns `Promise`)
- ✅ `PgDbConnection` implementation (`pg.Pool`-based)
- ✅ Schema SQL files (evidence + audit tables)
- ✅ Integration test (real PG round-trip)
- ✅ `docker-compose.yml` for reproducibility
- ✅ Updated boundary tests
- ✅ Updated `openspec/config.yaml` (`integration: true`)

**Deferred from this change (downstream):**
- ❌ `DbSession`/transaction shape — still deferred; single-statement operations in this slice
- ❌ Connection pool lifecycle management (min/max, health checks)
- ❌ Migration runner / versioning
- ❌ Single-aggregate atomicity enforcement
- ❌ Idempotency, outbox/inbox, lease fencing (R9-R15)

### Risks

- **Boundary test breakage**: The `boundary.test.ts` asserts `dependencies: {}` and scans all files for forbidden imports. These assertions MUST be updated to accept `pg` as a runtime dependency and exempt the new driver file from the forbidden-import scan. If forgotten, `pnpm check` fails.
- **`pg` typing compatibility**: Verify `pg` v8.x ships its own types (it does since v8.10). If not, `@types/pg` is needed. Verify against TS 6.x strict mode.
- **Integration test isolation**: PG state between tests must be managed (truncate tables or use separate test schemas). Without isolation, tests interfere.
- **Port interface breakage**: The `EvidenceRepository<R, S = unknown>` generic default means all existing `EvidenceRepository` usages type-check against the async version IF they don't call methods. But any code that calls `.save()` or `.get()` without `await` fails at type-check. This is desired — it catches the migration — but the orchestrator must plan for it.
- **Node version mismatch**: The environment has Node 26, the project targets Node 24. The toolchain probe test fails. NOT blocking this change (it's an env issue), but the integration test must not depend on Node 24 features unavailable in 26 (conversely, must not use 26 features that won't exist in 24).

### Ready for Proposal

**Yes** — proceed to `sdd-propose`. The core decision is settled: async ports (Option 1) is the only viable path. The orchestrator should tell the user:

> "This exploration confirms **Option 1 — Async Ports** is the only honest path for the live PostgreSQL wiring. The sync-bridge (Option 2) is not technically viable in Node.js: the `pg` driver is TCP-based and fundamentally async. The async migration is mechanical (add `async`/`Promise<>` throughout) with a clean blast radius of ~340-380 lines across two packages. Ready for proposal."
