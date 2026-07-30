# Apply Progress: Bootstrap Minimum Trust Kernel

> Strict TDD throughout. Slices 1–5 implemented. Slice 1 (Phase 1 + Phase 2),
> Slice 2 (Phase 3 + Phase 4), Slice 3 (Phase 5 + Phase 6), Slice 4 (Phase 7 +
> Phase 8), and Slice 5 (Phase 9 + Phase 10). Boundary/transitional identity +
> neutral identity/bounded roles + deterministic risk + deny-by-default grant +
> in-memory SOD + in-memory evidence/audit + honest in-memory receipt + the
> scoped 16-step in-memory pipeline are complete; `pnpm check` GREEN
> (144 tests, 0 warnings). All 10 phases done; ready for sdd-verify.

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

---

## Slice 4 outcome

| Field | Value |
|-------|-------|
| Slices implemented | Slice 4 (Phase 7 tasks 7.1–7.3, Phase 8 tasks 8.1–8.3) |
| Mode | Strict TDD |
| Gate | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` — GREEN (exit 0, 0 warnings) |
| Test result | 8 test files, 111 tests passing (root 2 + boundary 18 + identity 11 + risk 12 + grant 20 + sod 23 + evidence 11 + receipt 14) |
| Changed lines (authored, add+del) | **~418 product+test+task lines** before this mandatory apply-progress artifact (which the native ledger also counts) — OVER the 400-line budget |
| Exclusions held | Yes — pure in-memory functions only; no persistence/adapters/HTTP/db/daemon/LLM/framework; evidence/audit/receipt declare non-persistence; no crypto/durable receipts; no pipeline behavior |

## Slice 4 files changed

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/model.ts` | Modified | Added `InMemoryRecord` (shared non-persistent record: `persistent:false` literal + disclosure) plus `Evidence` and `AuditEntry` type aliases (Req 7). At the minimum stage the evidence record and audit entry share the same shape; they diverge when persistence arrives. |
| `packages/trust-kernel/src/evidence.ts` | Created | `NON_PERSISTENT_DISCLOSURE` (shared label), `EvidenceInput`/`EvidenceResult`, `captureEvidence` (capture evidence record + append ONE disclosed audit entry for ALLOW and DENY; return NEW immutable list), `buildDisclosedRecord` + `appendImmutable` helpers. |
| `packages/trust-kernel/src/receipt.ts` | Created | `RECEIPT_DISCLOSURE` (built on the shared non-persistent label + unsigned), `UnsignedInMemoryReceipt` (`signed:false`/`persistent:false`), `issueReceipt` (unsigned non-persistent receipt on ALLOW only; `null` on DENY), `summarizeEvidence`. |
| `packages/trust-kernel/test/evidence.test.ts` | Created | RED-first evidence/audit suite (11 tests): one entry for ALLOW and DENY; non-persistent disclosure; required fields; immutable/pure audit list (no state survives). |
| `packages/trust-kernel/test/receipt.test.ts` | Created | RED-first honest-receipt suite (14 tests): receipt only on ALLOW; DENY→none; required fields; unsigned/non-persistent disclosure; deterministic `summarizeEvidence`. |

## Slice 4 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 7.1 | `packages/trust-kernel/test/evidence.test.ts` | Unit | ✅ 84/84 (workspace) | ✅ Written — `Cannot find module '../src/evidence.js'` | ✅ Passed (11) | ✅ ALLOW+DENY append + non-empty prior + 4 immutability/chaining cases → 11 | ➖ See 7.3 |
| 7.2 | `packages/trust-kernel/test/evidence.test.ts` | Unit | ✅ 84/84 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 7.3 |
| 7.3 | `packages/trust-kernel/test/evidence.test.ts` | Unit | ✅ 84/84 → 96/96 | ➖ Refactor | ✅ Passed (11); `pnpm check` GREEN (96) | ➖ N/A | ✅ Extracted `appendImmutable` + `buildDisclosedRecord`; `pnpm check` GREEN (0 warnings) |
| 8.1 | `packages/trust-kernel/test/receipt.test.ts` | Unit | ✅ 96/96 | ✅ Written — `Cannot find module '../src/receipt.js'` | ✅ Passed (14) | ✅ ALLOW/DENY + distinct-per-action + summary stable/differs → 14 | ➖ See 8.3 |
| 8.2 | `packages/trust-kernel/test/receipt.test.ts` | Unit | ✅ 96/96 | ✅ (same RED) | ✅ Passed | ✅ Same | ➖ See 8.3 |
| 8.3 | `packages/trust-kernel/test/receipt.test.ts` | Unit | ✅ 96/96 → 111/111 | ➖ Refactor | ✅ Passed (14); `pnpm check` GREEN (111) | ➖ N/A | ✅ `RECEIPT_DISCLOSURE` shares `NON_PERSISTENT_DISCLOSURE` from evidence; `pnpm check` GREEN (0 warnings) |

