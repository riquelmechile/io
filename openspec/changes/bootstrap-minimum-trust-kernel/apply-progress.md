# Apply Progress: Bootstrap Minimum Trust Kernel

> Strict TDD throughout. Slice 1 (Phase 1 + Phase 2) and Slice 2 (Phase 3 + Phase 4)
> implemented. Boundary/transitional identity + neutral identity/bounded roles +
> deterministic risk classification complete; `pnpm check` GREEN. Phases 5–10
> remain for later slices.

## Slice 1 outcome

| Field | Value |
|-------|-------|
| Slices implemented | Slice 1 (Phase 1 tasks 1.1–1.6, Phase 2 tasks 2.1–2.3) |
| Mode | Strict TDD |
| Gate | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` — GREEN |
| Test result | 2 test files, 13 tests passing (2 root + 11 boundary) |
| Changed lines (authored, add+del) | **294** — under the 400-line budget |
| Exclusions held | Yes — no persistence/adapters/HTTP/db/daemon/LLM/framework; no real delegation/policy-version/budget/approval/records/crypto receipts |

## Slice 1 files changed

| File | Action | What was done |
|------|--------|---------------|
| `pnpm-workspace.yaml` | Modified | `packages: []` → `packages: ['packages/*']`; updated comment to mark the package transitional. |
| `tsconfig.json` | Modified | Added `packages/trust-kernel/**/*.ts` to `include` (typecheck). |
| `tsconfig.build.json` | Modified | Added `packages/trust-kernel/src/**/*.ts` to `include` (build). |
| `vitest.config.ts` | Modified | Added `packages/**/test/**/*.test.ts` to `test.include`. |
| `biome.json` | Modified | Added package `src`/`test`/`package.json` globs to `files.includes`. |
| `pnpm-lock.yaml` | Modified | Workspace now registers 2 projects (root + `@io/trust-kernel`). |
| `packages/trust-kernel/package.json` | Created | Private, `type: module`, strict-ESM, **zero** runtime/peer/optional/bundle deps. |
| `packages/trust-kernel/README.md` | Created | Transitional marker; excluded from 8+12+10=30; all 6 extraction targets recorded. |
| `packages/trust-kernel/src/index.ts` | Created | Centralized transitional labels + pure `transitionalDescriptor()` (fresh value per call). |
| `packages/trust-kernel/test/boundary.test.ts` | Created | RED-first boundary suite: deps/imports/README/purity. |

## Slice 1 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.5 | — | N/A (structural wiring) | ✅ 2/2 (root) | ➖ Structural | ➖ Structural | ➖ Triangulation skipped: pure config/metadata, no branching logic | ➖ None needed |
| 1.6 | — | N/A (gate) | ✅ 2/2 | ➖ Structural | ✅ `pnpm check` GREEN (8 files, 2 tests) | ➖ Structural | ➖ None needed |
| 2.1 | `packages/trust-kernel/test/boundary.test.ts` | Unit | ✅ 2/2 (root) | ✅ Written — `Cannot find module '../src/index.js'` | ✅ Passed (10) | ✅ +1 case (multi-call distinctness) → 11 | ✅ Centralized labels, tests still 11/11 |
| 2.2 | `packages/trust-kernel/test/boundary.test.ts` | Unit | ✅ 2/2 | ✅ (same RED) | ✅ Passed | ✅ Same | ✅ Same |
| 2.3 | `packages/trust-kernel/test/boundary.test.ts` | Unit | ✅ 11/11 | ➖ Refactor | ✅ Passed (11) | ➖ N/A | ✅ Labels centralized; `pnpm check` GREEN |

### Slice 1 test summary

- **Total tests written**: 11 (boundary) — 13 with the pre-existing 2 root tests.
- **Total tests passing**: 13.
- **Layers used**: Unit (11).
- **Approval tests**: None — no refactoring of existing product code (new module only).
- **Pure functions created**: 1 (`transitionalDescriptor`); plus 2 internal helpers (`listTsFiles`, `extractImportSpecifiers`) used by the boundary scan.

## Slice 1 RED → GREEN → REFACTOR narrative

1. **RED (2.1)**: `boundary.test.ts` imported `transitionalDescriptor` from `../src/index.js` and read `README.md`, neither of which existed. Confirmed: `pnpm vitest run packages/trust-kernel/test/boundary.test.ts` → `Failed Suites 1` / `Cannot find module '../src/index.js'`. This is the honest RED — production code referenced but absent.
2. **TRIANGULATE (2.1)**: Added a second purity case proving three independent calls yield mutually-distinct array references with equal content — forces the function to return fresh values, not a shared constant array.
3. **GREEN (2.2)**: Created `README.md` (transitional + excluded-from-30 + 6 targets) and minimal `src/index.ts` exposing `transitionalDescriptor()`. Focused run → 11 passed (10 + triangulation).
4. **REFACTOR (2.3)**: Centralized transitional labels (`PACKAGE_ID`, `TRANSITIONAL`, `CANONICAL_PARTITION_EXCLUDED`, `EXTRACTION_TARGETS`) into named constants; derived `ExtractionTarget` type from `EXTRACTION_TARGETS` (single source of truth). Kept purity by returning `[...EXTRACTION_TARGETS]` per call. Focused run → still 11/11.

## Slice 1 Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command + result | `pnpm vitest run packages/trust-kernel/test/boundary.test.ts` → `Test Files 1 passed (1)`, `Tests 11 passed (11)` |
| Runtime harness command/scenario + result | N/A — pure in-memory module with no transport/daemon/app to exercise (per design Threat Matrix: "No such boundary is introduced"). |
| Rollback boundary | Revert `packages/trust-kernel/` (entire dir) + `pnpm-workspace.yaml` + `tsconfig.json`/`tsconfig.build.json`/`vitest.config.ts`/`biome.json` glob edits together; `pnpm install` to refresh the lockfile. Returns to the toolchain-only baseline. |

## Slice 1 exclusion guard (Req 1, Req 10)

- `packages/trust-kernel/package.json` declares **zero** `dependencies`/`peerDependencies`/`optionalDependencies`/`bundleDependencies` — proven by the boundary test.
- `src/` is scanned for forbidden specifiers (fs/net/http/db/daemon/LLM/agentic-business framework); the detector is itself triangulated against `node:fs` + `express`. No violations.
- `README.md` marks the package **transitional**, excluded from **8+12+10=30**, and records all six extraction targets (`organization`, `policy`, `approvals`, `evidence`, `receipts`, `audit`).
- `transitionalDescriptor()` returns fresh, independent values — no surviving module-level mutable state.
- No identity/risk/grant/SOD/evidence/receipt/pipeline behavior implemented beyond the minimal transitional public surface (deferred to Slices 2–5).

## Slice 1 deviations from design

None. Phase 1 used root-only strict TS/Vitest/Biome globs (no per-package tooling) and one private, dependency-free workspace package, exactly as the design's Architecture Decisions specify. The boundary suite follows the Requirement-to-Test Map rows for "Transitional In-Memory Boundary" and "Transitional Package Boundary".

## Slice 1 issues found

None.

---

## Slice 2 outcome

| Field | Value |
|-------|-------|
| Slices implemented | Slice 2 (Phase 3 tasks 3.1–3.3, Phase 4 tasks 4.1–4.3) |
| Mode | Strict TDD |
| Gate | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` — GREEN |
| Test result | 4 test files, 39 tests passing (root + 11 boundary + 11 identity + 12 risk) |
| Changed lines (authored, add+del) | **332** — under the 400-line budget |
| Exclusions held | Yes — pure in-memory functions only; no persistence/adapters/HTTP/db/daemon/LLM/framework; reserved categories never downgraded; no LLM-input path |

