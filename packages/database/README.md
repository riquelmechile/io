# @io/database (Transitional adapter slice)

> First PostgreSQL-shaped adapter slice over the `@io/trust-kernel` persistence
> ports (`EvidenceRepository` / `AuditRepository`). **Transitional — excluded
> from the 8 + 12 + 10 = 30 canonical package partition.**

## What this is

A concrete hexagonal adapter implementing the kernel's evidence and audit
repository ports against an injectable, **synchronous** `DbConnection`. SQL is
PostgreSQL-shaped (`$N` positional placeholders, snake_case columns, targeting
PostgreSQL 18.4) and lives ONLY in the adapters — the connection port carries
zero table/schema knowledge. An `InMemoryDbConnection` test double records every
operation and round-trips data so the adapters are unit-testable without
PostgreSQL (`integration: false`).

## Boundary (hard)

| Rule | Status |
|------|--------|
| Real `pg` driver import | Excluded (this slice) |
| Real PostgreSQL connection / pool | Excluded (this slice) |
| Schema migrations | Excluded (this slice) |
| Driver / ORM / framework coupling | Excluded (`import type` only, zero runtime deps) |
| Agentic or business framework | Excluded |
| Satisfies persistent R1–R17 | No — the connection is still an in-memory fake |

This slice does NOT satisfy persistent R1–R17. Both adapters honestly carry the
SAME `PERSISTENT_PORT_DISCLOSURE` used by the kernel: a routed record is
durable-capable, but its ACTUAL durability depends on the adapter, and this
adapter is not yet real PostgreSQL.

## Not a canonical package

`packages/database/` is **excluded from the 8 + 12 + 10 = 30 canonical package
partition**. It is a Technical-Infrastructure package and a first adapter only;
it is never counted as a canonical package (never "package 31"). It stays
excluded until canonical extraction (migrations, pool, query utils, full R1–R17
coverage land under change pressure).

## Deferred debt (CRITICAL — decided at the live-PG boundary)

- **Sync vs async.** The kernel ports are synchronous (`save()` returns
  `Readonly<R>`, not `Promise<R>`), so this `DbConnection` is synchronous to stay
  honest while the in-memory fake is instant. A real `pg` driver is async. This
  tension is intentionally NOT resolved here — it belongs to the live-PG slice,
  which must choose between making the kernel ports async-aware or bridging
  async→sync at a real I/O boundary. The `DbConnection` port is the seam where
  that decision lands.
- **`DbSession` / transactions.** `EvidenceRepository<PersistentRecord, S>`
  defaults `S = unknown`; this adapter accepts and ignores the optional session.
  The session/transaction shape is deferred to the live-PG slice.

## Rollback

1. Delete `packages/database/`.
2. Revert the two `tsconfig.json` / `tsconfig.build.json` `include` lines (and the
   `biome.json` includes).
3. `pnpm install` to re-resolve the workspace.

Kernel ports are untouched (read-only). This touches NO credentials, secrets, or
human constitutional-authority boundaries; zero data-loss risk.
