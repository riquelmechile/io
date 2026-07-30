# Apply Progress — PostgreSQL Adapter (add-postgres-adapter)

**Change**: add-postgres-adapter
**Mode**: Strict TDD (pnpm test / vitest, Node 24 LTS)
**Slice**: 1 of 1 (work_unit: slice-1-database-adapter-package)
**Delivery**: auto-chain / stacked-to-main (single PR, 2 work-unit commits)
**Status**: ✅ ALL 28 tasks complete. `pnpm check` GREEN. Kernel untouched.

## Summary

Created `packages/database/`: a synchronous, driver-free, PG-shaped `DbConnection`
port plus the two kernel-port adapters (`PgEvidenceRepository`,
`PgAuditRepository`) and an `InMemoryDbConnection` test double. Strict TDD
throughout: RED → GREEN → REFACTOR per behavior group. Existing 184 tests stay
green; 49 new tests added (184 → **233**).

## Test Counts

| Metric | Before | After |
|--------|--------|-------|
| Test files | 10 | 15 (+5) |
| Tests | 184 | **233** (+49) |

New tests: connection-port (7), connection-fake (5), evidence-adapter (7),
audit-adapter (7), boundary (23) = 49.

## `pnpm check` Result

**GREEN** — format-check ✓, typecheck ✓, build ✓, lint ✓, test (233) ✓.
Biome `format --write` normalized 7 new files (added to `biome.json` includes so
formatting/lint are genuinely enforced, mirroring the trust-kernel precedent).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.2 | — | scaffold | ✅ 184/184 | n/a | ✅ install+symlink | ➖ structural | ➖ |
| 1.3–1.5 | `test/connection-port.test.ts` | Unit (type+fs) | ✅ 184/184 | ✅ TS2307+runtime | ✅ 7/7 | ✅ 4 type + 3 scan cases | ✅ stripComments |
| 2.1–2.4 | `test/connection-fake.test.ts` | Unit | ✅ | ✅ import-missing | ✅ 5/5 | ✅ 4 round-trip + alias | ✅ shared parse helpers |
| 3.1–3.6 | `test/evidence-adapter.test.ts` | Unit | ✅ | ✅ TS2307 | ✅ 7/7 | ✅ SQL shape + round-trip + unknown key | ✅ extract `src/sql.ts` builder |
| 4.1–4.6 | `test/audit-adapter.test.ts` | Unit | ✅ | ✅ TS2307 | ✅ 7/7 | ✅ order + immutability + append-returns | ✅ reuse builder from 3.6 |
| 5.1–5.4 | `test/boundary.test.ts` | Unit (fs+config) | ✅ | ✅ index/README-missing | ✅ 23/23 | ✅ per-file forbidden + type-only + deps | ➖ |
| 6.1–6.3 | — | exports/docs | ✅ | n/a | ✅ check GREEN | ➖ | ➖ |

## Work Unit Evidence

| Unit | Focused test command + result | Runtime harness | Rollback boundary |
|------|-------------------------------|-----------------|-------------------|
| 1: scaffold + port + fake | `pnpm test packages/database/test/connection-port.test.ts packages/database/test/connection-fake.test.ts` → 12/12 pass | N/A — library, `integration:false`, no transport/daemon/PG; vitest unit run is the only execution path | Delete `packages/database/{src/connection.ts,src/disclosure.ts,test/connection-fake.ts,test/connection-fake.test.ts,test/connection-port.test.ts,package.json}` + revert tsconfig/biome includes; `pnpm install` |
| 2: adapters + boundary + exports/docs | `pnpm test packages/database` → 49/49 pass; `pnpm check` → GREEN | N/A — same (sync fake instant, no real PG) | Delete adapter `src/{evidence-adapter,audit-adapter,sql,index}.ts` + `test/{evidence-adapter,audit-adapter,boundary}.test.ts` + `README.md`; leave port + fake intact |

## Files Changed

