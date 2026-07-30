# Apply Progress: IO Domain Contract v2

- **Mode**: Strict TDD (active per `openspec/config.yaml` `strict_tdd: true`), but **no runtime domain code** is introduced (design §Testing: runtime unit = N/A, integration/E2E = N/A). RED runtime tests are recorded N/A where no domain runtime exists, per orchestrator instruction. Applicable checks are the traceability label readback and the `pnpm check` no-regression gate.
- **Delivery**: single PR (Low risk; Chained PRs recommended: No; Decision needed before apply: No).
- **Task progress**: 8 / 8 apply-owned checklist tasks complete. Verify and archive work is now recorded as phase-owner obligations, not apply checkboxes.
- **Runtime attempt**: `io-domain-contract-v2-apply-1-20260729`, ordinal 1 (begun by orchestrator; not re-begun).

## Validation Findings

### Phase 1: Cross-Artifact Validation

- **1.1 [x]** — `proposal.md` §Scope preserves exploration §2 partition verbatim: Core Business 8 (§2.1), Platform-Enabled Domain 12 (§2.2), Technical Infrastructure 10 (§2.3) = 8+12+10=30 (exploration line 71). Proposal §Out of Scope forbids new requirements/tools/mechanisms and reopening H1–H3 / ADR-0001/0002. No new requirements introduced. ✅
- **1.2 [x]** — Traceability readback: `rg -c '\[(SRC|ADR-0001|ADR-0002|INF|HYP)\]' spec.md` → **7** labeled lines. All 6 requirements cite ≥1 label exactly: Primary-Responsibility `[INF]`; Context Boundary `[SRC …] [ADR-0001] [ADR-0002] [INF]`; Deny-by-Default `[SRC §2.1] [INF]`; Bounded Temporary Roles `[ADR-0001] [SRC §11]`; Platform-Enabled Semantics `[SRC §2.2/§3.2] [INF]`; Contract Meta-Handoff `[INF] [ADR-0002]`. ✅
- **1.3 [x]** — `design.md` File Changes table lists only docs/specs: `design.md` (Create), `specs/io-domain-contract/spec.md` (Retain), `openspec/specs/io-domain-contract/spec.md` (Create at archive). Explicit line: "No application, package, test, configuration, ADR, or exploration files are changed." ✅
- **1.4 [x]** — Five reserved categories read identically across all three artifacts: **purpose, capital, critical limits, irreversible actions, constitutional modification** + deny-by-default (every other action requires explicit bounded grant). Exploration §2.1/§3.1 (lines 26, 84–93), spec "Deny-by-Default Authority" (lines 30–31), proposal §In Scope (line 14). ✅

### Phase 2: Spec Structural Readiness

- **2.1 [x]** — `openspec/specs/io-domain-contract/spec.md` confirmed **absent** (new capability). Delta requirements are therefore effectively ADDED at archive. ✅
- **2.2 [x]** — No `## MODIFIED`, `## REMOVED`, or `## RENAMED` blocks present; spec uses plain `## Requirements` / `### Requirement:` headings. New capability — nothing replaced. ✅
- **2.3 [x]** — All 6 scenarios use GIVEN/WHEN/THEN; RFC 2119 keywords present (MUST, MUST NOT, MUST NEVER, MAY, SHALL). Compliant with `config.yaml` rules.specs. ✅

### Phase 3: Verification & RDD Review

- **Verify obligation (not apply checkbox)** — `pnpm check` must run under Node 24 LTS and be recorded in `verify-report.md`. The earlier Node 26 failure was environmental, not a code/test regression — zero product/toolchain files were touched (`git status --short -- ':!openspec/'` is empty).
- **Verify/RDD obligation (not apply checkbox)** — RDD review/structural evidence belongs to verification/review ownership, not apply.
- **3.3 [x]** — Threat matrix N/A confirmed: design §Threat Matrix states no routing/shell/subprocess/VCS/exec/process-integration boundary is changed. No RED test required. ✅

### Phase 4: Archive Promotion & Closure

