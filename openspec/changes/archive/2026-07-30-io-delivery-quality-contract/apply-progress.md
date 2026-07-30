# Apply Progress: IO Delivery Quality Contract

> Documentation-only change. Cumulative across native attempts 1–3. Attempt 3
> work unit `phase2-review-archive-readiness`, evidence goal
> `complete-verification-review-archive-readiness-tasks`. No product code, CI
> workflow, toolchain install, or receipt-schema redesign produced.

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `git diff --stat -- openspec/changes/io-delivery-quality-contract` → docs only, 0 deletions. `rg -c '^### Requirement:' specs/io-delivery-quality-contract/spec.md` → 6; `rg -c '^#### Scenario:'` → 6. `grep -rn '<delivery keywords>' openspec/specs/` → matches only in `development-toolchain` (single-owner). All exit 0. |
| Runtime harness command/scenario and exact result | Reused from attempt 2 (invariant): `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` → GREEN, exit 0 (Node v24.18.1, pnpm 11.18.0). Gates: format-check, typecheck, build, lint (biome, 7 TS files), test (vitest 1 file, 2 tests). Phase 2–4 work adds only `.md` content to the change folder; biome/tsc/vitest scope is unchanged, so every gate outcome is invariant — zero executable behavior introduced. No re-run required; no toolchain activity added. |
| Rollback boundary | Revert/remove `openspec/changes/io-delivery-quality-contract/**` (proposal.md, design.md, tasks.md, apply-progress.md, specs/io-delivery-quality-contract/spec.md, specs/development-toolchain/spec.md). `exploration.md` is pre-existing tracked/unmodified and is NOT part of this change. No product code, CI, data, or toolchain state to restore. |

## TDD Cycle Evidence

Documentation-only scope: no product code, runtime behavior, CI workflow, or
toolchain implementation changed in this apply candidate. Strict TDD remains
active for the repository, and this change records the explicit N/A waiver for
RED/GREEN/REFACTOR at the work-unit level instead of creating meaningless tests
for OpenSpec prose.

