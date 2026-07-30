# Proposal: PostgreSQL Adapter — Injectable DbConnection

## Intent

Create `packages/database/` — a concrete hexagonal adapter package implementing the kernel's
`EvidenceRepository<R>` and `AuditRepository<R>` ports against an injectable synchronous
`DbConnection` abstraction. This is Increment 2's second persistence slice: the adapter that
stands on the other side of the port boundary established by `add-persistence-layer`.
Unit-testable without PostgreSQL running.

## Scope

### In Scope
- `packages/database/` package scaffold (package.json, tsconfig, pnpm workspace wiring)
- `DbConnection` port interface: `execute(sql, params)` / `query(sql, params)` — synchronous, PG-shaped `$1` params, no PG types
- `PgEvidenceRepository`: saves PersistentRecord via `INSERT INTO evidence`, retrieves via `SELECT`
- `PgAuditRepository`: appends via `INSERT INTO audit`, retrieves log via `SELECT ... ORDER BY id ASC`
- `InMemoryDbConnection` test double: stores records in-memory + logs all SQL ops for assertion
- Unit tests: SQL-shape assertions + data round-trips via `InMemoryDbConnection`
- Root `tsconfig.json` / `tsconfig.build.json` updates

### Out of Scope
- Real `pg` driver dependency — deferred to live PG wiring slice
- Real PostgreSQL connection, pool, schema migrations — all deferred
- Integration/E2E tests — `integration: false`
- Transaction/session `S` parameter — adapter ignores `S = unknown` default
- Other aggregate ports (R1–R6, R8–R15, R17) — only evidence (R7) and audit (R16)
- Full `database/` package maturity — first adapter slice; package grows later

## Capabilities

### New Capabilities
- `db-connection-port`: Injectable synchronous DbConnection with `execute(sql, params)` / `query(sql, params)`,
  PG-shaped `$1` parameter placeholders, no runtime PG dependency

### Modified Capabilities
None — kernel port interfaces (`EvidenceRepository`, `AuditRepository`) are unchanged

## Approach

Hexagonal adapter: concrete repos depend on the injectable `DbConnection` port, not a driver.
`InMemoryDbConnection` records operations for SQL-shape assertion AND stores records for
round-trip testing. Both evidence + audit adapters share the connection pattern and fit in one slice.

> **CRITICAL — Sync/Async Debt**: Kernel ports are synchronous (`save()` returns `Readonly<R>`).
> This slice uses a SYNCHRONOUS `DbConnection`, consistent with the port contract. When real PG
> wiring arrives, EITHER the kernel ports become async-aware OR the adapter wraps async→sync at
> the real I/O boundary. Documented as deferred — resolved in the live-PG slice, not this one.

Connection has zero knowledge of tables/schemas. SQL lives ONLY in adapters.
`$1` params are intentionally PG-shaped (PostgreSQL 18.4 is the declared target).

**Estimated**: ~415 lines (tight on 400-line budget — orchestrator may chain if needed).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/database/` | New | Adapter package: connection port, evidence/audit adapters, test fake |
| `pnpm-workspace.yaml` | Modified | Add `packages/database` to workspace |
| `tsconfig.json` | Modified | Add `packages/database/**/*.ts` to `include` |
| `tsconfig.build.json` | Modified | Add `packages/database/src/**/*.ts` to `include` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Sync port/async PG mismatch — when live PG wiring arrives, pipeline or port MUST change | Certain (deferred) | Documented architectural debt. Resolved in live-PG slice |
| SQL untested against real PG — quoting/type errors possible | Medium | SQL-shape tests + param-count assertions. Full validation deferred to integration |
| ~415 lines exceeds 400-line budget | Medium | Orchestrator evaluates; split to evidence-only PR if budget blocks |
| PG-optimized `$1` params reduce DB portability | Low | Intentional — PostgreSQL 18.4 is the declared target |

## Rollback Plan

1. Remove `packages/database/` directory
2. Revert `pnpm-workspace.yaml` (remove `packages/database` entry)
3. Revert `tsconfig.json` and `tsconfig.build.json` (remove database include paths)
4. Run `pnpm install` to clean workspace resolution

No runtime dependencies exist outside the package — kernel ports are unchanged and read-only.

## Dependencies

- `@io/trust-kernel` workspace dep (reads port interfaces: `EvidenceRepository<R>`, `AuditRepository<R>`,
  `PersistentRecord`)

## Success Criteria

- [ ] `DbConnection` interface defined with `execute`/`query` (sync, PG-shaped params, no PG types)
- [ ] `PgEvidenceRepository` passes SQL-shape + round-trip tests via `InMemoryDbConnection`
- [ ] `PgAuditRepository` passes SQL-shape + log-order tests via `InMemoryDbConnection`
- [ ] `InMemoryDbConnection` records all SQL operations AND stores records for round-trips
- [ ] `pnpm test` passes (existing 145 tests + new adapter tests)
- [ ] `pnpm check` passes (format + lint + typecheck)
- [ ] Kernel port interfaces unchanged (read-only this slice)
