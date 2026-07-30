# Apply Progress — Add Persistence Port Boundary (Evidence/Audit)

> Slice 1 of 2 (work_unit: `slice-1-ports-record-fakes-boundary`). Strict TDD.
> Implements Phases 1–4 ONLY. Phases 5–6 (pipeline wiring + final verify) are
> Slice 2. `ARTIFACT_STORE=hybrid` (OpenSpec canonical files + Engram audit trail).

## Status

- **Slice**: 1 of 2 — **COMPLETE** (Phases 1–4). Ready for review → Slice 2.
- **Mode**: Strict TDD (RED → GREEN → REFACTOR per behavior group).
- **Test runner**: `pnpm test` (vitest 4.1.10) on Node 24.18.1.
- **`pnpm check`**: **GREEN** (format-check → typecheck → build → lint → test).
- **Test counts**: before **145** → after **171** (+26). All 145 original tests
  remain green (no-repo pipeline path byte-identical; pipeline.ts/index.ts NOT touched).

## Phases Completed (Slice 1)

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

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.3 | `test/ports.test.ts` | Unit | ✅ 145/145 | ✅ typecheck failed (no `PersistentRecord` + unused `@ts-expect-error`) | ✅ 3 passed | ✅ 3 cases (literal+disclosure; coexist+literal types; cross-assign guard) | ✅ field order mirrors InMemoryRecord |
| 2.1–2.3 | `test/ports.test.ts` | Unit | ✅ 148/148 | ✅ typecheck failed (missing port types → implicit any) | ✅ 8 passed | ✅ round-trip + unknown-key + typed-session + audit order/immutability + purity×2 | ✅ generic defaults = PersistentRecord/unknown |
| 3.1–3.3 | `test/ports.test.ts` | Unit | ✅ 157/157 | ✅ typecheck failed (module `ports/fakes.js` not found) | ✅ 11 passed | ✅ evidence round-trip/overwrite/session + audit order/immutability/empty + purity + honesty×3 | ✅ shared `withAppended` helper |
| 4.1–4.3 | `test/boundary.test.ts` | Unit (approval) | ✅ 169/169 | ➖ Characterization: ports/ already covered by recursive scan after Ph 1–3; test PINS the universal-coverage property (no production code this phase) | ✅ +2 passed (23 total in file) | ✅ would-catch-forbidden-in-ports proves non-exemption | ✅ centralized `portsFiles` assertion |

> Phase 4 note: Strict-TDD approval/characterization test (per `strict-tdd.md`
> "Approval Testing"). The universal recursive scan + the ports files pre-exist by
> the time Phase 4 runs; no production code is written this phase (task 4.2). The
> test locks the D7 property so a future regression (exempting ports/ or adding a
> forbidden import there) is caught. The "would-catch" case genuinely exercises the
> detector logic.

## Work Unit Evidence (Slice 1)

| Evidence | Value |
|---|---|
| Focused test command + result | `pnpm test packages/trust-kernel/test/ports.test.ts packages/trust-kernel/test/boundary.test.ts` → 45 passed (22 ports + 23 boundary), exit 0 |
| Runtime harness command/scenario + result | N/A — pure in-memory types/adapters; no transport/daemon/app exists to exercise (`integration: false`) |
| Rollback boundary | Revert `packages/trust-kernel/src/ports/` (repositories.ts + fakes.ts); drop the `PersistentRecord` + `PersistentEvidence`/`PersistentAuditEntry` block from `src/model.ts`; revert the ports-present/would-catch additions in `test/boundary.test.ts`; delete `test/ports.test.ts`. `pipeline.ts`/`index.ts`/`package.json` are untouched, so the 145-test baseline is restored with zero behavior change. |

## Files Changed

