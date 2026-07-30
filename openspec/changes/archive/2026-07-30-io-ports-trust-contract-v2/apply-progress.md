# Apply Progress: IO Ports Trust Contract v2

> **Work Units 1 and 2 are COMPLETE and validated.** Work Unit 1 (Phase 1, tasks
> 1.1–1.7) validated the new `io-ports-trust-contract` contract. Work Unit 2 (Phase 2,
> tasks 2.1–2.3 + readiness prep 3.1–3.3, 4.1, 5.1–5.3) validated the domain delta and
> confirmed verify/archive readiness by inspection. The verify report is a **verify-phase
> obligation** produced by `sdd-verify`, not an apply checkbox. All 7
> new-capability checks and the domain delta checks pass against `exploration.md` +
> ADR-0001/0002/0003. No spec content changes were required — the artifacts produced by
> earlier phases already satisfy every criterion. This is a **documentation-only** change;
> Strict TDD is active but no runtime code exists, so each task records the explicit reason
> RED/GREEN tests do not apply (work product is a normative spec document validated by
> inspection). Runtime safety-net baseline captured: `pnpm test` GREEN 2/2 (re-confirmed in
> WU2).

## Quick path

1. Read all change artifacts (proposal, 2 specs, design, tasks) + `exploration.md` + ADR-0001/0002/0003 + canonical `io-domain-contract` spec.
2. Ran the runtime safety net: `pnpm test` → `vitest run` → 1 file / 2 tests passed, exit 0 (WU1 and re-confirmed in WU2).
3. WU1: citation + field validation for tasks 1.1–1.7.
4. WU2: domain-delta + readiness validation for tasks 2.1–2.3, 3.1–3.3, 4.1, 5.1–5.3.
5. Marked validated apply-readiness tasks `[x]` in `tasks.md`. `sdd-verify` still produces the verify report as the next phase deliverable.

## Scope and PR Boundary

| Field | Value |
|-------|-------|
| Mode | Strict TDD (no silent fallback; no runtime code to test) |
| Work units | 1 — Finalize + validate new `io-ports-trust-contract` normative contract (DONE); 2 — Resolve `io-domain-contract` handoff by reference + readiness prep (DONE) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (PR 1 → `main`; PR 2 → PR 1 branch, then `main`) |
| This change | Work Units 1 and 2 complete; verify report remains the next phase deliverable |
| Left pending | No apply checkboxes. `sdd-verify` must produce `verify-report.md`. |
| Review budget | Well under 400 changed lines (validation only; no artifact content added) |

## Files Changed This Change

| File | Action | What Was Done |
|------|--------|---------------|
| `openspec/changes/io-ports-trust-contract-v2/tasks.md` | Modified | WU1: checked 1.1–1.7 `[x]`. WU2: checked 2.1–2.3, 3.1–3.3, 4.1, 5.1–5.3 `[x]`; verify report recorded as a verify-phase obligation, not an apply checkbox. |
| `openspec/changes/io-ports-trust-contract-v2/apply-progress.md` | Created (WU1) → Updated (WU2) | This progress artifact with WU1 + WU2 validation and TDD/work-unit evidence (merged). |

> No changes to `proposal.md`, `design.md`, or either `spec.md`: the specs already satisfy every
> criterion. No runtime source code was added or modified (documentation-only change).

## TDD Cycle Evidence (Strict TDD Active)

> **Why there are no RED/GREEN test cells:** Strict TDD is active (`openspec/config.yaml`
> `strict_tdd: true`, `test_command: pnpm test`, runner vitest). However, this change introduces
> **no runtime implementation** — the work product is the normative `io-ports-trust-contract` spec
> and the `io-domain-contract` delta. `design.md` Testing Strategy states explicitly: "No unit,
> integration, E2E, or RED tests are introduced: there is no runtime implementation." The threat
> matrix is **all N/A** (no classifier/executor/VCS/commit/push/PR automation is designed). Strict
> TDD's RED→GREEN→REFACTOR cycle is premised on production code existing; here none exists, so each
> task records the structural reason tests cannot apply instead of fabricating a fake test run. The
> validation is **citation + field + structural inspection** against `exploration.md`,
> ADR-0001/0002/0003, and the canonical `io-domain-contract` spec — exactly the focused review
> defined for the work units in `tasks.md`. This is the documented no-silent-fallback treatment,
> not a switch to Standard Mode.