- **Archive obligations (not apply checkboxes)** — Merge delta into new main spec, honor warn-before-destructive-merge, move change dir to dated archive. These are sdd-archive responsibilities.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `rg -c '\[(SRC\|ADR-0001\|ADR-0002\|INF\|HYP)\]' openspec/changes/io-domain-contract-v2/specs/io-domain-contract/spec.md` → **7**, exit **0**. Proves all 6 requirements + Purpose carry normative labels. |
| Runtime harness command/scenario and exact result | **N/A** — no domain runtime introduced (design §Testing: runtime unit N/A, integration/E2E N/A). `pnpm check` (no-regression only) **could not execute**: `ERR_PNPM_UNSUPPORTED_ENGINE`, Node v26.4.0 vs pinned `^24.18.1`. No product file changed; failure is environmental, not behavioural. |
| Rollback boundary | Delete `openspec/changes/io-domain-contract-v2/apply-progress.md` and revert the `[x]` marks in `tasks.md`. No application/package/test/config/ADR code touched; `exploration.md` content unaltered. |

## TDD Cycle Evidence (Strict TDD — docs-only, no runtime domain code)

> RED runtime tests are N/A: this change formalizes an approved exploration into OpenSpec documentation. No packages, ports, adapters, schema, UI, or runtime behavior are introduced (proposal §Out of Scope; design §Testing; design §Threat Matrix N/A). The applicable verification is the traceability label readback (the work unit's focused test) plus the `pnpm check` no-regression gate.

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | n/a (read-only validation) | Doc | N/A (no code) | N/A (no runtime domain code) | ✅ confirmed by reading exploration §2 / proposal §Scope | ➖ Single (partition is a fixed invariant 8+12+10=30) | ➖ None needed |
| 1.2 | `rg … spec.md` (readback) | Doc | N/A | N/A | ✅ readback=7, exit 0 | ➖ Single (label presence, no branching) | ➖ None needed |
| 1.3 | n/a (read-only validation) | Doc | N/A | N/A | ✅ design File Changes lists docs only | ➖ Single (structural fact) | ➖ None needed |
| 1.4 | n/a (read-only validation) | Doc | N/A | N/A | ✅ five categories + deny-by-default identical across 3 artifacts | ✅ 3 cross-references (exploration/spec/proposal) | ➖ None needed |
| 2.1 | `ls openspec/specs/io-domain-contract/spec.md` | Doc | N/A | N/A | ✅ absent → new capability → ADDED | ➖ Single (existence check) | ➖ None needed |
| 2.2 | n/a (read-only validation) | Doc | N/A | N/A | ✅ no MODIFIED/REMOVED/RENAMED blocks | ➖ Single (absence check) | ➖ None needed |
| 2.3 | n/a (read-only validation) | Doc | N/A | N/A | ✅ Given/When/Then + RFC 2119 present | ✅ 6 scenarios inspected | ➖ None needed |
| 3.1 | `pnpm check` (no-regression) | Toolchain | N/A | N/A | ⛔ BLOCKED: `ERR_PNPM_UNSUPPORTED_ENGINE` (Node 26 vs `^24.18.1`) | ➖ | ➖ |
| 3.2 | n/a (RDD review) | — | — | — | — (verify-owned, excluded) | — | — |
| 3.3 | n/a (read-only validation) | Doc | N/A | N/A | ✅ threat matrix N/A confirmed | ➖ Single | ➖ None needed |
| 4.1–4.3 | n/a (archive) | — | — | — | — (archive-owned, excluded) | — | — |

## Commands Run

| Command | Exit | Notes |
|---|---|---|
| `rg -c '\[(SRC\|ADR-0001\|ADR-0002\|INF\|HYP)\]' …/spec.md` | 0 | Result: 7 |
| `ls openspec/specs/io-domain-contract/spec.md` | non-zero | Confirms main spec absent (new capability) |
| `pnpm check` | 1 | `ERR_PNPM_UNSUPPORTED_ENGINE` — Node v26.4.0 vs pinned `^24.18.1`; infrastructure, not regression |
| `git status --short -- ':!openspec/'` | 0 | Empty — no product/toolchain file touched |
