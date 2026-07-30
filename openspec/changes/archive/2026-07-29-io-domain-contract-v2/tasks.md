# Tasks: IO Domain Contract v2

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~250–300 (markdown only) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

This is a documentation/spec formalization of an already-approved exploration. No application code, tests, config, ADRs, or exploration content change (design §File Changes, §Testing). Threat matrix is N/A, so no RED-test tasks are scheduled.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Land proposal+spec+design+tasks, then verify/archive via phase owners | Single PR | `rg -c '\[(SRC|ADR-0001|ADR-0002|INF|HYP)\]' openspec/changes/io-domain-contract-v2/specs/io-domain-contract/spec.md` (traceability label readback) | N/A — no domain runtime introduced (design §Testing); `pnpm check`/`pnpm test` run as verify no-regression only | Delete `openspec/changes/io-domain-contract-v2/` and `openspec/specs/io-domain-contract/spec.md`; `exploration.md` content unaltered |

## Phase 1: Cross-Artifact Validation

- [x] 1.1 Confirm `proposal.md` scope matches `exploration.md` §2 (30-package partition 8+12+10) with no new requirements introduced.
- [x] 1.2 Readback: every requirement in `specs/io-domain-contract/spec.md` cites a `[SRC]`/`[ADR-*]`/`[INF]`/`[HYP]` label exactly once.
- [x] 1.3 Verify `design.md` File Changes table lists only docs/specs (no app/package/test/config/ADR/exploration edits).
- [x] 1.4 Confirm the five reserved human categories and deny-by-default model read identically across proposal, spec, and exploration.

## Phase 2: Spec Structural Readiness

- [x] 2.1 Confirm delta spec is archive-promotable: main `openspec/specs/io-domain-contract/spec.md` is new, so requirements are effectively ADDED.
- [x] 2.2 Confirm no MODIFIED/REMOVED/RENAMED blocks exist (new capability; nothing replaced).
- [x] 2.3 Confirm scenarios use Given/When/Then and RFC 2119 keywords per `config.yaml` rules.specs.

## Phase 3: Verification Readiness

- [x] 3.3 Confirm threat matrix N/A holds (no routing/shell/subprocess/VCS/exec boundary touched) — no RED test required.

## Post-Apply Phase Owner Obligations

- Verify: run `pnpm check` as a no-regression gate under Node 24 LTS and record pass in `verify-report.md`.
- Verify/RDD: confirm the docs-only change needs only structural review evidence; do not create an application receipt.
- Archive: merge delta into new `openspec/specs/io-domain-contract/spec.md` (preserve labels and scenarios verbatim).
- Archive: honor `config.yaml` rules.archive — warn-before-destructive-merge; no existing main spec is overwritten (new file).
- Archive: move complete change dir to `openspec/changes/archive/YYYY-MM-DD-io-domain-contract-v2/` (including `exploration.md`, content unaltered).