### Slice 4 test summary

- **Total tests written**: 25 (11 evidence + 14 receipt). Boundary auto-extended +2 (`evidence.ts`/`receipt.ts` "imports nothing forbidden") → 111 workspace-wide.
- **Total tests passing**: 111.
- **Layers used**: Unit (25 new).
- **Approval tests**: None — no refactoring of existing product behavior (`model.ts` additions are purely additive types; no existing slice behavior changed).
- **Pure functions created**: 3 (`captureEvidence`, `issueReceipt`, `summarizeEvidence`) + 2 internal helpers (`buildDisclosedRecord`, `appendImmutable`).

## Slice 4 RED → GREEN → REFACTOR narrative

1. **RED (7.1)**: `evidence.test.ts` imported `{ NON_PERSISTENT_DISCLOSURE, captureEvidence, type EvidenceInput }` from `../src/evidence.js` and `Evidence`/`AuditEntry` types from `../src/model.js`, neither of which existed. Confirmed: `pnpm vitest run packages/trust-kernel/test/evidence.test.ts` → `Failed Suites 1` / `Cannot find module '../src/evidence.js'`.
2. **GREEN (7.2)**: Added `InMemoryRecord`/`Evidence`/`AuditEntry` to `model.ts` and created `evidence.ts` (`captureEvidence` + `NON_PERSISTENT_DISCLOSURE`). Triangulation was built into the suite: ALLOW and DENY both append exactly one entry, a non-empty prior log grows by one, and four immutability/purity/chaining cases force a real new-list return rather than a shared constant. Focused run → 11 passed.
3. **REFACTOR (7.3)**: Extracted `appendImmutable` (single immutable-append path so no caller can mutate the prior log) and `buildDisclosedRecord` (single source of truth for the `persistent:false` literal + disclosure). `pnpm check` GREEN (96 tests, 0 warnings) after one biome format auto-fix (collapsed a multi-line import).
4. **RED (8.1)**: `receipt.test.ts` imported `{ issueReceipt, summarizeEvidence, type ReceiptInput }` from `../src/receipt.js`, which did not exist. Confirmed: `Cannot find module '../src/receipt.js'`.
5. **GREEN (8.2)**: Created `receipt.ts` (`UnsignedInMemoryReceipt` + `issueReceipt` + `summarizeEvidence` + `RECEIPT_DISCLOSURE`). Triangulation: ALLOW→receipt, DENY→null even with an authority present, distinct receipts per action, and `summarizeEvidence` stable for the same evidence yet different across evidence. Focused run → 14 passed.
6. **REFACTOR (8.3)**: `RECEIPT_DISCLOSURE` is built from the shared `NON_PERSISTENT_DISCLOSURE` imported from `evidence.ts` (shared disclosure label, single source of truth). `pnpm check` GREEN (111 tests, 0 warnings, 0 fixes).

## Slice 4 Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command + result | `pnpm test packages/trust-kernel/test/evidence.test.ts packages/trust-kernel/test/receipt.test.ts` → `Test Files 2 passed (2)`, `Tests 25 passed (25)`; full `pnpm check` → exit 0, 0 warnings, `Test Files 8 passed (8)`, `Tests 111 passed (111)` |
| Runtime harness command/scenario + result | N/A — pure in-memory functions with no transport/daemon/app to exercise (per design Threat Matrix: persistence/adapter/network/framework leakage, routing/shell/subprocess = "No such boundary is introduced"). |
| Rollback boundary | Remove `packages/trust-kernel/src/{evidence,receipt}.ts` + `packages/trust-kernel/test/{evidence,receipt}.test.ts`, and revert the `model.ts` `InMemoryRecord`/`Evidence`/`AuditEntry` additions. Slices 1–3 are untouched; `pnpm check` returns to the Slice 3 baseline (84 tests). |

