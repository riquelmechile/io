# Exploration: IO Persistence Layer — Increment 2, First Slice

> **Status**: Complete — ready for proposal design
> **Date**: 2026-07-30
> **Context**: Roadmap Increment 2. Trust-kernel (bootstrap-minimum-trust-kernel) closed/archived. 145 tests green. All records carry `persistent: false` literals.

## Current State

The system has exactly one product package: `packages/trust-kernel/`, a **transitional, 100% in-memory, persistence-free** authority evaluation kernel. Its architecture:

- **Pure functions** receive `EvaluationInput` and return `EvaluationResult` — no state survives the call.
- **16-step pipeline**: 10 enforced gates (classification, authority, identity, assignment, bounded scope, evidence, SOD, expiry, action scope, final) + 6 documented no-op pass-throughs (delegation, policy-version, budget, approvals, exceptions, records).
- **All records are `InMemoryRecord`** with `persistent: false` as a **literal type** — the honesty contract is carried by the type system, not runtime.
- **No adapters, no I/O, no frameworks** — enforced by boundary test (forbidden import specifiers).
- **Repository root**: Node 24 LTS / TS 6.x strict-ESM / Vitest / Biome — `integration: false`, `coverage: false`.

### Key Design Feature
The trust-kernel spec (Req "Transitional In-Memory Boundary") and the io-domain-contract spec (Req "Transitional Package Boundary") both mandate extraction into 6 canonical targets: `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/`. The `io-persistence-recovery-contract` spec defines the persistence requirements (R1-R17, authoritative PostgreSQL, single-aggregate transactions, idempotency, outbox/inbox, lease fencing, receipts, recovery matrix).

## Affected Areas

| Area | Impact | Why |
|------|--------|-----|
| `packages/trust-kernel/src/pipeline.ts` | New port dependency | `finalize()` currently constructs `Evidence`/`AuditEntry` directly; must route through a repository port |
| `packages/trust-kernel/src/evidence.ts` | Port interface added | `captureEvidence` currently returns inline records; needs port boundary for persistence |
| `packages/trust-kernel/src/model.ts` | Type addition | `InMemoryRecord` with `persistent: false` literal must coexist with new `PersistentRecord` with `persistent: true` |
| `packages/trust-kernel/test/*.test.ts` | New fake adapter tests | `InMemoryEvidenceRepository` and `InMemoryAuditRepository` as test fakes |
| `packages/trust-kernel/package.json` | Possible dep addition | May add `pg` types as dev dep for adapter type definitions |
| `openspec/specs/trust-kernel/spec.md` | Spec update | New port boundary requirement + scenario |
| `openspec/specs/io-persistence-recovery-contract/spec.md` | Partial activation | Port interface design begins satisfying persistence obligations |
| `openspec/changes/add-persistence-layer/` | Change directory | New active change folder |

### NOT affected in this slice

| Area | Why deferred |
|------|-------------|
| `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/` packages | Extraction deferred; creates 6 packages + extraction logic → far exceeds 400-line budget. Extraction is a separate change increment. |
| Real PostgreSQL adapter | Cannot test without `psql` and `integration: false` in config. Port-first approach tests with fakes. |
| `apps/*` packages | No application layer exists yet. |
| Other aggregates (R1-R6, R8-R15, R17) | Only evidence (R7) and audit (R16) in scope for first slice — simplest records, already produced by pipeline. |

## Approaches

### Approach 1 (RECOMMENDED): Port-First — Evidence/Audit Repository Boundary

Define outbound port interfaces for evidence and audit storage in a new `packages/trust-kernel/src/ports/` directory. Create an in-memory fake adapter for testing. Wire the pipeline to accept an optional repository and use it when provided (backward compatible — in-memory fallback unchanged if no repository is given). Define the `PersistentRecord` type alongside the existing `InMemoryRecord`. Define the PostgreSQL adapter types/interfaces but defer implementation to the next slice.

**Slice contents**:
1. Port interfaces: `EvidenceRepository` (store + get) and `AuditRepository` (append + getLog)
2. `PersistentRecord` type with `persistent: true` literal
3. `InMemoryEvidenceRepository` and `InMemoryAuditRepository` fakes (used in tests)
4. Pipeline change: `finalize()` calls repository if provided; falls back to current in-memory path
5. Updated `EvaluationInput` and `EvaluationResult` to carry optional repositories
6. Updated boundary test to allow `ports/` imports
7. Delta spec for trust-kernel: new "persistence port boundary" requirement

**Estimated lines**: ~350-400 (ports ~80, types ~30, fakes ~100, pipeline wiring ~60, tests ~80, spec updates ~30)

**Why evidence/audit first**:
- Already produced by every pipeline evaluation (both ALLOW and DENY)
- Simplest records: single-action, append-mostly, no cross-aggregate dependencies
- The `InMemoryRecord` shape divergence is most visible here
- Establishes the pattern all other aggregates will follow

| Pros | Cons | Effort |
|------|------|--------|
| Proves hexagonal port boundary without PG dependency | No real persistence yet (staging slice) | **Low** (~350-400 lines) |
| All 145 existing tests remain green unchanged | Extraction still deferred | |
| Testable with unit tests only (`integration: false` preserved) | | |
| Backward compatible — pipeline unchanged if no repository | | |
| Fits within 400-line review budget | | |
| Pattern reusable for all other aggregates | | |

### Approach 2: Real PostgreSQL Adapter First

Add `pg` driver, create real PostgreSQL adapter for evidence/audit, write SQL migrations, add integration test configuration.