| File | Action | Lines | What Was Done |
|------|--------|------:|---------------|
| `packages/trust-kernel/src/model.ts` | Modified | +32 | Added `PersistentRecord` (`persistent:true` + disclosure) + `PersistentEvidence`/`PersistentAuditEntry` aliases (D8) |
| `packages/trust-kernel/src/ports/repositories.ts` | Created | +58 | Generic `EvidenceRepository<R,S=unknown>`, `AuditRepository<R>`, `PersistenceOutcome`, `PERSISTENT_PORT_DISCLOSURE`; `import type` only (D3/D4) |
| `packages/trust-kernel/src/ports/fakes.ts` | Created | +66 | `InMemoryEvidenceRepository` (Map) + `InMemoryAuditRepository` (array, immutable); honest NON-durable disclosure (D6) |
| `packages/trust-kernel/test/boundary.test.ts` | Modified | +26 | Centralized ports-present assertion + would-catch-forbidden proof (D7) |
| `packages/trust-kernel/test/ports.test.ts` | Created | +338 | RED→GREEN proof: discriminant, ports, fakes, purity, honesty |

**Code-only authored delta: +520 / -0** (test-heavy: ~65% tests). pipeline.ts,
index.ts, and package.json are **untouched** (no-repo path byte-identical; zero deps).

## Deviations from Design

1. **Session/transaction context on `EvidenceRepository` (justified).** design.md's
   illustrative "Interfaces" block and its Open Question deferred the session param
   ("no session param this slice"). The **authoritative spec R7** states the port
   "MUST accept a session/transaction context," and **task 2.2** explicitly requires
   `EvidenceRepository<R, S = unknown>` with `save(record, session?)`. I followed the
   spec + task (the higher-authority artifacts) over the design's illustrative
   snippet. This supersedes/resolves the design's Open Question. No design DECISION
   (D1–D8) is violated. `AuditRepository<R>` has no session param (its requirement
   R16/Req 2 does not call for one, and task 2.2 specifies only `append`+`getLog`).

2. **Fakes expose a `disclosure` property.** D6 says "Fake supplies an honest
   disclosure." Implemented as a `readonly disclosure = PERSISTENT_PORT_DISCLOSURE`
   on each fake (fake-specific metadata, not part of the port interface) so the
   adapter honestly declares its NON-durable nature. Consistent with D6 intent.

3. **Phase 4 is a characterization test (no production code).** Per task 4.2; the
   recursive `listTsFiles` already covered `ports/` once Phases 1–3 created the
   files. Documented as an approval test, not a manufactured failure.

## Issues Found

None. All gates GREEN; no forbidden imports anywhere in `src/` (incl. `ports/`);
no real PG driver; no crypto/durable overclaim; no canonical extraction performed.

## Slice 2 Remaining Scope (Phases 5–6)

- **Phase 5 — Pipeline Wiring (Optional Repo Routing, Req 5):** add optional
  `evidenceRepository?`/`auditRepository?` to `EvaluationInput`; in `finalize()`
  build a `PersistentRecord` and route through the ports when present, setting
  `result.persistence`; add optional `persistence?: PersistenceOutcome` to
  `EvaluationResult`; export ports + fakes + `PersistentRecord` from `index.ts`.
  No-repo path MUST stay byte-identical (all 145+ tests green).
- **Phase 6 — Final Verification & Exclusion Guard (Req 6):** full `pnpm check`
  GREEN; exclusion guard (no forbidden import incl. `ports/`; no PG driver/crypto
  overclaim/canonical extraction); confirm deferred items remain deferred.

## Workload / PR Boundary

- **Strategy**: auto-chain / stacked-to-main (decided by orchestrator).
- **Current work unit**: slice-1-ports-record-fakes-boundary (Phases 1–4).
- **Boundary**: starts from the persistence-free kernel (145 tests); ends with the
  port boundary defined + proven (171 tests), pipeline behavior UNCHANGED.
- **Review budget**: code-only +520 (≈65% tests); cohesive single work unit —
  splitting further would break the PersistentRecord↔port↔fake coherence. Flagged
  as over the 400-line budget; the auto-chain strategy already anticipates a
  multi-slice chain (Slice 2 = Phases 5–6 lands as a stacked PR on top).
