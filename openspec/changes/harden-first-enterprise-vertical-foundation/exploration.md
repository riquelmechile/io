# Exploration: Harden First Enterprise Vertical Foundation

**Change:** `harden-first-enterprise-vertical-foundation` · Project: io · Hybrid artifact store

## Current State

Three packages are live and green (411 tests pass, 20 PG-integration tests skipped without a container):

- **`packages/trust-kernel/`** — pure TS, zero infra deps. 16-step `evaluate()` pipeline (10 enforced gates + 6 deferred no-op pass-throughs). Exposes `classify()`, `checkGrant()`, `checkSod()`, `resolveActiveIdentity()`, optional async evidence/audit repository injection.
- **`packages/business-domain/`** — pure domain types (`Company`, `Delegation`, `Work`, `BusinessReceipt`), state-machine guards (`canTransitionWork`, `canTransitionDelegation`), async repository ports (`save`/`get` only), in-memory fakes.
- **`packages/database/`** — `DbConnection` port (`execute`/`query` only), `PgDbConnection` over `pg.Pool`, evidence/audit/business adapters, two SQL schema files.

**What the foundation LACKS (verified against real code):** real SoD wiring to Work transitions, window-active checks for future-start grants, `companyId` on business aggregates, UNIQUE constraints, `transaction(fn)`, optimistic concurrency, idempotency pre-effect, runtime input validation, and transition use cases.

---

## Affected Areas — Gap Analysis by Hardening Item

### 1.1 Autoridad (Authority)

**SoD enforcement — `packages/trust-kernel/src/sod.ts`:**

`checkSod()` enforces `ABSOLUTE_PAIRS` at every tier:
```ts
const ABSOLUTE_PAIRS = [['approver','executor'], ['verifier','executor']];
```

| Required invariant (ADR-0003 §13.3) | Currently enforced? |
|---|---|
| `executor ≠ verifier` (no self-verification) | YES — `['verifier','executor']` |
| `proposer ≠ approver` (no self-approval) | **NO** — missing from `ABSOLUTE_PAIRS` |

At low-risk with `allowsLowCombination: true`, `requiredDistinctRoles` returns `null`, so ONLY `ABSOLUTE_PAIRS` apply. A principal who is both `proposer` and `approver` gets ALLOWED — directly violating "nadie se autoaprueba." The existing `['approver','executor']` pair is an extra constraint (harmless but not the one the spec names).

**Critical structural gap:** SoD is enforced ONLY on the kernel-action evaluation, checking `sodAssignments` passed structurally in `EvaluationInput`. It is NOT wired to Work state transitions. The business domain has **no use cases** (`propose`, `accept`, `start`, `complete`, `verify`, `reject`) — so there is no code path that actually enforces `proposer ≠ approver` or `executor ≠ verifier` when Work changes state. State changes happen via raw `workRepository.save(work)`.

**Window active — `grant.ts:74` and `identity.ts:55`:**

`isGrantActive()`:
```ts
function isGrantActive(grant, now) {
  return validateGrant(grant).valid && grant.revoked !== true && grant.expiry > now;
}
```
`resolveActiveIdentity()`:
```ts
return (assignment.expiry ?? now) > now;
```

Grep confirmed: **no comparison of `start` to `now` exists anywhere in the kernel.** A grant or temp assignment with a future `start` is treated as active. `expiryGate` (pipeline step 12) checks `grant.expiry <= input.now` and `grant.revoked` — but never `grant.start > input.now`. No `isWindowActive(start, now, expiry)` helper exists. `Delegation` has `validFrom`/`validUntil` but no activation-window check.

### 1.2 Company scope

`Company` is correctly minimal: `{companyId, purpose}` ✓.

**Gap:** `Work`, `Delegation`, and `BusinessReceipt` types have **no `companyId` field**. All operations are tenant-unscoped. `PgWorkRepository.get(workId)` returns work regardless of company. No repository method rejects or filters by `companyId`.

### 1.3 Persistencia durable

**SQL (`packages/database/sql/002_create_business_tables.sql`):** All four tables use `SERIAL PRIMARY KEY` + non-unique indexes. **No UNIQUE constraints** on `company_id`, `delegation_id`, `work_id`, or `receipt_id`. Duplicate business-key inserts are silently accepted.

`business_receipt` has no `terminal_event_id` column — `UNIQUE (work_id, terminal_event_id)` cannot exist.

