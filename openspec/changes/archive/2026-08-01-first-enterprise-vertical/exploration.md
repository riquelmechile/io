# Exploration: First Enterprise Vertical (Increment 4 — Change 3)

**Change:** `first-enterprise-vertical` · Project: io · Hybrid artifact store
**Supersedes:** the stale parent exploration in this folder (pre-reset cycle)
**Baseline verified:** `3125c7d` (= origin/main, clean tree) · 604 passed / 3 skipped · live PG 18.4 integration 38/38 ran

## Supersedes

This exploration SUPERSEDES the parent exploration previously stored at
`openspec/changes/first-enterprise-vertical/exploration.md` and is written
afresh for the current repo state. It does not pretend the parent never
existed — it records why the parent is now historical.

**What the parent recommended:** "Approach A — Three Separate SDD Changes", with
build order `domain-foundation → deepseek-client → first-enterprise-vertical`;
it named `domain-foundation` as "The FIRST SDD change to tackle", counted
"264 tests", described `packages/app/` as an empty shell, and predated the
deepseek-client change and the clean harden cycle entirely.

**Why it is now historical:**

| Parent assumption | Current reality |
|---|---|
| "Change 1 `domain-foundation` is next" | ✅ DONE + ARCHIVED (`openspec/changes/archive/2026-07-31-domain-foundation/`) |
| "Change 2 `deepseek-client` is next" | ✅ DONE + ARCHIVED (`openspec/changes/archive/2026-07-31-deepseek-client/`) |
| No harden cycle existed | ✅ DONE + ARCHIVED (`openspec/changes/archive/2026-07-31-harden-first-enterprise-vertical-foundation/`) — 7 specs synced, verify 18/18 req, 61/61 scenarios, 0 blockers |
| "264 tests" | 604 passed / 3 skipped (re-verified by a live `pnpm vitest run` on 2026-07-31) |
| Build order question | The parent's three-change plan is fulfilled EXCEPT Change 3 — this exploration covers exactly that remaining change |

