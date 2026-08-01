# Proposal: Harden First Enterprise Vertical Foundation

## Intent

The foundation is operationally unsafe: self-approval is possible (no `proposer ≠ approver` SoD), future-start grants read active, aggregates lack tenant scope, persistence has no atomic transactions or uniqueness, and Work mutates via raw `save()` with last-write-wins, no authority, no runtime guards. PASOS Paso 1 (1.1–1.7) requires these closed before the first enterprise vertical opens; this change builds that governed foundation.

## Scope

One SDD change, **3 chained PRs (stacked-to-main)**, each ≤400 lines with its own RED→GREEN (strict TDD, `pnpm test`).

| Slice | Hardening areas (gaps) |
|---|---|
| **A — authority + scope** | (1) SoD `proposer ≠ approver` incl. low-risk; (2) `isWindowActive` → future-start inactive, honest no-op steps; (4) `companyId` on aggregates + scoped repos |
| **B — persistence + concurrency** | (3) `DbConnection.transaction(fn)` (PG+fake); (4) UNIQUE + `terminal_event_id` + 003 SQL; (5) `Work.version` + optimistic CAS, explicit conflict |
| **C — use cases + idempotency + validation** | (3) transition use cases replace `save()`; (6) idempotency-key store + attempt journal, pre-effect + terminal-close-in-one-tx; (7) runtime-validation guards; hygiene |

### Out of Scope
- NO vertical features (worker, SandboxPort, E2E LLM — Paso 2).
- NO Memory OS, minions, skills, learning, CEO, crypto receipts.
- `packages/app` untouched; `deepseek-client` NOT reopened.
- Backup branches reference-only (no code copied).

## Capabilities

### New
- `runtime-validation`: runtime guards (command, PG rows, LLM plan), explicit rejection.

### Modified
- `trust-kernel`: `proposer ≠ approver` every tier; window-active; honest no-op steps.
- `company-identity`: `companyId` mandatory, scope-enforced.
- `delegation-lifecycle`: `companyId`; window-active assignments.
- `work-lifecycle`: `companyId`; `version`+CAS; use cases replace `save()`.
- `business-receipt`: `companyId`; `terminal_event_id`; UNIQUE.
- `db-connection-port`: add `transaction(fn)` (PG+fake).

## Forbidden-Coupling Invariants (preserve all 5)

1. No aggregate imports another (neutral IDs/ports).
2. `business-domain` pure — zero `@io/*` imports.
3. `openai` confined to `deepseek-client.ts`.
4. DeepSeek output never grants authority.
5. No agentic/business frameworks.

## Success Criteria

- [ ] `proposer = approver` rejected all tiers (incl. low-risk).
- [ ] Future-start grant/assignment → inactive.
- [ ] `companyId` mandatory; scoped repos reject wrong scope.
- [ ] `transaction(fn)` atomic (PG+fake).
- [ ] UNIQUE blocks duplicate IDs / receipts.
- [ ] Concurrent Work writes: single writer wins, explicit conflict.
- [ ] Idempotency: key+hash replay; key+different-hash DENY.
- [ ] Use cases replace raw `save()`.
- [ ] Runtime guards reject bad command/PG-row/LLM-plan.
- [ ] 411 tests GREEN; CI runs PG integration (not silently skipped).

## Rollback Plan

Greenfield — no migration. Each slice independently revertible (revert merge commit); reverting all three returns to baseline `120ec33`.

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| Slice B port change ripples adapters/fakes/boundary | Med | Port+fake+boundary in one PR |
| CAS correctness (single writer wins) | Med | Concurrency tests, PG+fake |
| `companyId` breadth (4 aggregates) | Med | Mechanical; guard vs. creep |
| LLM-plan guard couples to `@io/llm-client` | Med | Guard stays in-domain |
| SoD pair alters low+policy outcomes | Low | RED→GREEN first; no silent fixes |
| Process honesty (prior reset for hacks) | Low | Real findings; verify confirms only |

## Open Design Questions (→ design)

1. `transaction(fn)` shape on driver-free port (PG BEGIN/COMMIT/ROLLBACK; honest fake).
2. `proposer ≠ approver`: absolute pair vs. low-combination only.
3. Use-case layout/naming under `business-domain/src/use-cases/`.
4. Work versioning: `version` vs. `updatedAt`; CAS + conflict type; fake CAS.
5. `terminal_event_id`: event/attempt table vs. journal column.
6. Idempotency semantics + journal location; atomic terminal close.
7. Runtime-validation placement; LLM guard without `@io/llm-client` coupling.
8. Stable business `evidenceId` across retries.
