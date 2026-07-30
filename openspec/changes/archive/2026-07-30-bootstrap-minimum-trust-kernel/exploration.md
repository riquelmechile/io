# Exploration: Bootstrap Minimum Trust Kernel

> **Roadmap Increment 2** — first strict-TDD product behavior: identity and
> principal; deterministic risk classification; policy and deny-by-default
> authority; separation of duties; evidence, audit, and honest receipt.
>
> **Constraint from archived bootstrap-development-toolchain proposal**: without
> persistence/adapters — in-memory first slice only.

---

## Current State

The repository is greenfield with exactly one phase completed: the root-only,
non-product development toolchain (Node 24 LTS + pnpm + TypeScript 6.x strict-ESM +
Vitest + Biome). `strict_tdd: true` is active and `pnpm check` passes. No product
source, no `apps/` or `packages/`, no adapters, no persistence, no runtime
exist.

**Accepted authority documents** that define the trust kernel behavior:

| Document | Relevant Contribution |
|----------|----------------------|
| ADR 0001 — Role Cardinality | One primary + bounded temporary roles; neutral `principal_id`/`position_id` boundary references |
| ADR 0002 — Delegation ≠ Work | Delegation is an authority commitment separate from execution; no ambient authority |
| ADR 0003 — Risk-Tiered Controls | Deterministic risk classification before authority; 4-tier SOD matrix; 16-step evaluation pipeline |
| `io-ports-trust-contract` spec | Command-bound authority envelope (12 fields); deny-by-default with 5 reserved categories; 16-step algorithm order; R1–R17 records |
| `io-domain-contract` spec | 30-package inventory; default-deny mechanism resolved to ports-trust; exact package boundaries |
| `io-persistence-recovery-contract` spec | PostgreSQL authoritative store; single-aggregate transaction boundaries; idempotency; outbox/inbox (all downstream) |
| `io-delivery-quality-contract` spec | SDD phase dependencies; RDD review authority; 400-line budget; stacked-to-main chaining |
| Roadmap doc § Increment 2 | Trust kernel mínimo: identidad y principal; clasificación determinística de riesgo; policy y autoridad deny-by-default; separación de funciones; evidencia, auditoría y receipt honesto |

**Toolchain evidence** (`docs/evidence/bootstrap-development-toolchain-red-green.md`)
confirms the harness is green and the toolchain gates all pass. The repo currently
has exactly 2 source files (`src/toolchain-probe.ts`, `test/toolchain-probe.test.ts`)
— neither is product/domain code.

---

## Affected Areas

| Area | Why Affected |
|------|-------------|
| `packages/trust-kernel/` (new) | New product domain package — authority evaluation pipeline, risk classification, identity types, SOD, evidence, receipts. |
| `src/toolchain-probe.ts` | Minimal update to remove the probe from `typecheck` include, or leave as non-product fixture. |
| `vitest.config.ts` | Must include the new package in test discovery if multi-project; or keep root `include` broad. |
| `tsconfig.json` | Must add paths/ references or adjust `include` for new package. |
| `tsconfig.build.json` | Must include or exclude the new package source (product code should be validated by `build`). |
| `pnpm-workspace.yaml` | Must add `packages/` glob if we use workspace packages (optional for first slice). |
| `openspec/config.yaml` | Testing block may need to declare `packages` for test discovery. |
| `openspec/specs/` (canonical) | No changes in this exploration phase; future archive will promote delta specs. |

---

## Approaches

### 1. Transitional `packages/trust-kernel/` Module

Create one domain package outside the 30 canonical packages that concentrates the
minimal trust kernel: identity types, risk classification, authority evaluation,
SOD, evidence, and receipt. No real adapters, no persistence — all pure functions
and in-memory state exercised through unit tests.

**Architecture**: Single `packages/trust-kernel/src/` with submodules:
- `identity.ts` — `PrincipalId`, `PositionId`, `Principal`, `Position`
- `risk.ts` — `RiskClass` enum, deterministic classification function
- `authority.ts` — `AuthorityEnvelope`, `AuthorityDecision`, policy evaluation pipeline (simplified 16-step)
- `sod.ts` — SOD checks per ADR-0003 tier matrix
- `evidence.ts` — `EvidenceRecord`, evidence collection
- `receipt.ts` — `Receipt` type with minimum fields
- `audit.ts` — In-memory audit trail (list of `AuditEntry`)
- `pipeline.ts` — `evaluateAction()` orchestrator that runs classification → authority → SOD → evidence → receipt

| Pros | Cons |
|------|------|
| Simple start — one package, one tsconfig | Package name "trust-kernel" is transitional; must be refactored later into canonical packages |
| Easy to test — pure domain logic, zero I/O | Temporary package name introduces renaming cost |
| No premature canonical-package boundary decisions | Doesn't reflect the final 30-package inventory |
| Clean boundary for Increment 3 (persistence adds adapters at port boundaries) | Could delay canonical-split decisions |

**Effort**: Medium

### 2. Multiple Canonical Packages (First Pass)

