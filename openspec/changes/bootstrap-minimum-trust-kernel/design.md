# Design: Bootstrap Minimum Trust Kernel

## Technical Approach

Add one workspace package, `packages/trust-kernel/`, containing strict-ESM TypeScript domain functions and immutable in-memory evaluation records. Root `pnpm check` remains the only gate. The package is a transitional proving ground, not a canonical domain: no I/O, adapters, persistence, frameworks, HTTP, database, daemon, LLM, real approvals/budgets/policy-version store, durable R1–R17 records, or cryptographic receipts.

## Architecture Decisions

| Decision | Choice | Alternative / rationale |
|---|---|---|
| State seam | Functions receive immutable input and return decision, evidence, audit entry, receipt, and next in-memory audit list. | Mutable singleton/repository rejected: it leaks state and obscures TDD. |
| Pipeline | Model all fixed 16 steps in order; enforce ten persistence-free gates and mark six deferred steps `pass-through: harden downstream`. | Omitting deferred steps rejected: it would hide the canonical ordering. |
| Package boundary | Add one private workspace package with no runtime dependencies. | Adding canonical packages now rejected: extraction needs persistence/first-vertical change pressure. |
| Toolchain | Expand root TS, Vitest, and Biome globs; preserve root scripts and no-emit build. | Per-package tooling rejected: duplicates the proven root-only gate. |

## Data Flow

```text
EvaluationInput + Policy + prior AuditLog
  -> classify -> grant -> identity/assignment/scope -> evidence -> SOD
  -> expiry/action scope -> final check -> Decision + Evidence + AuditLog' + Receipt?
                 \-> deferred steps: delegation, policy version, budget,
                     approvals, exceptions, records = explicit pass-through
```

Risk classification precedes every authority decision. A failed enforced step terminates as `DENY`; both allow and deny append one non-persistent audit entry. Only `ALLOW` returns an unsigned, non-persistent receipt.

## File Changes

| File | Action | Description |
|---|---|---|
| `pnpm-workspace.yaml` | Modify | Replace empty workspace list with `packages/*`. |
| `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `biome.json` | Modify | Include package source/tests in root strict checks and Vitest discovery. |
| `packages/trust-kernel/package.json` | Create | Private strict-ESM, dependency-free workspace metadata. |
| `packages/trust-kernel/README.md` | Create | Transitional marker and future extraction map. |
| `packages/trust-kernel/src/{model,identity,risk,grant,sod,evidence,pipeline,receipt,index}.ts` | Create | Types and pure authority evaluation slices. |
| `packages/trust-kernel/test/{identity,risk,grant,pipeline,sod,evidence,receipt,boundary}.test.ts` | Create | RED-first unit coverage and structural boundary checks. |

## Interfaces / Contracts

```ts
type Decision = 'ALLOW' | 'DENY';
type DeferredStep = 'delegation' | 'policy-version' | 'budget' |
  'approvals' | 'exceptions' | 'records';
interface EvaluationResult {
  decision: Decision; reason: string; risk: RiskClass;
  evidence: InMemoryEvidence; auditLog: readonly AuditEntry[];
  receipt?: UnsignedInMemoryReceipt;
  steps: readonly StepResult[];
}
```

`PrincipalId` and `PositionId` remain neutral IDs. Temporary assignments require ID, bounded scope, start, and expiry; invalid, expired, or revoked assignments add no authority. Explicit grants are command-bound and re-evaluated per input. Reserved categories are always critical; no LLM input exists in this API.

## Requirement-to-Test Map

| Requirement | Modules | RED tests |
|---|---|---|
| Transitional In-Memory Boundary | `README`, `boundary`, `index` | no dependencies/I-O imports; marked transitional; no state survives returned values |
| Neutral Identity and Bounded Roles | `model`, `identity`, `grant` | indefinite rejection; expiry/revocation preserves primary; no ambient authority |
| Deterministic Risk Classification Before Authority | `risk`, `pipeline` | identical input is stable; reserved categories critical; ordering precedes grant |
| Deny-by-Default Explicit Grant | `grant`, `pipeline` | absent/unbounded/wrong-command grant denies; enforced failure terminally denies |
| Scoped In-Memory Evaluation Pipeline | `pipeline` | fixed ordering; every enforced gate denies; six deferred steps explicitly pass through |
| In-Memory Separation of Duties | `sod`, `pipeline` | self-approval/self-verification deny; medium four-way and high/critical five-way distinctness; low only with policy |
| In-Memory Evidence and Audit | `evidence`, `pipeline` | one disclosed non-persistent audit entry for allow and deny |
| Honest In-Memory Receipt | `receipt`, `pipeline` | allow-only receipt includes IDs, authority, risk, evidence, terminal state, unsigned/non-persistent disclosure |
| Persistence-Free Pipeline Scoping | `pipeline` | enforceable gates plus named deferred no-op behavior |
| Transitional Package Boundary | `README`, `boundary` | excluded from 8+12+10=30; all six extraction targets recorded |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Every row above and pure-function determinism | Vitest RED→GREEN tests under package `test/` using object fixtures only. |
| Integration | N/A | Prohibited adapters/persistence leave no integration boundary. |
| E2E | N/A | No transport, daemon, or application exists. |

## Threat / Risk Matrix

| Risk | Status | Safe behavior / RED test |
|---|---|---|
| Persistence, adapter, network, framework leakage | Applicable | Dependency-free package; boundary test rejects forbidden imports. |
| Ambient/expired authority | Applicable | Deny unless current bounded command grant; expiry/revocation tests deny. |
| Risk downgrade or order bypass | Applicable | Reserved is critical; order test proves classify before grant. |
| SOD overlap | Applicable | Terminal deny for prohibited overlap. |
| Receipt overclaim | Applicable | Allow receipt declares unsigned/non-persistent; no receipt for deny. |
| Routing, shell, subprocess, VCS/PR, executable classification | N/A | No such boundary is introduced. |

## Migration / Rollout

No data migration. Roll out as a single dependency-free workspace package after root checks pass. Future canonical extraction is mandatory under persistence/first-vertical change pressure: identity → `organization/`; risk/grants → `policy/`; SOD → `approvals/`; evidence → `evidence/`; receipt → `receipts/`; audit → `audit/`. Revalidate that mapping and the 30-package partition before extraction; never count `trust-kernel` as package 31. Roll back by reverting the package and toolchain-glob/workspace changes together.

## Open Questions

- [ ] Define policy threshold values and authorized human exceptions in the later policy/persistence increment.
