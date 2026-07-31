# Exploration: First Enterprise Vertical (Increment 4)

**Change:** `first-enterprise-vertical` · Project: io · Hybrid artifact store

## Current State

IO has completed Increments 1–3 (foundation, trust kernel, persistence). Three packages exist:

- **`packages/trust-kernel/`** (`@io/trust-kernel`) — pure TypeScript, zero infra deps. Exposes `evaluate(input): Promise<EvaluationResult>` running a 16-step authority pipeline (classification → authority → identity → assignment → bounded scope → evidence → SOD → expiry → action scope → final). Supports optional async evidence/audit repository injection. Includes: `classify()`, `checkGrant()`, `checkSod()`, `captureEvidence()`, `issueReceipt()`, `resolveActiveIdentity()`. Exports types: `PrincipalIdentity`, `Grant`, `KernelAction`, `SodAssignment`, `RiskClass`, `Decision`, etc.

- **`packages/database/`** (`@io/database`) — PG persistence adapter. Exposes `PgDbConnection` (over `pg.Pool`), `DbConnection` port, evidence/audit adapters backed by real PostgreSQL 18.4. SQL is PG-shaped (`$N` placeholders). Includes `pgConnectionString()` and schema builders.

- **`packages/app/`** — empty shell (only `node_modules/@io` symlinks). The previous attempt (`first-vertical-flow`) built an `evaluateAuthority` orchestrator wiring PG to `evaluate()` — pure infrastructure plumbing, not a product vertical. It was scrapped. No source remains.

**Existing specs (8):** `trust-kernel`, `persistence-port-boundary`, `db-connection-port`, `development-toolchain`, `io-domain-contract`, `io-ports-trust-contract`, `io-persistence-recovery-contract`, `io-delivery-quality-contract`. 264 tests pass. Strict TDD is active.

**What Increment 4 requires (architecture doc §15):** A single minimal, verifiable product conduct:

```
Founder → proposes low-risk work → classification + explicit grant →
independent review/approval → worker executes reversible sandbox action →
independent verification → Work + evidence persisted →
business receipt registers identity, authority, terminal result
```

Uses Company as scope, Delegation separate from Work (ADR-0002), internal worker process, and PostgreSQL as authoritative state. Does NOT require full company, semantic memory, multiple departments, or broad autonomy.

## Affected Areas

- `packages/trust-kernel/src/` — reusable as-is: `evaluate()`, `classify()`, `checkGrant()`, `checkSod()`, `captureEvidence()`, `issueReceipt()`, ports, fakes. The vertical CALLS these; it does not modify them.
- `packages/database/src/` — reusable: `PgDbConnection`, `DbConnection` port, evidence/audit adapters. The vertical adds NEW adapters for Company/Delegation/Work/Receipt tables following the same pattern.
- `packages/app/` — currently empty; will host the vertical's application layer (use cases, worker process, orchestration).
- **NEW packages needed:**
  - Domain types for Company/Delegation/Work/Receipt (pure, zero infra deps)
  - DeepSeek client adapter (driven adapter, OpenAI SDK dependency)
  - Worker process (orchestration use case)
- `openspec/specs/` — new capabilities will be added (company, delegation, work, deepseek-client, worker-process)
- `migrations/` — PG schema for new tables

## Approaches

### Approach A: Three Separate SDD Changes (Recommended)

Break the vertical into three independent SDD changes, each with its own full lifecycle (explore → propose → spec → design → tasks → apply → verify → archive):

#### Change 1: `domain-foundation`
Company + Delegation + Work + BusinessReceipt domain types, invariants, lifecycle state machines, repository ports, and PG-backed persistence.

