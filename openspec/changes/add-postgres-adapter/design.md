# Design: PostgreSQL Adapter — Injectable DbConnection

## Technical Approach

Create `packages/database/`: a concrete hexagonal adapter implementing the kernel's
`EvidenceRepository<R, S>` and `AuditRepository<R>` ports (from `@io/trust-kernel`) against an
injectable, **synchronous** `DbConnection`. Camino B: the connection is a port, not a driver —
unit-testable without PostgreSQL (`integration: false`). SQL lives ONLY in adapters; the connection
knows nothing of tables or schemas. `$1` placeholders are intentionally PG-shaped (PostgreSQL 18.4
target). An `InMemoryDbConnection` fake records every operation for SQL-shape assertion AND stores
rows for round-trips. This is Increment 2's second persistence slice — the other side of the
boundary `add-persistence-layer` closed.

## Findings (correct/refine the proposal)

- **`pnpm-workspace.yaml` needs NO change.** It already globs `packages: ['packages/*']`, so
  `packages/database` is auto-included. (Mirrors the prior slice's "verify, don't assume" correction.)
- **`DbSession` stays deferred.** The design brief names `EvidenceRepository<PersistentRecord, DbSession>`;
  the proposal, exploration, and prior open question #2 ALL defer the session shape. Adapter implements
  `EvidenceRepository<PersistentRecord>` (the `S = unknown` default) and accepts/ignores the optional
  `session?`. `DbSession` is decided at the live-PG boundary.

## Architecture Decisions

| # | Decision | Choice | Alternatives / rationale |
|---|---|---|---|
| D1 | Sync vs async `DbConnection` | **Synchronous** | Async-ready rejected: a sync `save()` calling `.then()` but returning `Readonly<R>` would LIE about completion. Sync is honest while the fake is instant. The real PG mismatch is documented critical debt (below). |
| D2 | Connection API | `execute(sql, params): unknown` + `query<T>(sql, params): readonly T[]` | `DbExecuteResult` rejected: `save()` already holds the record; it does not need execute's return. `query<T>` casts rows to the record shape in one step. |
| D3 | PG-shaped SQL | `$1` params, snake_case columns | Portable generic SQL rejected: PG 18.4 is the declared target; realistic tests > portability. |
| D4 | Type coupling to kernel | `@io/trust-kernel` in **devDependencies**, `import type` only | Runtime `dependencies` rejected: `import type` is erased by tsc → literally zero runtime deps (prior slice D3/D4 preserved). |
| D5 | Row→record mapping | `SELECT ... AS "actionId"` aliases via `query<PersistentRecord>` | A separate mapper fn rejected: column aliases produce correctly-shaped rows directly; `persistent: true` + `disclosure` selected back as stored. |
| D6 | Fake honesty | Reuses kernel `PERSISTENT_PORT_DISCLOSURE` | "Durable in PostgreSQL" rejected: the in-memory fake connection is NOT durable; the adapter still does not satisfy R1–R17. |
| D7 | Package scope | First adapter slice only | Full `database/` (migrations, pool, query utils) deferred; grows under change pressure. |

## Component Map / Data Flow

```text
@io/trust-kernel ports (read-only, import type)
  EvidenceRepository<R,S>      AuditRepository<R>
            ▲                           ▲
            │ implements                │ implements
  PgEvidenceRepository        PgAuditRepository   ── packages/database/
            │                           │
            └─────► DbConnection.execute() / query<T>()   (sync, PG-shaped)
                            ▲
              injected ─────┘
        ┌───────────────────┴──────────────────┐
  InMemoryDbConnection (fake)            [real pg driver]  (deferred)
  stores rows + logs every {sql,params}       next slice
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/database/package.json` | Create | `@io/database`, `private:true`, `type:module`; `@io/trust-kernel` in devDependencies; runtime `dependencies: {}` (D4) |
| `packages/database/src/connection.ts` | Create | `DbConnection` interface + `DbRow` type (D2) |
| `packages/database/src/evidence-adapter.ts` | Create | `PgEvidenceRepository implements EvidenceRepository<PersistentRecord>` (D5) |
| `packages/database/src/audit-adapter.ts` | Create | `PgAuditRepository implements AuditRepository<PersistentRecord>` |
| `packages/database/src/index.ts` | Create | Public exports |
| `packages/database/test/connection-fake.ts` | Create | `InMemoryDbConnection`: operations log + row store (D6) |
| `packages/database/test/evidence-adapter.test.ts` | Create | SQL-shape + round-trip (R7) |
| `packages/database/test/audit-adapter.test.ts` | Create | SQL-shape + log-order (R16) |
| `packages/database/README.md` | Create | Scope: first adapter slice, not full database/ |
| `tsconfig.json` | Modify | Add `packages/database/**/*.ts` to `include` |
| `tsconfig.build.json` | Modify | Add `packages/database/src/**/*.ts` to `include` |
| `pnpm-workspace.yaml` | **No change** | Glob `packages/*` already covers it (Finding 1) |

## Interfaces / Contracts

```ts
// connection.ts — synchronous, PG-shaped, no driver types (D1/D2/D3)
export interface DbRow { readonly [column: string]: unknown }
export interface DbConnection {
  execute(sql: string, params: readonly unknown[]): unknown;
  query<T>(sql: string, params: readonly unknown[]): readonly T[];
}
```

```ts
// evidence-adapter.ts — SQL lives here, not in the connection (D5)
save(record: PersistentRecord, _session?: unknown): Readonly<PersistentRecord> {
  conn.execute(
    'INSERT INTO evidence (action_id, principal_id, risk_class, decision, reason, timestamp, persistent, disclosure) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [record.actionId, record.principalId, record.riskClass, record.decision,
     record.reason, record.timestamp, record.persistent, record.disclosure]);
  return record;                          // immutable view of the routed record
}
get(actionId: string): PersistentRecord | undefined {
  const rows = conn.query<PersistentRecord>(
    'SELECT action_id AS "actionId", principal_id AS "principalId", risk_class AS "riskClass", ' +
    'decision, reason, timestamp, persistent, disclosure FROM evidence WHERE action_id = $1',
    [actionId]);
  return rows[0];                         // readonly array + noUncheckedIndexedAccess → T | undefined
}
```
`PgAuditRepository` is analogous: `append()` INSERTs one row then returns `getLog()`; `getLog()`
builds `SELECT ... AS "actionId", ... ORDER BY id ASC` and maps rows back. Append preserves order
immutably because it reads the committed log on every call — never mutates a prior reference.

## Requirement-to-Test Map

| Obligation | Modules | RED tests |
|---|---|---|
| R7 Evidence adapter | `evidence-adapter`, `connection-fake` | `save()` emits exact INSERT + `$1..$8` param order; `get()` emits exact SELECT + round-trips the record (incl. `persistent: true` literal). |
| R16 Audit adapter | `audit-adapter`, `connection-fake` | `append()` emits exact INSERT; `getLog()` emits ORDER BY; order preserved; prior log immutable. |
| Port boundary purity | package.json | `import type` only; runtime `dependencies: {}`; no `pg` import this slice. |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | SQL shape (exact string + param array/order); round-trip save→get; audit append preserves order immutably | Vitest RED→GREEN against `InMemoryDbConnection` |
| Integration | N/A | `integration: false` — no real PG |
| E2E | N/A | No transport/daemon |

Strict TDD: each adapter method's RED test asserts the generated SQL string AND params via the fake's
operation log BEFORE asserting data round-trips. If the adapter emitted wrong SQL or wrong `$N` order,
RED fails before GREEN. The fake's row store then proves the round-trip.

## Threat / Risk Matrix

| Risk | Status | Safe behavior / RED test |
|---|---|---|
| Sync port ↔ async PG mismatch | **Applicable — CRITICAL, deferred** | Documented debt; resolved at the live-PG boundary (below). Adapter stays sync = honest while the fake is instant. |
| SQL quoting/type errors untested vs real PG | Applicable | SQL-shape + param-count assertions; full validation deferred to `integration:true`. |
| Driver/framework leakage | Applicable | `import type` only; runtime `dependencies: {}`; no `pg` import this slice. |
| Type confusion (`PersistentRecord` ↔ `InMemoryRecord`) | Applicable | `persistent: true` literal preserved through round-trip; tsc rejects cross-assignment. |
| Routing/shell/subprocess/VCS/executable/process integration | N/A | None introduced (no transport/daemon/CLI). |

## Sync/Async Debt — CRITICAL, DEFERRED

The kernel ports are **synchronous**: `save()` returns `Readonly<R>`, not `Promise<R>`. This adapter's
`DbConnection` is therefore synchronous to stay consistent and honest (the in-memory fake completes
instantly). A real `pg` driver is async. **This tension is intentionally NOT resolved here** — it belongs
to the live-PG slice. When that lands it MUST decide one of:

1. Make the kernel ports **async-aware** (`save(): Promise<Readonly<R>>`) — propagates `async` through
   `finalize()`/`evaluate()` and every caller; the architecturally honest option.
2. Keep ports sync and have the adapter **bridge async→sync** at a real I/O boundary — viable only with
   a sync driver shim or worker-thread blocking; risks lying about completion under load.

Choosing sync now does NOT preclude either path: the `DbConnection` port is the seam where the async
boundary will be introduced. This slice's sync signature is a placeholder the fake honors truthfully.

## Migration / Rollout

No data migration (no real persistence exists). Rollback (per config rule):

1. Delete `packages/database/`.
2. Revert the two `tsconfig` `include` lines.
3. `pnpm install` to re-resolve the workspace.

Kernel ports are untouched (read-only). **Capital/secrets guard**: touches NO credentials, secrets, or
human constitutional-authority boundaries. Zero data-loss risk.

## Extraction Staging

`packages/database/` is a Technical Infrastructure package (per `io-domain-contract`
"Primary-Responsibility Classification"), but this slice keeps it as a first adapter only — it STAYS
excluded from the 8+12+10=30 canonical partition until canonical extraction (migrations, pool, full
R1–R17 coverage land under change pressure). It is a sibling `packages/database/`, NOT
`packages/trust-kernel/src/ports/pg/` — keeping the kernel driver-free resolves prior open question #1.

## Open Questions

- [x] PG adapter location → sibling `packages/database/` (resolves prior open Q#1).
- [ ] `DbSession`/transaction shape → deferred to live-PG slice (prior open Q#2).
- [ ] Async decision (option 1 vs 2 above) → MUST be decided when real PG wiring lands.
