# Design: Harden First Enterprise Vertical Foundation

## Technical Approach

Seven tightly-coupled hardening areas delivered as **3 stacked-to-main PR slices** (A: authority+scope → B: persistence+concurrency → C: use-cases+idempotency+validation). The seam: `companyId` + `version` are additive to domain types; transactions + compare-and-set live behind the existing `DbConnection`/repository ports; transition use cases consume both and **replace raw `save()` for state changes**. All changes stay pure-TS in the kernel and driver-free at the port boundary; `pg` stays confined to `packages/database/`. Mapping to proposal: Slice A = capabilities `trust-kernel`, `company-identity`, scope fields; Slice B = `db-connection-port`, `business-receipt`, concurrency; Slice C = use cases, idempotency, NEW `runtime-validation`.

## Architecture Decisions

### Decision: SoD absolute-pair fix

**Choice**: Add `['proposer','approver']` to `ABSOLUTE_PAIRS` in `sod.ts:35` (keep existing `approver/executor`, `verifier/executor`).
**Alternatives**: policy-driven pair sets.
**Rationale**: Absolute pairs run FIRST at every tier incl. low-risk+`allowsLowCombination`. Minimal surgical fix to the real self-approval bug ("nadie se autoaprueba"); existing distinct-role fixtures stay GREEN.

### Decision: Activation-window helper in the kernel

**Choice**: `isWindowActive(start, now, expiry)` in `trust-kernel/src/model.ts` next to `validateBoundedWindow`.
**Alternatives**: business-domain; per-call inline checks.
**Rationale**: Operates on the same `BoundedWindow`; one temporal source of truth reused by `grant.ts:74`, `identity.ts:51`, and pipeline step 12. Kernel stays pure, zero infra.

### Decision: Mandatory company scope at the port

**Choice**: `Work/Delegation/ReceiptRepository.get(id)` → `get(id, companyId)`. Unscoped reads are impossible by construction.
**Alternatives**: optional `companyId`; separate `getByCompany`.
**Rationale**: Optional params invite forgetting scope; a mandatory param makes "unscoped read returns nothing" a compile-time guarantee. Greenfield → no data migration.

### Decision: `transaction(fn)` on DbConnection, same-port surface

**Choice**: `transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T>`. PG uses `pool.connect()` + `BEGIN/COMMIT/ROLLBACK`, releases client in `finally`; in-memory fake snapshots tables and restores on throw (simulates rollback).
**Alternatives**: narrower `DbTx` type; nested savepoints.
**Rationale**: Reuses the port surface (no new type). Atomicity + rollback is testable in-memory. Nested transactions throw `NestedTransactionError` (savepoints deferred, documented).

### Decision: Work concurrency via CAS + split insert/update

**Choice**: Add `version: number` to `Work`. Repository gains `updateWithVersion(work, expectedVersion)` — single CAS `UPDATE ... SET version=version+1 ... WHERE work_id=$1 AND company_id=$2 AND version=$3`; `rowCount===0` → probe → `VersionConflictError` vs `NotFoundError`. Keep `save()` for initial insert only.
**Alternatives**: `INSERT ... ON CONFLICT`; SELECT-then-UPDATE (TOCTOU).
**Rationale**: Single-statement CAS is race-free; no read/write gap. The deferred pipeline steps stay pass-through ALLOWs (none silently bypass SoD — transition-time SoD is enforced in the use-case layer, not the pipeline).

### Decision: Company-scoped idempotency journal

**Choice**: `IdempotencyStore` port + PG table `idempotency_journal` with `UNIQUE(company_id, operation, key)`. Pre-effect `register()` returns replay(completed) or proceed; same-key+different-hash → `IdempotencyConflictError` (DENY). `complete()` stores the terminal result.
**Alternatives**: in-memory only; kernel-side.
**Rationale**: Per doc §9.8 keys serialize per company+operation; a durable store survives retry across processes (the in-memory fake would lose the journal on restart).

### Decision: Use cases + runtime guards live in business-domain

**Choice**: New `packages/business-domain/src/use-cases/` (`proposeWork`/`acceptWork`/`startWork`/`completeWork`/`verifyWork`/`rejectWork`) and `src/validation/` guards. Use cases call trust-kernel authority/SoD, load scoped+versioned Work, transition, persist inside `transaction()`, close the idempotency key.
**Alternatives**: `packages/app/`.
**Rationale**: Domain orchestration is testable without app/infra and keeps vertical-deployment out of scope. Guards are pure domain predicates reused at every edge.

### Decision: Stable `evidenceId` is a business/persistence concern

**Choice**: Kernel `InMemoryRecord` stays byte-identical (411 tests GREEN). Business evidence refs use stable IDs (`${companyId}:${workId}:${transition}:${seq}` or UUID) produced by the use-case/evidence-adapter layer and referenced by `BusinessReceipt.evidenceRefs`.
**Alternatives**: add `evidenceId` to the kernel record.
**Rationale**: Avoids touching the kernel record shape and its byte-identity assertions; kernel evidence (actionId-keyed) ≠ business evidence refs.

