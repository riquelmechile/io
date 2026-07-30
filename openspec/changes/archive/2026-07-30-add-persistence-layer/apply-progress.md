# Apply Progress — Add Persistence Port Boundary (Evidence/Audit)

> 2-slice change, auto-chain / stacked-to-main. Strict TDD. `ARTIFACT_STORE=hybrid`
> (OpenSpec canonical files + Engram cross-session audit trail).
>
> - **Slice 1** (`slice-1-ports-record-fakes-boundary`, Phases 1–4): COMPLETE,
>   committed `3c9a13c`, pushed.
> - **Slice 2** (`slice-2-pipeline-wiring-verify`, Phases 5–6): COMPLETE, ready
>   for native review → delivery.

## Status

- **Full change**: **COMPLETE** (Phases 1–6, both slices). Ready for verify/review.
- **Mode**: Strict TDD (RED → GREEN → REFACTOR per behavior group).
- **Test runner**: `pnpm test` (vitest 4.1.10) on Node 24.18.1.
- **`pnpm check`**: **GREEN** (format-check → typecheck → build → lint → test).
- **Test counts**: 145 (pre-change) → 171 (Slice 1) → **184** (Slice 2). All 145
  original tests remain green throughout; the no-repo pipeline path is
  byte-identical (no `persistence` field when no repository is injected).

---

## Slice 1 — Phases 1–4 (COMPLETE, committed 3c9a13c)

### Phase 1 — PersistentRecord & Honesty Discriminant (Req 3) ✅
- `PersistentRecord` + `PersistentEvidence`/`PersistentAuditEntry` aliases added to
  `src/model.ts`. Field order mirrors `InMemoryRecord` exactly; diverges only on the
  `persistent: true` literal + `disclosure` (D8). tsc rejects cross-assignment via
  the literal (proven by `@ts-expect-error` + `expectTypeOf` literal assertions).

### Phase 2 — Repository Port Interfaces (Req 1, 2, 6) ✅
- Created `src/ports/repositories.ts`: `EvidenceRepository<R = PersistentRecord,
  S = unknown>` (`save(record, session?)` + `get(actionId)`), `AuditRepository<R>`
  (`append` + `getLog`), `PersistenceOutcome`, `PERSISTENT_PORT_DISCLOSURE`.
  `import type` only, relative kernel imports (D3/D4) → zero runtime deps.

### Phase 3 — In-Memory Fake Adapters (Req 4, D6) ✅
- Created `src/ports/fakes.ts`: `InMemoryEvidenceRepository` (Map-backed) +
  `InMemoryAuditRepository` (array-backed, immutable `withAppended` helper). Each
  fake exposes an honest `disclosure = PERSISTENT_PORT_DISCLOSURE` that is NON-durable
  (does NOT claim "durable in PostgreSQL"). Accepts the R7 session context.

### Phase 4 — Boundary Detector: Universal Scan of ports/ (Req 6, D7) ✅
- `test/boundary.test.ts` asserts `ports/*.ts` ARE discovered by the recursive
  `listTsFiles({recursive:true})` scan (ports/ is NOT exempted — D7) and that a
  forbidden import inside a ports file WOULD be caught (ports pass on merit). The
  existing per-file loop + zero-deps `package.json` assertions stay green.

### Slice 1 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.3 | `test/ports.test.ts` | Unit | ✅ 145/145 | ✅ typecheck failed (no `PersistentRecord`) | ✅ 3 passed | ✅ 3 cases | ✅ field order mirrors InMemoryRecord |
| 2.1–2.3 | `test/ports.test.ts` | Unit | ✅ 148/148 | ✅ typecheck failed (missing port types) | ✅ 8 passed | ✅ round-trip + session + audit order/immutability + purity×2 | ✅ generic defaults |
| 3.1–3.3 | `test/ports.test.ts` | Unit | ✅ 157/157 | ✅ typecheck failed (module not found) | ✅ 11 passed | ✅ evidence round-trip/overwrite + audit order/immutability + purity + honesty×3 | ✅ shared `withAppended` |
| 4.1–4.3 | `test/boundary.test.ts` | Unit (approval) | ✅ 169/169 | ➖ Characterization: ports/ already covered | ✅ +2 passed | ✅ would-catch-forbidden proves non-exemption | ✅ centralized `portsFiles` |