| File | Action | What |
|------|--------|------|
| `packages/database/package.json` | Created | `@io/database`, private, strict-ESM, `@io/trust-kernel` devDep, `dependencies:{}` |
| `packages/database/src/connection.ts` | Created | `DbRow` + synchronous `DbConnection` (D1/D2/D3) |
| `packages/database/src/disclosure.ts` | Created | Local `PERSISTENT_PORT_DISCLOSURE` (design finding, see below) |
| `packages/database/src/sql.ts` | Created | Shared column-alias SQL builders (tasks 3.6/4.6) |
| `packages/database/src/evidence-adapter.ts` | Created | `PgEvidenceRepository` (R7) |
| `packages/database/src/audit-adapter.ts` | Created | `PgAuditRepository` (R16) |
| `packages/database/src/index.ts` | Created | Public exports |
| `packages/database/test/connection-fake.ts` | Created | `InMemoryDbConnection` (Req 4) |
| `packages/database/test/{connection-port,connection-fake,evidence-adapter,audit-adapter,boundary}.test.ts` | Created | Strict-TDD tests |
| `packages/database/README.md` | Created | Scope, debt, canonical exclusion |
| `tsconfig.json` / `tsconfig.build.json` | Modified | Added `packages/database` includes |
| `biome.json` | Modified | Added `packages/database` includes (format/lint enforcement) |
| `pnpm-lock.yaml` | Modified | Workspace resolution (@io/database + devDep link) |

## Deviations from Design (documented, not silent)

1. **Kernel has no package entry point → bare `@io/trust-kernel` import fails
   (TS2307).** Verified empirically: the symlink resolves to the directory, but
   NodeNext finds no `exports`/`main`/`types` and no root `index.ts`, so
   `import type { X } from '@io/trust-kernel'` errors. Since the kernel is
   read-only (HARD rule), I import the kernel's **public barrel via its resolvable
   subpath** `@io/trust-kernel/src/index.js`, `import type` only. This honors D4's
   intent (zero runtime deps, type-only) without modifying the kernel. Recommended
   follow-up: add an `exports` field to `@io/trust-kernel/package.json` (a future
   kernel change) so the bare name resolves.

2. **`PERSISTENT_PORT_DISCLOSURE` is a runtime value, but D4 + task 5.1 force
   `import type` only.** The package therefore carries the disclosure as a LOCAL
   constant (`src/disclosure.ts`) with the kernel's IDENTICAL text, not a runtime
   import. "SAME" is verified by test: the evidence/audit tests import the kernel's
   `PERSISTENT_PORT_DISCLOSURE` value and assert `adapter.disclosure ===` it, so the
   local copy cannot drift. This is forced by the `import type`-only boundary
   check (task 5.1), not a free choice.

3. **Two extra src modules** (`disclosure.ts`, `sql.ts`) beyond the design's File
   Changes table — both required by the tasks (D6 disclosure reuse; 3.6/4.6 shared
   SQL builder). Justified structural additions.

4. **Schema-awareness port test scans code with comments stripped** — the literal
   substring check would otherwise flag architectural JSDoc ("SQL lives in
   adapters"). Refined to measure code/types (the real concern); a genuine schema
   reference in a type/runtime value is still caught.

5. **Review workload forecast was optimistic.** Forecast: ~300 lines, Low risk.
   Actual authored size: **~1090 lines** (213 src + 545 test + 62 README + 11
   pkg.json + ~15 config). Every file is required by a task; the design's file
   list simply omitted the granular test/builder files the tasks mandated
   (boundary.test.ts, connection-port.test.ts, sql.ts, disclosure.ts). The change
   exceeds the 400-line review budget — see Workload/PR Boundary.

## Issues Found

None blocking. All gates GREEN; kernel unchanged (verified via `git status` — no
`packages/trust-kernel/**` files modified).

## Workload / PR Boundary

- **Mode**: single PR, 2 work-unit commits (per tasks.md work-unit table).
- **Current work unit**: slice-1-database-adapter-package (the whole change).
- **Boundary**: complete, cohesive adapter slice (port + fake + 2 adapters +
  boundary guards + exports + docs); kernel read-only; rollback = delete
  `packages/database/` + revert 3 config includes + `pnpm install`.
- **Budget impact**: ~1090 changed lines > 400 budget. The slice is cohesive and
  not cleanly splittable mid-implementation (port/adapters/tests are interlocked).
  Recommend the maintainer either accept `size:exception` for this single adapter
  slice, or split BEFORE apply at the work-unit boundary (Unit 1 = scaffold+port+
  fake; Unit 2 = adapters+boundary) into a stacked chain — but the prompt mandated
  a single slice, so this batch is delivered whole.
