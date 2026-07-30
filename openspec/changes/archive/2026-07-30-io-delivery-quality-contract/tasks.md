# Tasks: IO Delivery Quality Contract

> Documentation-only change. No product code, CI workflow, toolchain install, or
> native receipt-schema redesign is produced. Concrete realizations (strict-TDD,
> CI mechanics, cache sync, lockfile, rollback) remain owned by
> `development-toolchain`; future dispatcher/CI/provider integrations own their
> own RED tests. Threat matrix: all rows N/A → no RED tasks planned.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~340 landing PR (change-folder docs); ~80 separate archive PR |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR now (change folder); archive promotion is a later-phase PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (cached; not triggered — single PR) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

No slice is planned: risk is Low and a single PR stays within the 400-line
budget. The cached `stacked-to-main` topology applies only if a future slice
exceeds budget; it is dormant for this change.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Land docs-only change folder; prove zero executable behavior | PR 1 | `git diff --stat -- openspec/` | `pnpm check` → all gates green (docs-only regression) | Revert `openspec/changes/io-delivery-quality-contract/**` only |
| 2 | Verify trace + review-readiness evidence | PR 1 | requirement/decision trace (6/6) | `pnpm check` unchanged | Same change-folder revert |
| 3 | Canonical promotion + alignment edit | PR 2 (sdd-archive) | single-owner trace check | N/A — pure markdown promotion, no runtime | Revert canonical spec + the one alignment requirement |

## Phase 1: Apply — Documentation-Only Consistency

- [x] 1.1 Confirm scope purity: `git diff --stat` shows change folder adds only markdown under `openspec/changes/io-delivery-quality-contract/`; no `.ts`, CI yaml, toolchain install, or receipt-schema code.
- [x] 1.2 Trace all 6 new requirements to proposal intent and the 4 design decisions; confirm 6 Given/When/Then scenarios are present and use RFC 2119 keywords.
- [x] 1.3 Confirm the single `development-toolchain` ADDED requirement only references the contract and does not redefine provider-owned receipt schema or duplicate concrete mechanics.
- [x] 1.4 Run `pnpm check` (format-check + typecheck + build + lint + test) green to prove the documentation-only change introduces zero executable behavior. PASSED under Node v24.18.1 + pnpm 11.18.0 (engine-compatible, matches `.nvmrc`): exit 0, format-check (biome, 7 files), typecheck (tsc), build (tsc build), lint (biome, 7 files), test (vitest: 1 file, 2 tests passed). No toolchain install or product code touched; the docs-only change introduces zero executable behavior. See `apply-progress.md`.

## Phase 2: Verification

- [x] 2.1 Confirm every threat-matrix row is N/A; record that future dispatcher/CI/provider integrations must add RED tests for their own behaviors before implementation. — CONFIRMED. design.md Threat Matrix: 5 rows, all `N/A — no <boundary> integration`; Review/Verification Strategy states future dispatcher/CI/provider integrations MUST add their own RED tests before implementation. No executable routing/VCS/shell boundary → no RED tasks planned. See `apply-progress.md`.
- [x] 2.2 Confirm CI dimensions (`not_applicable` vs `unavailable`), review states (`ready_final_verification`, `final_verifying`), and freeze rules are stated as policy, not implemented. — CONFIRMED. Requirements 1/2/3 are normative MUST policy with no executable code; concrete mechanics deferred to `development-toolchain`. See `apply-progress.md`.
- [x] 2.3 Confirm authority: current `openspec/config.yaml` + reviewed Git candidate are cited; derived Engram cache is explicitly excluded from candidate bytes and receipt authority (Requirement 6). — CONFIRMED. Requirement 6 anchors authority to Git candidate + `openspec/config.yaml` (verified current: `rdd: true`, `chain_strategy: stacked-to-main`, `review_budget_lines: 400`); Engram cache excluded from candidate bytes/receipt authority. See `apply-progress.md`.
- [x] 2.4 Single-owner check: no delivery rule has two normative owners across the new capability and the toolchain alignment delta. — CONFIRMED. `grep` of delivery keywords across `openspec/specs/` matches ONLY `development-toolchain`; new capability owns policy, toolchain owns realization, alignment requirement is a consistency seam. See `apply-progress.md`.

## Phase 3: Review Readiness

- [x] 3.1 Produce a review checklist: review first = the 6 new requirements; explicitly out of scope = tool selection, bootstrap implementation, business receipt schema. — MET. Review Checklist in `apply-progress.md`.
- [x] 3.2 Count authored additions + deletions; confirm within the 400-line native budget; note there are no generated goldens to exclude. — MET. 273 core docs + 84 evidence = 357 authored lines, 0 deletions; no generated goldens. Within budget → single PR valid, `stacked-to-main` dormant. See `apply-progress.md`.
- [x] 3.3 Prepare single-PR body with start state, end state, out-of-scope, and verification pointer (cognitive-doc-design + work-unit-commits); state no stacked boundary is active. — MET. PR Body Notes in `apply-progress.md`.

## Phase 4: Archive Readiness (gates sdd-archive)

- [x] 4.1 Plan canonical promotion: create `openspec/specs/io-delivery-quality-contract/spec.md` and remove the `openspec/changes/io-delivery-quality-contract/` folder. — PLANNED (not executed). Target confirmed absent (pre-archive). See `apply-progress.md`.
- [x] 4.2 Plan the alignment edit: add only the one "Delivery-Quality Contract Alignment" requirement to canonical `openspec/specs/development-toolchain/spec.md`; reconfirm no duplicate ownership. — PLANNED (not executed). Single consistency-pointer requirement; concrete realization retained in canonical toolchain. See `apply-progress.md`.
- [x] 4.3 Confirm the destructive-delta warning is honored (config `archive: Warn before merging destructive deltas`); rollback reverts documentation only — no product, data, CI, or toolchain state to restore. — CONFIRMED. config rule present; rollback is docs-only. See `apply-progress.md`.
