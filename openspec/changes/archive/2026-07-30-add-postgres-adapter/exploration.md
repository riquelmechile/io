# Exploration: PostgreSQL Adapter (Camino B — Injectable Connection)

> **Status**: Complete — ready for proposal/design
> **Date**: 2026-07-30
> **Context**: `add-persistence-layer` archived (ports defined, fakes proven, 145 tests green). User explicitly chose **Camino B**: concrete adapter with an **injectable connection** abstraction, NOT a live PG connection — so it can be unit-tested without PostgreSQL infrastructure running.

## Current State

The persistence port boundary is closed: `packages/trust-kernel/src/ports/repositories.ts` defines `EvidenceRepository<R, S = unknown>` and `AuditRepository<R>` with `import type` only (zero runtime deps). The pipeline in `finalize()` optionally routes through repos when injected at `EvaluationInput`. In-memory fakes live in `ports/fakes.ts`.

The `io-domain-contract` (req "Primary-Responsibility Classification") allocates `database/` as a **Technical Infrastructure** package. The previous design's open questions leaned toward a sibling `packages/database/` adapter package (NOT inside the kernel) and deferred the session/transaction shape.

PostgreSQL 18.4 is the intended authoritative source, but `integration: false` in `openspec/config.yaml` and no `psql` locally mean zero integration tests this slice.

Key constraint (config 6.4/6.5): NO agentic or business frameworks. `pg` is a database driver (infra primitive) and is permitted as a dependency when real PG wiring arrives — but this slice does NOT add `pg` as a dependency.

## Affected Areas

| Area | Impact | Why |
|------|--------|-----|
| `packages/database/` (NEW) | Create sibling package | Implements `EvidenceRepository`/`AuditRepository` from kernel ports via injectable `DbConnection` |
| `packages/database/src/connection.ts` | Create | The **Camino B core**: `DbConnection` port interface (`execute()`/`query()`) — injectable, fakeable, no PG types |
| `packages/database/src/evidence-adapter.ts` | Create | `PgEvidenceRepository` implements `EvidenceRepository<PersistentRecord>` with SQL translation |
| `packages/database/src/audit-adapter.ts` | Create | `PgAuditRepository` implements `AuditRepository<PersistentRecord>` with SQL translation |
| `packages/database/src/index.ts` | Create | Public exports |
| `packages/database/test/connection-fake.ts` | Create | `InMemoryDbConnection` — records SQL operations AND stores records in-memory for round-trip testing |
| `packages/database/test/evidence-adapter.test.ts` | Create | Unit tests: SQL shape, save/get round-trip via fake connection |
| `packages/database/test/audit-adapter.test.ts` | Create | Unit tests: SQL shape, append/getLog via fake connection |
| `packages/database/package.json` | Create | `@io/database`, workspace dep on `@io/trust-kernel` |
| `tsconfig.json` | Modify | Add `packages/database/**/*.ts` to `include` |
| `tsconfig.build.json` | Modify | Add `packages/database/src/**/*.ts` to `include` |
| `packages/database/README.md` | Create | Document scope: adapter slice, not complete database/ package yet |

### NOT affected in this slice

| Area | Why deferred |
|------|-------------|
| `packages/trust-kernel/src/` source or tests | Read-only this slice — port interfaces stay unchanged |
| Real `pg` driver dependency | `integration: false` — `pg` comes when real PG wiring arrives (next slice) |
| Integration/E2E tests | `integration: false` — all tests are unit-only against fake connection |
| Transaction/session `S` parameter | The adapter ignores `S` (uses `S = unknown` default); session threading deferred to real PG wiring |
| `DbSession` interface | Not needed yet — connection-level abstraction is sufficient for Camino B |
| Other aggregate ports (R1-R6, R8-R15, R17) | Only evidence (R7) and audit (R16) in this increment |
| Full `database/` package scope | This slice implements ONLY the evidence/audit adapter (connection/migration/query utilities deferred) |

## Approaches

