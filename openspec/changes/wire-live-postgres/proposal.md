# Proposal: Wire Live PostgreSQL

## Intent

Wire real `pg` driver so records persist to PostgreSQL 18.4. Exploration resolved the sync/async CRITICAL debt: Option 2 (sync bridge) is NOT viable — `pg` is TCP-based, fundamentally async. Option 1 (async ports) is the only honest path. Repository ports return `Promise<>`; pipeline's `evaluate()` becomes async; `PgDbConnection` uses `pg.Pool`.

## Scope

### In Scope
- Async migration: `EvidenceRepository`, `AuditRepository`, `DbConnection` → `Promise<>`
- Pipeline `evaluate()`/`finalize()` → async; ~26 test call sites get `await`
- `PgDbConnection` via `pg.Pool`; schema SQL (`evidence` + `audit` tables)
- Integration test round-trip; `docker-compose.yml`
- Boundary tests: `pg` allowed, `integration: true`

### Out of Scope
- Outbox/inbox, idempotency, lease fencing (R9–R15)
- Pool config, migration runner, multi-tenant, `DbSession`, canonical extraction

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `db-connection-port`: sync → async; `integration: true`; real `pg` allowed
- `persistence-port-boundary`: ports become async; boundary permits `pg`
- `trust-kernel`: pipeline becomes async; kernel accepts database downstream

## Approach

`save()` → `Promise<Readonly<R>>`, `get()` → `Promise<R | undefined>`. Pipeline's `finalize()` awaits repo ops. `PgDbConnection` wraps `pg.Pool` — constructor takes connection string, `execute`/`query` delegate. Schema via raw SQL files. Integration test creates tables, round-trips a `PersistentRecord`. Zero secrets, capital, or critical limits touched.

## Affected Areas

| Area | Impact | Key files |
|------|--------|-----------|
| `packages/trust-kernel/` | Modified | ports, fakes, pipeline → async; tests → ~26 awaits |
| `packages/database/src/` | Modified | connection + adapters → async |
| `packages/database/src/pg-connection.ts` | **New** | `pg.Pool`-based `DbConnection` |
| `packages/database/sql/` | **New** | `001_create_tables.sql` |
| `packages/database/test/` | Modified / **New** | Boundary + adapter updates; `pg-roundtrip.test.ts` |
| `packages/database/package.json` | Modified | Add `pg` dependency |
| `docker-compose.yml` | **New** | PG container definition |
| `openspec/config.yaml` | Modified | `integration: false` → `true` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Missing `await` at ~26 call sites | High | tsc catches all; mechanical change |
| Boundary test breakage | Medium | Exempt `pg` in database package |
| `pg` types vs TS 6 strict | Low | v8.x ships own types |
| Integration test isolation | Low | `TRUNCATE` in `beforeEach` |
| Node 26 env vs Node 24 target | Low | 24-compatible APIs only |

## Rollback Plan

1. Revert async → sync in ports, pipeline, adapters, fakes
2. Remove `PgDbConnection`, schema, integration test, `docker-compose.yml`
3. Remove `pg` dep; revert config → `integration: false`

## Dependencies

- `pg` npm package (v8.x, types included)
- Running PG 18.4 container (`io-postgres`, localhost:5432, db `io_dev`)

## Success Criteria

- [ ] Pipeline tests pass with `await` on `evaluate()` calls
- [ ] Integration test round-trips through real PG
- [ ] `pnpm check` passes (biome + tsc + vitest)
- [ ] Boundary tests accept `pg` in database package
