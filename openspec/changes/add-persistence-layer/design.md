# Design: Add Persistence Port Boundary (Evidence/Audit)

## Technical Approach

Define outbound hexagonal **port interfaces** for evidence (R7) and audit (R16)
storage inside a new `packages/trust-kernel/src/ports/` directory. `evaluate()`
accepts the repositories as **optional** inputs on `EvaluationInput`; when absent
the exact current in-memory path runs unchanged; when present `finalize()` routes
the captured record through the port. Generic types (no `pg`) and `import type`
keep the package dependency-free. In-memory fakes prove the boundary with unit
tests only (`integration: false`). This implements proposal **Approach 1** and
activates only the port-interface aspect of `io-persistence-recovery-contract`;
real PG storage and canonical extraction are deferred to stacked slices.

## Architecture Decisions

| # | Decision | Choice | Alternatives / rationale |
|---|---|---|---|
| D1 | Port location | `packages/trust-kernel/src/ports/` now | New port package rejected: extraction needs change pressure (per archived design). `ports/` dir signals extraction boundary; moves with its aggregate later. |
| D2 | Injection style | **Optional** repos on `EvaluationInput` | Required injection rejected: breaks all 145 callers. Optional preserves byte-identical no-repo path. |
| D3 | Port typing | **Generic** records, no `pg` types | PG-specific interfaces rejected: would import an uninstalled driver AND trip the boundary detector. Generic types keep `integration:false`. |
| D4 | Runtime coupling | `import type` for ports in domain | Value import rejected: type-only import is erased by tsc → zero runtime deps → `package.json` unchanged. |
| D5 | Result shape | Add optional `persistence: PersistenceOutcome`; keep `evidence`/`auditLog` as captured `InMemoryRecord` | Generic `EvaluationResult<R>` rejected: heavier, riskier. Carrying both records is honest — in-memory capture ≠ durable routing — and the divergence is visible in the type system. |
| D6 | Honesty of `persistent:true` | Literal is a **port-contract path marker**; durability truth lives in adapter-supplied `disclosure` | Fake claiming "durable in PostgreSQL" rejected as a lie. Fake supplies an honest disclosure ("routed via port; durability depends on adapter"). Honesty contract preserved. |
| D7 | Boundary detector | **Universal** — scans `ports/` too, NO per-file exemption | Proposal's "ports/ exemption" reframed: generic-typed ports pass the detector on merit; exempting ports would WEAKEN the guard. Stronger: ports proven clean like every other file. |
| D8 | `persistent` literal | Keep `InMemoryRecord.persistent:false`; add `PersistentRecord.persistent:true` | Single union rejected: loses the literal honesty contract that distinguishes paths. |

## Data Flow

```text
EvaluationInput (+ optional evidenceRepo?, auditRepo?)
  └─ evaluate() ── 16-step gates ── finalize()
                                     │
        ┌────────────────────────────┴────────────────────────────┐
        │ both repos absent                                         │ repos present
        ▼                                                           ▼
 captureEvidence → InMemoryRecord (persistent:false)      captureEvidence → InMemoryRecord (captured)
 result byte-identical to today                           + build PersistentRecord (persistent:true)
                                                          + evidenceRepo.save() / auditRepo.append()
                                                          result.persistence = { evidenceRecord?, auditRecord? }
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/trust-kernel/src/model.ts` | Modify | Add `PersistentRecord` (`persistent: true` literal + `disclosure`) alongside `InMemoryRecord`; add `PersistentEvidence`/`PersistentAuditEntry` aliases (R7/R16). |
| `packages/trust-kernel/src/ports/repositories.ts` | Create | `EvidenceRepository` (save+get), `AuditRepository` (append+getLog) generic interfaces; `PersistenceOutcome` type; `PERSISTENT_PORT_DISCLOSURE`. |
| `packages/trust-kernel/src/ports/fakes.ts` | Create | `InMemoryEvidenceRepository`, `InMemoryAuditRepository` test doubles (Map/array backed, immutable returns). |
| `packages/trust-kernel/src/pipeline.ts` | Modify | `EvaluationInput` gains optional `evidenceRepository?`/`auditRepository?`; `finalize()` routes via ports when present; `EvaluationResult` gains optional `persistence?`. |
| `packages/trust-kernel/src/index.ts` | Modify | Export port types, `PersistentRecord`, fakes. |
| `packages/trust-kernel/test/boundary.test.ts` | Modify | Assert `ports/` files ARE scanned by the universal forbidden-import detector (D7) + package stays zero-dep. |
| `packages/trust-kernel/test/ports.test.ts` | Create | RED tests: repo-absent byte-identity, repo-present routing, fake store/get/append. |
| `packages/trust-kernel/package.json` | No change | **Finding (corrects proposal):** generic types + `import type` ⇒ zero runtime deps. No `pg` added this slice. |

