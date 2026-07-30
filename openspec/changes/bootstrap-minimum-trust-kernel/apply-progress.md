# Apply Progress: Bootstrap Minimum Trust Kernel

> Strict TDD throughout. Slice 1 (Phase 1 + Phase 2), Slice 2 (Phase 3 + Phase
> 4), and Slice 3 (Phase 5 + Phase 6) implemented. Boundary/transitional identity
> + neutral identity/bounded roles + deterministic risk + deny-by-default grant
> + in-memory SOD complete; `pnpm check` GREEN (84 tests, 0 warnings). Phases
> 7–10 remain for later slices.

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

- Phase 7 — In-memory evidence & audit
- Phase 8 — Honest in-memory receipt
- Phase 9 — Scoped in-memory pipeline
- Phase 10 — Final verification & exclusion guard

## Workload / PR boundary (cumulative)

- Mode: **chained PR slice (Slice 3)** — `stacked-to-main`
- Current work unit: `slice-3-grant-sod` (Work Unit 3 → PR 3 → main)
- Boundary: starts from the committed Slice 2 baseline; ends with deny-by-default explicit grant + in-memory separation of duties and their RED→GREEN→REFACTOR tests. Slices 1–2 work is untouched.
- Estimated review budget impact: **537 changed lines (Slice 3) — OVER the 400-line budget** (`changed_line_budget_exceeded: true`). Grant + SOD are two substantial security requirements (Req 4 + Req 6) with full triangulated coverage (43 new tests); trimming further would sacrifice required strict-TDD triangulation. No `size:exception` recorded; flagged for maintainer budget decision (same disposition as Slice 1 ordinal 1→2 reset).

---

## Slice 3 outcome

| Field | Value |
|-------|-------|
| Slices implemented | Slice 3 (Phase 5 tasks 5.1–5.3, Phase 6 tasks 6.1–6.3) |
| Mode | Strict TDD |
| Gate | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` — GREEN (exit 0, 0 warnings) |
| Test result | 6 test files, 84 tests passing (root 2 + boundary 16 + identity 11 + risk 12 + grant 20 + sod 23) |
| Changed lines (authored, add+del) | **537** — OVER the 400-line budget (468 new-file lines + 50 add / 19 del tracked) |
| Exclusions held | Yes — pure in-memory functions only; no persistence/adapters/HTTP/db/daemon/LLM/framework; no ambient authority; no real delegation/policy-version/budget/approval/records/crypto receipts |

## Slice 3 files changed

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/model.ts` | Modified | Added shared `Decision` type, `BoundedWindow` interface, `ValidationOutcome`, and `validateBoundedWindow` (single source of truth for the scope/start/expiry-after-start rule shared by identity + grant). |
| `packages/trust-kernel/src/identity.ts` | Modified | `validateTemporaryAssignment` now delegates the bounded-window checks to `validateBoundedWindow` (shared helper; behavior identical). |
| `packages/trust-kernel/src/grant.ts` | Created | `Grant`, `GrantValidation`, `GrantDecision`; `validateGrant` (id/command/authority + shared window); `checkGrant` deny-by-default command-bound authority check re-evaluated per input; `isGrantActive`. |
| `packages/trust-kernel/src/sod.ts` | Created | `SodRole`/`SodAssignment`/`SodPolicy`/`SodInput`/`SodDecision`; `checkSod` per-tier distinctness (absolute no-self-approve/no-self-verify pairs + medium 4-way / high+critical 5-way / low-4-way-unless-policy); extracted `CORE_ROLES`/`CRITICAL_ROLES`/`ABSOLUTE_PAIRS`/`requiredDistinctRoles`. |
| `packages/trust-kernel/test/grant.test.ts` | Created | RED-first deny-by-default suite (20 tests): unbounded/wrong-command/expired/revoked/different-principal → DENY; current bounded command grant → ALLOW; per-input re-evaluation; command-bound isolation. |
| `packages/trust-kernel/test/sod.test.ts` | Created | RED-first SOD suite (23 tests): self-approve/self-verify DENY at every tier; medium 4-way; high/critical 5-way (incl. missing authorizer); low combines only with policy. |