### Slice 1 Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/trust-kernel/src/model.ts` | Modified | Added `PersistentRecord` + aliases (D8) |
| `packages/trust-kernel/src/ports/repositories.ts` | Created | Generic port interfaces + `PersistenceOutcome` + disclosure (D3/D4) |
| `packages/trust-kernel/src/ports/fakes.ts` | Created | `InMemoryEvidenceRepository` + `InMemoryAuditRepository` (D6) |
| `packages/trust-kernel/test/boundary.test.ts` | Modified | ports-present assertion + would-catch proof (D7) |
| `packages/trust-kernel/test/ports.test.ts` | Created | RED→GREEN: discriminant, ports, fakes, purity, honesty |

### Slice 1 Deviations from Design

1. **Session/transaction context on `EvidenceRepository`** (justified): spec R7 +
   task 2.2 REQUIRE it (`S = unknown`); design's illustrative snippet deferred it.
   Followed spec + task (higher authority). `AuditRepository<R>` has no session
   param (R16/Req 2 does not call for one).
2. **Fakes expose a `disclosure` property** (D6 intent): adapter honestly declares
   its NON-durable nature.
3. **Phase 4 is a characterization test** (no production code): per task 4.2.

---

## Slice 2 — Phases 5–6 (COMPLETE, ready for review)

### Phase 5 — Pipeline Wiring: Optional Repo Routing (Req 5, D1/D5/D6) ✅

- **5.1 RED** `test/ports.test.ts` (+256): 13 new tests across two describe blocks.
  - *No-repo byte-identity (D1, approval/characterization)*: no `persistence`
    field; `evidence`/`auditLog` carry `InMemoryRecord` `persistent:false`; full
    evidence object + decision + steps + receipt asserted identical; DENY path
    also byte-identical.
  - *Repo-present routing (D5, true RED)*: `evidence`/`auditLog` STILL carry the
    captured `InMemoryRecord` (`persistent:false`); `persistence.evidenceRecord`/
    `auditRecord` carry the routed `PersistentRecord` (`persistent:true`); evidence
    saved via the evidence port; audit appended via the audit port; prior audit log
    never mutated; partial injection (evidence-only / audit-only); routed record
    mirrors captured core fields (D8); DENY also routes.
  - **RED evidence**: `pnpm vitest run ports.test.ts` → 8 routing tests FAIL
    (`result.persistence` undefined); `pnpm typecheck` → 18 type errors
    (`evidenceRepository`/`auditRepository` not on `EvaluationInput`,
    `persistence` not on `EvaluationResult`).
- **5.2 GREEN**: `pipeline.ts` — added optional `evidenceRepository?`/
  `auditRepository?` to `EvaluationInput`, optional `persistence?` to
  `EvaluationResult`, and `routeThroughPorts()` in `finalize()` that builds a
  `PersistentRecord` and routes through the ports when present (returns `undefined`
  when absent → no `persistence` key → byte-identical). `index.ts` — exported
  `EvidenceRepository`/`AuditRepository`/`PersistenceOutcome` (types),
  `PERSISTENT_PORT_DISCLOSURE` (value), fakes, and `PersistentRecord` + aliases.
- **5.3 REFACTOR**: `buildPersistentRecord()` extracted as a pure helper mirroring
  `buildDisclosedRecord` field order (D8); `routeThroughPorts()` is a separate
  concern from record-building. `pnpm check` GREEN.

### Phase 6 — Final Verification & Exclusion Guard (Req 6) ✅

- **6.1** Full `pnpm check` GREEN: format-check → typecheck → build → lint →
  **184 tests passed** (10 files). All 171 Slice-1 tests + 145 originals stay
  green; no-repo byte-identity intact.
- **6.2** Exclusion guard: `rg` confirms ZERO non-relative imports in `src/`
  (incl. `ports/`); ZERO pg/postgres/prisma/typeorm/crypto/express/langchain/
  langgraph references; `package.json` stays zero-deps (verified runtime).
  `ports/` is a forward extraction signal ONLY; kernel stays excluded from the
  8+12+10=30 canonical partition (boundary test green).
- **6.3** Deferred items confirmed deferred: real PG storage (only in-memory
  fakes), canonical extraction into organization/policy/approvals/evidence/
  receipts/audit (kernel transitional), other aggregate ports R1–R6/R8–R15/R17
  (only R7 + R16 defined), cryptographic receipts (still unsigned), real approval
  chains (still no-op pass-through).