### Approach 1 (RECOMMENDED): DbConnection Port — SQL-Shape Adapter with Connection Fake

Define a minimal `DbConnection` port interface inside `packages/database/` with synchronous `execute(sql, params)` and `query(sql, params)` methods. The concrete adapters (`PgEvidenceRepository`, `PgAuditRepository`) translate port calls into parameterized SQL against the injected connection. An `InMemoryDbConnection` fake stores records in-memory AND records every SQL operation for test assertion.

**Key design choices**:
- **Connection is synchronous** — consistent with the synchronous port interfaces. The sync/async tension is deferred (real PG wiring MUST revisit this).
- **SQL is concrete (PG-style `$1` params)** — intentionally PG-shaped because PostgreSQL 18.4 is the target. This IS a tradeoff: portable generic SQL would avoid PG lock-in but produce less realistic tests.
- **Connection has NO knowledge of tables/schemas** — it's a raw SQL executor. Schema knowledge lives ONLY in the adapters.
- **Adapters hardcode `persistent: true` and their own `disclosure`** — the adapter disclosure is the SAME `PERSISTENT_PORT_DISCLOSURE` from the kernel, because this adapter does NOT satisfy R1-R17 (it still uses an in-memory fake connection, not real PG).

**InMemoryDbConnection behaviour**:
- `execute()` stores the record in its internal map (evidence) or appends to its array (audit), PLUS records `{ sql, params }` in an operations log
- `query()` retrieves from the store based on SQL pattern, PLUS records the operation
- Tests assert BOTH: stored data round-trips correctly AND the SQL/params match expected patterns

| Pros | Cons | Effort |
|------|------|--------|
| Proves the adapter translates port calls into correct SQL — strongest proof without PG | SQL strings are untested against real PG syntax — risk of quoting/spacing errors | **Medium** (~415 lines) |
| Follows same pattern as kernel fakes (connection fake stores+records) | Sync port interface conflicts with eventual async PG driver — MUST refactor later | |
| `DbConnection` is just 2 methods — minimal, composable, no framework | Connection abstraction IS PG-optimized (`$1` params, snake_case columns) — less portable | |
| Full unit-testable under `integration: false` | Package name `database/` implies broader scope than what's implemented | |
| Both evidence AND audit adapters fit in one slice (shared connection pattern) | Tight on 400-line budget (~415 estimated) — may need chained PR | |

### Approach 2: Async-Ready Connection (DbConnection returns Promise)

Make `DbConnection.execute()` and `DbConnection.query()` return `Promise<>` even in this slice, to future-proof for real PG wiring. The adapter would still implement the synchronous port interface by wrapping the promise resolution inside `save()`/`get()`.

| Pros | Cons | Effort |
|------|------|--------|
| Connection abstraction is async-ready — no refactor when real PG arrives | The sync port interface can't use async connection meaningfully — `save()` would call `.then()` internally but return `Readonly<R>` synchronously = lying about completion | **Medium** (~415 lines) |
| | More complex fake (needs to handle promises for no reason) | |
| | Premature abstraction — real PG wiring is the NEXT slice, async will be designed then | |

### Approach 3: DbSession as First-Class Entity

Define a `DbSession` interface with `begin/commit/rollback` alongside `DbConnection`. The `EvidenceRepository<S = DbSession>` would accept sessions. The adapter participates in transactions when a session is provided.

| Pros | Cons | Effort |
|------|------|--------|
| Aligns with the `S` generic intended design | No real PG means no real transactions — the session would be a no-op carrier | **Medium-High** (~500 lines) |
| Proves the session threading pattern early | Sessions without real transactions are theater — adds complexity without value until real PG wiring | |
| | Blows the 400-line budget | |

### Approach 4: Evidence-Only Slice

Create the evidence adapter only; defer audit to a follow-up slice.

| Pros | Cons | Effort |
|------|------|--------|
| Fits comfortably under 400-line budget (~300 lines) | Incomplete — pipeline routes through BOTH ports; an auditor asking about audit adapter would get "next slice" | **Low-Medium** (~300 lines) |
| Faster first PR | The pattern is identical for both — splitting adds process overhead without reducing review risk | |