## Slice 3 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `packages/trust-kernel/test/grant.test.ts` | Unit | ✅ 39/39 (workspace) | ✅ Written — `Cannot find module '../src/grant.js'` | ✅ Passed (20) | ✅ 7 invalid shapes (it.each) + 6 deny cases (it.each) + allow + per-input + command-bound + terminal → 20 | ➖ See 5.3 |
| 5.2 | `packages/trust-kernel/test/grant.test.ts` | Unit | ✅ 39/39 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 5.3 |
| 5.3 | `packages/trust-kernel/test/{identity,grant}.test.ts` | Unit | ✅ 39/39 → 31/31 after refactor | ➖ Refactor | ✅ Passed (identity 11 + grant 20 = 31) | ➖ N/A | ✅ Extracted `validateBoundedWindow` to `model.ts`; identity + grant delegate to it; `pnpm check` GREEN |
| 6.1 | `packages/trust-kernel/test/sod.test.ts` | Unit | ✅ 59/59 (after grant) | ✅ Written — `Cannot find module '../src/sod.js'` | ✅ Passed (23) | ✅ self-approve/self-verify ×4 tiers (it.each) + medium 4 overlap pairs (it.each) + high/critical allow/missing/overlap (it.each) + low policy → 23 | ➖ See 6.3 |
| 6.2 | `packages/trust-kernel/test/sod.test.ts` | Unit | ✅ 59/59 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 6.3 |
| 6.3 | `packages/trust-kernel/test/sod.test.ts` | Unit | ✅ 59/59 → 23/23 | ➖ Refactor | ✅ Passed (23) | ➖ N/A | ✅ Tier rules extracted as `CORE_ROLES`/`CRITICAL_ROLES`/`ABSOLUTE_PAIRS`/`requiredDistinctRoles`; removed 2 `noNonNullAssertion` warnings; `pnpm check` GREEN (0 warnings) |

### Slice 3 test summary

- **Total tests written**: 43 (20 grant + 23 sod). Boundary auto-extended +5 (grant.ts/sod.ts "imports nothing forbidden") → 84 workspace-wide.
- **Total tests passing**: 84.
- **Layers used**: Unit (43 new).
- **Approval tests**: None — no refactoring of existing product behavior (identity refactor was behavior-preserving delegation, safety-net proven by 11/11 identity tests staying green).
- **Pure functions created**: 3 (`validateGrant`, `checkGrant`, `checkSod`) + 1 shared helper (`validateBoundedWindow` in model.ts) + 1 internal (`isGrantActive`).

## Slice 3 RED → GREEN → REFACTOR narrative

1. **RED (5.1)**: `grant.test.ts` imported `{ checkGrant, validateGrant, Grant, GrantDecision }` from `../src/grant.js`, which did not exist. Confirmed: `pnpm vitest run packages/trust-kernel/test/grant.test.ts` → `Failed Suites 1` / `Cannot find module '../src/grant.js'`.
2. **GREEN (5.2)**: Added `Decision` to `model.ts` and created `grant.ts` (`Grant`/`validateGrant`/`checkGrant`/`isGrantActive`). Triangulation built into the suite: 7 invalid shapes + 6 deny cases via `it.each`, plus allow/per-input/command-bound/terminal cases. One test-fixture bug found and fixed (`grant({ expiry: 2000 })` at `now:1500` is NOT expired — implementation was correct; fixture corrected to `expiry: 1200`). Focused run → 20 passed.
3. **REFACTOR (5.3)**: Extracted `validateBoundedWindow` into `model.ts`; both `identity.validateTemporaryAssignment` and `grant.validateGrant` now delegate the window checks to it (single source of truth). Identity + grant focused run → 31/31 still green.
4. **RED (6.1)**: `sod.test.ts` imported from `../src/sod.js`, which did not exist. Confirmed: `Cannot find module '../src/sod.js'`.
5. **GREEN (6.2)**: Created `sod.ts` (`SodRole`/`SodAssignment`/`SodPolicy`/`SodInput`/`SodDecision`/`checkSod`). Triangulation across all four tiers, four medium overlap pairs, and high/critical five-way forced the tier-rule extraction rather than a fake-it constant. One test-construction bug found and fixed (`FIVE_WAY` incorrectly spread the already-built `FOUR_WAY` objects back into `assign()`; rebuilt explicitly). Focused run → 23 passed.
6. **REFACTOR (6.3)**: Tier role-count rules formalized as extracted constants/functions; removed 2 `noNonNullAssertion` warnings via guarded locals. `pnpm check` GREEN with 0 warnings.