Start creating the actual canonical packages that the trust kernel touches:
`organization/` (Core Business, for identity/principal/position), `policy/`
(Platform-Enabled, for risk classification + policy rules), `approvals/` (for
SOD), `evidence/`, `receipts/`, `audit/` (all Platform-Enabled).

| Pros | Cons |
|------|------|
| Aligned with final architecture from day one | 6+ packages for the first product behavior — disproportionate overhead |
| No refactoring needed later | Cross-package coordination in tests is heavier |
| Each package has clear ownership boundary | Risk of getting boundaries wrong without runtime experience |
| | Many packages would be near-empty (just 2–3 types each) for the first slice |

**Effort**: High

### 3. Flat `src/` Product Code

Place all trust kernel types and functions directly in `src/` (or a
`src/trust-kernel/` subdirectory), outside any package structure. Same module
boundary as the toolchain probe.

| Pros | Cons |
|------|------|
| Fastest to implement | Creates structural tech debt immediately |
| No monorepo decisions needed yet | `src/` was established as non-product harness; mixing product code blurs the boundary |
| Simplest toolchain config | No path to monorepo migration — `src/` is not `packages/` |

**Effort**: Low (short-term), High (long-term — must be refactored)

---

## Recommendation

**Approach 1: Transitional `packages/trust-kernel/` module.**

Rationale:

1. **First product behavior needs a clear boundary** — keeping the trust kernel
   isolated from the toolchain probe (`src/`) and from the yet-unchosen canonical
   package split lets us focus on getting the domain logic right.

2. **No persistence/adapters** — a single package with pure functions, types, and
   in-memory state is the lightest container for strict TDD. Every scenario
   exercises the pipeline through unit tests only.

3. **Refactoring to canonical packages is expected** — the roadmap Increment 3
   (persistence) and Increment 4 (first vertical) are natural points to split
   `trust-kernel` into the canonical packages listed in `io-domain-contract`.
   Documenting the expected refactoring path in the design avoids stagnation.

4. **Review budget** — a single focused package stays well within 400 lines
   for types + pipeline + tests, where 6 canonical packages would each need
   scaffolding (index files, tsconfig, test setup) that inflates the line count.

**Key decisions for Proposal/Design:**

- Package name: `trust-kernel` — clearly transitional, NOT a final canonical name
- No dependency on any driven port, adapter, or framework
- All state is in-memory, scoped to single use-case execution
- Receipts are in-memory data structures (no cryptographic signatures yet)
- The 16-step pipeline (§5.4 of io-ports-trust-contract) is implemented in
  simplified form: steps requiring delegation, budget, real approvals, and
  persisted records use explicit pass-through or always-grant stubs documented
  as "harden in Increment 3/4"
- The authority envelope includes all 12 fields from the contract but only a
  subset are enforced in this increment (risk, identity, assignment, scope,
  evidence, SOD)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Scope creep** — roadmap lists identity, risk, policy, SOD, evidence, audit, AND receipt in one increment | Medium | High — exceeds 400-line budget or takes multiple design iterations | Exploration identifies clear boundary: implement minimum authority evaluation flow. Defer delegation lifecycle, real budget, persistent records to Increment 3/4. |
| **Receipt without signing** — "honesto" could be interpreted as requiring cryptographic receipts | Low | Medium — scope ambiguity | Clarify in design: first slice uses in-memory receipt data structures. Cryptographic binding is downstream (Increment 4+ when daemon boundaries exist). |
| **Package structure decision postpones canonical boundaries** | Medium | Medium — architectural drift if refactoring never happens | Design must document planned refactoring to `organization/`, `policy/`, `approvals/`, `evidence/`, `receipts/`, `audit/` at the persistence increment. |
| **16-step pipeline is complex for first product code** | Medium | High — over-engineered first slice if all 16 steps are implemented | Scope the first slice to the steps that work in-memory without persistence: classification, identity, assignment, authority existence, bounded scope, SOD, expiry, evidence. Delegate delegation/policy-version/budget/approvals/records steps to later increments. |
| **Toolchain config changes (workspace, tsconfig, vitest) inflate review** | Low | Medium — tooling changes are one-time | Each config file change is small; the pattern is already established by the bootstrap phase. |

---

## Ready for Proposal

**Yes.** The exploration identifies a clear first-product-behavior boundary,
one recommended approach (transitional package), explicit scope boundaries,
and documented risks.

The orchestrator should:

1. Proceed to **Proposal** for `bootstrap-minimum-trust-kernel`.
2. In the proposal, adopt Approach 1 (transitional `packages/trust-kernel/`)
   and confirm the scope boundaries against the archived proposal constraints.
3. Be explicit that:
   - No persistence/adapters — all in-memory, pure domain logic
   - Receipts are in-memory data structures
   - The 16-step pipeline is scoped to persistence-free steps
   - Refactoring to canonical packages is planned for Increment 3
4. Flag the 400-line review budget: a single package + tests should fit,
   but the proposal should track the forecast.
