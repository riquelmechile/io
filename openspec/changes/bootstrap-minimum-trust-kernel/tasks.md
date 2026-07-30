# Tasks: Bootstrap Minimum Trust Kernel

> First product-code change. Strict TDD: every behavior group is RED test → GREEN impl → REFACTOR, committed as one GREEN work unit (test + impl together so the repo stays green per commit). Exclusions held: no persistence/adapters/HTTP/db/daemon/LLM/framework, no real delegation/policy-version/budget/approval/records/crypto receipts — the six deferred pipeline steps are explicit no-op pass-throughs.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,100–1,200 authored (additions+deletions): 9 src + 8 test files + README/package.json + 4 config edits |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 5 stacked-to-main slices (wiring+boundary → identity/risk → grant/sod → evidence/receipt → pipeline) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Workspace + toolchain globs + package skeleton + boundary/transitional identity (Ph 1–2) | PR 1 → main | `pnpm check` (boundary.test passes) | N/A — pure in-memory module, no transport/daemon/app to exercise | Revert `packages/trust-kernel/` + `pnpm-workspace.yaml` + tsconfig/vitest/biome glob edits together |
| 2 | Neutral identity/bounded roles + deterministic risk (Ph 3–4) | PR 2 → main | `pnpm test packages/trust-kernel/test/{identity,risk}.test.ts` | N/A — pure functions, no runtime boundary | Remove `src/{model,identity,risk}.ts` + their tests |
| 3 | Deny-by-default grant + separation of duties (Ph 5–6) | PR 3 → main | `pnpm test packages/trust-kernel/test/{grant,sod}.test.ts` | N/A — pure functions | Remove `src/{grant,sod}.ts` + tests |
| 4 | Evidence/audit + honest receipt (Ph 7–8) | PR 4 → main | `pnpm test packages/trust-kernel/test/{evidence,receipt}.test.ts` | N/A — pure functions | Remove `src/{evidence,receipt}.ts` + tests |
| 5 | Pipeline orchestration + public export surface + full check (Ph 9–10) | PR 5 → main | `pnpm test packages/trust-kernel/test/pipeline.test.ts` then `pnpm check` | N/A — pure in-memory, no app to exercise | Remove `src/pipeline.ts` + test, revert `index.ts` to minimal barrel |

## Phase 1: Workspace & Toolchain Wiring

- [x] 1.1 `pnpm-workspace.yaml`: replace `packages: []` with `packages: ['packages/*']`.
- [x] 1.2 `tsconfig.json`/`tsconfig.build.json`: add `packages/trust-kernel/src/**/*.ts` (build) and `packages/trust-kernel/**/*.ts` (typecheck) to `include`.
- [x] 1.3 `vitest.config.ts`: add `packages/**/test/**/*.test.ts` to `test.include`.
- [x] 1.4 `biome.json`: add package `src`/`test` globs to `files.includes`.
- [x] 1.5 Create `packages/trust-kernel/package.json`: private, `type: module`, strict-ESM, zero runtime dependencies.
- [x] 1.6 `pnpm install` (register workspace) + `pnpm check` GREEN with empty package baseline.

## Phase 2: Package Boundary & Transitional Identity — Req 1, 10 (Threat: leakage)

- [x] 2.1 RED `test/boundary.test.ts`: package.json has no runtime deps; src has no forbidden imports (fs/net/http/db/daemon/LLM/agentic-business framework); README marks transitional, excludes from 8+12+10=30, records all 6 extraction targets (`organization/policy/approvals/evidence/receipts/audit`); returned values leak no surviving state.
- [x] 2.2 GREEN: create `README.md` (transitional marker + 6 targets + excluded-from-30) and minimal `src/index.ts`; pass boundary test.
- [x] 2.3 REFACTOR: centralize transitional labels; `pnpm check` GREEN.

## Phase 3: Neutral Identity & Bounded Roles — Req 2 (Threat: ambient/expired authority)

- [x] 3.1 RED `test/identity.test.ts`: indefinite temp role rejected (grants no authority); expiry/revocation strips temp authority while primary role unchanged; temp role carries no ambient authority.
- [x] 3.2 GREEN: create `src/model.ts` (neutral `PrincipalId`/`PositionId`, Role, TemporaryAssignment, Grant, Policy, EvaluationInput, Decision/StepResult/Evidence/AuditEntry/Receipt types) + `src/identity.ts` (validate assignment id+scope+start+expiry; expiry/revocation strip authority; primary immutable).
- [x] 3.3 REFACTOR: dedupe assignment-validation helpers; `pnpm check` GREEN.

