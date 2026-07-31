# Apply Progress: Wire Live PostgreSQL — Slice 1

**Slice**: 1 of 3 — `slice-1-async-port-migration`
**Work unit**: Async port & pipeline migration (tsc-gated, no new deps)
**Mode**: Strict TDD (refactor — existing tests define behavior; signatures change)
**Status**: ✅ Complete — `pnpm check` GREEN, 233/233 tests (unchanged count)
**Date**: 2026-07-30

## Summary

Migrated every persistence port + the evaluation pipeline + all fakes/adapters
+ every test call site from SYNCHRONOUS to ASYNC (`Promise`-returning). No new
dependencies, no `pg`, no schema, no integration flip (those are Slices 2–3).
Kernel stays driver-free; database stays driver-free this slice. The kernel
boundary test is UNCHANGED.

This resolves the CRITICAL sync/async debt (design D1): the `pg` driver is
TCP-based and fundamentally async, so a `Promise` return is the only honest
completion contract. `evaluate()` now returns `Promise<EvaluationResult>`;
`finalize`/`routeThroughPorts` `await` the routed save/append.

## Files Changed (15)

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/ports/repositories.ts` | Modified | `EvidenceRepository.save/get` + `AuditRepository.append/getLog` → `Promise` (D1). JSDoc updated to async. |
| `packages/trust-kernel/src/ports/fakes.ts` | Modified | `InMemoryEvidenceRepository`/`InMemoryAuditRepository` methods → `async` (bodies unchanged, instant in-memory resolution). |
| `packages/trust-kernel/src/pipeline.ts` | Modified | `evaluate`/`finalize`/`routeThroughPorts` → `async`; `await` save+append in routing; 9 `return finalize(...)` sites unchanged (returning a Promise from an async fn adopts it). |
| `packages/trust-kernel/test/pipeline.test.ts` | Modified | 4 describe-scope `evaluate()` → `beforeAll(async …)`; in-`it` calls → `await` + `async` callbacks. Imported `beforeAll`, `EvaluationResult`. |
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
| `biome.json` | Modified | Toolchain hygiene: `vcs.useIgnoreFile` (full: enabled+clientKind) + `.pgdata` negation so Biome stops traversing the running PG container's unreadable `.pgdata/18/docker` volume (gitignored). NOT part of the async semantics — required for `pnpm check` GREEN. |

## TDD Cycle Evidence (Strict TDD)

The async migration is a REFACTOR: existing tests define behavior, only
signatures change. RED is captured at the TYPE level (the contract the design
says tsc must enforce: "tsc catches every missing await").

| Task | RED (test demands async) | GREEN (production satisfies) | REFACTOR |
|------|--------------------------|------------------------------|----------|
| 1.1 connection-port | Flipped execute/query `expectTypeOf` to demand `Promise` → `tsc` failed: `execute returns unknown` not assignable to `Promise<unknown>`; query not assignable to `Promise<readonly DbRow[]>`. | `connection.ts` signatures → `Promise`. | — |
| 1.2 ports | Added `expectTypeOf<EvidenceRepository['save/get']>` + `AuditRepository['append/getLog']` demanding `Promise` → `tsc` failed: sync returns not assignable to `Promise<…>`. | `repositories.ts` interfaces → `Promise`. | — |
| 1.3–1.8 production | (covered by 1.1/1.2 RED) | All ports/fakes/connection-fake/pipeline/adapters migrated async; tsc clean. | — |
| 1.9 test awaits | tsc flagged every missing `await` / non-async impl across test files (inline impls not assignable to async port). | Added `await` + `async` at every call site; describe-scope `evaluate` → `beforeAll`. | — |
| 1.10 full check | — | — | `pnpm check` GREEN (format-check → typecheck → build → lint → test). |

RED capture command + result:
```
$ pnpm run typecheck   # after 1.1+1.2, production still sync
packages/database/test/connection-port.test.ts(90,69): error TS2344 ... Promise<unknown> ...
packages/trust-kernel/test/ports.test.ts(100,32): error TS2344 ... Promise<Readonly<PersistentRecord>> ...
… (8 errors total, all on the new Promise assertions)
```

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command + result | `pnpm test` → 15 files, **233 passed (233)**. Focused: `pnpm test packages/database` → 49 passed; `pnpm test packages/trust-kernel` → 182 passed. |
| Runtime harness command/scenario + result | **N/A** — Slice 1 is pure in-memory: fakes/`InMemoryDbConnection` resolve Promises instantly, no network, no `pg`, no real I/O. No runtime boundary exists this slice (integration harness is Slice 3). |
| Rollback boundary | Revert the 14 src+test files under `packages/` to synchronous; behavior identical, zero dep/config churn. (`biome.json` is an independent toolchain hygiene fix, separately revertible.) |

## Test Counts

- Before: 233 (15 files)
- After: **233** (15 files) — exactly unchanged. No new test cases were added;
  1.1 flips existing type-assertion `it` blocks and 1.2 folds Promise assertions
  into existing `it` blocks. The migration is signature+await only.

## `pnpm check` Result

**GREEN** — all five gates pass:
```
biome format .       → Checked 41 files, No fixes applied
tsc -p tsconfig.json → clean
tsc -p tsconfig.build.json → clean
biome lint .         → Checked 41 files, No fixes applied
vitest run           → 233 passed (233)
```

## Deviations from Design

- **`biome.json` touched (out of async-scope).** Required for `pnpm check` GREEN:
  the running PG 18.4 container (orchestrator-managed, for the broader change)
  bind-mounts `.pgdata/` into the repo root; its `18/docker` subdir is
  root-owned (`999:root`, `drwx------`) and unreadable. Biome v2.5 defaults
  `vcs.useIgnoreFile` off, so it traversed the gitignored volume and aborted
  (`internalError/io: Permission denied`). Fix: enabled `vcs.useIgnoreFile`
  (full config) + added `!.pgdata` / `!**/.pgdata` negation. This is toolchain
  hygiene (respect `.gitignore`), not a product-code change. Flagged for the
  reviewer; does not touch `openspec/config.yaml` (integration stays `false`).
- Everything else matches `design.md` verbatim (D1 async ports, the 9 unchanged
  `return finalize(...)` sites, lazy in-memory fakes, untouched SQL builders,
  kernel boundary test unchanged, `dependencies: {}` unchanged).

## Issues Found

- `pipeline.test.ts` had `evaluate()` called at `describe` scope (not inside
  `it`), which cannot use `await`. Resolved by converting those 4 sites to
  `beforeAll(async () => { result = await evaluate(...) })` with a typed
  `let result: EvaluationResult`. Count-neutral (beforeAll is not a test).
- `.pgdata` toolchain blocker (see Deviations) — environment artifact, not code.

## Remaining Slices (NOT done — out of scope)

- **Slice 2**: `PgDbConnection` + `pg` dep + schema DDL (`sql/001_create_tables.sql`)
  + boundary allowlist + `docker-compose.yml`. Kernel stays driver-free.
- **Slice 3**: real-PG integration round-trip (`pg-roundtrip.test.ts`) +
  `integration: false → true` config flip + final guard.