- **What it builds:**
  - `Company` — minimal: `companyId`, `purpose` (scope/identity per architecture doc §4: "Company represents identity and scope for all capabilities")
  - `Delegation` — delegator, delegate, authority scope, budget, duration, escalation, revocation, expected outcome (ADR-0002 invariants)
  - `Work` — execution state, deliverable, acceptance, evidence refs, outcome (ADR-0002 invariants)
  - `BusinessReceipt` — links Work ID + Delegation authority + actor identity + policy + evidence + terminal state + artifact hash (architecture doc §9.8: "Business receipts are immutable and link Work, the Delegation or authority used, actor, policy, evidence, terminal state, and artifact version/hash")
  - Lifecycle state machines: Delegation (`draft → active → revoked | expired`), Work (`proposed → accepted → in_progress → completed → verified | rejected`)
  - Repository ports (following `EvidenceRepository`/`AuditRepository` pattern — generic, async, driver-free)
  - PG-backed adapters (following `PgEvidenceRepository` pattern — SQL in adapter, not domain)
  - Migration SQL for tables
- **Pros:** Foundation that everything references; no external deps (no LLM); fully TDD'd with unit tests; follows established patterns; independently deliverable
- **Cons:** No product value by itself — it's domain plumbing (but NECESSARY plumbing, not gratuitous)
- **Effort:** Medium (~350-400 lines)

#### Change 2: `deepseek-client`
DeepSeek V4 driven adapter behind a hexagonal port.

- **What it builds:**
  - Domain-side port: `LlmClient` interface (pure, zero SDK deps — like `DbConnection`)
  - DeepSeek implementation using `openai` npm package (`baseURL: https://api.deepseek.com`)
  - Model selection: `deepseek-v4-flash` (low risk), `deepseek-v4-pro` (high risk)
  - Thinking mode: `{ thinking: { type: "enabled" }, reasoning_effort: "high" }`
  - Tool calls support (for sandbox actions — OpenAI-compatible tool/function format)
  - Cost tracking: prompt/completion/cached tokens, cache hit/miss
  - API key from `DEEPSEEK_API_KEY` env var
  - In-memory fake for unit tests (returns canned responses)
- **Pros:** Isolated from domain; testable without real API (fake); follows hexagonal pattern; can use real API in integration tests
- **Cons:** Requires `openai` npm dependency; testing requires either fake or real API key
- **Effort:** Medium (~300-350 lines)

#### Change 3: `first-enterprise-vertical` (the actual vertical)
Worker process + sandbox execution + full vertical integration.

- **What it builds:**
  - Worker cycle implementation (architecture doc §13.1 — abbreviated for low-risk: wake → verify contract → classify risk → verify authority → compile context → select Flash → reason → produce plan → validate SOD → execute reversible action → verify → register episode → issue business receipt)
  - Sandbox action execution: DeepSeek tool calls that perform reversible actions (e.g., write a file, send a test message, create a document)
  - Vertical orchestration use case: wires founder proposal → trust kernel `evaluate()` → independent approval → worker execution → verification → Work persistence → business receipt issuance
  - End-to-end integration test: full flow against real PostgreSQL
- **Pros:** Delivers the actual product vertical; integrates all prior work; produces verifiable evidence
- **Cons:** Most complex slice; depends on changes 1 and 2; integration testing requires all components
- **Effort:** High (~350-400 lines)

**Dependencies:** Change 1 and Change 2 are independent — they can be developed in parallel. Change 3 depends on both.

---

### Approach B: Single Large SDD Change

Implement the entire vertical as one SDD change with multiple slices (chained PRs).

- **Pros:** Single spec/design covering the whole vertical; no inter-change coordination
- **Cons:** Very large (1000+ lines across all slices); high risk of scope drift (what happened with `first-vertical-flow`); harder to review; violates 400-line review budget per unit; harder to verify incrementally
- **Effort:** Very High

---

### Approach C: Domain + Vertical (Two Changes)

Skip the separate DeepSeek change — inline the client into the vertical change.

- **Pros:** Fewer changes to coordinate; DeepSeek client is only used by the worker anyway
- **Cons:** The vertical change becomes larger; mixing LLM adapter with orchestration violates single responsibility; harder to test the DeepSeek adapter in isolation
- **Effort:** Medium (domain) + High (vertical+deepseek)