| Pros | Cons | Effort |
|------|------|--------|
| Real persistence exists | `integration: false` in config — violates project rules | **High** (~800+ lines) |
| Tangible progress on the increment promise | `psql` not installed — can't test locally without container setup | |
| | Far exceeds 400-line budget (~800+) → requires chaining | |
| | Breaking strict-TDD because integration tests can't run locally | |
| | Premature without port boundary defined first | |
| | No experience with IO-first PG patterns yet | |

### Approach 3: Full Canonical Extraction + Persistence

Extract all 6 targets (organization, policy, approvals, evidence, receipts, audit) into canonical packages simultaneously, adding persistence interfaces to each.

| Pros | Cons | Effort |
|------|------|--------|
| Clears accumulated tech debt immediately | **MASSIVE** (~2000+ lines, 10-20x budget) | **Extreme** (multiple chains) |
| Aligns with architectural vision | Extracting from working trust-kernel + adding persistence = double risk | |
| | 6 packages + persistence interfaces + tests = impossible in one slice | |
| | Extraction before proving persistence boundary may create wrong abstractions | |

### Approach 4: Deferred Step Warm-Up

Turn one deferred pipeline step (e.g., step 15 'records') from no-op pass-through into a real port call backed by in-memory implementation.

| Pros | Cons | Effort |
|------|------|--------|
| Directly impacts the 16-step pipeline | The 'records' step represents R1-R17 — enormous domain | **Medium** (~300-400 lines) |
| Follows architectural intent of incremental hardening | Which step to warm first is arbitrary without port architecture | |
| | Doesn't address the fundamental port boundary design | |

## Recommendation

**Approach 1: Port-First — Evidence/Audit Repository Boundary.**

This is the minimal first slice that proves the persistence boundary without overbuilding. It establishes:

1. **The port pattern** that all later aggregates will use (repository interface + in-memory fake + future real adapter)
2. **The `InMemoryRecord`/`PersistentRecord` divergence point** — the type system enforces which records are persistent
3. **Backward compatibility** — existing trust-kernel API unchanged; pipeline accepts optional repositories
4. **Review budget compliance** — ~350-400 lines fits within the 400-line budget
5. **Testability without PostgreSQL** — all tests remain unit-level with in-memory fakes

The next slice adds the real PostgreSQL adapter (with integration test setup), and subsequent slices add other aggregates and begin extraction.

## Open Design Questions (Must Be Resolved in Proposal/Design Phase)

| Question | Impact | Suggested resolution |
|----------|--------|---------------------|
| Where do port interfaces live? | Package structure | New `packages/trust-kernel/src/ports/` directory within the transitional package. Ports are NOT extracted yet — extraction is a later change. |
| `pg` as a dependency — framework or infra primitive? | Dependency policy | `pg` is a database driver (infra primitive), not a business framework. Allowed under doc 6.4/6.5. Add as dependency when real adapter is built (next slice). |
| Connection/transaction model for single-aggregate boundaries | Architecture decision | Port methods should accept a transaction context. Consider a lightweight `DbSession` passed through the pipeline. Must NOT use an ORM or framework. |
| InMemoryRecord vs PersistentRecord type divergence | Type design | Both types exist. `InMemoryRecord` keeps `persistent: false` as literal. `PersistentRecord` has `persistent: true` + DB fields (id, created_at, etc.). Pipeline returns both during transition. |
| Integration test strategy for the real PG adapter | Testing policy | Proposal/design must decide: (a) integration tests excluded from `pnpm test` (tagged `@integration`), (b) PG testcontainers via vitest, or (c) deferred until developer experience tooling is ready. |
| Threshold values and authorized human exceptions | Deferred from bootstrap | These remain deferred. The port boundary is defined but the policy/domain logic doesn't change. |
| SOD 5th role 'authorizer' interpretation | Deferred from bootstrap | The 5-role SOD (proposer, reviewer, approver, executor, verifier + authorizer) for critical/high risk is implemented in trust-kernel but the exact semantics of 'authorizer' vs 'approver' are architectural, not persistence. No change needed in this slice. |

## Risks

| Severity | Description | Mitigation |
|----------|-------------|------------|
| **warning** | Pipeline wiring adds optional branches — must not break existing 145 green tests | Keep repository optional; existing path unchanged when no repository provided. Write tests that exercise both paths. |
| **warning** | Port location in `trust-kernel/src/ports/` may conflict with future extraction | This is intentional: ports stay with trust-kernel until extraction. The `ports/` directory is a signal of where extraction boundaries lie. |
| **suggestion** | `pg` type imports in port interfaces create a dependency on a package not yet installed | Define port interfaces using generic types (no `pg` types in the port definitions). The PG adapter concrete implementation imports `pg`. |
| **suggestion** | InMemoryRecord/PersistentRecord dual type system could confuse consumers | Document clearly: `InMemoryRecord` is the transitional type, `PersistentRecord` is the future canonical type. Both coexist during the transition period. |

## Ready for Proposal

**Yes.** The exploration identifies a clear minimal first slice, resolves the major forks (port-first vs real-PG-now vs extraction-now), and documents what must be decided in the design phase.

The orchestrator should tell the user:
> "Exploration complete. Recommended first persistence slice: **define port interfaces for evidence/audit storage** within the trust-kernel package, with in-memory fakes for testing and backward-compatible pipeline wiring. This proves the hexagonal persistence boundary without requiring PostgreSQL, fits within the 400-line review budget, and preserves all 145 existing tests. Real PG adapter and canonical extraction are deferred to subsequent slices."
