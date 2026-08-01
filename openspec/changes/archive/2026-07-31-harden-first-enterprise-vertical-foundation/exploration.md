# Exploration: Harden First Enterprise Vertical Foundation

**Change:** `harden-first-enterprise-vertical-foundation` · Project: io · Artifact store: openspec
**Date:** 2026-07-31 · Baseline: `main` @ `120ec33` (= `4ea1653` + docs commit; working tree clean)
**Authoritative spec:** `docs/PASOS_SIGUIENTES_INCREMENTO_4.md` (Paso 1, sections 1.1–1.7)

## Context

This is a CLEAN REBUILD. A prior cycle on this exact change was reset away because its
APPLY/REVIEW used gate hacks (empty review findings, post-verify gap-fixes). The prior
analysis was sound and is maintained; every gap below was RE-VERIFIED against the current
baseline code and is confirmed PRESENT again at baseline (the harden code was reset away).
The baseline itself is live-verified: `pnpm test` at HEAD reports **411 passed / 20 skipped**
(26 files passed, 3 skipped) — exactly the documented stable state of `PASOS_SIGUIENTES_INCREMENTO_4.md`
and unchanged by the docs-only commit `120ec33`.

Order of work per the authoritative doc: deepseek-client ✅ closed → **harden (this change)** →
`first-enterprise-vertical`. The vertical MUST NOT be opened until harden is archived clean.

## Current State

Four real packages exist (each with `package.json`):

- **`packages/trust-kernel`** (`@io/trust-kernel`) — pure authority kernel: `evaluate()` 16-step
  pipeline, `classify()`, `checkGrant()`, `checkSod()`, `resolveActiveIdentity()`, evidence/audit
  receipts, optional repository ports.
- **`packages/database`** (`@io/database`) — PG adapter over `DbConnection` port + 4 business
  adapters (company/delegation/work/business-receipt) + SQL schema (001, 002).
- **`packages/business-domain`** (`@io/business-domain`) — pure types (Company, Delegation, Work,
  BusinessReceipt), transition tables, repository ports, fakes.
- **`packages/llm-client`** (`@io/llm-client`) — DeepSeek V4 adapter behind the pure `LlmClient`
  port (archived clean; verified PASS 7/7 · 12/12).

**`packages/app` is an EMPTY SHELL** — only `node_modules/`, no `package.json`, no `src/`.
It is reserved for the future vertical (`first-enterprise-vertical`), NOT part of this change.

## Re-Verified Gaps (all 7 confirmed PRESENT at baseline)

### Gap 1 — SoD `proposer ≠ approver` is MISSING (self-approval possible at low risk)

- `packages/trust-kernel/src/sod.ts:35-38` — `ABSOLUTE_PAIRS = [['approver','executor'], ['verifier','executor']]`. There is NO `['proposer','approver']` pair.
- `sod.ts:53` — at `low` risk with `allowsLowCombination: true`, `requiredDistinctRoles` returns `null`; the ONLY checks then are `ABSOLUTE_PAIRS` (`sod.ts:79-86`). A single principal can be both proposer and approver.
- ADR-0003 §Decision Rules:42 — "For low-risk actions, functions may be combined when policy permits, **but no principal may self-approve or self-verify**" (doc: "nadie se autoaprueba"). Current kernel violates this.
- **Verdict: PRESENT.** Fix direction: add `['proposer','approver']` to `ABSOLUTE_PAIRS` (applies at every tier; medium+ tiers already require 4-way/5-way distinctness, so the practical change is the low+policy path) — design decision for the design phase.

### Gap 2 — No `start <= now` check anywhere; future-start records treated as ACTIVE

