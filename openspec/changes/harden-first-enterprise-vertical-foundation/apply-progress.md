# Apply Progress — harden-first-enterprise-vertical-foundation

**Slice**: A — Authority + Scope (PR1, stacked-to-main) — ONLY. Slices B and C NOT implemented.
**Mode**: Strict TDD (RED → GREEN → REFACTOR), vitest (`pnpm test`), Node 24 (`PATH=/data/node24/bin`).
**Status**: ✅ Slice A complete — `pnpm check` fully green (format-check → typecheck → build → lint → test).
**Fresh artifact**: written from scratch per orchestrator instruction (no merge with any prior cycle).

## Tasks Done (1.1–1.11)

All 11 Slice A tasks checked off in `tasks.md`. Full suite: **455 passed / 20 skipped** (baseline 411 passed / 20 skipped — the 20 PG-integration skips are expected: Slice A is pure domain + fakes, no live PG reachable in this environment).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/trust-kernel/test/sod.test.ts` | Unit | ✅ 411/20 | ✅ Written (proposer==approver DENY ×tiers + low+combination) | ✅ Passed | ✅ 3+ cases (4 tiers, low combo, distinct-ok guard) | ✅ Pair comment/reason updated |
| 1.2 | `packages/trust-kernel/src/sod.ts` | Unit | ✅ (above) | ✅ (test from 1.1 failed: `expected 'ALLOW' to be 'DENY'`) | ✅ Passed (29/29) | ➖ Covered by 1.1 triangulation | ✅ reason string widened |
| 1.3 | `packages/trust-kernel/test/{model,grant,identity,pipeline}.test.ts` | Unit | ✅ (above) | ✅ 8 failed (isWindowActive missing; future-start not gated) | ✅ Passed (77/77) | ✅ 5 window scenarios + boundary cases | ➖ None needed |
| 1.4 | `packages/trust-kernel/src/{model,grant,identity,pipeline}.ts` | Unit | ✅ (above) | ✅ (from 1.3) | ✅ Passed | ✅ start==now / now==expiry / future / expired | ✅ shared gate, single source |
| 1.5 | `packages/trust-kernel/test/pipeline.test.ts` | Unit | ✅ (above) | ✅ 8 failed (deferred steps still `ALLOW`; spec MODIFIED to non-ALLOW marker) | ✅ Passed (38/38) | ✅ all 6 deferred steps + await + no-silent-ALLOW | ➖ None needed |
| 1.6 | `packages/trust-kernel/src/pipeline.ts` | Unit | ✅ (above) | ✅ (from 1.5) | ✅ Passed | ➖ covered by 1.5 | ✅ `StepDecision` type extracted |
| 1.7 | `packages/business-domain/test/{types,fakes}.test.ts` | Unit | ✅ (above) | ✅ 17 runtime failures + tsc TS2353/TS2554/TS2339 (companyId/version/scoped get missing) | ✅ Passed (31/31) | ✅ per-aggregate scoped get + empty rejection | ➖ None needed |
| 1.8 | `packages/business-domain/src/{types,ports/repositories,ports/fakes}.ts` | Unit | ✅ (above) | ✅ (from 1.7) | ✅ Passed | ✅ Delegation/Work/Receipt/Company × scope | ✅ `requireCompanyId` shared helper |
| 1.9 | `packages/business-domain/test/transitions.test.ts` + `src/transitions.ts` | Unit | ✅ (above) | ✅ 5 failed (isDelegationActive missing) | ✅ Passed (50/50) | ✅ 4 spec scenarios + boundary validUntil | ➖ None needed |
| 1.10 | `packages/database/test/business-adapters.test.ts` + `src/{delegation,work,business-receipt}-adapter.ts` + `test/connection-fake.ts` | Unit | ✅ (above) | ✅ 14 failed (old SQL shapes, unscoped get, no company_id/version) | ✅ Passed (26/26 adapters+fake) | ✅ wrong-company isolation ×3, SQL shape ×6 | ✅ fake parseSelect extended (WHERE + AND) |
| 1.11 | Verify A — full gate | N/A | ✅ (above) | N/A | ✅ `pnpm check` green | N/A | N/A |

**Test summary**: 44 new tests written (411 → 455 passing). Layers: Unit only (Slice A is pure domain + fakes; live PG integration is Slice B). Approval tests updated: 2 pipeline deferred-step tests changed from old `ALLOW` to new `DEFERRED` behavior — this is the spec's MODIFIED requirement ("Previously: deferred no-op steps were recorded with decision ALLOW"), executed per strict-tdd approval-testing rule (update test to NEW expected behavior → RED → implement → GREEN). Not a gate hack.

## Files Changed (all UNCOMMITTED — left dirty for native RDD review)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/trust-kernel/src/sod.ts` | Modified | `['proposer','approver']` appended to ABSOLUTE_PAIRS (D2) — absolute at EVERY tier incl. low+allowsLowCombination |
| `packages/trust-kernel/src/model.ts` | Modified | Added `isWindowActive(start, now, expiry) = start<=now && now<expiry` (ADR-0001) |
| `packages/trust-kernel/src/grant.ts` | Modified | `isGrantActive` uses `isWindowActive` (future-start grant confers no authority) |
| `packages/trust-kernel/src/identity.ts` | Modified | `resolveActiveIdentity` filters temp assignments through `isWindowActive` |
| `packages/trust-kernel/src/pipeline.ts` | Modified | `expiryGate` uses `isWindowActive`; `StepDecision = Decision \| 'DEFERRED'`; `passThrough` records `DEFERRED` (never silent ALLOW) |
| `packages/trust-kernel/src/index.ts` | Modified | Export `isWindowActive` |
| `packages/trust-kernel/test/sod.test.ts` | Modified | SoD ×4 scenarios: self-approve/self-verify (pre-covered), low proposer==approver DENY (×tiers), distinct-ok guard |
| `packages/trust-kernel/test/model.test.ts` | Created | `isWindowActive` unit tests (5 window scenarios) |
| `packages/trust-kernel/test/grant.test.ts` | Modified | future-start DENY, start==now ALLOW, now==expiry DENY |
| `packages/trust-kernel/test/identity.test.ts` | Modified | future-start stripped, start==now kept, now==expiry stripped |
| `packages/trust-kernel/test/pipeline.test.ts` | Modified | future-start expiryGate DENY, start==now ALLOW, deferred steps carry `DEFERRED`, evaluate awaited |
| `packages/business-domain/src/types.ts` | Modified | `companyId` added to Delegation/Work/BusinessReceipt; `Work.version` (numeric, init 1) |
| `packages/business-domain/src/ports/repositories.ts` | Modified | Scoped `get(companyId, id)` for Delegation/Work/BusinessReceipt |
| `packages/business-domain/src/ports/fakes.ts` | Modified | Enforce scope (wrong-company → not-found) + reject empty companyId (`requireCompanyId`) |
| `packages/business-domain/src/transitions.ts` | Modified | `isDelegationActive` — same window rule as kernel, implemented locally (package stays @io/*-free) |
| `packages/business-domain/src/index.ts` | Modified | Export `isDelegationActive` |
| `packages/business-domain/test/{types,fakes,transitions}.test.ts` | Modified | companyId/version/scoped-get/empty-rejection/window tests |
| `packages/database/src/{delegation,work,business-receipt}-adapter.ts` | Modified | `company_id` INSERT/SELECT; scoped get `WHERE company_id = $1 AND <id> = $2`; work `version`; receipt carries companyId |
| `packages/database/test/business-adapters.test.ts` | Modified | New SQL shapes, scoped get, tenant-isolation tests |
| `packages/database/test/connection-fake.ts` | Modified | parseSelect supports 2-condition WHERE (AND) for scoped reads |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modified | Compile-only updates for scoped signatures + companyId/version (stays skipped at runtime; live PG is Slice B) |
| `openspec/changes/harden-first-enterprise-vertical-foundation/tasks.md` | Modified | Tasks 1.1–1.11 checked `[x]` |

## Workload / PR Boundary

- Mode: chained PR slice — `auto-chain` / `stacked-to-main`; this batch = **PR1 (Slice A)**.
- Boundary: starts at `8840bd4` (clean tree); ends with Slice A only. Slices B (persistence/CAS/003 migration) and C (use cases/idempotency/validation) NOT implemented.
- Actual authored diff: **613 insertions + 180 deletions ≈ 793 changed lines** — above the 400-line guideline and above the ~330 forecast for A (forecast underestimated test breadth). Flagged for the orchestrator/reviewer: PR1 review budget is elevated; further splitting (A1/A2) is possible but would break the stacked A→B→C plan's scope coherence. Rollback boundary: revert the 26 files above; nothing outside Slice A touched.

## Deviations from Design

1. **business-domain window rule implemented locally** (`isDelegationActive` in transitions.ts): design D2/spec delegation-lifecycle says activity "MUST be decided by the same window rule as the trust kernel (`isWindowActive`)". business-domain cannot import `@io/trust-kernel` (invariant 2: zero `@io/*` imports), so the rule is implemented with identical semantics (`validFrom <= now && now < validUntil`) and documented as such. No cross-package import introduced.
2. **Empty-companyId rejection enforced at port/fake level, not in PG adapters** (Slice A): fakes throw on empty companyId; PG adapters rely on scoped SQL (empty `company_id` matches no rows → not-found). An explicit adapter guard can land in a later slice; live PG schema changes are explicitly Slice B (no 003 migration added — per instruction).
3. **Work version "init 1"** is a required field with fixtures at 1 (Slice A). The create-factory that sets version=1 as a transition use case lands in Slice C (D3); CAS bump logic is Slice B (D4) — correctly NOT implemented here.

## Issues Found

- None blocking. Slice A scope respected: no `transaction`, no CAS, no `003` migration, no use-cases, no idempotency, no validation, no `DbConnection` signature change.

## Verify A Evidence (task 1.11)

- `PATH=/data/node24/bin pnpm check` (equivalent invocation with pnpm on PATH): **format-check ✅ / typecheck ✅ / build ✅ / lint ✅ / test ✅ — 455 passed, 20 skipped**.
- No cross-aggregate import: trust-kernel `grep -rn "@io/" src` → zero; business-domain actual `@io` imports → zero (only comment mentions explaining the rule).
- `openai` import confined to `packages/llm-client/src/deepseek-client.ts` (unchanged).
- No dependency added; `package.json` files untouched.
- `DbConnection` execute/query return types untouched.

## Slice A Review

- **Native RDD review contract**: `gentle-ai review status --next-transition` returns `applicability: unrelated` / `receipt.status: not_applicable` for this repo (riquelmechile/io is not onboarded to `gentle-ai.review-integration/v2`; the review-* agents require a native binding and are unavailable outside it). No native review gate applies; delivery is `not_applicable` at the native layer. NOT fabricated — this is the facade's own determination.
- **Adversarial security review (general, read-only)** on the uncommitted candidate — **VERDICT: CLEAN**, no BLOCKER/CRITICAL. Attack vectors traced and could NOT be bypassed: (1) self-approval at low+allowsLowCombination → DENY (ABSOLUTE_PAIRS loop runs before requiredDistinctRoles); (2) window gate applied at all 4 activity sites (grant.ts:80, identity.ts:58, pipeline.ts:295, transitions.ts:42), no residual `expiry>now`-only check, boundaries correct; (3) no silent ALLOW (deferred = `DEFERRED`); (4) no cross-tenant read (scoped `WHERE company_id=$1 AND id=$2`); (5) no Work.version/companyId contract hole (tsc clean).
- **1 WARNING (candidate-caused, folded to Slice B)**: PG adapters bind `companyId` without an empty guard, while the fake rejects empty (`requireCompanyId`). Defense-in-depth / validation parity only — NOT an isolation break (scoped SQL still isolates tenants). Fix in Slice B: add `if (!companyId) throw` to the three PG adapters (tracked as task 2.11).
- **1 SUGGESTION (spec-sanctioned, not a bug)**: `proposer==verifier` / `approver==verifier` are not absolute pairs; the trust-kernel spec explicitly permits low-risk to combine other roles but never proposer with approver. No action.
- Independent orchestrator verification: `pnpm check` re-run green (455/20); business-domain `@io/*` imports = none; critical tests (sod.test.ts, model.test.ts) inspected and confirmed genuine (real assertions, not empty/trivial).