## Interfaces / Contracts

```ts
// model.ts — honesty literal is the path marker (D6)
export interface PersistentRecord {
  readonly actionId: string; readonly principalId: PrincipalId;
  readonly riskClass: RiskClass; readonly decision: Decision; readonly reason: string;
  readonly timestamp: number; readonly persistent: true; readonly disclosure: string;
}
export type PersistentEvidence = PersistentRecord;     // R7
export type PersistentAuditEntry = PersistentRecord;    // R16

// ports/repositories.ts — generic, no driver types (D3); import type in domain (D4)
export interface EvidenceRepository<R = PersistentRecord> {
  save(record: R): Readonly<R>; get(actionId: string): R | undefined;
}
export interface AuditRepository<R = PersistentRecord> {
  append(record: R): readonly R[]; getLog(): readonly R[];
}
export interface PersistenceOutcome {
  readonly evidenceRecord?: PersistentRecord;   // R7 routed
  readonly auditRecord?: PersistentRecord;       // R16 routed
}

// pipeline.ts deltas
interface EvaluationInput { /* existing... */ readonly evidenceRepository?: EvidenceRepository;
  readonly auditRepository?: AuditRepository; }
interface EvaluationResult { /* existing... */ readonly persistence?: PersistenceOutcome; }
```

## Requirement-to-Test Map

| Obligation | Modules | RED tests |
|---|---|---|
| R7 Evidence port | `ports/repositories`, `ports/fakes`, `pipeline` | repo-present saves R7 record; fake get round-trips; repo-absent path unchanged. |
| R16 Audit port | `ports/repositories`, `ports/fakes`, `pipeline` | repo-present appends R16 immutably; getLog reflects order; prior log never mutated. |
| Port boundary purity | `boundary` | `ports/**` scanned by universal detector; zero forbidden specifiers; `package.json` zero deps. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | repo-absent byte-identity; repo-present routing; fake store/get/append; literal `persistent` discriminant | Vitest RED→GREEN, object fixtures only. |
| Integration | N/A | `integration: false` — no real DB this slice. |
| E2E | N/A | No transport/daemon exists. |

Strict TDD proof of the port boundary: fakes are the only adapters; if the
boundary leaked a driver/framework, the universal detector (now covering `ports/`)
would fail before GREEN.

## Threat / Risk Matrix

| Risk | Status | Safe behavior / RED test |
|---|---|---|
| Persistence/adapter/framework leakage | Applicable | Universal forbidden-import detector scans `ports/`; generic types (no `pg`); `import type` erased; `package.json` stays zero-dep. |
| Type confusion (`InMemoryRecord` ↔ `PersistentRecord`) | Applicable | Literal `persistent:false`/`:true` discriminant; distinct aliases; tsc rejects cross-assignment. |
| Backward-compat breakage | Applicable | Optional repos; no-repo path byte-identical; all 145 existing tests must stay green. |
| Port-location staging conflict | Applicable (low) | `ports/` dir signals extraction boundary; recorded in descriptor; revalidated under extraction pressure. |
| Routing, shell, subprocess, VCS/PR, executable classification, process integration | N/A | None introduced (no transport/daemon/CLI). |

## Migration / Rollout

No data migration (no real persistence exists). Rollback (per config rule):

1. Revert `EvaluationInput`/`EvaluationResult` optional repo fields.
2. Delete `packages/trust-kernel/src/ports/` and `test/ports.test.ts`.
3. Remove `PersistentRecord` + aliases from `model.ts`; revert `index.ts` exports.
4. Revert `boundary.test.ts` `ports/` assertions.
5. `pnpm test` confirms 145 tests restored green.

**Capital/secrets guard**: touches NO credentials, secrets, or human
constitutional-authority boundaries. Zero data-loss risk.

## Extraction Staging

This slice DEFINES the port pattern all aggregates will follow but DELIBERATELY
defers: (a) the real PostgreSQL adapter (next slice — needs `integration:true`
+ `psql`); (b) canonical extraction into `organization/`, `policy/`,
`approvals/`, `evidence/`, `receipts/`, `audit/`; (c) the remaining R1–R6,
R8–R15, R17 ports. `packages/trust-kernel/` REMAINS excluded from the
8+12+10=30 canonical partition; the `ports/` directory is a forward signal of
extraction seams, not a canonical package.

## Open Questions

- [ ] Should the real PG adapter (next slice) live in `packages/trust-kernel/src/ports/pg/` or a sibling `packages/database/` adapter package? Lean sibling adapter package so the kernel stays driver-free.
- [ ] Transaction/session context shape (`DbSession`) — deferred; ports are single-method, no session param this slice. Decide when the real adapter lands.