## Slice 2 files changed

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/model.ts` | Created | Neutral `PrincipalId`/`PositionId`/`Role`/`Scope`/`CommandId`/`Authority`, `TemporaryAssignment`, `RiskClass`, `ReservedCategory`, `KernelAction`. Remaining design-listed types (Grant/Policy/EvaluationInput/Decision/StepResult/Evidence/AuditEntry/Receipt) deferred to the slices whose tests require them. |
| `packages/trust-kernel/src/identity.ts` | Created | `validateTemporaryAssignment` (rejects indefinite + missing id/scope/start + expiry-not-after-start) and `resolveActiveIdentity` (primary immutable; expired/revoked/invalid temp authority stripped; `authority` always empty — no ambient authority). |
| `packages/trust-kernel/src/risk.ts` | Created | Pure `classify(action, thresholds)` (deterministic; reserved → critical, never downgradable) + `isReservedCategory` + `RiskThresholds`; reserved set + threshold map extracted as single sources of truth. |
| `packages/trust-kernel/test/identity.test.ts` | Created | RED-first neutral-identity/bounded-roles suite (indefinite/expiry/revocation/ambient-authority). |
| `packages/trust-kernel/test/risk.test.ts` | Created | RED-first deterministic-risk suite (stability, 5 reserved categories, no-downgrade, impact tiers, no-LLM-path). |

## Slice 2 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `packages/trust-kernel/test/identity.test.ts` | Unit | ✅ 11/11 (boundary) | ✅ Written — `Cannot find module '../src/identity.js'` | ✅ Passed (11) | ✅ 5 invalid-shape cases (it.each) + 3 strip cases + active + no-ambient → 11 | ➖ See 3.3 |
| 3.2 | `packages/trust-kernel/test/identity.test.ts` | Unit | ✅ 11/11 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 3.3 |
| 3.3 | `packages/trust-kernel/test/identity.test.ts` | Unit | ✅ 11/11 | ➖ Refactor | ✅ Passed (11) | ➖ N/A | ✅ Single validation path: `resolveActiveIdentity` reuses `validateTemporaryAssignment`; `pnpm check` GREEN |
| 4.1 | `packages/trust-kernel/test/risk.test.ts` | Unit | ✅ 11/11 (identity) | ✅ Written — `Cannot find module '../src/risk.js'` | ✅ Passed (12) | ✅ 5 reserved categories (it.each) + 3 impact tiers (it.each) + downgrade + no-LLM-path → 12 | ➖ See 4.3 |
| 4.2 | `packages/trust-kernel/test/risk.test.ts` | Unit | ✅ 11/11 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 4.3 |
| 4.3 | `packages/trust-kernel/test/risk.test.ts` | Unit | ✅ 12/12 | ➖ Refactor | ✅ Passed (12) | ➖ N/A | ✅ Reserved-category set + threshold map extracted (`RESERVED_CATEGORIES`/`RESERVED_CATEGORY_SET`/`RiskThresholds`); `pnpm check` GREEN |

### Slice 2 test summary

- **Total tests written**: 23 (11 identity + 12 risk).
- **Total tests passing**: 23 (39 workspace-wide with root + boundary).
- **Layers used**: Unit (23).
- **Approval tests**: None — no refactoring of existing product code (new modules only).
- **Pure functions created**: 3 (`validateTemporaryAssignment`, `resolveActiveIdentity`, `classify`) plus 1 type-guard helper (`isReservedCategory`).

## Slice 2 RED → GREEN → REFACTOR narrative

1. **RED (3.1)**: `identity.test.ts` imported from `../src/identity.js` (and types from `../src/model.js`), neither of which existed. Confirmed: `pnpm vitest run packages/trust-kernel/test/identity.test.ts` → `Failed Suites 1` / `Cannot find module '../src/identity.js'`.
2. **GREEN (3.2)**: Created `model.ts` (neutral IDs + `TemporaryAssignment` + risk types) and `identity.ts` (`validateTemporaryAssignment` + `resolveActiveIdentity`). Triangulation was built into the suite: five invalid shapes via `it.each`, three authority-stripping cases, plus the active-role and no-ambient-authority cases — forcing real branching, not a fake-it constant. Focused run → 11 passed.
3. **REFACTOR (3.3)**: Ensured a single assignment-validation path — `resolveActiveIdentity` calls `validateTemporaryAssignment` instead of re-checking invariants. `pnpm check` GREEN.
4. **RED (4.1)**: `risk.test.ts` imported from `../src/risk.js`, which did not exist. Confirmed: `Cannot find module '../src/risk.js'`.
5. **GREEN (4.2)**: Created `risk.ts` (`classify` + `isReservedCategory` + `RiskThresholds`). Triangulation across the five reserved categories and three impact tiers forced the reserved-set lookup and threshold-band logic. Focused run → 12 passed.
6. **REFACTOR (4.3)**: Extracted `RESERVED_CATEGORIES`/`RESERVED_CATEGORY_SET` and `RiskThresholds` as single sources of truth. `pnpm check` GREEN.

## Slice 2 Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command + result | `pnpm test packages/trust-kernel/test/identity.test.ts packages/trust-kernel/test/risk.test.ts` → `Test Files 2 passed (2)`, `Tests 23 passed (23)` |
| Runtime harness command/scenario + result | N/A — pure in-memory functions with no transport/daemon/app to exercise (per design Threat Matrix: persistence/adapter/network/framework leakage, routing/shell/subprocess = "No such boundary is introduced"). |
| Rollback boundary | Remove `packages/trust-kernel/src/{model,identity,risk}.ts` + `packages/trust-kernel/test/{identity,risk}.test.ts`. Slice 1 workspace/boundary work is untouched. `pnpm check` returns to the Slice 1 baseline (boundary-only). |

## Slice 2 exclusion guard (Req 2, Req 3)

- `src/{model,identity,risk}.ts` import only each other (relative `.js` specifiers); the Slice 1 boundary scan auto-covers them and reports **no** forbidden imports (fs/net/http/db/daemon/LLM/framework).
- Neutral IDs (`PrincipalId`/`PositionId`) are plain strings referencing no package-specific entity.
- Indefinite temporary assignments are structurally **invalid** and grant no authority; expired/revoked/invalid assignments are stripped while the primary role is unchanged.
- Holding any role grants **no ambient authority** — `ActiveIdentity.authority` is always `[]` at the identity stage (explicit command-bound grants are a later slice).
- `classify` is a pure function of action + thresholds; the five reserved categories always return `critical` and cannot be downgraded; `classify.length === 2` and there is no LLM/output input channel.

## Slice 2 deviations from design

- `src/model.ts` was created with the identity + risk type subset only. Task 3.2's literal text lists the full type set (Grant/Policy/EvaluationInput/Decision/StepResult/Evidence/AuditEntry/Receipt); those are deferred to the slices whose RED tests require them, per Strict TDD ("do not write production code before a test"). The staged additions match the design's Requirement-to-Test Map, where each type is first exercised by its own slice's tests.
- No other deviations.

## Slice 2 issues found

- Initial draft totaled 441 lines (over the 400 budget). Compacted by tightening doc comments and table-driving the repeated negative test cases (`it.each`) without reducing coverage; final 332 lines, all 39 tests green.

## Remaining tasks (later slices)

- Phase 5 — Deny-by-default explicit grant
- Phase 6 — In-memory separation of duties
- Phase 7 — In-memory evidence & audit
- Phase 8 — Honest in-memory receipt
- Phase 9 — Scoped in-memory pipeline
- Phase 10 — Final verification & exclusion guard

## Workload / PR boundary (cumulative)

- Mode: **chained PR slice (Slice 2)** — `stacked-to-main`
- Current work unit: `slice-2-identity-risk` (Work Unit 2 → PR 2 → main)
- Boundary: starts from the committed Slice 1 baseline; ends with neutral identity/bounded roles + deterministic risk classification and their RED→GREEN→REFACTOR tests. Slice 1 work is untouched.
- Estimated review budget impact: 332 changed lines (Slice 2) — within the 400-line budget; no `size:exception` required.