### Slice 2 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `test/ports.test.ts` | Unit | ✅ 171/171 | ✅ 8 runtime FAIL (persistence undefined) + 18 typecheck errors | ✅ 35 passed | ✅ 13 cases (byte-identity×2 ALLOW+DENY; routing×6 incl. partial injection; D8 mirror; DENY routing) | ➖ see 5.3 |
| 5.2 | `test/ports.test.ts` | Unit | ✅ 171/171 | (covered by 5.1) | ✅ 35 passed; typecheck clean | ✅ partial-injection evidence-only/audit-only forces conditional routing | ➖ see 5.3 |
| 5.3 | `test/ports.test.ts` | Unit | ✅ 184/184 | (refactor — no new test) | ✅ 184 passed | ➖ refactor only | ✅ `buildPersistentRecord` extracted; `routeThroughPorts` separated |
| 6.1–6.3 | full suite | Unit (guard) | ✅ 184/184 | ➖ verification/guard — no new test | ✅ `pnpm check` GREEN; exclusion scan clean | ✅ no-repo byte-identity + zero-deps + zero forbidden imports | ➖ N/A |

### Slice 2 Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command + result | `pnpm vitest run packages/trust-kernel/test/ports.test.ts` → 35 passed, exit 0 |
| Runtime harness command/scenario + result | N/A — pure in-memory pipeline + ports; no transport/daemon/app exists to exercise (`integration: false`) |
| Rollback boundary | Revert `pipeline.ts` optional repo fields + `finalize()` routing + `routeThroughPorts`/`buildPersistentRecord` + `persistence` on `EvaluationResult`; revert `index.ts` port/persistent exports. `ports/` files, `model.ts`, `boundary.test.ts`, and `package.json` are untouched by Slice 2, so reverting restores the 171-test Slice-1 state with zero behavior change. |

### Slice 2 Files Changed

| File | Action | Lines | What Was Done |
|------|--------|------:|---------------|
| `packages/trust-kernel/src/pipeline.ts` | Modified | +93 / -3 | Optional `evidenceRepository?`/`auditRepository?` on `EvaluationInput`; optional `persistence?` on `EvaluationResult`; `routeThroughPorts()` + `buildPersistentRecord()` in `finalize()` (D1/D5/D6/D8) |
| `packages/trust-kernel/src/index.ts` | Modified | +15 | Exported ports types, `PERSISTENT_PORT_DISCLOSURE`, fakes, `PersistentRecord` + aliases |
| `packages/trust-kernel/test/ports.test.ts` | Modified | +256 | 13 RED→GREEN pipeline-wiring tests (byte-identity + routing + partial + D8 + DENY) |

**Slice 2 code-only authored delta: +364 / -3** (≈70% tests). `package.json`,
`model.ts`, `ports/*.ts`, and `boundary.test.ts` are **untouched** by Slice 2.

### Slice 2 Deviations from Design

None — implementation matches design D1–D8 exactly. The `buildPersistentRecord`
helper mirrors `evidence.ts`'s private `buildDisclosedRecord` field order (D8) and
diverges only on the `persistent: true` literal + `PERSISTENT_PORT_DISCLOSURE`
(D6 path marker). The no-repo path returns a result object with NO `persistence`
key (conditional spread), ensuring true byte-identity rather than a
`persistence: undefined` field.

### Slice 2 Issues Found

None. All gates GREEN; no forbidden imports anywhere in `src/` (incl. `ports/`);
no real PG driver; no crypto/durable overclaim; no canonical extraction performed.

---

## Workload / PR Boundary

- **Strategy**: auto-chain / stacked-to-main.
- **Slice 1** (PR 1 → main): port boundary defined + proven (171 tests), pipeline
  UNCHANGED. Committed `3c9a13c`.
- **Slice 2** (PR 2 → main, stacked on Slice 1): optional repo routing +
  `PersistenceOutcome` consumer contract + exclusion guard (184 tests).
  Boundary: starts from the Slice-1 port boundary; ends with the full change
  complete — pipeline accepts optional repos, routes durable-capable records, and
  the no-repo path stays byte-identical.
- **Review budget (Slice 2)**: +364/-3 authored; cohesive single work unit (the
  wiring + its proof are inseparable).

## Full Change Summary

The persistence port boundary is complete: `PersistentRecord` honesty discriminant,
generic `EvidenceRepository`/`AuditRepository` port interfaces, in-memory fakes,
universal boundary proof, and backward-compatible optional pipeline routing — all
dependency-free, all under `integration: false`, with the no-repo path provably
byte-identical to the persistence-free kernel. Real PostgreSQL, canonical
extraction, other aggregate ports, crypto receipts, and real approval chains
remain explicitly deferred.