## Phase 4: Deterministic Risk Classification — Req 3 (Threat: risk downgrade)

- [x] 4.1 RED `test/risk.test.ts`: identical input → identical class across repeats; the 5 reserved categories (purpose, capital, critical limits, irreversible actions, constitutional modification) always critical, never downgradable; no LLM-input path exists in the API.
- [x] 4.2 GREEN: create `src/risk.ts` pure `classify(action, thresholds)`.
- [x] 4.3 REFACTOR: extract reserved-category set + threshold map; `pnpm check` GREEN.

## Phase 5: Deny-by-Default Explicit Grant — Req 4 (Threat: ambient/expired authority)

- [ ] 5.1 RED `test/grant.test.ts`: no grant→DENY; unbounded/wrong-command/expired grant→DENY; only current bounded command-bound grant allows; any enforced-step failure→terminal DENY.
- [ ] 5.2 GREEN: create `src/grant.ts` command-bound, re-evaluated-per-input grant check.
- [ ] 5.3 REFACTOR: share authority/expiry helpers with identity; `pnpm check` GREEN.

## Phase 6: In-Memory Separation of Duties — Req 6 (Threat: SOD overlap)

- [ ] 6.1 RED `test/sod.test.ts`: self-approve/self-verify DENY at any tier; medium 4-way distinct (proposer/approver/executor/verifier); high & critical 5-way distinct; low combines only when policy permits.
- [ ] 6.2 GREEN: create `src/sod.ts` per-tier distinctness check; prohibited overlap→DENY.
- [ ] 6.3 REFACTOR: extract tier role-count rules; `pnpm check` GREEN.

## Phase 7: In-Memory Evidence & Audit — Req 7

- [ ] 7.1 RED `test/evidence.test.ts`: exactly one audit entry appended for allow AND deny, each disclosing non-persistence; audit list immutable (no state survives returned values).
- [ ] 7.2 GREEN: create `src/evidence.ts`: capture evidence record + append one disclosed audit entry, return new immutable list.
- [ ] 7.3 REFACTOR: shared immutable-append helper; `pnpm check` GREEN.

## Phase 8: Honest In-Memory Receipt — Req 8 (Threat: receipt overclaim)

- [ ] 8.1 RED `test/receipt.test.ts`: receipt produced only on ALLOW; carries work/action ID, authority reference, risk class, evidence summary, terminal state, and explicit unsigned/non-persistent disclosure; DENY yields no receipt.
- [ ] 8.2 GREEN: create `src/receipt.ts` unsigned non-persistent receipt on ALLOW only.
- [ ] 8.3 REFACTOR: share disclosure label with evidence; `pnpm check` GREEN.

## Phase 9: Scoped In-Memory Pipeline — Req 3 ordering, 4, 5, 7, 8, 9 (Threat: order bypass; +Persistence-Free Scoping)

- [ ] 9.1 RED `test/pipeline.test.ts`: fixed 16-step order with classify BEFORE grant; every enforced gate (classification/authority/identity/assignment/scope/evidence/SOD/expiry/action-scope/final) denies on failure (terminal DENY); the six deferred steps (delegation, policy-version, budget, approvals, exceptions, records) execute as documented no-op pass-throughs (never real behavior); allow→decision+evidence+audit+receipt; deny→audit appended, no receipt.
- [ ] 9.2 GREEN: create `src/pipeline.ts` composing the enforced gates + six pass-throughs; DENY on any failed enforced step; ALLOW builds receipt.
- [ ] 9.3 REFACTOR: unify StepResult recording; expand `src/index.ts` to export public evaluation surface; `pnpm check` GREEN.

## Phase 10: Final Verification & Exclusion Guard

- [ ] 10.1 Full `pnpm check` GREEN across the whole workspace (format-check → typecheck → build → lint → test).
- [ ] 10.2 Confirm no deferred behavior was silently implemented: all six steps remain documented no-ops; no crypto/durable receipts; no persistence/adapter/framework leakage.
- [ ] 10.3 Confirm `index.ts` exports only the public evaluation API surface; leave `sdd-verify` to the verify phase.