### Work Unit 1 (Phase 1 — new-capability contract validation)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated 7 requirements vs spec | N/A: no code to exercise | N/A: structural enumeration, single correct count | N/A: spec unchanged |
| 1.2 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated 12 envelope fields vs exploration §4.1 | N/A | N/A: field-set match, single correct set | N/A: spec unchanged |
| 1.3 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated 16-step ordering + DENY-any vs exploration §5.4 | N/A | N/A: fixed ordering, single correct sequence | N/A: spec unchanged |
| 1.4 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated ADR carry vs ADR-0001/0002/0003 + reserved categories | N/A | N/A: citation presence check | N/A: spec unchanged |
| 1.5 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated neutral IDs + daemon-no-credentials | N/A | N/A: invariant presence check | N/A: spec unchanged |
| 1.6 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated R1–R17 scope + R10/R15 dual-ref | N/A | N/A: record enumeration, single correct set | N/A: spec unchanged |
| 1.7 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; validated downstream exclusions explicit | N/A | N/A: exclusion presence check | N/A: spec unchanged |

### Work Unit 2 (Phase 2 — domain delta validation + verify/archive readiness prep)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; delta resolves handoff exactly once in 2 MODIFIED requirements | N/A: no code to exercise | N/A: structural match, single correct resolution | N/A: delta unchanged |
| 2.2 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; 4 mechanisms reference new capability, no duplication | N/A | N/A: reference-set match | N/A: delta unchanged |
| 2.3 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; H1–H3 excluded, H4 enforced, H5/H6 resolved; no open handoff | N/A | N/A: disposition enumeration | N/A: delta unchanged |
| 3.1 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; every requirement labeled, each cited once | N/A | N/A: citation presence + once-check | N/A: specs unchanged |
| 3.2 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; delta scenarios align with new-capability scenarios | N/A | N/A: cross-check, no contradiction | N/A: specs unchanged |
| 3.3 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; 5 threat-matrix rows N/A with reasons; no RED tests | N/A | N/A: matrix enumeration | N/A: design unchanged |
| 4.1 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; counts stable (7 req / 10 scenarios + delta 2 req / 3 scenarios) | N/A | N/A: count match | N/A: specs unchanged |
| Verify report | N/A (verify phase) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; `sdd-verify` produces `verify-report.md` after apply readiness | N/A | N/A: phase deliverable, not an apply checkbox | N/A |
| 5.1 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; promotion path clear (no existing canonical capability) | N/A | N/A: path-presence check | N/A: no file created (archive-owned) |
| 5.2 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; MODIFIED delta format correct; unchanged-intent scenario preserved exactly | N/A | N/A: format + wording check | N/A: delta unchanged |
| 5.3 | N/A (doc-only) | Inspection | `pnpm test` 2/2 GREEN | N/A: no runtime code; naming convention understood; delta MODIFIED non-destructive | N/A | N/A: convention + non-destructive check | N/A: no folder created (archive-owned) |

### Test Summary

- **Total runtime tests written this change**: 0 (documentation-only; design forbids runtime tests for this change).
- **Safety-net tests passing (pre-existing, unrelated to spec)**: 2/2 — `test/toolchain-probe.test.ts` (re-confirmed GREEN in WU2, exit 0).
- **Layers used**: Inspection (citation + field + structural review vs `exploration.md`, ADR-0001/0002/0003, canonical `io-domain-contract`).
- **Approval tests**: None — no refactoring of production code (no production code exists).
- **Pure functions created**: 0 (no runtime implementation in this change).

## Work Unit Evidence (Hard Gate — All Modes)

### Work Unit 1

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm test` → `vitest run` → `Test Files 1 passed (1)` / `Tests 2 passed (2)`, exit 0 (safety net). Spec-content focused review = citation/field validation against `exploration.md` + ADR-0001/0002/0003. All 7 checks PASS. |
| Runtime harness command/scenario and exact result | N/A — documentation-only change; no runtime implementation to exercise (design Testing Strategy + threat matrix all N/A). Safety-net harness above confirms toolchain is GREEN. |
| Rollback boundary | Revert `tasks.md` checkboxes (1.1–1.7) and this WU1 evidence. The `io-ports-trust-contract` spec files remain as authored; the `io-domain-contract` deferred handoff is untouched by this slice. |

### Work Unit 2

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm test` → `vitest run` → `Test Files 1 passed (1)` / `Tests 2 passed (2)`, exit 0 (safety net). Focused review = domain-delta + readiness inspection against the canonical `io-domain-contract` spec, `exploration.md`, and ADR-0001/0002/0003. Tasks 2.1–2.3, 3.1–3.3, 4.1, 5.1–5.3 all PASS. |
| Runtime harness command/scenario and exact result | N/A — documentation-only change; no runtime implementation to exercise (design Testing Strategy + threat matrix all N/A). Safety-net harness above confirms nothing was broken. |
| Rollback boundary | Revert `tasks.md` checkboxes (2.1–2.3, 3.1–3.3, 4.1, 5.1–5.3) and this WU2 evidence. No spec content, canonical spec, or archive folder was created or modified by this slice — only `tasks.md` checkboxes and this progress artifact. |