**`DbConnection` (`connection.ts:40`):** Only `execute(sql, params)` and `query<T>(sql, params)`. **No `transaction(fn)` method.** The architecture doc §9.8 mandates single-aggregate atomicity (Work + evidence + idempotency-close + receipt in one transaction), which is impossible without it.

**Use cases:** `business-domain/src/` has `types.ts`, `transitions.ts`, `ports/repositories.ts`, `ports/fakes.ts`, `index.ts`. **No use-case layer.** `save(object)` is the only way to mutate Work state — there is no command-driven transition path that validates authority, checks SoD, enforces company scope, and closes atomically.

**`evidenceId`:** The in-memory `Evidence` is an alias for `InMemoryRecord` with no stable external `evidenceId`. `BusinessReceipt.evidenceRefs` is `readonly string[]` but nothing produces stable evidence IDs the receipt can reference.

### 1.4 Concurrency

`Work` has **no `version` field** (no `etag`, no `revision`, no `leaseToken`). `PgWorkRepository.save()` is a blind `INSERT` — it does not update existing rows, does not compare-and-set, and does not detect concurrent mutations. Last writer wins silently. No fencing tokens, no leasing.

### 1.5 Idempotency pre-efecto

**Nothing exists.** No idempotency-key store, no attempt journal, no pre-effect registration. The architecture doc §9.8 describes idempotency keys serialized per company+operation, atomic effect+terminal-result confirmation, and `UNKNOWN` reconciliation — all absent. The six deferred pipeline steps (`delegation`, `budget`, `approvals`, etc.) are documented no-ops; none implement an attempt journal.

### 1.6 Validación runtime

The trust kernel validates grants/assignments structurally. But the business domain's transition guards (`canTransitionWork`) are pure functions with **no runtime validation at the use-case boundary** — there are no use cases to guard. No validation on command input shape, no validation on PG rows read back, no validation on LLM-produced plans.

### 1.7 Higiene de estado

README and `pnpm-workspace.yaml` should be checked against the actual 5-package layout (`app`, `business-domain`, `database`, `llm-client`, `trust-kernel`). CI needs a Postgres service so the 20 skipped integration tests run instead of being silently skipped.

---

## Approaches

### Approach 1: Single SDD change, delivered as 3 chained PRs (Recommended)

One proposal/spec/design covering all 7 areas; `sdd-tasks` sequences the work into 3 review-sized PR slices along the natural dependency seam. Each slice is independently GREEN and reviewable.

| PR Slice | Scope | Capabilities touched | Why this order |
|---|---|---|---|
| **Slice A — Authority & Scope** | SoD fix (`proposer≠approver`), `isWindowActive()`, future-start rejection, `companyId` on all 3 aggregates + scoped repos | `trust-kernel`, `company-identity`, `delegation-lifecycle`, `work-lifecycle` | Foundation invariants first; no persistence dependency; fixes a real correctness bug (self-approval) |
| **Slice B — Durable Persistence & Concurrency** | `DbConnection.transaction(fn)`, UNIQUE constraints, Work versioning (optimistic CAS), `terminal_event_id` + `UNIQUE(work_id, terminal_event_id)` | `db-connection-port`, `business-receipt`, `work-lifecycle` | Depends on Slice A's `companyId`; enables atomic transitions |
| **Slice C — Use Cases, Idempotency & Runtime Validation** | Transition use cases (`propose`/`accept`/`start`/`complete`/`verify`/`reject`), idempotency-key store + attempt journal, runtime guards, CI Postgres | `work-lifecycle`, `delegation-lifecycle`, new `runtime-validation` | Depends on A + B; consumes transactions + concurrency; produces the safe command surface the vertical calls |

- **Pros:** One coherent design; clear dependency ordering; each slice ≤400 changed lines; strict TDD per slice; no cross-change coordination overhead
- **Cons:** Single design must reason about all 7 areas upfront; slice B + C are the largest
- **Effort:** High overall, but each PR is Medium

### Approach 2: Three separate SDD changes (mirroring the slices)

Each slice becomes its own explore → propose → spec → design → tasks → apply → verify → archive cycle.

- **Pros:** Maximum isolation; each change independently archivable
- **Cons:** 3× the SDD ceremony; coordination of `work-lifecycle` spec across 3 delta sets; slower to reach a safe foundation; the SoD bug in Slice A is urgent and shouldn't wait for full ceremony
- **Effort:** High (ceremony overhead)