- `packages/trust-kernel/src/grant.ts:74-76` — `isGrantActive()` checks only `grant.expiry > now`; a future-start grant is "active".
- `packages/trust-kernel/src/identity.ts:51-56` — `resolveActiveIdentity()` filters only `(assignment.expiry ?? now) > now`; a future-start temp assignment is active.
- `packages/trust-kernel/src/pipeline.ts:277-283` — `expiryGate()` checks `grant.expiry <= input.now` only; no start check.
- `packages/trust-kernel/src/model.ts:48-62` — `validateBoundedWindow()` validates `expiry > start` structurally, but nothing evaluates `start <= now` at decision time.
- Grep for `isWindowActive` / `start > now` across `packages/`: **zero hits**. No helper exists.
- **Verdict: PRESENT.** PASOS 1.1: "Inicio futuro → no activo".

### Gap 3 — SoD enforced ONLY on kernel-action evaluation, NOT wired to Work transitions; business domain has NO use cases (raw `save()` mutates state)

- `packages/trust-kernel/src/pipeline.ts:272-274` — `sodGate` (step 10) runs `checkSod()` over the `sodAssignments` list; this is a structural check of the kernel input, not of business lifecycle transitions.
- `pipeline.ts:36-42` + `pipeline.ts:197-206` — `DEFERRED_STEPS` explicitly documents `delegation`, `approvals`, `records` (and budget/exceptions/policy-version) as "harden downstream" no-op pass-throughs recorded with `decision: 'ALLOW'` — the "silent ALLOW" concern of PASOS 1.1 ("pasos no-op del kernel: no `ALLOW` silencioso").
- `packages/business-domain/src/transitions.ts:33-35` — `canTransitionWork()` is a pure transition-table lookup; no SoD, no authority, no scope check.
- `packages/business-domain/src/ports/repositories.ts:24-27` — `WorkRepository` = `save`/`get` only; there is no transition/use-case surface.
- `find packages -type d -name "use-cases"`: **zero hits**. `packages/business-domain/src/` contains only `index.ts`, `ports/`, `transitions.ts`, `types.ts`.
- **Verdict: PRESENT.** PASOS 1.3: "`save` no es el camino de cambio de estado de Work"; 1.1: "Pasos no-op del kernel".

### Gap 4 — No `companyId` on Delegation, Work, or BusinessReceipt (tenant-unscoped aggregates)

- `packages/business-domain/src/types.ts:11-14` — Company is minimal `{ companyId, purpose }` (correct, per arch doc §4).
- `types.ts:30-40` — `Delegation` has NO `companyId`.
- `types.ts:62-71` — `Work` has NO `companyId`.
- `types.ts:75-85` — `BusinessReceipt` has NO `companyId`.
- SQL mirrors this: `packages/database/sql/002_create_business_tables.sql:17-29` (delegation), `32-43` (work), `47-59` (business_receipt) — no `company_id` column.
- **Verdict: PRESENT.** PASOS 1.2: "`companyId` obligatorio en operaciones; repos/casos de uso rechazan scope incorrecto".

### Gap 5 — No `DbConnection.transaction(fn)`; SQL has indexes but ZERO UNIQUE constraints; `business_receipt` has no `terminal_event_id`

- `packages/database/src/connection.ts:40-43` — the port has EXACTLY `execute` and `query`. No transaction primitive.
- `packages/database/src/pg-connection.ts:56-67` — the PG adapter implements only those two; error mapping explicitly deferred: `pg-connection.ts:16-18` — "No swallowing, no classification (deferred to hardening)".
- `packages/database/sql/001_create_tables.sql:9-32` — `evidence`/`audit`: SERIAL PK + indexes only.
- `packages/database/sql/002_create_business_tables.sql:9-61` — `company`/`delegation`/`work`/`business_receipt`: SERIAL PK + `CREATE INDEX` only; **no `UNIQUE`** on any business ID.
- `002_create_business_tables.sql:47-59` — `business_receipt` columns: no `terminal_event_id` (PASOS 1.3 prefers `UNIQUE (work_id, terminal_event_id)` on receipts).
- **Verdict: PRESENT.** PASOS 1.3: UNIQUE en IDs de negocio + `DbConnection.transaction(fn)` (PG + fake).