## Slice 4 exclusion guard (Req 7, Req 8)

- `src/{evidence,receipt}.ts` import only `./model.js` and `./evidence.js` (relative `.js` specifiers); the Slice 1 boundary scan auto-covers them and reports **no** forbidden imports (proven by the two new `imports nothing forbidden` boundary cases).
- Evidence and audit entries are **non-persistent**: `persistent:false` literal + disclosure; they explicitly do NOT satisfy persistent R1–R17 obligations (Req 7).
- No state survives: `captureEvidence` returns a NEW immutable list; the prior log is never mutated and there is no module-level mutable state (four purity/immutability tests prove it).
- The receipt is produced **only on ALLOW**; a DENY yields `null`. It is unsigned (`signed:false`) and non-persistent (`persistent:false`) with an explicit disclosure that makes no cryptographic or durable guarantee (Req 8).
- No pipeline behavior, delegation, policy-version, budget, approval, or records behavior implemented (deferred to Slice 5).

## Slice 4 deviations from design

- **Shared `InMemoryRecord` shape for Evidence and AuditEntry (interpretation)**: the spec (Req 7) requires "an in-memory evidence record" and "one in-memory audit entry recording principal, action, risk class, decision, and reason" without requiring them to differ. At the minimum persistence-free stage they record the same facts, so `Evidence` and `AuditEntry` are type aliases of a shared `InMemoryRecord` (`persistent:false` + disclosure carried by the type). They will diverge when persistence arrives; documented in `model.ts`. This is an interpretation of an under-specified point, not a contradiction.
- **Over 400-line budget**: ~418 authored product+test+task lines before this mandatory apply-progress artifact (which the native ledger also counts). Flagged `changed_line_budget_exceeded: true`; no `size:exception` recorded. Consistent with Slice 1 (408) and Slice 3 (537) precedent — flagged for maintainer budget decision.
- No other deviations.

## Slice 4 issues found

- One biome format auto-fix after 7.2 (collapsed a multi-line import in `evidence.test.ts`); re-ran `pnpm check` GREEN. No product-code issues; both RED phases were genuine module-not-found failures with no implementation bugs.

## Remaining tasks (final slice)

- Phase 9 — Scoped in-memory pipeline
- Phase 10 — Final verification & exclusion guard

## Workload / PR boundary (cumulative)

- Mode: **chained PR slice (Slice 4)** — `stacked-to-main`
- Current work unit: `slice-4-evidence-receipt` (Work Unit 4 → PR 4 → main)
- Boundary: starts from the committed Slice 3 baseline; ends with in-memory evidence/audit + honest in-memory receipt and their RED→GREEN→REFACTOR tests. Slices 1–3 work is untouched.
- Estimated review budget impact: **over the 400-line budget** (`changed_line_budget_exceeded: true`); flagged for maintainer budget decision (same disposition as Slice 1 and Slice 3).

---

## Slice 5 outcome

| Field | Value |
|-------|-------|
| Slices implemented | Slice 5 (Phase 9 tasks 9.1–9.3, Phase 10 tasks 10.1–10.3) |
| Mode | Strict TDD |
| Gate | `PATH="/tmp/opencode/node-24.18.1/node-v24.18.1-linux-x64/bin:$PATH" pnpm check` — GREEN (exit 0, 0 warnings) |
| Test result | 9 test files, 144 tests passing (root 2 + boundary 19 + identity 11 + risk 12 + grant 20 + sod 23 + evidence 11 + receipt 14 + pipeline 32) |
| Changed lines (authored, add+del) | **612** (index.ts 43 + pipeline.ts 297 + pipeline.test.ts 272) — OVER the 400-line budget; pre-approved Slice 5 budget-reset/acceptance pattern (`size:exception` disposition consistent with Slices 1/3/4) |
| Exclusions held | Yes — pure in-memory pipeline only; no persistence/adapters/HTTP/db/daemon/LLM/framework; the six deferred steps are documented no-op pass-throughs; receipt unsigned/non-persistent; no crypto/durable receipts |