## Phase 1 Validation Findings (1.1–1.7)

### 1.1 — Seven requirements present: PASS
All 7 requirements exist in `specs/io-ports-trust-contract/spec.md`:
1. Product Surface and Port Separation — 2. Command-Bound Authority Envelope — 3. Default-Deny Authority with Reserved Categories — 4. Separation-of-Duties Tiers — 5. Bounded Role Model — 6. Delegation Separation and Conservative Revocation — 7. Required Persistence and Recovery Records.

### 1.2 — Envelope carries all required fields: PASS
Spec lists all 12 field groups (`work_id`/`step_id`, `principal_id`/`position_id`, `authority_commitment_id`, `action_scope`, `assignment_id`, `policy_version`, `risk_class`, `budget_reservation`, `approvals`/`evidence`, `expiry`/`revocation_state`, `sod_decision`, `invocation_id`/`command_id`), matching `exploration.md` §4.1 exactly.

### 1.3 — 16-step ordering + DENY-on-any-failure: PASS
Fixed ordering `classification → authority → identity → assignment → bounded authority → delegation → policy version → budget → evidence → approval → SOD → exceptions → expiry/revocation → action scope → records → check` = **16 steps**, terminated by "MUST DENY on ANY failure." Matches `exploration.md` §5.4 exactly.

### 1.4 — ADR carry cited once per requirement; 5 reserved categories never autonomously delegated: PASS
- Req 2 → `[ADR-0001]`; Req 3 → `[ADR-0003]`; Req 4 → `[ADR-0003]`; Req 5 → `[ADR-0001]`; Req 6 → `[ADR-0002]`; Req 7 inline R9 `[ADR-0001]`, R10/R15 `[ADR-0002]`. Req 1 legitimately carries `[SRC §5] [INF]` (no ADR source).
- Role/delegation/risk-SOD fidelity verified against ADR-0001, ADR-0002, ADR-0003.
- 5 source-reserved categories ("company purpose, capital, critical limits, irreversible actions, constitutional modification") match ADR-0003 §Decision + source §2.1 + `exploration.md` §5.1, and are marked "MUST NEVER be autonomously delegated."

### 1.5 — Neutral boundary IDs; daemon holds NO direct credentials: PASS
- Neutral IDs: spec "MUST use neutral `principal_id` / `position_id`, never package-specific entities" (matches ADR-0001, exploration §2.1).
- Daemon: spec "MUST NOT hold direct PostgreSQL or DeepSeek credentials" + scenario "MUST reach them only through authenticated server/application ports" (matches exploration §1/§2.2, AC9).

### 1.6 — R1–R17 enumerated with scope; R10 & R15 dual-reference: PASS
- R1–R17 each present with scope (matches exploration §8).
- R10 "Delegation authority history … Work linked by stable authority reference" `[ADR-0002]` — Work + Delegation reference.
- R15 "Immutable receipt fields: Work ID and Delegation/policy-authority ID used" `[ADR-0002]` — dual-reference.

### 1.7 — Downstream exclusions explicit: PASS (with observation)
Six exclusion categories are explicit across the change:
- vault/HSM, lease, idempotency, schema/DDL → `spec.md` Purpose ("Mechanisms … vault/HSM, lease protocol, idempotency, schemas … MUST NOT be finalized here").
- reconciliation → `design.md` (reconciliation protocol) + `exploration.md` §11 item 7; R17 is a record obligation only.
- policy thresholds → `design.md` Open Questions + `proposal.md` Out of Scope + `exploration.md` §11 item 5.

> **Observation (not a deviation):** the spec's own Purpose statement names 4 of the 6 exclusions
> (vault/HSM, lease, idempotency, schemas); reconciliation and policy-threshold exclusions live in
> `design.md`/`proposal.md`. They are explicit at the change level, so 1.7 PASSES.

## Phase 2 Validation Findings (2.1–2.3)

