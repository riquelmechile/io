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

## Coherence Fix (post-commit, live-PG verification)

After the Slice A commit (`c4b4d7e`) was verified against LIVE PG 18.4
(`postgresql://io:io_dev@localhost:5432/io_dev`), the business integration test
failed with **9 failures**: `error: column "company_id" does not exist` (and the
work `version` column) across the Delegation/Work/BusinessReceipt round-trips.

- **Root cause**: Slice A changed the PG adapters (`delegation-adapter.ts`,
  `work-adapter.ts`, `business-receipt-adapter.ts`) to INSERT/SELECT `company_id`
  (×3) and work `version`, but those columns were planned for Slice B's migration
  (`003_harden_constraints.sql`). Against live PG with only 001+002 applied, the
  adapters referenced columns that did not exist — a coherence defect between the
  committed adapters and the shipped schema.
- **Fix**: the additive columns travel WITH Slice A. New idempotent migration
  `packages/database/sql/003_harden_columns.sql` adds exactly the four columns the
  Slice A adapters read/write (`delegation.company_id`, `work.company_id`,
  `work.version`, `business_receipt.company_id`), each `ADD COLUMN IF NOT EXISTS`.
  `business-pg-roundtrip.integration.test.ts` now applies 001 + 002 + 003 in order
  before the tests run (TRUNCATE isolation in beforeEach unchanged). Slice B's
  migration is renumbered to `004_harden_constraints.sql` and keeps only the
  constraints (`terminal_event_id` column, all UNIQUE indexes,
  `idempotency_journal`); its column additions use `IF NOT EXISTS`, so 004 is safe
  after 003. design.md (Data Model split into 003 + 004, Slice Mapping, File
  Changes) and tasks.md (Slice A task 1.12 added; Slice B task 2.7 renumbered
  003→004) updated to match.
- **Not touched**: adapter logic (correct), Slice B/C code (transaction, CAS,
  journal, use-cases, validation), no test weakened/skipped/deleted, no new deps,
  business-domain stays `@io/*`-free.
- **Result**: full suite GREEN against live PG — `pnpm check` format-check ✅ /
  typecheck ✅ / build ✅ / lint ✅ / test ✅, **473 passed | 2 skipped (475)**;
  `business-pg-roundtrip.integration.test.ts` **11 passed / 0 failed**. Both PG
  integration tests RUN (not skipped) and pass; the only 2 skips are the DeepSeek
  external-API round-trip (no `DEEPSEEK_API_KEY`), unrelated to PG.

---

# Slice B — Persistence + Concurrency (PR2, stacked-to-main) — APPENDED

**Slice**: B — Persistence + Concurrency (PR2, stacked-to-main) — ONLY. Slice C (use-cases,
idempotency journal LOGIC, runtime-validation guards) NOT implemented.
**Mode**: Strict TDD (RED → GREEN → REFACTOR), vitest (`pnpm test`), Node 24 (`PATH=/data/node24/bin`),
live PG 18.4 (`postgresql://io:io_dev@localhost:5432/io_dev`, container io_pg) — integration tests RAN,
none skipped.
**Status**: ✅ Slice B complete — `pnpm check` fully green (**525 passed | 2 skipped**); both PG
integration files ran (32/32). All changes UNCOMMITTED (left dirty for native RDD review).
**Merge note**: Slice A's record above is preserved untouched; this section appends Slice B evidence.

## Tasks Done (2.1–2.12)