### Approach 3: Fix-First then Harden (2 changes)

Ship the SoD self-approval bug + window-active fix as an immediate small change (it's a correctness bug), then do the remaining 6 areas as one larger hardening change.

- **Pros:** Fastest path to fixing the active correctness violation
- **Cons:** The SoD fix without use-case wiring is incomplete (the kernel check is structural; without use cases it still isn't enforced at transition time); splits a coherent design artificially
- **Effort:** Low (fix) + High (harden)

---

## Recommendation

**Approach 1 — Single SDD change, 3 chained PRs.**

Rationale:
1. The 7 areas are tightly coupled — `companyId` (1.2) is needed by UNIQUE (1.3), transactions (1.3) are needed by use cases (1.3) and idempotency (1.5), Work versioning (1.4) is needed by use cases (1.3). Splitting across changes creates spec-coordination pain.
2. The 400-line review budget is respected by slicing at the PR level, not the change level.
3. Slice A fixes the real SoD correctness bug first — no waiting for full ceremony.
4. One design document can reason about the transaction boundary, concurrency model, and idempotency semantics coherently (architecture doc §9.8 treats these as one consistency problem).
5. Strict TDD is preserved per slice: each PR ships RED → GREEN.

**Design questions for the design phase:**
- How to add `transaction(fn)` to `DbConnection` without breaking the kernel boundary? The port stays driver-free; `transaction(fn)` takes a `DbTx` (same `execute`/`query` surface). The `InMemoryDbConnection` fake wraps `fn` in a no-op boundary; `PgDbConnection` wraps it in `BEGIN/COMMIT/ROLLBACK`.
- Where do use cases live? A new `business-domain/src/use-cases/` layer (or `packages/app/`). Use cases receive scoped ports + `DbConnection`, call `transaction()` to transition Work atomically.
- How to version Work for optimistic concurrency? Add `version: number` to `Work`; repos compare-and-set (`UPDATE ... SET version = version + 1 WHERE work_id = $1 AND version = $expected`); mismatch → explicit conflict error.

---

## Risks

1. **Breaking the trust-kernel boundary test** — Adding use-case logic must not import drivers into the kernel. The fix to `sod.ts` ABSOLUTE_PAIRS and the `isWindowActive()` helper are additive and stay pure-TS. Existing 411 tests must stay GREEN. The `expiryGate` start-check is additive (test fixtures have `start < now`).
2. **SoD fix changes kernel behavior** — Adding `['proposer','approver']` to `ABSOLUTE_PAIRS` is additive: existing test fixtures use distinct proposer/approver. But any downstream code that relied on self-approval at low risk will break — that is the INTENDED behavior change.
3. **`companyId` addition is a breaking domain-type change** — All aggregate constructors, adapters, fakes, and tests must add the field. Migration of existing PG rows is N/A (greenfield, no production data). SQL tables gain the column.
4. **Transaction semantics in the in-memory fake** — The fake must simulate atomicity (all-or-nothing) so use-case tests catch partial-failure. A naive no-op wrapper hides bugs.
5. **Optimistic concurrency on INSERT vs UPDATE** — `PgWorkRepository.save()` currently does blind `INSERT`. Transition use cases need `INSERT ... ON CONFLICT` or separate `insert`/`updateWithVersion` methods. The repository port surface must change.
6. **Idempotency scope** — Per architecture doc §9.8, idempotency keys are serialized per company+operation. The key store must be company-scoped from the start to match.
7. **`evidenceId` stability** — Producing stable evidence IDs requires the evidence record to carry an explicit ID, not just reuse `actionId`. The `BusinessReceipt.evidenceRefs` contract depends on this.

---

## Ready for Proposal

**Yes.** The gap analysis is complete and grounded in real code. The orchestrator should proceed to `sdd-propose` with:
- **Intent:** Harden the domain foundation with real SoD, company scope, durable persistence, concurrency, idempotency, and runtime validation.
- **Scope:** All 7 areas; delivered as 3 chained PRs (authority/scope → persistence/concurrency → use-cases/idempotency/validation).
- **Capabilities needing MODIFIED deltas:** `trust-kernel`, `company-identity`, `delegation-lifecycle`, `work-lifecycle`, `business-receipt`, `db-connection-port`. **NEW capability:** `runtime-validation`.
