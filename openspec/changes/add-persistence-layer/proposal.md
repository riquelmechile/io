# Proposal: Add Persistence Port Boundary (Evidence/Audit)

## Intent

The trust-kernel is a transitional, 100% in-memory, persistence-free module (145 tests green, all records carry `persistent: false`). IO's roadmap Increment 2 demands persistence BEFORE the first vertical — durable records, crypto receipts, and real approvals all need storage. This FIRST slice defines the hexagonal port boundary for evidence and audit storage WITHOUT adding a real database, proving the pattern all other aggregates will follow while preserving backward compatibility and the 400-line review budget.

## Scope

### In Scope
- `EvidenceRepository` and `AuditRepository` port interfaces in `packages/trust-kernel/src/ports/`
- `PersistentRecord` type with `persistent: true` literal alongside `InMemoryRecord`
- In-memory fake adapters (`InMemoryEvidenceRepository`, `InMemoryAuditRepository`) for test use
- Pipeline wiring: `evaluate()` accepts optional repositories, falls back to current in-memory path when absent
- Boundary test exemption for `ports/` imports

### Out of Scope
- Real PostgreSQL adapter (next slice — violates `integration: false`, no `psql` available)
- Canonical extraction into `evidence/`, `audit/`, or other packages (separate increment, ~2000+ lines)
- Other aggregate ports (R1–R6, R8–R15, R17 deferred)
- Deferred step warm-up (`records`, `approvals`, etc.)
- Persisted R1–R17 obligations — port interface ONLY; real storage is downstream

## Capabilities

### New Capabilities
- `persistence-port-boundary`: Repository port interfaces for evidence and audit storage, in-memory fake adapters, `PersistentRecord` type, and backward-compatible pipeline wiring. Defines the hexagonal port pattern for all future aggregates.

### Modified Capabilities
- `trust-kernel`: Transitional In-Memory Boundary requirement MUST be updated to permit `ports/` directory and optional repository injection while preserving the existing in-memory path and prohibition on real persistence/adapters.

## Approach

**Approach 1 (exploration recommended): Port-First — Evidence/Audit Repository Boundary.** Define outbound port interfaces inside `packages/trust-kernel/src/ports/`. The pipeline accepts optional repositories; when provided, records route through them; when absent, the current in-memory path runs unchanged. All 145 existing tests remain green. Real PG adapter and extraction deferred to stacked subsequent slices.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/trust-kernel/src/ports/` | New | `EvidenceRepository`, `AuditRepository` interfaces + `PersistentRecord` type |
| `packages/trust-kernel/src/ports/fakes.ts` | New | `InMemoryEvidenceRepository`, `InMemoryAuditRepository` for tests |
| `packages/trust-kernel/src/pipeline.ts` | Modified | `EvaluationInput` gains optional repositories; `evaluate()` routes through them |
| `packages/trust-kernel/src/model.ts` | Modified | `PersistentRecord` type added alongside `InMemoryRecord` |
| `packages/trust-kernel/src/index.ts` | Modified | Export new port types |
| `packages/trust-kernel/test/` | Modified | New tests for port interfaces, fakes, and dual-path pipeline behavior |
| `packages/trust-kernel/package.json` | Modified | Boundary test exemption for `ports/` imports |
| `openspec/specs/trust-kernel/spec.md` | Modified | New port boundary requirement + scenario |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pipeline wiring adds optional branches — must not break 145 green tests | Medium | Repository optional; existing path unchanged when absent. Tests exercise both paths. |
| Port location in `trust-kernel/src/ports/` may conflict with future extraction | Low | Intentional staging: ports stay with trust-kernel until extraction. `ports/` directory signals extraction boundaries. |
| `pg` type imports in port interfaces create dependency on uninstalled package | Low | Port interfaces use generic types only. PG adapter concrete implementation imports `pg` in next slice. |
| `InMemoryRecord`/`PersistentRecord` dual type system could confuse consumers | Low | Document explicitly: `InMemoryRecord` is transitional, `PersistentRecord` is canonical. Both coexist during migration. |

## Rollback Plan

1. Revert `EvaluationInput` to not accept optional repositories — restore original type signature (no database types).
2. Delete `packages/trust-kernel/src/ports/` directory.
3. Remove `PersistentRecord` from `model.ts`.
4. Revert `index.ts` exports.
5. Revert boundary test exemption in `package.json`.
6. Run `pnpm test` to confirm all 145 tests restore to green.
7. **Capital/secrets guard** (config rule): this change touches NO credentials, NO secrets, and NO human constitutional authority boundaries. Rollback has zero data-loss risk — no real persistence exists yet.

## Dependencies

- `bootstrap-minimum-trust-kernel` (archived) — trust-kernel at 145 tests green with `persistent: false` literals
- No external packages required in this slice

## Success Criteria

- [ ] `EvidenceRepository` and `AuditRepository` port interfaces defined with TypeScript generics (no `pg` types)
- [ ] `PersistentRecord` type compiles with `persistent: true` literal
- [ ] `InMemoryEvidenceRepository` and `InMemoryAuditRepository` fakes pass all new tests
- [ ] `evaluate()` accepts optional repositories; all 145 existing tests pass without repository injection
- [ ] New tests cover: repository-provided path, repository-absent path, fake store/get/append behavior
- [ ] Boundary test permits `ports/` imports but still rejects frameworks, drivers, adapters
- [ ] Delta spec for `trust-kernel` documents the new "persistence port boundary" requirement
- [ ] `pnpm check` (Biome + tsc + Vitest) all green