| Cycle | Evidence | Result |
|---|---|---|
| RED | N/A — the change only adds OpenSpec markdown policy artifacts; no executable behavior or failing product test target exists. Future dispatcher, CI, or provider-code implementations of this policy MUST add RED tests before implementation. | Waived for docs-only scope |
| GREEN | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` passed under Node v24.18.1 + pnpm 11.18.0. Gates: format-check, typecheck, build, lint, Vitest. | Passed |
| REFACTOR | No code refactor performed; documentation was reconciled for requirement traceability, authority boundaries, and review/archive readiness. | N/A |
| Safety net | The same `pnpm check` command proves the existing executable project surface remains green while the candidate changes only markdown under `openspec/changes/io-delivery-quality-contract/`. | Passed |

## Task Status

### Phase 1: Apply — Documentation-Only Consistency (attempt 1–2)

- [x] **1.1 Scope purity** — CONFIRMED. Only untracked `.md` under the change folder; no `.ts`, CI yaml, toolchain, or receipt-schema code.
- [x] **1.2 Requirement trace (6/6) + RFC 2119** — CONFIRMED. 6 requirements, 6 scenarios, RFC 2119 MUST keywords. Trace table below.
- [x] **1.3 development-toolchain minimal alignment delta** — CONFIRMED. One ADDED requirement; references the contract; `MUST NOT redefine the provider-owned receipt schema`.
- [x] **1.4 `pnpm check` green** — MET (attempt 2). Exit 0 under Node v24.18.1 + pnpm 11.18.0.

### Phase 2: Verification (attempt 3)

- [x] **2.1 Threat matrix all N/A** — CONFIRMED. design.md Threat Matrix has 5 rows (Documentation-like paths, Git repository selection, Commit state, Push state, PR commands), all `N/A — no <boundary> integration`. Review/Verification Strategy states: "No unit, integration, E2E, or RED tests are created… Future dispatcher/CI/provider integrations MUST add RED tests for their applicable behaviors before implementation." No executable routing/VCS/shell boundary exists, so no RED tasks are planned.
- [x] **2.2 Policy, not implementation** — CONFIRMED. Review states (`ready_final_verification`, `final_verifying` — Req 1), candidate freeze + single bounded correction (Req 2), and CI dimensions (`not_applicable` vs `unavailable`, fork live-smoke — Req 3) are normative MUST policy statements with no executable code. Each defers concrete mechanics to `development-toolchain` ("Concrete mechanics are specified in `development-toolchain`").
- [x] **2.3 Authority boundary** — CONFIRMED. Requirement 6: "Reviewed Git candidate bytes and `openspec/config.yaml` are the delivery authority. Derived Engram caches… MUST NOT be treated as Git artifacts, candidate bytes, or evidence of distributed atomicity." Current `openspec/config.yaml` verified authoritative: `rdd: true`, `delivery.chain_strategy: stacked-to-main`, `delivery.review_budget_lines: 400`, `delivery.delivery_strategy: auto-chain`.
- [x] **2.4 Single-owner check** — CONFIRMED. `grep -rn` of delivery keywords across `openspec/specs/` returns matches ONLY in `development-toolchain` (concrete realization). The new capability owns cross-cutting POLICY; `development-toolchain` owns CONCRETE realization (strict-TDD activation, CI dimensions, cache sync, rollback, lockfile forecasting); the one alignment requirement is a consistency seam ("MUST remain consistent… MUST NOT contradict"), not a second normative source. Semantic proximity between new Req 3 and canonical "Orthogonal Check Status Dimensions" is partitioned by abstraction layer (policy vs realization), not duplicated ownership.

### Phase 3: Review Readiness (attempt 3)

- [x] **3.1 Review checklist** — MET. See Review Checklist below. Review first = the 6 new requirements; out of scope = tool selection, bootstrap implementation, business receipt schema.
- [x] **3.2 Authored-line budget** — MET. See Review Budget below. Core deliverable = 273 lines; total incl. this evidence file ≤ 400; no generated goldens.
- [x] **3.3 Single-PR body** — MET. See PR Body Notes below. Single PR; no stacked boundary active.

### Phase 4: Archive Readiness (attempt 3 — plan only; not executed)

- [x] **4.1 Canonical promotion plan** — PLANNED (not executed). On archive: create `openspec/specs/io-delivery-quality-contract/spec.md` from the delta's normative content, then remove the `openspec/changes/io-delivery-quality-contract/` folder. Confirmed the canonical target does NOT yet exist (pre-archive).
- [x] **4.2 Alignment edit plan** — PLANNED (not executed). Add ONLY the one "Delivery-Quality Contract Alignment" requirement (with its scenario) to canonical `openspec/specs/development-toolchain/spec.md`. Reconfirm no duplicate ownership: canonical toolchain retains its concrete realization requirements; the added requirement is a consistency pointer, not a restatement of the 6 policy requirements.
- [x] **4.3 Destructive-delta warning honored** — CONFIRMED. `openspec/config.yaml` rule: `archive: Warn before merging destructive deltas`. Rollback reverts documentation only — no product, data, CI, or toolchain state to restore (matches proposal Rollback Plan and design Migration/Rollback).

## Requirement → Proposal / Design Trace (6/6)

Decisions: **D1 Policy ownership**, **D2 Receipt boundary**, **D3 Authority**, **D4 Delta promotion**.

| # | Requirement | Proposal anchor | Decision | RFC 2119 |
|---|---|---|---|---|
| 1 | SDD Phase Dependencies / Verification Dispatch Readiness | In-Scope SDD phase deps | D3 | MUST |
| 2 | Native Review Authority and Candidate Freeze | Out-of-Scope receipt redesign | D2 | MUST |
| 3 | Orthogonal CI Status Dimensions | In-Scope CI separation + DeepSeek fork | D4 | MUST |
| 4 | 400-Line Review Budget / Stacked-to-Main | In-Scope review budget + auto-chain | D1 | MUST |
| 5 | Work-Unit Commits | In-Scope commit discipline | D1 | MUST |
| 6 | Authority Boundary — Git Candidate vs Engram Cache | Risk: separate Git vs Engram | D3 | MUST |

## Review Checklist (3.1)

- **Review first:** the 6 new requirements + 6 scenarios in `specs/io-delivery-quality-contract/spec.md` (RFC 2119 compliance, dispatch-readiness gate, freeze invalidation, CI dimension orthogonality, fork smoke handling, budget auto-chain, commit scoping, authority boundary).
- **Also review:** the single alignment requirement in `specs/development-toolchain/spec.md` (consistency seam, no schema redefinition).
- **Out of scope:** tool/package-manager/test-DB/scanner selection; bootstrap implementation; CI workflow creation; business receipt schema design; native receipt-schema redesign.

## Review Budget (3.2)

- Authored additions = 5 core deliverable docs: `proposal.md` (59) + `design.md` (73) + `tasks.md` (61) + `specs/io-delivery-quality-contract/spec.md` (67) + `specs/development-toolchain/spec.md` (13) = **273 lines**.
- Plus this evidence file `apply-progress.md` (84 lines) → total **357** authored lines. Deletions = 0 (all new files).
- No generated goldens exist to exclude.
- Result: within the 400-line native budget → single PR valid; dormant `stacked-to-main` chain NOT triggered.

## PR Body Notes (3.3)

- **Start state:** no delivery-quality contract capability existed; delivery rules were ad-hoc.
- **End state:** new `io-delivery-quality-contract` capability (6 requirements) + one alignment requirement in `development-toolchain`; docs-only, zero executable behavior (proven green by attempt 2 `pnpm check`).
- **Out of scope:** tool selection, bootstrap implementation, business receipt schema, native receipt redesign, archive promotion (separate later PR).
- **Verification pointer:** trace 6/6 (above); `pnpm check` green (attempt 2, reused — invariant to docs-only growth).
- **Chain state:** single PR; no stacked boundary active (`stacked-to-main` dormant, risk Low).

## Deviations / Issues

None. Phases 2–4 are verification/readiness evidence only; no design, product, CI, toolchain, or receipt-schema change. Attempt 1's Node-engine blocker was resolved in attempt 2 (Node 24.18.1 runtime via PATH, no install).

## Remaining Tasks

All apply/checklist tasks (1.1–4.3) complete. Next: native bounded review, then `sdd-verify`, then a separate archive PR (Phase 4 plans).