The roadmap (`docs/PASOS_SIGUIENTES_INCREMENTO_4.md`, Rev 2, Paso 2) explicitly
mandates superseding the stale exploration before proposing ("**Supersederlo
antes de proponer**"). This document is that supersession.

## Current State (verified from the live repo)

- **Packages (5):** `app` (empty shell — only `node_modules/@io` symlinks to
  `database` + `trust-kernel`, NO `package.json`, NO `src/` — confirmed still
  reserved for the vertical's application layer), `business-domain` (pure,
  zero `@io/*`), `database` (PG adapters), `llm-client` (DeepSeek adapter,
  `openai` confined to `deepseek-client.ts`), `trust-kernel` (pure, zero
  infra deps).
- **Specs in `openspec/specs/` (14 files):** business-receipt, company-identity,
  db-connection-port, delegation-lifecycle, development-toolchain,
  io-delivery-quality-contract, io-domain-contract,
  io-persistence-recovery-contract, io-ports-trust-contract, llm-client-port,
  persistence-port-boundary, runtime-validation, trust-kernel, work-lifecycle.
- **Tests:** `pnpm vitest run` → **604 passed / 3 skipped** (2 = DeepSeek
  external-API round-trip without `DEEPSEEK_API_KEY`; 1 = local CI
  reachability guard). Both PG integration files re-run against live
  PostgreSQL 18.4 (`io_pg`, `postgresql://io:io_dev@localhost:5432/io_dev`):
  **38 passed / 38 ran, 0 skipped**. Matches the harden archive-report exactly;
  no source changed since the archive commit (`3125c7d` is docs-only).
- **Archives:** `domain-foundation`, `deepseek-client`,
  `harden-first-enterprise-vertical-foundation` (7 specs synced).

## What the Vertical Builds On (harden cycle additions — the vertical CALLS these, it does not re-build them)

| Foundation piece | Where | What the vertical uses it for |
|---|---|---|
| 6 transition use-cases (propose/accept/start/complete/verify/reject) | `business-domain/src/use-cases/` | Worker claims and advances Work via typed `UseCaseResult`, get + CAS, no throw-for-control-flow |
| `DbConnection.transaction(fn)` (PG + fake) | `database/src/{connection,pg-connection,test/connection-fake}.ts` | The terminal transaction wraps journal + CAS + receipt + journal.close atomically |
| CAS `updateIfVersion` — single winner | `WorkRepository` port + PG adapter + fake | Claim = `startWork` with expectedVersion; concurrent workers → exactly one winner, explicit `version-conflict` |
| Idempotency journal (replay / DENY / atomic terminal close) | `business-domain/src/ports/idempotency.ts` + `database/src/{idempotency-adapter,complete-work-flow}.ts` | `completeWorkAtomically` already implements the full terminal close: journal lookup → replay \| DENY \| continue → in_flight → CAS → receipt → complete, all inside ONE transaction |
| Runtime validation guards (command / LLM plan / PG rows) | `business-domain/src/validation/{command,llm-plan}.ts` + `database/src/row-guards.ts` | Worker parses untrusted LLM output (`parseLlmPlan`), validates commands (`parseCommand`), and PG rows are guarded on read |
| `companyId` scope enforcement | ports/fakes/adapters + `company-identity` spec | Every worker operation is tenant-scoped; empty companyId rejected; wrong-tenant get → not-found |
| Stable `evidenceId` (`ev:${companyId}:${idempotencyKey}`) | `business-domain/src/evidence-id.ts` | Retry-stable evidence identity — the receipt's evidenceRefs survive restarts |
| `UNIQUE (work_id, terminal_event_id)` receipts | `database/sql/004_harden_constraints.sql` + receipt adapter | No duplicate business receipts — E2E proves single issuance |
| Hardened SoD: `ABSOLUTE_PAIRS` (approver≠executor, verifier≠executor, proposer≠approver at EVERY tier), `isWindowActive`, `DEFERRED` markers | `trust-kernel/src/{sod,model,grant,identity,pipeline}.ts` | Verifier ≠ executor is enforced even at low risk — the worker must supply DISTINCT principals |
| `LlmClient` port with tool calls + `LlmError('failed' \| 'unknown')` | `llm-client/src/llm-client.ts` | `LlmError('unknown')` (timeout/disconnect) is the adapter's explicit hook for the worker's reconciliation responsibility; `FakeLlmClient` preserves `reasoningContent` and records requests in order |

Also reusable as-is: `evaluate()` 16-step pipeline (`EvaluationInput` /
`EvaluationResult`), `checkSod`, `checkGrant`, `classify`, `captureEvidence`,
the `PgDbConnection` + `pgConnectionString()`, `InMemoryDbConnection` fake,
and the `InMemory*Repository` fakes.

**Not present anywhere (must be built):** any worker/orchestration code, any
sandbox/tools port, any `packages/app` source. Grep for `SandboxPort` /
`worker` / `claim` finds only docs-comment references and the LLM port's
"executed by the worker (Change 3)" comments.

## Scope

### In scope (roadmap Paso 2 + architecture §13.1 abbreviated low-risk form)

- **Worker cycle:** `claim → authority → intent → effect OUTSIDE the transaction → reconcile → verify → terminal transaction`. §13.1's full loop is abbreviated for low risk (no memory retrieval, no scorecard, no episodes — those belong to later increments).
- **Reversible `SandboxPort`** — a driven port (in the application layer) plus a reversible fake and a reversible adapter. The effect MUST be reversible: post-effect failure and failed verification reverse the effect instead of leaking it.
- **E2E integration:** LLM fake (`FakeLlmClient`) + REAL PostgreSQL — the worker wired end-to-end through the real adapters and the real terminal transaction.
- **Tests for:** restart (worker dies mid-cycle and recovers), retry (same key + same hash → replay; different hash → DENY), unique receipt (no duplicate business receipts), revocation (delegation revoked while work is in-flight → authority DENY at action time), post-effect failure (effect succeeded but terminal tx failed → reconcile: reverse effect + close the attempt), verifier ≠ executor (distinct principals even at low risk).
- **`packages/app/` hosts the application layer:** use cases / worker / orchestration (gains its missing `package.json` + `src/`).

### Out of scope (stated explicitly)

Memory OS, minions, skills, learning, CEO agent, crypto/signed receipts.
Also out of scope for this change: context compilation for KV-cache prefix
ordering (§7.2 — the worker's prompt can hard-code a minimal stable prefix;
the full compiler is Paso 3), real DeepSeek E2E, heartbeats, outbox/sagas,
and any change to `business-domain` or `trust-kernel` purity boundaries.

## Affected Areas

- `packages/app/` — NEW application layer: `package.json`, `src/` with the worker orchestration, the `SandboxPort` + reversible fake/adapter, and the E2E wiring. No existing source is modified (none exists).
- `packages/database/` — READ-ONLY reuse: `completeWorkAtomically`, `PgWorkRepository`, `PgDelegationRepository`, `PgBusinessReceiptRepository`, `PgCompanyRepository`, `PgIdempotencyJournalRepository`, `PgDbConnection`. At most new integration tests land here (or in `packages/app/test/`) — no production code change anticipated.
- `packages/business-domain/`, `packages/trust-kernel/`, `packages/llm-client/` — READ-ONLY reuse. The vertical MUST NOT modify them (purity invariants: business-domain and trust-kernel keep zero `@io/*` cross-imports and zero infra deps; `openai` stays confined to `deepseek-client.ts`).
- `openspec/specs/` — new capability spec(s) for the vertical (e.g., `worker-cycle`, `sandbox-port`), plus the change artifacts.
- `pnpm-workspace.yaml` comment — the "five packages / app = thin shell" honesty note must be updated when `packages/app` gains logic.

## Approaches

### Approach A: One change, three chained slices (RECOMMENDED)

Single SDD change `first-enterprise-vertical` (the parent's Change 3), split
into stacked slices like the harden cycle that just succeeded:

- **Slice A — Sandbox + app shell:** `packages/app` scaffolding (package.json,
  tsconfig) + `SandboxPort` (driven port) + reversible fake + reversible
  adapter, fully TDD'd in isolation.
- **Slice B — Worker core:** the orchestration `claim → authority → intent →
  effect → reconcile → verify → terminal` over fakes (InMemory fakes for all
  repos + `InMemoryDbConnection` + `FakeLlmClient`), all the lifecycle
  scenarios (restart, retry, revocation, post-effect failure, verifier ≠
  executor) as unit tests.
- **Slice C — E2E:** worker wired to REAL PostgreSQL + `FakeLlmClient` +
  the shipped reversible sandbox adapter; the full happy path, replay/DENY,
  single receipt, and atomic-close scenarios against live PG.

- **Pros:** matches the parent's change unit; mirrors the A→B→C stacked
  pattern that just completed cleanly; each slice is independently
  RED→GREEN-able and reviewable; the 400-line budget is respected per slice
  (each slice flags `size:exception` like harden did — forecast ~350–450 /
  ~450–550 / ~550–700 authored lines, honest 2–3× of naive estimates).
- **Cons:** three slice boundaries to sequence; Slice A alone has no product
  value (pure enabling infrastructure).
- **Effort:** High overall; Medium per slice.

### Approach B: Two changes (`reversible-sandbox`, then `first-enterprise-vertical`)

Ship the sandbox port + reversible adapter as its own complete SDD change
(explore → propose → spec → design → tasks → apply → verify → archive),
then the worker + E2E as the vertical change.

- **Pros:** sandbox independently reviewed and archived; the vertical change
  then lands on a stable, verified sandbox.
- **Cons:** two full SDD lifecycles (coordinated archives); the sandbox
  boundary is designed WITHOUT a consumer — the worker will likely reshape
  it (the deepseek-client precedent shipped its port alongside its single
  consumer); adds inter-change churn the roadmap did not anticipate.
- **Effort:** High total (two changes), each Medium.

### Approach C: One change, single PR (no chaining)

Everything in one PR.

- **Pros:** no slice boundaries; single review.
- **Cons:** ~1,500+ authored lines (harden's honest ratio says so); blows the
  400-line budget by ~4×; exactly the scope-drift profile that killed the
  earlier `first-vertical-flow` attempt. Verification cannot be staged.
- **Effort:** Very High.

### Sub-decision: where the SandboxPort boundary sits

- **Recommended:** the port + reversible adapter live in `packages/app` (the
  composition root owns its driven port — same shape as business-domain owning
  its repository ports). Keeps the 5-package inventory; no new workspace entry;
  `packages/app` is already designated as the vertical's home.
- **Rejected for now:** a 6th package (`packages/sandbox`, the §14 `tools`
  embryo). §14's 30-package inventory is explicitly "a hypothesis, not a
  mandate"; the repo rule is to extract packages only under real change
  pressure. One consumer (the worker) does not justify it yet — the change
  records this as the future extraction trigger.
- **Rejected:** inlining the sandbox into business-domain (breaks purity:
  a sandbox is infrastructure with I/O, and business-domain is zero-infra).

### Sub-decision: how reconciliation after post-effect failure is modeled

Recommended model — **journal-anchored effect ledger**: the idempotency
journal (already built, D6) is the single source of truth for attempt state;
the sandbox undo log is the source of truth for whether the effect ran.

- Pre-effect: `insertInFlight` BEFORE the effect (D6's exact pattern).
- Effect runs OUTSIDE the transaction against the reversible sandbox (records
  an undo entry).
- Post-effect failure (terminal tx throws, verification fails, restart):
  consult journal + sandbox undo log. Applied effect → `undo()` (reverse),
  close the journal attempt with the terminal result, and let the work sit in
  `in_progress` (retry) or move to `rejected` (policy decision). No effect
  detected → retry cleanly (replay path).
- Unresolvable state → `UNRESOLVED_REQUIRES_HUMAN` per §9.8 (a typed result;
  the low-risk vertical records it, does not fabricate resolution).
- This preserves the §9.8 invariant: the external effect and the durable
  bookkeeping never share one transaction; the journal + undo log reconcile
  the two.

## Recommendation

**Approach A — one change, three chained slices.** Rationale:

1. **It is the parent's Change 3** — the roadmap treats the vertical as one
   unit; splitting it into a separate change (B) adds coordination the
   roadmap did not anticipate.
2. **It mirrors the proven pattern** — the just-archived harden cycle
   succeeded precisely because A→B→C stacking kept every slice reviewable
   and RED→GREEN-staged. The vertical repeats the recipe.
3. **It defuses the failure that killed `first-vertical-flow`** — scope drift.
   A single-PR vertical (C) is the same trap; slicing the sandbox from the
   worker core from the E2E forces the scope decision at every boundary.
4. **Budget honesty** — harden slices forecast ~330–390 and landed
   793 / 1,155 / 1,500 changed lines. This exploration therefore forecasts
   per-slice in the same honest band (Slice A ~350–450, B ~450–550, C
   ~550–700) and flags every slice as `size:exception` against the 400-line
   budget, exactly as harden did. No slice pretends to fit.
5. **The harden foundation makes the vertical mostly orchestration** —
   terminal transaction, CAS, journal, guards, receipts, and SoD already
   exist; the change assembles them, which is why per-slice effort stays
   Medium rather than exploding.

**Build order:** Slice A (sandbox + app shell) → Slice B (worker core, fakes)
→ Slice C (E2E, real PG). Slice A is first because the worker cannot be
exercised without the effect boundary; Slice C is last because it proves the
whole.

## Risks

1. **Scope drift into Paso 3 territory** (context compiler, real DeepSeek E2E,
   heartbeats, memory) — HIGH. Same failure mode as `first-vertical-flow`.
   Mitigation: explicit out-of-scope list above; the LLM prompt for the worker
   is a hard-coded minimal stable prefix, NOT the §7.2 compiler.
2. **Per-slice line budgets exceed 400** — HIGH (established pattern: harden
   793/1,155/1,500 vs forecasts 330–390). Mitigation: flag each slice
   `size:exception` up front; never merge slices to "compensate".
3. **Post-effect failure reconciliation is subtle** — MEDIUM. The danger:
   reversing an effect that actually ran, or NOT reversing one that did. The
   journal + undo-log model addresses it, but the restart scenario needs
   careful triangulation (effect applied before crash, after crash, mid-apply).
4. **Restart recovery depends on journal rows surviving the process** — MEDIUM.
   The journal is PG-backed (durable); the in-flight row is the recovery
   anchor. The fake must mirror this or restart tests are vacuous.
5. **SoD at low risk** — MEDIUM. Low-risk MAY combine functions but NEVER
   self-approve/self-verify; `ABSOLUTE_PAIRS` denies `verifier==executor` at
   every tier. The worker must thread distinct principals for executor and
   verifier even in the E2E fake.
6. **Revocation semantics for in-flight work** — LOW/MEDIUM. ADR-0002 says
   revocation's effect on active work "is decided explicitly by policy";
   this change must pick one (deny at action time, work stays in_progress)
   and record it — not leave it ambiguous.
7. **`packages/app` imports from four packages** — LOW. Allowed (app is the
   composition root), but a boundary test must pin that app does NOT re-export
   domain/kernel internals and that `openai` never leaks past
   `deepseek-client.ts`.
8. **Deferred harden follow-ups interact** (replay row-guard on
   `result_json`, typed same-key race loser, journal transaction-boundary
   doc) — LOW. Non-blocking; the vertical's replay path should read them and
   adopt the documented behavior without re-opening the archived change.

## Ready for Proposal

**Yes.** Proceed to `sdd-propose` for `first-enterprise-vertical` with:

- **Intent:** assemble the first enterprise vertical on the archived
  foundation — reversible sandbox, worker cycle (claim → authority → intent →
  effect outside tx → reconcile → verify → terminal transaction), and an
  end-to-end E2E with `FakeLlmClient` + real PostgreSQL.
- **Scope:** worker + SandboxPort + `packages/app` application layer + E2E +
  lifecycle tests. NO Memory OS, minions, skills, learning, CEO, crypto
  receipts, context compiler, or real DeepSeek E2E.
- **Slicing:** 3 chained PRs (sandbox → worker core → E2E), each flagged
  `size:exception` with honest forecasts.
- **Rollback:** delete `packages/app` sources + new specs; existing packages
  untouched (the change is additive by design).
- **Purity invariants to preserve:** business-domain and trust-kernel stay
  `@io/*`-free and infra-free; `openai` stays confined to `deepseek-client.ts`;
  the vertical CALLS the foundation, it does not modify it.

## Evidence

- `PATH=/data/node24/bin pnpm vitest run` → **604 passed / 3 skipped (607)**, 36 passed files / 2 skipped (2026-07-31).
- `pnpm vitest run packages/database/test/business-pg-roundtrip.integration.test.ts packages/database/test/pg-roundtrip.integration.test.ts` → **38 passed / 38 ran** against live PG 18.4.
- Archive report (`2026-07-31-harden-first-enterprise-vertical-foundation`): 18/18 req, 61/61 scenarios, 0 blockers, `pass_with_warnings` — cited as the source for verify metrics (code unchanged since `4cc0b15`).