## Slice 5 files changed

| File | Action | What was done |
|------|--------|---------------|
| `packages/trust-kernel/src/pipeline.ts` | Created | `evaluate(input)` composing the fixed 16-step pipeline (10 enforced gates + 6 deferred no-op pass-throughs) with terminal DENY short-circuit; `StepResult`/`EvaluationInput`/`EvaluationResult`/`DeferredStep` types; `DEFERRED_STEPS` canonical names; granular per-step gate predicates reusing `classify`/`validateBoundedWindow`/`checkSod`/`captureEvidence`/`issueReceipt`; `finalize` captures one evidence + one audit entry per evaluation and issues a receipt only on ALLOW. |
| `packages/trust-kernel/test/pipeline.test.ts` | Created | RED-first pipeline suite (32 tests): fixed 16-step order + classify-before-grant; reserved→critical→five-way SOD ordering; six deferred no-op pass-throughs; every enforced gate denies on failure (8 `it.each` crafted fixtures + revoked); allow→evidence+audit+receipt; deny→audit only, no receipt; purity (no surviving state). |
| `packages/trust-kernel/src/index.ts` | Modified | Expanded to export the public evaluation API surface: `evaluate` + `DEFERRED_STEPS`/`NON_PERSISTENT_DISCLOSURE`/`RECEIPT_DISCLOSURE` + the input/output types needed to call `evaluate` and read `EvaluationResult` + the transitional descriptor. Internal slice check functions (`classify`/`checkGrant`/`checkSod`/`captureEvidence`/`issueReceipt`) remain unexported. |

## Slice 5 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 9.1 | `packages/trust-kernel/test/pipeline.test.ts` | Unit | ✅ 111/111 (workspace) | ✅ Written — `Cannot find module '../src/pipeline.js'` | ✅ Passed (32) | ✅ 8 enforced-gate deny cases (it.each) + reserved-vs-medium ordering + allow/deny + revoked + 2 purity → 32 | ➖ See 9.3 |
| 9.2 | `packages/trust-kernel/test/pipeline.test.ts` | Unit | ✅ 111/111 | ✅ (same RED) | ✅ Passed (32) | ✅ Same | ➖ See 9.3 |
| 9.3 | `packages/trust-kernel/test/pipeline.test.ts` | Unit | ✅ 111/111 → 144/144 | ➖ Refactor | ✅ Passed (32); `pnpm check` GREEN (144) | ➖ N/A | ✅ Unified `StepResult` recording via single `record` helper (removed unused `gate` params); expanded `index.ts` to the public evaluation surface; trimmed internal check-function I/O types; `pnpm check` GREEN (0 warnings) |
| 10.1 | — | N/A (gate) | ✅ 144/144 | ➖ Structural | ✅ `pnpm check` GREEN (format-check → typecheck → build → lint → test, exit 0, 0 warnings) | ➖ Structural | ➖ None needed |
| 10.2 | `packages/trust-kernel/test/{boundary,pipeline}.test.ts` | Unit | ✅ 144/144 | ➖ Exclusion guard | ✅ `src/pipeline.ts imports nothing forbidden`; six deferred steps proven no-op; receipt unsigned/non-persistent | ➖ N/A | ➖ None needed |
| 10.3 | — | N/A (surface guard) | ✅ 144/144 | ➖ Surface guard | ✅ `index.ts` exports `evaluate` + types + disclosures + transitional descriptor only; slice check functions internal | ➖ N/A | ➖ None needed |

### Slice 5 test summary