### 2.1 — Deferred handoff resolved exactly once: PASS
The delta (`specs/io-domain-contract/spec.md`) contains exactly two `## MODIFIED Requirements`, each resolving one deferred item, once:
- **Deny-by-Default Authority** — resolves the deferred "mechanism and default-deny policy" (canonical spec said "deferred to the next ports/trust contract"); delta now points normatively to `io-ports-trust-contract`.
- **Contract Meta-Handoff** — resolves the "next ports/trust contract MUST exclude H1–H3 / enforce H4 / resolve H5–H6" obligation; delta now states that contract exists and the items are resolved.

No other canonical `io-domain-contract` requirement references the ports/trust handoff (the "Context Boundary…" requirement's "(placement deferred to design)" is a separate design-placement deferral, not the ports/trust handoff). Resolved exactly once. PASS.

### 2.2 — Four mechanisms reference the new capability with no duplication: PASS
The delta "Deny-by-Default Authority" requirement explicitly states: "The default-deny mechanism, the risk-classification-before-authority ordering, the no-aggregate-sharing enforcement, and the required audit/recovery records are now defined normatively in the `io-ports-trust-contract` capability and are no longer deferred." Each is confirmed present and normative in the new capability:
- default-deny mechanism → new-capability Req 3 (16-step evaluation, DENY on any failure).
- classification ordering → new-capability Req 3 ("Risk classification MUST precede authority evaluation").
- no-aggregate-sharing → new-capability Req 6 ("there is NO aggregate sharing").
- required records → new-capability Req 7 (R1–R17).

The delta does NOT re-define any of these mechanisms — it references the capability, preserving the 5 reserved categories and scenario intent without duplicating mechanism detail. No duplication. PASS.

### 2.3 — H1–H6 dispositioned; no outstanding handoff: PASS
The delta "Contract Meta-Handoff" requirement states: the `io-ports-trust-contract` capability "HAS excluded H1–H3 as pure design, HAS enforced H4 (no-aggregate-sharing), and HAS resolved H5 (classification before authority) and H6 (mechanism, default-deny). No outstanding ports/trust handoff remains." Confirmed in the new capability + design:
- H1–H3 (pure-design inferred mechanisms: cron, state machines, checkpoints, compensation, middleware) excluded — `design.md` Architecture Decisions keeps mechanism choices downstream; new-capability Req 2/3 specify invariants, not implementation.
- H4 (no-aggregate-sharing) enforced — new-capability Req 6.
- H5 (classification before authority) resolved — new-capability Req 3.
- H6 (mechanism, default-deny) resolved — new-capability Req 3.

Scenario "Labels and hypotheses" confirms: H1–H3 ignored as pure design, H4/H5/H6 resolved by `io-ports-trust-contract`. No outstanding handoff. PASS.

## Phase 3 Findings (3.1–3.3 — verify prep)

### 3.1 — Every requirement/scenario traces via labels, each cited once: PASS
New-capability requirement header labels (each cited once per requirement):
Req 1 `[SRC §5] [INF]` → exploration §1; Req 2 `[INF] [ADR-0001]` → §4; Req 3 `[SRC §2.1] [ADR-0003] [INF]` → §5; Req 4 `[ADR-0003]` → §5.5; Req 5 `[ADR-0001]` → §6; Req 6 `[ADR-0002] [INF]` → §7; Req 7 `[INF] [HYP]` → §8 (with inline R9 `[ADR-0001]`, R10/R15 `[ADR-0002]` at record level, not duplicated). Delta labels: Deny-by-Default `[SRC §2.1] [INF]`; Meta-Handoff `[INF] [ADR-0002]`. Label set `[SRC]`/`[INF]`/`[ADR-0001|2|3]`/`[HYP]` all used; no requirement lacks a label. PASS.

### 3.2 — Delta scenarios do not contradict new-capability scenarios: PASS
- Delta "Reserved refused" → aligns with new-capability Req 3 "Reserved category refused" + "Classification before authority; deny on any failure". No contradiction.
- Delta "Mechanism resolved downstream" → aligns with new-capability Req 3 (mechanism is now defined there). No contradiction.
- Delta "Labels and hypotheses" → aligns with new-capability enforcement of H4/H5/H6 and exclusion of H1–H3. No contradiction.

### 3.3 — Threat-matrix all N/A; no RED tests required: PASS
`design.md` Threat Matrix: 5 rows (Documentation-like paths, Git repository selection, Commit state, Push state, PR commands) — all N/A with reasons (no classifier/executor/VCS/commit/push/PR automation designed). `design.md` Testing Strategy: "No unit, integration, E2E, or RED tests are introduced: there is no runtime implementation." No RED tests required. PASS.

## Phase 4 Findings (verify readiness)

### 4.1 — Counts stable and match design; no runtime tests apply: PASS
- New-capability spec: 7 requirements, 10 scenarios (Req1×2, Req2×2, Req3×2, Req4×1, Req5×1, Req6×1, Req7×1).
- Domain delta: 2 MODIFIED requirements, 3 scenarios (Deny-by-Default×2, Meta-Handoff×1).
- Counts are stable (spec files already exist and validated; no content changes this change). Match `design.md` (7 requirements + R1–R17 + delta). No runtime/unit/integration/E2E tests apply (documentation-only). PASS.

### 4.2 — verify-report attestation: PENDING (verify-owned)
Left unchecked. The verify-report is explicitly "(produced by `sdd-verify`, not this phase)". Apply confirms the artifacts are in a state where verify CAN attest traceability (validated in 3.1) and unique delta resolution (validated in 2.1), but producing the verify-report itself is the verify phase's deliverable, not apply's.

## Phase 5 Findings (archive readiness — confirmed by inspection; promotion itself is archive-owned)

### 5.1 — New-capability promotion path clear: PASS (readiness)
`openspec/specs/` currently holds `development-toolchain/` and `io-domain-contract/` only; there is **no** existing `openspec/specs/io-ports-trust-contract/`. The promotion path from `openspec/changes/io-ports-trust-contract-v2/specs/io-ports-trust-contract/spec.md` → `openspec/specs/io-ports-trust-contract/spec.md` is clear (no collision). Creating the canonical capability is the archive phase's action; apply confirms the path. PASS.

### 5.2 — Domain MODIFIED delta format correct; scenario wording: PASS (with observation)
- Delta uses `## MODIFIED Requirements`; each `### Requirement:` name matches the canonical requirement exactly ("Deny-by-Default Authority", "Contract Meta-Handoff"), so archive will replace the correct full blocks.
- **Unchanged-intent scenario preserved exactly:** delta "Reserved refused" (GIVEN/WHEN/THEN) is byte-identical to the canonical "Reserved refused" scenario.
- **Resolved-handoff scenario intentionally updated:** the delta "Labels and hypotheses" scenario changes from "inspected or the next contract is authored" to "inspected or the resolved contract is reviewed", and its THEN now resolves H4/H5/H6 to `io-ports-trust-contract`. This is correct MODIFIED-delta behavior: the requirement's status flipped from pending-handoff to resolved, so its scenario must reflect the new reality. Preserving the old wording would re-introduce deferral language. PASS.

### 5.3 — Archive folder + non-destructive delta: PASS (readiness)
- Folder convention `YYYY-MM-DD-io-ports-trust-contract-v2` understood (date prefix + change name); the actual dated folder is created by the archive phase.
- `openspec/config.yaml` archive rule: "Warn before merging destructive deltas". The `io-ports-trust-contract` capability is ADDED (non-destructive); the `io-domain-contract` delta is MODIFIED (updates wording, does not delete requirements). No REMOVED requirements. The destructive-delta warning is therefore satisfied (no destructive deltas). Creating the folder is archive-owned; apply confirms the delta is non-destructive. PASS.

## Deviations from Design
None — implementation (validation) matches design. No spec content was altered; the specs already
satisfied every criterion. Work Unit 1 deliverable is the confirmed new-contract state; Work Unit 2
deliverable is the confirmed domain-delta resolution + verify/archive readiness.

## Issues Found
None. Non-blocking observations recorded under 1.7 (exclusion anchoring across files) and 5.2
(intentional, correct rewording of the resolved-handoff scenario). Both are noted for the
verify/archive reviewer, not defects.

## Cross-Phase Notes (for verify/archive)
- Exclusion anchoring: vault/HSM, lease, idempotency, schema/DDL are in the new-capability spec
  Purpose; reconciliation and policy-threshold exclusions are anchored in `design.md`/`proposal.md`.
  Reviewer may optionally record where each exclusion is anchored at archive.
- Delta "Labels and hypotheses" scenario rewording is intentional (handoff status flip). Archive
  must apply the MODIFIED block as-is (do not re-inject the old "next contract is authored" wording).

## Remaining Phase Obligation
`sdd-verify` must produce `verify-report.md` attesting traceability + unique delta resolution. This is a phase deliverable, not an apply task checkbox.

## Status
17/17 apply-readiness tasks complete (Phase 1–2 done; Phases 3/4/5 readiness prep done). **Ready for verify** (`sdd-verify`), then archive.