## Data Flow

```
Command ──assertValidCommand──▶ use case
   │                               │
   │   IdempotencyStore.register ◀─┤ (pre-effect; replay → return cached)
   │                               │
   │   DbConnection.transaction ◀──┤
   │       ├─ load Work (companyId)│
   │       ├─ evaluate (trust-kernel: authority + SoD + window)
   │       ├─ assertValidTransition
   │       ├─ updateWithVersion ───┼─▶ CAS UPDATE (version+1)
   │       ├─ capture business evidence (stable evidenceId)
   │       └─ issue receipt ───────┤  UNIQUE(work_id, terminal_event_id)
   │                               │
   └── IdempotencyStore.complete ◀─┘ (commit → COMPLETED)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/trust-kernel/src/sod.ts` | Modify | Add `['proposer','approver']` to `ABSOLUTE_PAIRS` |
| `packages/trust-kernel/src/model.ts` | Modify | Add `isWindowActive(start, now, expiry)`; export it |
| `packages/trust-kernel/src/grant.ts` | Modify | `isGrantActive` rejects future `start` via `isWindowActive` |
| `packages/trust-kernel/src/identity.ts` | Modify | `resolveActiveIdentity` respects `start <= now` |
| `packages/trust-kernel/src/pipeline.ts` | Modify | Step 12 `expiryGate` → window gate (`start > now` → DENY) |
| `packages/business-domain/src/types.ts` | Modify | Add `companyId` to Work/Delegation/BusinessReceipt; `version`+`terminalEventId` |
| `packages/business-domain/src/ports/repositories.ts` | Modify | `get(id, companyId)`; `WorkRepository.updateWithVersion`; `IdempotencyStore` |
| `packages/business-domain/src/use-cases/*.ts` | Create | 6 transition use cases |
| `packages/business-domain/src/validation/*.ts` | Create | `assertValidCommand/WorkRow/Transition/...` guards + `ValidationError` |
| `packages/database/src/connection.ts` | Modify | Add `transaction<T>(fn)` to `DbConnection` |
| `packages/database/src/pg-connection.ts` | Modify | `BEGIN/COMMIT/ROLLBACK` over `pool.connect()` |
| `packages/database/test/connection-fake.ts` | Modify | Snapshot/restore rollback; `transaction` |
| `packages/database/src/work-adapter.ts` (+ delegation/receipt) | Modify | companyId param, `updateWithVersion`, `terminal_event_id` |
| `packages/database/src/idempotency-adapter.ts` | Create | PG `IdempotencyStore` |
| `packages/database/sql/003_harden_business_tables.sql` | Create | ALTER ADD COLUMN + UNIQUE constraints + `idempotency_journal` |
| `README.md` | Modify | Reflect hardened foundation + 5-package layout |

## Interfaces / Contracts

```ts
// trust-kernel/src/model.ts
export function isWindowActive(start: number, now: number, expiry: number): boolean;

// database/src/connection.ts
export interface DbConnection {
  execute(sql: string, params: readonly unknown[]): Promise<unknown>;
  query<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]>;
  transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T>;
}

// business-domain ports
export interface WorkRepository {
  save(work: Work): Promise<Readonly<Work>>;                       // initial insert
  get(workId: string, companyId: string): Promise<Work | undefined>;
  updateWithVersion(work: Work, expectedVersion: number): Promise<Readonly<Work>>;
}
export interface IdempotencyStore {
  register(companyId: string, op: string, key: string, hash: string): Promise<IdempotencyRegisterResult>;
  complete(companyId: string, op: string, key: string, hash: string, result: unknown): Promise<void>;
}
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (kernel) | SoD proposer≠approver at every tier; future-start DENY | pure TS tests, no repo |
| Unit (fake) | `transaction` rollback restores state; CAS version-mismatch throws | `InMemoryDbConnection` |
| Unit (use cases) | each transition happy path + SoD denial + stale-version conflict | scoped fakes |
| Unit (guards) | invalid command/row/transition rejected with `ValidationError` | pure predicates |
| Integration (PG) | CAS under real UPDATE; UNIQUE duplicate rejected; idempotency replay | real PG 18.4 (CI service) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

New idempotent `packages/database/sql/003_harden_business_tables.sql` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ADD CONSTRAINT IF NOT EXISTS`, new `idempotency_journal` table). Greenfield → no data migration, no backfill. Each PR slice is independently revertible (Slice A: revert pair/helper; Slice B: drop method/constraints; Slice C: delete use-case/validation layer).

## Open Questions

- [ ] Should `IdempotencyStore` expire/reap stale `in_progress` rows (TTL), or rely on `UNKNOWN` reconciliation (doc §9.8)? — proposed: reconcile, no TTL this change.
- [ ] Nested `transaction()` — throw now, add `SAVEPOINT` later? — proposed: throw + document.