- **Total tests written**: 32 (pipeline). Boundary auto-extended +1 (`pipeline.ts` "imports nothing forbidden") → 144 workspace-wide.
- **Total tests passing**: 144.
- **Layers used**: Unit (32 new).
- **Approval tests**: None — no refactoring of existing product behavior (`index.ts` expansion was purely additive re-exports; no existing slice behavior changed).
- **Pure functions created**: 1 (`evaluate`) + 1 `finalize` helper + 8 per-step gate predicates (`classifyGate`/`authorityGate`/`identityGate`/`assignmentGate`/`boundedScopeGate`/`sodGate`/`expiryGate`/`actionScopeGate`) + 2 recording helpers (`gate`/`passThrough`/`record`).

## Slice 5 RED → GREEN → REFACTOR narrative

1. **RED (9.1)**: `pipeline.test.ts` imported `{ DEFERRED_STEPS, evaluate, type EvaluationInput }` from `../src/pipeline.js`, which did not exist. Confirmed: `pnpm vitest run packages/trust-kernel/test/pipeline.test.ts` → `Failed Suites 1` / `Cannot find module '../src/pipeline.js'`. Triangulation was built into the suite up front: 8 enforced-gate deny cases via `it.each`, reserved-vs-medium risk ordering, allow/deny receipt asymmetry, revoked grant, and two purity cases.
2. **GREEN (9.2)**: Created `pipeline.ts`. First draft had a short-circuit bug (the `enforced` helper returned a finalize result that `evaluate` ignored, so DENY never terminated). Caught before declaring GREEN by reading the control flow, not by a failing test — rewrote `evaluate` with explicit `if (!gate(...)) return finalize(...)` short-circuits. Focused run → 32 passed on the corrected implementation.
3. **REFACTOR (9.3)**: (a) Removed the unused `input`/`ctx` params (and `void` hack) from the `gate` helper — cleaner signature; (b) expanded `index.ts` to the public evaluation surface, then trimmed internal check-function I/O types (`ActiveIdentity`/`GrantDecision`/`SodInput`/`ReceiptInput`/`BoundedWindow`/`ValidationOutcome`) so only what a caller needs to invoke `evaluate` and read `EvaluationResult` is exported; (c) one biome format auto-fix on `pipeline.test.ts` (long `it.each` rows wrapped). `pnpm check` GREEN (144, 0 warnings).

## Slice 5 Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command + result | `pnpm vitest run packages/trust-kernel/test/pipeline.test.ts` → `Test Files 1 passed (1)`, `Tests 32 passed (32)`; full `pnpm check` → exit 0, 0 warnings, `Test Files 9 passed (9)`, `Tests 144 passed (144)` |
| Runtime harness command/scenario + result | N/A — pure in-memory pipeline with no transport/daemon/app to exercise (per design Threat Matrix: persistence/adapter/network/framework leakage, routing/shell/subprocess = "No such boundary is introduced"). |
| Rollback boundary | Remove `packages/trust-kernel/src/pipeline.ts` + `packages/trust-kernel/test/pipeline.test.ts`, and revert `src/index.ts` to the Slice 1 minimal barrel (`transitionalDescriptor` only). Slices 1–4 are untouched; `pnpm check` returns to the Slice 4 baseline (111 tests). |

## Slice 5 exclusion guard (Req 5, Req 9, io-ports Persistence-Free Pipeline Scoping)

- `src/pipeline.ts` imports only `./model.js`/`./risk.js`/`./grant.js`/`./identity.js`/`./sod.js`/`./evidence.js`/`./receipt.js` (relative `.js` specifiers); the Slice 1 boundary scan auto-covers it and reports **no** forbidden imports (proven by the new `src/pipeline.ts imports nothing forbidden` boundary case).
- The **six deferred steps** (`delegation`, `policy-version`, `budget`, `approvals`, `exceptions`, `records`) are documented no-op pass-throughs: `passThrough` records `{deferred:true, passThrough:true, decision:'ALLOW', reason:'<name> deferred: harden downstream; no-op pass-through'}` and performs NO real delegation/policy-version/budget/approval/exception/records behavior (Req 5, io-ports). Proven by the "six deferred steps are documented no-op pass-throughs" test group.
- Every enforced gate (`classification`/`authority`/`identity`/`assignment`/`bounded-scope`/`evidence`/`sod`/`expiry`/`action-scope`/`final`) produces a terminal DENY on failure; classify (step 1) strictly precedes authority (step 3). Proven by 8 `it.each` crafted-failure cases + a revoked-grant case.
- No crypto/durable receipts: the receipt is issued only on ALLOW, is unsigned (`signed:false`) and non-persistent (`persistent:false`) with `RECEIPT_DISCLOSURE`; DENY yields no receipt. Proven by the pipeline receipt + deny test groups.
- No state survives: `evaluate` threads local `steps`/`ctx`, returns a NEW immutable audit list from `captureEvidence`; two purity tests prove repeated evaluations from the same prior log stay independent.