## Recommendation

**Approach 1: DbConnection Port — SQL-Shape Adapter with Connection Fake.**

This approach delivers the most value within the 400-line budget: both adapters, a minimal connection abstraction, and strong SQL-shape + data-integrity tests. The key architectural bet is **making the connection synchronous** to match the port interface — this is honest for Camino B (the fake is instant) and the async tension is a documented deferred item.

The `DbConnection` interface is:

```ts
export interface DbConnection {
  execute(sql: string, params?: readonly unknown[]): DbExecuteResult;
  query(sql: string, params?: readonly unknown[]): readonly DbRow[];
}

export interface DbExecuteResult {
  readonly rowCount: number;
}

export interface DbRow {
  readonly [column: string]: unknown;
}
```

The commit scope:
1. `packages/database/` package scaffold (package.json, README, src/index.ts)
2. `DbConnection` port interface + types
3. `PgEvidenceRepository` (save → `INSERT INTO evidence`, get → `SELECT ... WHERE action_id = $1`)
4. `PgAuditRepository` (append → `INSERT INTO audit`, getLog → `SELECT ... ORDER BY id ASC`)
5. `InMemoryDbConnection` test double (records operations + stores records)
6. Unit tests: SQL shape assertions + data round-trips
7. Root tsconfig updates
8. Candidate `DbConnectionFake` exported as a test utility

**Effort**: Medium — estimated ~415 lines (tight on budget; consider chained slicing if root CI shows >400).

## Risks

| Severity | Description | Mitigation |
|----------|-------------|------------|
| **critical** | Sync port ↔ async PG mismatch: the port interface is synchronous (`save()` returns `Readonly<R>`, not `Promise<>`). When real PG wiring arrives, either the pipeline MUST become async-aware or the port interface MUST change. This slice CANNOT fix this without breaking the kernel contract. | Document this as a **known architectural debt**. The connection abstraction is where the async boundary will be introduced. Real PG wiring is the NEXT slice — that's where this MUST be resolved. |
| **warning** | SQL strings built without real PG validation: syntax errors, quoting bugs, type mapping issues won't be caught until real PG integration. | Mitigate with careful SQL-shape tests (param count, string structure, keyword presence). Accept that full validation is deferred to when `integration:true` is configured. |
| **warning** | 400-line budget risk: estimated ~415 lines for both adapters. | The orchestrator MUST evaluate budget. If over, split to evidence-only adapter (saves ~100 lines) and defer audit adapter to a chained PR. |
| **suggestion** | Connection abstraction is PG-optimized: `$1` params, snake_case columns, PG-specific SQL dialect. If a future DB swap is needed, this abstraction must be reworked. | The port contract (Generic, no driver types) is satisfied because `DbConnection` is defined in `packages/database/`, NOT in the kernel. It's intentionally PG-shaped — the target is PostgreSQL 18.4. Portability would add complexity without justification. |
| **suggestion** | Package name `database/` implies full database layer (migrations, pool management, query utilities) but this slice only adds the evidence/audit adapter. | Document in README that this is the first slice; the package will grow to cover the full Technical Infrastructure scope over time. |

## Ready for Proposal

**Yes.** The exploration identifies a clear minimal slice, resolves the key architectural forks (DbConnection shape, sync vs async, evidence-only vs both), and documents the critical risk (sync/async tension). The orchestrator should:

1. Tell the user: **"Camino B exploration complete. The adapter will live in `packages/database/` with an injectable `DbConnection` port (synchronous, 2 methods: execute+query). Both evidence and audit adapters fit in one slice (~415 lines). The critical architectural debt is that the port interface is synchronous — this MUST be resolved before real PG wiring. Recommend proceeding to sdd-propose."**
2. Decide delivery strategy: if 415 lines exceeds the budget, consider `auto-chain` with evidence-only in PR#1 and audit in PR#2.