---

## Recommendation

**Approach A — Three Separate SDD Changes.**

Rationale:
1. **Each change delivers coherent, verifiable value** — domain types + persistence, LLM adapter, and vertical integration are each complete units.
2. **Stays within the 400-line review budget** — each change is independently reviewable.
3. **Follows established patterns** — the domain change mirrors the trust-kernel/database pattern; the DeepSeek change mirrors the DbConnection/port pattern.
4. **Enables incremental construction** — architecture doc principle 10: "The minimal company MUST run and produce evidence before autonomy grows."
5. **Prevents scope drift** — the #1 risk from the previous attempt. Each change has a narrow, clear scope.
6. **Parallelizable** — Changes 1 and 2 have no dependency on each other and can proceed in parallel.

**Build order:** Change 1 (`domain-foundation`) → Change 2 (`deepseek-client`) → Change 3 (`first-enterprise-vertical`).

**The FIRST SDD change to tackle is `domain-foundation`** because:
- It is the foundation: Delegation, Work, and Company are referenced by every other change.
- It has zero external dependencies (no LLM API, no network).
- It follows the exact pattern already proven in `packages/trust-kernel/` and `packages/database/`.
- It can be fully TDD'd with pure unit tests and PG integration tests.
- It delivers durable business objects ready for the worker process.

## Risks

1. **Over-architecting the domain types** — Architecture doc risk #1. Company must be minimal (ID + purpose), NOT a full organizational hierarchy. Delegation and Work must have only the fields ADR-0002 requires. Resist adding fields "we might need later."
2. **Scope drift into infrastructure** — The previous `first-vertical-flow` attempt drifted into plumbing. The domain change MUST produce business objects with lifecycle semantics, not just CRUD repositories.
3. **DeepSeek API coupling in domain** — The `LlmClient` port MUST be defined in the domain layer with zero SDK imports, exactly like `DbConnection`. The `openai` package lives ONLY in the adapter.
4. **Business receipt vs honest receipt confusion** — The trust kernel's `UnsignedInMemoryReceipt` is a trust-evaluation artifact (unsigned, non-persistent). The vertical's `BusinessReceipt` is a business record (immutable, persisted, links Work + Delegation + identity + terminal result + artifact hash). They are DIFFERENT types with DIFFERENT purposes.
5. **SOD for low-risk vertical** — ADR-0003 allows function combination for low-risk, but "no principal may self-approve or self-verify." The vertical must use DISTINCT principals for proposer/approver/verifier even though functions may combine.
6. **Thinking mode `reasoning_content` passthrough** — When using DeepSeek tool calls in thinking mode, `reasoning_content` MUST be passed back to the API in all subsequent turns (DeepSeek docs). Forgetting this produces 400 errors.
7. **KV cache prefix stability** — Architecture doc §7.2 mandates canonical context ordering. The worker's context compilation MUST place stable prefixes (protocol, constitution, policies, company, role) before dynamic suffix (memory, work, evidence, tool results). No dates, IDs, or nonces in the prefix.
8. **400-line budget per change** — The domain foundation with types, validation, ports, adapters, and tests may approach the budget. If it exceeds, split into `domain-types` (types + invariants + ports + fakes) and `domain-persistence` (PG adapters + migrations + integration tests).

## Ready for Proposal

**Yes.** The orchestrator should proceed to `sdd-propose` for the **`domain-foundation`** change. The proposal should define:

- **Intent:** Build Company, Delegation, Work, and BusinessReceipt domain types with lifecycle invariants (ADR-0001/0002/0003), repository ports, and PG-backed persistence — the durable business object foundation for the first enterprise vertical.
- **Scope:** Pure domain types + validation + state machines + async repository ports + PG-backed adapters + migrations. NO LLM, NO worker process, NO orchestration.
- **Rollback:** Delete the new package(s), drop the new tables, remove migrations. No existing code is modified.

The `deepseek-client` and `first-enterprise-vertical` changes will follow as separate proposals.