### Gap 6 — Work has NO version field (last-write-wins); no idempotency store, no attempt journal

- `packages/business-domain/src/types.ts:62-71` — `Work` fields: `workId, delegationId, proposer, description, state, deliverable, evidenceRefs, outcome`. No `version`.
- `packages/database/sql/002_create_business_tables.sql:32-43` — `work` table has no `version` column.
- Grep `version` in `packages/business-domain/src` + `packages/database/src`: zero hits.
- Grep `idempot|attempt` across packages: only doc comments (SQL idempotent-DDL notes); **no idempotency-key store, no attempt journal** anywhere.
- **Verdict: PRESENT.** PASOS 1.4 (claim con versión/CAS, conflicto explícito, un solo escritor gana) + 1.5 (intento + key antes del efecto).

### Gap 7 — No runtime validation guards (type-check only)

- `find packages -type d -iname "*validation*"`: **zero hits**. No runtime-validation capability exists (`openspec/specs/runtime-validation` ABSENT).
- `pg-connection.ts:16-18` explicitly defers error classification to hardening.
- No guards on commands, PG rows, or LLM plans (PASOS 1.6: "guards: comando, filas PG, plan LLM; rechazo explícito; no solo TypeScript").
- **Verdict: PRESENT.**

### Hygiene observation (PASOS 1.7) — stale workspace comment

- `pnpm-workspace.yaml:1-4` — comment still reads "Workspace now includes one transitional package: packages/trust-kernel". Stale: four real packages exist. README/workspace must be brought up to date as part of 1.7.

## Forbidden-Coupling Invariants to PRESERVE (verified intact at baseline)

1. **No aggregate imports another aggregate** — cross-references use neutral string IDs, ports, and application coordination (arch doc §5.5 / line ~411: "Ningún agregado importa otro agregado"). `packages/business-domain/src/types.ts:5-7` header states it; repository ports (`ports/repositories.ts`) reference only neutral IDs.
2. **`business-domain` stays pure — zero `@io/*` imports** — grep of `packages/business-domain/src` shows no `@io/` imports. All cross-package imports in `packages/database/src` are TYPE-ONLY and boundary-enforced (`packages/database/test/boundary.test.ts:68-75, 100-105, 150`).
3. **`openai` confined to `packages/llm-client/src/deepseek-client.ts:1`** — boundary test enforces exactly one src file imports it (`packages/llm-client/test/boundary.test.ts:83-118`); port (`llm-client.ts:23-132`) is SDK-free and chat-only.
4. **DeepSeek output never grants authority** — arch doc: "La salida de DeepSeek es una propuesta no confiable. No concede permisos, no ejecuta herramientas directamente y no modifica estado operacional sin atravesar clasificación de riesgo, autoridad, política, presupuesto, evidencia, aprobación y separación de funciones." `LlmClient` returns only content/usage/model — no authority types.
5. **NO agentic/business frameworks** (LangGraph, CrewAI, AutoGen, Mem0, Zep, Engram, Mastra, etc.) — appear ONLY as forbidden patterns in boundary-test regexes (`trust-kernel/test/boundary.test.ts:35`, `llm-client/test/boundary.test.ts:25`, `database/test/boundary.test.ts:38`, etc.). Harden MUST NOT introduce any.

Harden must preserve all five; the SoD/window/scope hardening strengthens invariants 1–4 without changing the coupling topology.

## Package Map (reconfirmed)

| Package | Status | Role in harden |
|---|---|---|
| `packages/trust-kernel` | real | MODIFIED — SoD pairs, window-active, no-op steps |
| `packages/database` | real | MODIFIED — transaction(fn), UNIQUE, version col, terminal_event_id, 003 sql |
| `packages/business-domain` | real | MODIFIED — companyId, Work.version, use cases |
| `packages/llm-client` | real | UNTOUCHED (closed) — only reference for port/fake patterns |
| `packages/app` | EMPTY SHELL (no package.json/src) | NOT part of harden — reserved for the vertical |