All 12 Slice B tasks checked off in `tasks.md`. Test count: baseline **473 passed / 2 skipped**
(Slice A coherence fix) → **525 passed / 2 skipped** (+52 new tests). The only skips remain the
DeepSeek external-API round-trip (no `DEEPSEEK_API_KEY`) — PG integration is NOT skipped.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/database/test/connection-port.test.ts` | Unit | ✅ 473/2 | ✅ 1 runtime fail (port lacks `transaction`) + tsc TS2339 | ✅ Passed | ✅ signature ×3 (keyof, generic T, fn param) + source-level guard | ✅ header comment widened to three ops |
| 2.2 | `packages/database/src/connection.ts` | Unit | ✅ (above) | ✅ (from 2.1) | ✅ Passed (11/11) | ➖ covered by 2.1 | ✅ JSDoc: three operations, nested forbidden, close() outside port |
| 2.3 | `packages/database/test/pg-connection.test.ts` + boundary.test.ts | Unit | ✅ (above) | ✅ 5 failed (4 tx unit tests `conn.transaction is not a function` + boundary `.connect(` approval update) | ✅ Passed (59/59) | ✅ BEGIN/COMMIT order, ROLLBACK+rethrow identity, nested throws, param spread | ✅ keyof test widened; boundary approval updated to NEW spec behavior (`pool.connect()` now MANDATED, `new Client` still banned) |
| 2.4 | `packages/database/src/pg-connection.ts` | Unit | ✅ (above) | ✅ (from 2.3) | ✅ Passed | ✅ original-error identity (`rejects.toBe(boom)`) | ✅ rejectNested rejects (async) not throws (port is ASYNC-only contract) |
| 2.5 | `packages/database/test/connection-fake.test.ts` | Unit | ✅ (above) | ✅ 4 failed (`db.transaction is not a function`) | ✅ Passed (9/9) | ✅ commit keeps / error restores+rethrows / nested throws / mirrors-PG contract | ✅ scenario-4 test names the PG-observable contract explicitly |
| 2.6 | `packages/database/test/connection-fake.ts` | Unit | ✅ (above) | ✅ (from 2.5) | ✅ Passed | ✅ UPDATE parse for CAS (up to 3 WHERE + `version=version+1`) + `{rowCount}`; snapshot via structuredClone, restore clones are pristine | ✅ `restore()` re-clones snapshot so a second rollback restores original data |
| 2.7 | `packages/database/test/sql-migrations.test.ts` + `sql/004_harden_constraints.sql` | Unit + Integration | ✅ (above) | ✅ 5 failed (004 file absent) | ✅ Passed (5/5) + live-PG: 004 applies idempotently, journal usable, both journal UNIQUEs enforced | ✅ every statement IF NOT EXISTS; journal round-trip + dup attempt_id + dup (company,key) live tests | ✅ 1 test fix: strip `--` comment lines before counting statements |
| 2.8 | `packages/business-domain/test/fakes.test.ts` + `packages/database/test/business-adapters.test.ts` | Unit | ✅ (above) | ✅ 10 failed (updateIfVersion missing on port/fake/adapter) | ✅ Passed | ✅ success N→N+1 / stale+current / concurrent single winner / repeated bumps / insert-only save | ✅ seeded fixture `await save` (test bug, not prod) |
| 2.9 | `packages/business-domain/src/ports/{repositories,fakes}.ts` + `database/src/work-adapter.ts` | Unit | ✅ (above) | ✅ (from 2.8) | ✅ Passed (228/228 db+domain) | ✅ triangulation caught REAL bug: new version = `expectedVersion + 1` (stored), NOT `work.version + 1` (caller may be stale) — fixed in BOTH fake and PG impl | ✅ CasResult type in pure ports; fake mirrors PG `{rowCount}` semantics |
| 2.10 | `packages/business-domain/test/{types,fakes}.test.ts` + `business-adapters.test.ts` + integration | Unit + Integration | ✅ (above) | ✅ 5 unit fails (10→11 fields, dup work×terminal not rejected, SQL shape) + 4 integration fails (terminal round-trip, dup receiptId, dup work×terminal) | ✅ Passed — unit 66/66, integration 25/25 (live PG) | ✅ same work + different terminal ALLOWED (triangulation); dup receiptId rejected; dup work×terminal rejected even with different receiptId | ✅ fake mirrors uq_receipt_work_terminal with an explicit scan |
| 2.11 | `packages/database/test/business-adapters.test.ts` (empty-companyId block) | Unit | ✅ (above) | ✅ 4 failed (delegation save/get, work save/get) — receipt+updateIfVersion guards already landed in 2.9/2.10 edits | ✅ Passed (32/32) | ✅ 7 parity tests across 3 adapters (save/get/updateIfVersion) | ✅ identical message to fake's `requireCompanyId` ('a non-empty companyId is required') |
| 2.12 | Verify B — full gate | N/A | ✅ (above) | N/A | ✅ `pnpm check` green; `pnpm vitest run packages/database` 162/162 (0 skipped) | N/A | N/A |

**Test summary**: 52 new tests written (473 → 525 passing). Layers: Unit (connection-port +4, pg-connection +4,
connection-fake +4, sql-migrations +5, fakes +9, types +1, business-adapters +17), Integration
(business-pg-roundtrip 11 → 25 tests, +14 live-PG scenarios: tx commit/rollback/nested, fake-vs-PG mirror,
conn-string isolation via scratch DB `io_dev_iso`, CAS live success/stale/concurrent-winner, work insert-only,
receipt single-issuance ×2 + different-terminal allowed, journal ×3). Approval tests updated to NEW spec
behavior (strict-tdd rule): (1) `keyof DbConnection` now `'execute' | 'query' | 'transaction'`; (2) boundary
`pg-connection.ts` now REQUIRES `pool.connect()` (spec mandates it) while still banning `new Client`;
(3) business-pg-roundtrip "re-save creates duplicate" replaced by "duplicate receiptId REJECTED by
uq_receipt_receipt_id" (spec MODIFIED: Single Issuance). None of these are gate hacks — each reflects a
spec-MODIFIED requirement.

## Files Changed (all UNCOMMITTED — left dirty for native RDD review)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/database/src/connection.ts` | Modified | Port adds `transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T>` (D1). execute/query return types UNCHANGED. close() still NOT on the port. |
| `packages/database/src/pg-connection.ts` | Modified | `transaction`: pool.connect() → BEGIN → tx-scoped {execute, query, transaction: rejectNested-as-rejection} → fn → COMMIT + release; throw → ROLLBACK + release + rethrow ORIGINAL error. |
| `packages/database/test/connection-fake.ts` | Modified | `transaction` with structuredClone snapshot/restore of tables+idCounters (restore re-clones so repeated rollbacks stay pristine); nested rejects; `parseUpdate` (up to 3 WHERE, `col=col+1` increment, `{rowCount}`) so CAS works in tests; INSERT now returns `{rowCount:1}`. |
| `packages/database/sql/004_harden_constraints.sql` | Created | terminal_event_id column (IF NOT EXISTS), 5 UNIQUE indexes (company/delegation/work/receipt/work×terminal), idempotency_journal table (created here; logic is Slice C). All statements idempotent. |
| `packages/business-domain/src/types.ts` | Modified | `BusinessReceipt.terminalEventId` (D5). |
| `packages/business-domain/src/ports/repositories.ts` | Modified | `CasResult` type + `WorkRepository.updateIfVersion(work, expectedVersion)` (D4); save documented INSERT-only. |
| `packages/business-domain/src/ports/fakes.ts` | Modified | Fake `updateIfVersion` (compare version → bump `expectedVersion+1` / conflict with current, no silent overwrite); work save insert-only (dup workId throws); receipt fake rejects dup (workId, terminalEventId). |
| `packages/business-domain/src/index.ts` | Modified | Export `CasResult`. |
| `packages/database/src/work-adapter.ts` | Modified | `updateIfVersion`: `UPDATE work SET … version=version+1 WHERE work_id=$1 AND company_id=$2 AND version=$3`, 0 rows → version-conflict + current via scoped get; empty-companyId guard (2.11). |
| `packages/database/src/business-receipt-adapter.ts` | Modified | INSERT/SELECT `terminal_event_id`; empty-companyId guard (2.11). |
| `packages/database/src/delegation-adapter.ts` | Modified | Empty-companyId guard on save/get (2.11). |
| `packages/database/test/connection-port.test.ts` | Modified | transaction signature ×3 + source-level runtime guard (2.1 RED). |
| `packages/database/test/pg-connection.test.ts` | Modified | Mocked Pool gains `connect()` client; keyof widened; 4 tx lifecycle tests (2.3). |
| `packages/database/test/connection-fake.test.ts` | Modified | Fake tx scenario-3 ×3 + scenario-4 mirrors-PG (2.5). |
| `packages/database/test/sql-migrations.test.ts` | Created | 004 content contract (2.7). |
| `packages/business-domain/test/{fakes,types}.test.ts` | Modified | CAS ×5 + insert-only + receipt dup work×terminal + terminalEventId types (2.8/2.10). |
| `packages/database/test/business-adapters.test.ts` | Modified | CAS ×5, terminal_event_id SQL shapes, empty-companyId parity ×7 (2.8/2.10/2.11). |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modified | Applies 004; +14 live-PG scenarios incl. tx commit/rollback/nested, fake-vs-PG mirror, conn-string isolation (scratch DB io_dev_iso), CAS live (Promise.all concurrent winners), work insert-only, receipt single-issuance, journal uniques. |
| `packages/database/test/boundary.test.ts` | Modified | Approval update: pg-connection.ts (driver owner) now REQUIRES `pool.connect()`; `new Client` still banned. |
| `openspec/changes/harden-first-enterprise-vertical-foundation/tasks.md` | Modified | Tasks 2.1–2.12 checked `[x]` (Slice C 3.x untouched). |

## Workload / PR Boundary

- Mode: chained PR slice — `auto-chain` / `stacked-to-main`; this batch = **PR2 (Slice B)**.
- Boundary: Slice B ONLY. Slice A files (trust-kernel, transitions, 003) untouched — git status shows no
  trust-kernel/003 changes in this batch. Slice C (use-cases, idempotency journal logic, row guards, validation)
  NOT implemented — `idempotency_journal` table exists (004) but no adapter/logic.
- Authored diff: **1105 insertions + 50 deletions ≈ 1155 changed lines** (19 files touched) — above the
  400-line guideline and above the ~380 forecast for B. Forecast underestimated the live-PG integration
  breadth (the tx/CAS/journal/isolation scenarios are genuine and long). Flagged for the orchestrator/
  reviewer: PR2 review budget is elevated; splitting B further was rejected because tx + CAS + UNIQUE are
  one coherent concurrency unit. Rollback boundary: revert the 20 files above; Slice A stays.

## Deviations from Design

1. **rejectNested rejects (async) instead of throwing synchronously** (pg-connection + fake). The port
   contract is ASYNC-only — every operation returns a Promise (the port's own D1 rationale: a synchronous
   bridge would lie about completion). The spec says "MUST throw"; an awaited rejection satisfies it. Both
   implementations behave identically (mirrors-PG test asserts this).
2. **CAS returned version is `expectedVersion + 1`**, not `work.version + 1` (fake + PG). Triangulation
   caught that a caller may hold a stale snapshot; the DB computes `version=version+1` on the STORED row,
   which equals expectedVersion+1 because the WHERE clause guaranteed the match. Design D4 said "bump +1"
   without pinning which base; this is the faithful reading.
3. **Fake INSERT now returns `{ rowCount: 1 }`** (was `undefined`): mirrors PG's `QueryResult.rowCount` so
   adapter code reads execute results uniformly. No consumer asserted the old value.
4. **Boundary approval test updated** (`pg-connection.ts` may `pool.connect()`): the spec MODIFIED
   requirement explicitly mandates `pool.connect()` for transactions; pg-connection.ts remains the single
   driver owner and `new Client` stays banned.
5. **Empty-companyId guard message** matches the fake's `requireCompanyId` exactly ('a non-empty companyId
   is required') for parity (2.11).

## Issues Found

- None blocking. One test bug caught during RED (fakes.test.ts CAS fixture forgot to `save` the seeded
  work) and one during GREEN (sql-migrations statement counter counted comment lines) — both fixed in the
  tests, not by weakening them. Triangulation surfaced one real production bug (CAS version base) that was
  fixed in both fake and PG implementations.

## Verify B Evidence (task 2.12)

- `PATH=/data/node24/bin pnpm vitest run packages/database`: **10 files, 162 passed, 0 skipped** — both
  PG integration files RAN (not skipped).
- `PATH=/data/node24/bin pnpm check`: **EXIT 0** — format-check ✅ / typecheck ✅ / build ✅ / lint ✅ /
  test ✅ **525 passed | 2 skipped (527)**. The 2 skips are the DeepSeek external-API round-trip (no
  `DEEPSEEK_API_KEY`) — unrelated to PG; PG integration RAN (32/32 across both integration files, verified
  in verbose reporter output).
- Forbidden-coupling invariants: business-domain `@io/*` imports = **zero** (grep verified); no
  cross-aggregate import; `openai` confined to `deepseek-client.ts`; no dependency added (no package.json
  change); `DbConnection` execute/query return types unchanged (transaction ADDED only); CasResult +
  updateIfVersion live in business-domain ports (pure) + database adapter (PG).
- All changes LEFT UNCOMMITTED (git status: 19 modified + 2 untracked, nothing staged/committed).

---

## Slice B Correction (adversarial review findings)

**Scope**: BOUNDED correction to the UNCOMMITTED Slice B diff. Three real defects fixed
with real tests (strict TDD RED→GREEN) + one documentation note. No Slice C surface
touched, no test weakened/deleted, no new deps, business-domain stays `@io/*`-free.
Live PG 18.4 (`postgresql://io:io_dev@localhost:5432/io_dev`) — integration RAN, not skipped.

### #1 (WARNING, candidate-caused) — transaction() crash path on connection break — FIXED

`transaction()` held a checked-out client across `await fn(tx)`. pg-pool removes the idle
`error` listener on acquire and only re-adds it on release, so a checked-out client had NO
`error` listener during the tx; a backend death mid-tx (during a non-DB await) would emit an
unhandled `error` → uncaughtException → process crash. R4-001's `pool.on('error')` only covers
IDLE clients. **Fix** (`pg-connection.ts`): for the tx lifetime, attach an error-capturing
`client.on('error', onError)` (removed in `finally`); on a connection error the client is
released WITH the error (`client.release(connectionError)`) so the pool discards the broken
connection. The tx promise still rejects (atomicity preserved) with NO uncaughtException —
mirrors R4-001's intent for checked-out clients.

**Test evidence** (`pg-connection.test.ts`, mocked `pg.Pool` whose `MockClient` now mirrors
Node's EventEmitter contract incl. "an `error` event with no listener throws"):
- `attaches an error listener to the checked-out client during the tx and removes it in finally`
  — asserts `listenerCount('error') === 1` mid-tx and `=== 0` after.
- `captures a client error mid-tx (NO uncaughtException) and releases the client WITH the error`
  — emits `error` on the checked-out client during fn's INSERT (handled only because the tx
  attached a listener), asserts the tx rejects with the connection error, `release` called WITH
  the error, and a process-level `uncaughtException` spy was NEVER fired.
- `releases a healthy client without an error on success` — `release(undefined)` (reusable).

### #2 (SUGGESTION, candidate-caused) — ROLLBACK masks original error — FIXED

In the catch path, `await client.query('ROLLBACK')` could itself reject (broken connection),
replacing fn's original error. **Fix** (`pg-connection.ts`): wrap ROLLBACK in its own try/catch
(swallow the rollback error) and ALWAYS rethrow the ORIGINAL error from fn. Atomicity unaffected
—the tx is aborted either way; this is error fidelity.

**Test evidence** (`pg-connection.test.ts`):
- `when ROLLBACK itself rejects, the ORIGINAL fn error still propagates (rollback error swallowed)`
  — `clientQueryMock` rejects on `'ROLLBACK'`; asserts `rejects.toBe(fnError)` (identity — the
  original fn error, NOT the rollback error) and `release` called once.

### #3 (WARNING, pre-existing parity gap) — PgCompanyRepository empty-companyId guard — FIXED

The Slice A follow-up added `if (!companyId) throw new Error('a non-empty companyId is required')`
to the work/delegation/business-receipt PG adapters but MISSED `company-adapter.ts`. **Fix**:
added the SAME guard (identical message/shape) to `PgCompanyRepository.save` and `.get` so all
four PG adapters match the fake's `requireCompanyId`.

**Test evidence**:
- Unit (`business-adapters.test.ts`, parity block): `PgCompanyRepository` rejects save/get with an
  empty companyId (`/companyId/i`).
- Integration (`business-pg-roundtrip.integration.test.ts`, LIVE PG): `PG save/get rejects an empty
  companyId, exactly like the fake` — asserts the PG error message is `'a non-empty companyId is
  required'` AND is byte-identical to the `InMemoryCompanyRepository` fake's message (parity).

### #4 (SUGGESTION) — migration backfill note — DOCUMENTED

`004_harden_constraints.sql`: `terminal_event_id NOT NULL DEFAULT ''` + `UNIQUE(work_id,
terminal_event_id)` would fail to create the index if pre-existing business_receipt rows share a
work_id (backfill to `''` creates dup keys; `IF NOT EXISTS` does not skip on a data violation).
The project is GREENFIELD (no existing rows), so NO code change — added a SQL comment in 004 noting
the greenfield assumption and the `terminal_event_id = receipt_id` backfill recipe if rows ever exist.
`sql-migrations.test.ts` (statement-count, strips `--` comments) still passes.

### Verify (correction)

- `PATH=/data/node24/bin:$PATH pnpm check` → full gate green (see return contract for counts). PG
  integration RAN (not skipped) and passed; the only skips remain the DeepSeek external-API
  round-trip (no `DEEPSEEK_API_KEY`), unrelated to PG.
- No uncaughtException from the #1 scenario — pinned by the process-level `uncaughtException` spy
  in the #1 test (asserts `not.toHaveBeenCalled()`).
- New tests: 4 in `pg-connection.test.ts` (#1 ×3, #2 ×1) + 2 unit in `business-adapters.test.ts`
  (#3) + 2 integration in `business-pg-roundtrip.integration.test.ts` (#3 parity, live PG).
- All changes LEFT UNCOMMITTED. business-domain `@io/*` imports = zero (unchanged). No new deps.

---

# Slice C — Use Cases + Idempotency + Validation (PR3, stacked-to-main) — APPENDED

**Slice**: C — Use Cases + Idempotency + Validation (PR3, stacked-to-main) — ONLY. Final
implementation slice of the change.
**Mode**: Strict TDD (RED → GREEN → REFACTOR), vitest (`pnpm test`), Node 24
(`PATH=/data/node24/bin:$PATH`), live PG 18.4 (`postgresql://io:io_dev@localhost:5432/io_dev`,
container io_pg) — integration tests RAN, none skipped.
**Status**: ✅ Slice C complete — `pnpm check` fully green (**603 passed | 3 skipped**);
both PG integration files ran (38/38). All changes UNCOMMITTED (left dirty for native RDD review).
**Merge note**: Slice A + coherence fix + Slice B + Slice B correction records above are
preserved untouched; this section appends Slice C evidence.

## Tasks Done (3.1–3.10)

All 10 Slice C tasks checked off in `tasks.md`. Test count: baseline **525 passed / 2 skipped**
(Slice B correction) → **603 passed / 3 skipped** (+78 new tests). The skips are exactly:
2 = DeepSeek external-API round-trip (no `DEEPSEEK_API_KEY`, pre-existing, unrelated to PG);
1 = the NEW CI reachability guard `pg-required.integration.test.ts`, which by design SKIPS
locally without `IO_REQUIRE_PG=1` and FAILS LOUDLY in CI (task 3.9). PG integration is NOT skipped.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `packages/business-domain/test/use-cases.test.ts` | Unit | ✅ 261/0 (bd+db pkgs) | ✅ 18 failed (module missing) | ✅ 18/18 | ✅ all six transitions + conflicts + not-found + invalid-transition + terminal | ✅ shared `applyWorkTransition` helper extracted |
| 3.2 | `packages/business-domain/src/use-cases/{result,propose,accept,start,complete,verify,reject}-work.ts,index.ts` | Unit | ✅ (above) | ✅ (from 3.1) | ✅ 18/18 | ✅ propose dup / stale expectedVersion / terminal verified | ✅ `UseCaseResult` + reason union typed; save demoted to insert-only (propose) |
| 3.3 | `packages/business-domain/test/idempotency.test.ts` + `packages/database/test/{idempotency-adapter, business-pg-roundtrip.integration}.test.ts` | Unit + Integration | ✅ (above) | ✅ 21 failed (journal port/adapter/wiring/evidenceId missing) | ✅ unit 21/21; integration 4/4 live PG | ✅ replay vs re-execute (version pinned), DENY, attempt-in-flight, pre-flight no-journal-row, no-partial-write via exploding journal | ✅ `IdempotentFlowAbortError` documented (post-write abort vs pre-write results) |
| 3.4 | `packages/business-domain/test/validation.test.ts` (command block) | Unit | ✅ (above) | ✅ 9 failed (module missing) | ✅ 9/9 | ✅ non-object ×5, empty/missing/non-string fields, expectedVersion edge cases (0/-1/1.5/'1'/NaN/∞) | ➖ None needed |
| 3.5 | `packages/business-domain/src/validation/command.ts` | Unit | ✅ (above) | ✅ (from 3.4) | ✅ 9/9 | ✅ runtime-not-type-only via `as unknown as BusinessCommand` | ✅ immutable value construction (TS2540 fix) |
| 3.6 | `packages/business-domain/test/validation.test.ts` (llm-plan block) | Unit | ✅ (above) | ✅ 4 failed (module missing) | ✅ 13/13 | ✅ 11 malformed shapes + optional intent + source-level no-import test | ✅ import-specific regex (comment ≠ import) |
| 3.7 | `packages/database/test/row-guards.test.ts` + adapters | Unit | ✅ (above) | ✅ 17 failed (module missing) | ✅ 17/17 | ✅ 11 corrupt work rows + 7 corrupt receipt rows + null→undefined normalization | ✅ guards wired into adapter get() read paths (throw on corrupt row) |
| 3.8 | `packages/business-domain/test/evidence-id.test.ts` | Unit | ✅ (above) | ✅ RED folded into 3.3 batch (evidenceId referenced by idempotency tests before implementation) | ✅ 6/6 | ✅ retry-stability (twice→same), not now-based, tenant-scoped, key-scoped, namespace collision check | ➖ None needed (pure one-liner) |
| 3.9 | `packages/database/test/pg-required.integration.test.ts` + ci.yml + README + pnpm-workspace.yaml | Integration (CI guard) | ✅ (above) | N/A (config/docs — triangulation skipped) | ✅ 3-mode verified: local skip / CI pass / CI fail-loudly (ECONNREFUSED) | N/A structural | ✅ ci.yml postgres:18 service + IO_REQUIRE_PG=1 |
| 3.10 | Verify C — full gate | N/A | ✅ (above) | N/A | ✅ `pnpm check` green; PG integration 38/38 ran | N/A | N/A |

**Test summary**: 78 new tests (525 → 603 passing). Layers: Unit (+76), Integration (+1 CI guard
skipped locally, +4 live-PG atomic-close scenarios added to business-pg-roundtrip). Approval test
updated (strict-tdd rule): the database public-surface boundary test now lists the three Slice C
runtime exports (`PgIdempotencyJournalRepository`, `completeWorkAtomically`,
`parseWorkRow`/`parseBusinessReceiptRow`) — design-sanctioned additions (D6/D7), not a gate hack.
One test-bug fix (not a weakening): the new integration assertions called `conn.query(sql)` without
the port's required params array — fixed in the tests.

## Files Changed (all UNCOMMITTED — left dirty for native RDD review)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/business-domain/src/use-cases/{result,propose-work,accept-work,start-work,complete-work,verify-work,reject-work,index}.ts` | Created | D3 use cases: typed `UseCaseResult<Work>`, no throw-for-control-flow, deps = ports only. `applyWorkTransition` = get + canTransitionWork + CAS (updateIfVersion). propose uses insert-only save; complete implements the idempotent terminal close (D6). |
| `packages/business-domain/src/ports/idempotency.ts` | Created | `IdempotencyJournalPort` + `JournalEntry`/`NewJournalEntry` (D6). |
| `packages/business-domain/src/ports/fakes.ts` | Modified | `InMemoryIdempotencyJournalRepository` (mirrors 004 UNIQUEs: one attempt per key, dup attemptId rejected). |
| `packages/business-domain/src/evidence-id.ts` | Created | `evidenceId = ev:${companyId}:${idempotencyKey}` (D8), used in the receipt path. |
| `packages/business-domain/src/validation/{command,llm-plan}.ts` | Created | D7 guards: `parseCommand` / `parseLlmPlan(unknown)` → `{ok:true,value}|{ok:false,reason}`, runtime structural checks, zero @io/* imports. |
| `packages/business-domain/src/index.ts` | Modified | Exports use-cases, journal port + fake, evidenceId. |
| `packages/business-domain/test/{use-cases,idempotency,evidence-id,validation}.test.ts` | Created | 49 new unit tests (transitions ×18, idempotency ×9, evidenceId ×6, validation ×13 + source-level no-import test). |
| `packages/database/src/idempotency-adapter.ts` | Created | `PgIdempotencyJournalRepository` over 004 (lookup/insertInFlight/complete; scoped by company_id; empty-input guards). |
| `packages/database/src/complete-work-flow.ts` | Created | `completeWorkAtomically`: complete-work use case wired to PG adapters inside ONE `DbConnection.transaction` (Atomic Terminal Flow, D6). |
| `packages/database/src/row-guards.ts` | Created | D7 `parseWorkRow`/`parseBusinessReceiptRow`; wired into the work + receipt adapter get() paths (corrupt row → loud failure). |
| `packages/database/src/{work,business-receipt}-adapter.ts` | Modified | get() now validates PG rows through the guards before use (SQL shapes unchanged). |
| `packages/database/src/index.ts` | Modified | Exports the journal adapter, the wiring, and the row guards. |
| `packages/database/test/idempotency-adapter.test.ts` | Created | Adapter SQL-shape + lifecycle + guard tests (9). |
| `packages/database/test/row-guards.test.ts` | Created | Work/receipt row guards (17). |
| `packages/database/test/pg-required.integration.test.ts` | Created | CI reachability guard (3.9): IO_REQUIRE_PG=1 → fail loudly if PG down; else skip. |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modified | +4 live-PG scenarios: fresh atomic close, replay, diff-hash DENY, no-partial-write (exploding journal → full rollback). |
| `packages/database/test/boundary.test.ts` | Modified | Public-surface approval updated for the 3 new Slice C exports (D6/D7). |
| `.github/workflows/ci.yml` | Modified | postgres:18 service container + `DATABASE_URL` + `IO_REQUIRE_PG: '1'` (3.9). |
| `README.md` | Modified | Honest Estado section (toolchain + packages + CI exist) + documented CI-PG expectation (no silent skip). |
| `pnpm-workspace.yaml` | Modified | Stale "one transitional package" comment → honest five-package inventory. |
| `openspec/.../tasks.md` | Modified | Tasks 3.1–3.10 checked `[x]`. |

## Workload / PR Boundary

- Mode: chained PR slice — `auto-chain` / `stacked-to-main`; this batch = **PR3 (Slice C)**, the
  final implementation slice. Per the change-level forecast this is the highest-risk slice; actual
  authored diff ≈ **1500+ changed lines** across 27 files (18 new + 9 modified) — above the 400-line
  guideline and above the ~390 forecast (forecast consistently underestimates test breadth; the
  live-PG atomicity scenarios and the full guard/validation surfaces are genuine and long).
  Rollback boundary: revert the 27 files above; Slices A + B stay.

## Deviations from Design

1. **Post-write failures in the idempotent flow THROW (IdempotentFlowAbortError), pre-write
   decisions RETURN results.** D6 mandates "throw → full rollback" for the atomic terminal close;
   the no-throw-for-control-flow contract (D3) applies to pre-write decisions (not-found,
   invalid-transition, version-conflict, invalid-command), which return results and leave NO
   journal row. A CAS loss AFTER the in_flight insert must abort the transaction or it would commit
   a zombie in_flight row poisoning every retry — so it throws, and the enclosing
   `DbConnection.transaction` (completeWorkAtomically) rolls everything back. Documented in the
   class + the flow; covered by the no-partial-write integration test (via an exploding journal).
2. **attemptId is deterministic** (`att:${companyId}:${idempotencyKey}`), not random: one attempt
   per key is already guaranteed by UNIQUE(company_id, idempotency_key), so a key-derived id stays
   unique AND keeps `business_receipt.terminal_event_id` traceable to the key. receiptId =
   `rcpt:${attemptId}`. Design D5 said "journal attempt_id = terminal event id" without pinning the
   derivation.
3. **Row guards wired into adapter get() as a loud throw** on corrupt rows (integrity violation),
   while the guards THEMSELVES return `{ok:false,reason}` per the spec — the adapter converts the
   guard result into a failure at the I/O boundary. SQL shapes untouched (boundary tests pin them).
4. **completeWork without an idempotencyKey does NOT issue a receipt** — D5 ties
   terminal_event_id to a journal attempt id, so receipts only exist for journal-backed (idempotent)
   terminal closes. The plain path is a pure CAS transition.
5. **"411 tests" in task 3.10 is the stale pre-Slice-A baseline** — the verified count is
   603 passed / 3 skipped; the task's intent (gate green + domain purity) is met and noted in
   tasks.md.

## Issues Found

- None blocking. Two test-side fixes during the cycle: (1) the new integration assertions called
  `conn.query(sql)` without the port's required params array (`params is not iterable`) — fixed in
  the tests; (2) the llm-plan no-import test's regex matched a doc COMMENT (`@io/llm-client`) — made
  import-specific (`import\s+[^;]*@io\/llm-client`), which is what the spec forbids. Neither
  weakened any test. One production fix during GREEN: `parseCommand`/`parseLlmPlan` built value
  objects by mutating readonly fields (TS2540) — switched to immutable spread construction.
- The `exploding journal` (no-partial-write) test uses a test-only subclass of
  PgIdempotencyJournalRepository whose `complete()` throws — real test, real rollback asserted
  across work + receipt + journal.

## Verify C Evidence (task 3.10)

- `PATH=/data/node24/bin:$PATH pnpm check` → **EXIT 0**: format-check ✅ / typecheck ✅ / build ✅ /
  lint ✅ / test ✅ — **603 passed | 3 skipped (606)**; 36 files passed, 2 files skipped.
- PG integration RAN (not skipped): `pnpm vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/database/test/pg-roundtrip.integration.test.ts` →
  **38 passed / 0 failed**, live PG 18.4 (`io_dev`). The 4 new atomic-close scenarios
  (fresh/replay/DENY/no-partial) are among them.
- The 3 skips, precisely: 2 = DeepSeek external-API round-trip (no `DEEPSEEK_API_KEY`,
  pre-existing), 1 = the new CI guard (skips locally by design; fails loudly under `IO_REQUIRE_PG=1` —
  verified in all 3 modes: local-skip ✅ / CI+PG-pass ✅ / CI+PG-down-FAIL-ECONNREFUSED ✅).
- Forbidden-coupling invariants: business-domain `@io/*` actual imports = **zero** (grep for
  `^import[^;]*@io/` → nothing; only comments document the rule); llm-plan guard has **no**
  @io/llm-client/SDK import (grep + source-level test); `openai` production import confined to
  `deepseek-client.ts` (the two llm-client TEST matches are string literals in boundary
  assertions); no package.json/lockfile change (no new deps); no cross-aggregate import introduced.
- All changes LEFT UNCOMMITTED (git status: 9 modified + 18 untracked, nothing staged/committed).

## Slice C Correction (adversarial review findings)

Adversarial review of Slice C: **VERDICT CLEAN** (no BLOCKER/CRITICAL). The crown-jewel guarantees — idempotent replay, diff-hash DENY, and the atomic terminal close (including the CAS-loss-after-in_flight rollback the author suite did not cover) — were independently reproduced against live PG 18.4.

- **WARNING fixed (candidate-caused)**: `proposeWork` mapped EVERY `save()` throw to `work-already-exists`, so an empty `companyId` (rejected by `requireCompanyId`) was mislabeled. Added `!cmd.companyId` to the pre-guard → now returns `invalid-command`. Test added (`use-cases.test.ts`: empty companyId → invalid-command). Suite green (604 passed / 3 skipped).
- **Follow-ups (SUGGESTIONs, deferred — low impact, none affect safety properties)**:
  1. Replay path returns journal `result_json` without a row guard (D7 consistency) — consider `parseWorkRow` on replay. Low: value is written by the same system.
  2. Same-key concurrent race loser surfaces a thrown error (unique violation) instead of a typed replay/`attempt-in-flight` result. Safety holds (exactly one effect); D6 sanctions throw⇒rollback; loser can retry to a clean replay.
  3. `completeWorkIdempotent` atomicity is caller-enforced (must be wrapped in one transaction); document the assumption on `IdempotencyJournalPort`. The sanctioned wiring `completeWorkAtomically` always wraps; no shipped path violates it.