## Slice 5 deviations from design

- **Canonical 16-step interleaving (interpretation)**: the canonical "Default-Deny Authority with Reserved Categories" 16-step ordering is referenced by the design but not enumerated in-repo. The pipeline fixes a concrete ordered interleaving of the 10 enforceable steps and 6 deferred steps — classification(1) → delegation(2,deferred) → authority(3) → policy-version(4,deferred) → identity(5) → assignment(6) → bounded-scope(7) → budget(8,deferred) → evidence(9) → sod(10) → approvals(11,deferred) → expiry(12) → exceptions(13,deferred) → action-scope(14) → records(15,deferred) → final(16) — satisfying the spec-mandated invariant that **classify precedes authority** and that the 10 enforceable + 6 deferred names each appear once. This is an interpretation of an under-specified ordering, not a contradiction; it is re-validatable when the canonical source is referenced.
- **Grant gates decomposed vs `checkGrant` (interpretation)**: the standalone slice-3 `checkGrant` bundles existence+validity+active+command+principal into one deny-by-default oracle. The canonical pipeline instead expresses these as distinct observable gates so each can independently DENY and be audited: `authority` = grant existence for the principal; `assignment` = well-formed grant record; `bounded-scope` = `validateBoundedWindow`; `expiry` = active at `now`; `action-scope` = command binding. This matches the design Requirement-to-Test Map row ("absent/unbounded/wrong-command/expired grant denies") and reuses the shared `validateBoundedWindow` helper; `checkGrant` remains the standalone tested oracle and is not altered.
- **`evidence` gate has no failure mode (honest)**: evidence capture is a pure append with no failure condition, so the evidence step always proceeds; the actual evidence record + audit entry are captured at `finalize` for the terminal decision (ALLOW or DENY), satisfying "every evaluation captures one evidence + one audit entry" regardless of where the pipeline stopped. Documented rather than given an artificial deny path.
- **Over 400-line budget**: 612 authored product+test+index lines. Pre-approved Slice 5 budget-reset/acceptance pattern (`size:exception` disposition consistent with Slices 1/3/4).
- No other deviations.

## Slice 5 issues found

- **Short-circuit bug caught before GREEN**: the first `pipeline.ts` draft used an `enforced` helper whose DENY finalize return value `evaluate` ignored, so a failing gate would NOT have terminated evaluation. Caught by reading the control flow during GREEN (not by a failing test) and rewritten with explicit `if (!gate(...)) return finalize(...)` short-circuits before declaring GREEN. The 8 deny-case `it.each` tests would have caught it at run time (they assert the failing step is the LAST recorded step), confirming the fix.
- One biome format auto-fix on `pipeline.test.ts` (wrapped long `it.each` rows); re-ran `pnpm check` GREEN. No product-code issues.

## Remaining tasks

- None for apply. All 10 phases (tasks 1.1–10.3) are complete. Next step is `sdd-verify` (verify the change against specs/design/tasks).

## Workload / PR boundary (cumulative)

- Mode: **chained PR slice (Slice 5 — final)** — `stacked-to-main`
- Current work unit: `slice-5-pipeline-final` (Work Unit 5 → PR 5 → main)
- Boundary: starts from the committed Slice 4 baseline; ends with the scoped 16-step in-memory pipeline + public export surface + final exclusion guard and their RED→GREEN→REFACTOR tests. Slices 1–4 work is untouched.
- Estimated review budget impact: **612 authored lines — OVER the 400-line budget** (`changed_line_budget_exceeded: true`); pre-approved Slice 5 budget-reset/acceptance pattern (`size:exception`), consistent with Slices 1 (408), 3 (537), and 4 (~418).