## Capability / Delta Plan (reconfirmed)

- **MODIFIED deltas** (all 6 main specs exist): `trust-kernel`, `company-identity`, `delegation-lifecycle`, `work-lifecycle`, `business-receipt`, `db-connection-port` (each at `openspec/specs/{capability}/spec.md`).
- **NEW capability**: `runtime-validation` (confirmed ABSENT from `openspec/specs/`).
- `llm-client-port`, `persistence-port-boundary`, and the trust/quality contracts are NOT in this change.

## Delivery Recommendation (maintained from prior analysis)

**One SDD change, delivered as 3 chained PRs (stacked-to-main per `openspec/config.yaml`), each slice within the 400-line review budget, each with its own RED→GREEN verify:**

- **Slice A — authority + scope:** SoD `proposer ≠ approver` (Gap 1), `isWindowActive(start, now, expiry)` + future-start → not active (Gap 2), no-op kernel steps no longer silent-ALLOW (Gap 3 kernel side), `companyId` on all aggregates + scoped repos (Gap 4).
- **Slice B — persistence + concurrency:** `DbConnection.transaction(fn)` on port + PG + fake (Gap 5), UNIQUE constraints + `terminal_event_id` + new 003 SQL (Gap 5), `Work.version` + optimistic CAS (`UPDATE ... WHERE version = $expected`) with explicit conflict (Gap 6).
- **Slice C — use cases + idempotency + validation:** transition use cases replacing raw `save()` (propose/accept/start/complete/verify/reject) (Gap 3), idempotency-key store + attempt journal, pre-effect attempt + terminal-close-in-one-tx (PASOS 1.5), runtime-validation guards (Gap 7), hygiene (README/workspace, CI-PG note) (PASOS 1.7).

Slices are sequential (A → B → C); each ends in a reviewable PR with honest findings and a receipt-verified commit.

## Affected Areas (baseline)

- `packages/trust-kernel/src/sod.ts` — Gap 1: `ABSOLUTE_PAIRS` + low-risk path.
- `packages/trust-kernel/src/grant.ts`, `src/identity.ts`, `src/pipeline.ts`, `src/model.ts` — Gap 2: `isWindowActive`; Gap 3: no-op step honesty.
- `packages/business-domain/src/types.ts` — Gaps 4, 6: `companyId` on 3 aggregates, `Work.version`.
- `packages/business-domain/src/transitions.ts` + NEW `src/use-cases/` — Gap 3: transition use cases.
- `packages/business-domain/src/ports/repositories.ts` — Gaps 3, 4: transition surface, scoped lookups, versioned save.
- `packages/database/src/connection.ts`, `src/pg-connection.ts` — Gap 5: `transaction(fn)`.
- `packages/database/src/{company,delegation,work,business-receipt}-adapter.ts` — Gaps 4–6: new columns, version CAS, scoped queries.
- `packages/database/sql/002_create_business_tables.sql` + NEW `003` — Gap 5: UNIQUE, `terminal_event_id`, version, idempotency/attempt tables.
- NEW `packages/business-domain/src/use-cases/` (Slice C) + NEW runtime-validation surface (Slice C).
- Tests: trust-kernel SoD/window, database port/adapter/integration, business-domain transitions/use-cases, idempotency, runtime guards.

## Open Design Questions (for the design phase)

