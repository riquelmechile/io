# Apply Progress — businessevent

**Batch**: PR1 (tasks 1.1–1.6) — packages/business-domain ONLY
**Status**: COMPLETE — 6/6 tasks done. Next batch: PR2 (tasks 2.1–2.6, `packages/database`).
**Mode**: Strict TDD (RED → GREEN per task)
**Artifact store**: hybrid (OpenSpec + Engram) · Delivery: stacked-to-main auto-chain
**Baseline**: main@b1662e5, 829 passed | 6 skipped

## Files changed (PR1)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/types.ts` | Modified | Added `BusinessEvent` interface (8 fields: eventId, companyId, aggregateKind, aggregateId, eventType, occurredAt, payload, source) |
| `packages/business-domain/src/ports/repositories.ts` | Modified | Added `BusinessEventRepository` port — surface EXACTLY `{ append, listByCompany }` |
| `packages/business-domain/src/ports/fakes.ts` | Modified | Added `InMemoryBusinessEventRepository` — ordered array, insertion-order reads, eventId uniqueness, `requireCompanyId` |
| `packages/business-domain/src/index.ts` | Modified | Exports `BusinessEvent`, `BusinessEventRepository`, `InMemoryBusinessEventRepository` (biome re-sorted exports) |
| `packages/business-domain/test/business-event.test.ts` | Created | 16 unit tests: shape, determinism, port surface, order, tenant isolation, duplicate id, empty companyId, R1 isolation |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/business-domain/test/business-event.test.ts` | Unit | ✅ 158/158 (business-domain suite) | ✅ Written — tsc TS2305 `BusinessEvent` not exported | ✅ tsc clean + 3/3 vitest | ✅ 3 cases (shape, equal facts, differing facts) | ✅ types.ts repaired (helper-corruption fix during cycle) |
| 1.2 | same | Unit | ✅ (covered above) | ✅ Written — tsc TS2724 `BusinessEventRepository` missing | ✅ tsc clean + 4/4 | ➖ Single scenario (exact-surface check) | ➖ None needed |
| 1.3 | same | Unit | ✅ | ✅ Written — runtime `InMemoryBusinessEventRepository is not a constructor` | ✅ 9/9 | ✅ 4 cases (surface, round-trip, interleaved order, cross-tenant) | ➖ None needed |
| 1.4 | same | Unit | ✅ | ✅ Written — duplicate append succeeded (no rejection yet) | ✅ 11/11 | ✅ 2 cases (dup rejected + original kept; distinct ids allowed) | ➖ None needed |
| 1.5 | same | Unit | ✅ | ✅ Written — empty companyId append/list did NOT throw | ✅ 13/13 | ✅ 2 cases (append guard, list guard) | ➖ None needed |
| 1.6 | same | Unit | ✅ | ✅ Written — tsc TS2724/TS2305 index exports missing; runtime import failed | ✅ tsc clean + 16/16 | ✅ 3 cases (index functional export, src scan, package.json deps) | ✅ biome format pass |

Notes: 1.1/1.2 are pure declaration tasks — their RED gate is compile-time (tsc), since vitest (esbuild) strips type-only imports at runtime. All behavioral tasks (1.3–1.6) had genuine runtime RED.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain` → **174 passed (174)** (8 files; baseline 158 + 16 new) |
| Runtime harness command/scenario and exact result | N/A — pure domain package, no I/O boundary (no adapter, no live PG in PR1; runtime boundary arrives in PR2) |
| Rollback boundary | Revert PR1 commit; files: `src/types.ts`, `src/ports/repositories.ts`, `src/ports/fakes.ts`, `src/index.ts`, `test/business-event.test.ts`. No other package touched — nothing in `packages/context`, `packages/database`, `packages/app` changed. |

## Gate

`PATH=/data/node24/bin:$PATH pnpm check` → **GREEN** (format-check ✅, typecheck ✅, build ✅, lint ✅, tests: **845 passed | 6 skipped**). Baseline preserved exactly (829 + 16 new).

## Requirement coverage (PR1 slice)

R1 (1.1/1.6) · R2 (1.2) · R3 (1.3) · R6 (1.1) · R7 (1.4) · R8 (1.3/1.5) — all 16 tests passing. R4/R5/R9 remain for PR2/PR3.

## Deviations from design

None — implementation matches design.md exactly (field set, port surface, ordered-array fake, requireCompanyId, evt:{attemptId} convention). One note: `pnpm --filter @io/business-domain test` is a silent no-op (package has no `test` script); the effective focused command is `pnpm vitest run packages/business-domain`.

## Remaining

- PR2: tasks 2.1–2.6 (`packages/database`) — 006 migration, PgBusinessEventRepository, row guard, boundary tests
- PR3: tasks 3.1–3.6 (`packages/app`) — worker T1 emission, wiring, E2E