## Slice 3 Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command + result | `pnpm test packages/trust-kernel/test/grant.test.ts packages/trust-kernel/test/sod.test.ts` → `Test Files 2 passed (2)`, `Tests 43 passed (43)`; full `pnpm check` → exit 0, 0 warnings, `Test Files 6 passed (6)`, `Tests 84 passed (84)` |
| Runtime harness command/scenario + result | N/A — pure in-memory functions with no transport/daemon/app to exercise (per design Threat Matrix: persistence/adapter/network/framework leakage, routing/shell/subprocess = "No such boundary is introduced"). |
| Rollback boundary | Remove `packages/trust-kernel/src/{grant,sod}.ts` + `packages/trust-kernel/test/{grant,sod}.test.ts`, and revert the `model.ts`/`identity.ts` window-helper refactor (restore inline checks in `validateTemporaryAssignment`). Slices 1–2 are untouched; `pnpm check` returns to the Slice 2 baseline. |

## Slice 3 exclusion guard (Req 4, Req 6)

- `src/{grant,sod}.ts` import only `./model.js` (relative `.js` specifiers); the Slice 1 boundary scan auto-covers them and reports **no** forbidden imports (proven by the two new `imports nothing forbidden` boundary cases).
- No ambient authority: `ActiveIdentity.authority` is still `[]`; authority comes ONLY from an explicit, current, bounded, command-matching `Grant` (Req 4). `checkGrant` returns `authority: null` on every DENY.
- Grants are re-evaluated per input — `checkGrant` takes the grants list each call; nothing is "remembered" across actions.
- SOD is enforced per risk tier; the absolute no-self-approval/no-self-verification pairs are checked at EVERY tier (including low with policy-permitted combination); medium = 4-way, high/critical = 5-way (distinct authorizer); low combines only when `policy.allowsLowCombination === true`.
- No pipeline, evidence, receipt, delegation, policy-version, budget, approval, or records behavior implemented (deferred to Slices 4–5).

## Slice 3 deviations from design

- **SOD 5th role 'authorizer' (interpretation)**: The spec names the four medium roles (proposer/approver/executor/verifier) and requires high/critical to use "five distinct principals" without naming the 5th role. A 5th role is structurally required (4 roles cannot yield 5 distinct principals). `src/sod.ts` adds `authorizer` as the critical-tier additional control role. This is an interpretation of an under-specified spec point, not a contradiction — it satisfies "five distinct principals" and is isolated (only high/critical require it; extraction target `approvals/` is recorded).
- **Absolute SOD pairs (interpretation)**: The spec says "No principal MAY self-approve or self-verify at ANY tier" and the normative scenario pins self-approval to "approver and executor". `ABSOLUTE_PAIRS` is implemented as `(approver, executor)` (self-approval, per the scenario) and `(verifier, executor)` (self-verification). At low with policy-permitted combination, other role pairs (e.g. proposer==executor) MAY combine; the absolute pairs always deny.
- **Over 400-line budget**: 537 authored lines for two requirements with full triangulated coverage. Flagged `changed_line_budget_exceeded: true`; no `size:exception` recorded. Documented for maintainer budget decision.
- No other deviations.

## Slice 3 issues found

- Two genuine RED-phase bugs caught by execution and fixed BEFORE declaring GREEN (both test-side, implementation was correct): (a) `grant({ expiry: 2000 })` at `now: 1500` is active, not expired — fixture corrected; (b) `FIVE_WAY` rebuilt explicitly instead of spreading `FOUR_WAY` objects.
- Source compaction pass (comments/helpers) reduced new-file lines 524 → 468 after GREEN without changing behavior or coverage; full suite re-verified green.