1. **`transaction(fn)` shape on the driver-free port** — PG: `BEGIN`/`COMMIT`/`ROLLBACK` around the fn; fake: honest simulated atomicity (single-threaded in-memory, or explicit rollback semantics). Signature candidate: `transaction<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T>`. Must keep the port driver-free and the fake honest (no lying about durability).
2. **`proposer ≠ approver` placement** — add `['proposer','approver']` to `ABSOLUTE_PAIRS` (absolute at every tier) vs. only under `allowsLowCombination`. ADR-0003 wording ("no principal may self-approve") favors absolute; confirm against existing trust-kernel tests (no test asserts proposer=approver ALLOW at baseline — RED→GREEN tests required).
3. **Use-case location** — `packages/business-domain/src/use-cases/` (pure, port-dependent orchestration) confirmed as the natural home; exact file layout and naming.
4. **Work versioning** — numeric `version` vs. `updatedAt`; CAS via `UPDATE ... WHERE work_id=$1 AND version=$2`; explicit conflict result type (no silent overwrite); how fakes simulate CAS.
5. **`terminal_event_id` + receipts** — is the terminal event a new event/attempt table (003 SQL) with `UNIQUE (work_id, terminal_event_id)` on `business_receipt`, or a column referencing the attempt journal? Defines the idempotency-close-in-one-tx shape.
6. **Idempotency semantics** — same key + same hash → replay; same key + different hash → DENY (PASOS 1.5). Where the journal lives (new table), and how the terminal close stays atomic with the attempt record.
7. **Runtime-validation placement** — new capability `runtime-validation`: guards for command, PG rows, and LLM plan — where do the guards live (which package), and how does the LLM-plan guard avoid coupling to `@io/llm-client` (must stay in-domain; DeepSeek output is never authority).
8. **`evidenceId` stability** (PASOS 1.3) — the kernel's evidence currently keys on `actionId`; what makes a stable business `evidenceId` across retries.

## Stale Exploration Reconciliation Note

`openspec/changes/first-enterprise-vertical/exploration.md` (154 lines, NOT edited) is STALE and MUST be reconciled/superseded:

- It recommends `domain-foundation` as "next" (lines 128–133, 146–154) — that change is ARCHIVED (`openspec/changes/archive/2026-07-31-domain-foundation/`).
- It predates `deepseek-client` (archived `2026-07-31-deepseek-client/`, verify PASS) and the harden reset.
- Its remaining relevance is as the future `first-enterprise-vertical` change — which per `PASOS_SIGUIENTES_INCREMENTO_4.md` is gated on THIS harden change being archived clean.

The change folder `first-enterprise-vertical/` holds only this stale exploration.md and should be superseded/reconciled by the orchestrator when the vertical is eventually opened (or archived as superseded context). Do not treat it as an active change.

## Risks

- **Medium — Slice coupling:** slices are sequential; Slice B's `transaction(fn)` port change ripples through all adapters, fakes, and `connection-port.test.ts` boundary expectations. Must update the port contract + fake in one PR.
- **Medium — CAS correctness:** proving "single writer wins" requires concurrency tests over both PG and fake; last-write-wins must be fully replaced, not patched.
- **Medium — companyId breadth:** touching 4 aggregates (types + SQL + adapters + ports + tests) is mechanical but wide; guard against scope creep into vertical-only features.
- **Medium — runtime-validation scope:** the "plan LLM" guard must not become a `@io/llm-client` dependency in the domain; enforce the pure-domain invariant.
- **Low — trust-kernel behavior change:** SoD pair addition alters low+policy outcomes; existing tests must not be silently "fixed" — new RED→GREEN tests first.
- **Low — clean-rebuild discipline:** `backup/pre-reset-harden-4c353fa` and `backup/harden-wip-reference` are REFERENCE ONLY; do not copy code from them, and do not let the stale `first-enterprise-vertical/exploration.md` confuse the vertical gating.
- **Low — process honesty:** prior cycle was reset for gate hacks; this cycle's review must report real findings and verify must only confirm, never discover (PASOS: "review no se fabrica").

## Ready for Proposal

**Yes.** Proceed to `sdd-propose` for `harden-first-enterprise-vertical-foundation`. The proposal should define: intent (durable foundation for the vertical per PASOS Paso 1, sections 1.1–1.7), scope (the 3 slices above, one SDD change, chained PRs stacked to main), the 6 MODIFIED capabilities + NEW `runtime-validation`, preserved forbidden-coupling invariants, and a rollback plan (per-slice revert; no vertical features; `packages/app` untouched).
