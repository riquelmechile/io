# Apply Progress: Cold-Start Discovery — Phase 1 (tasks 1.1–1.3)

- **Change**: `cold-start-discovery`
- **Batch**: Phase 1, tasks 1.1–1.3 (pure event builder)
- **Work unit**: `phase-1-pure-event-builder`
- **Correction**: `phase-1-evidence-gate-correction` (evidence-only rerun; no source changes) — gate token `sha256:7476c6cc011fc758628c664641edf2ffe8f17400c0c9a31de43a1ac5321dcf55`, added lines ≤ 40
- **Attempt token**: `sha256:6c1925976087c727d8cc454695dadfc5dcfe44f7fe545caaaa1034eada8be9c4` (parent-held; authenticated as same attempt, state `proceed`)
- **Changed lines (authored)**: 189 (additions; 0 deletions) — under the 200 runtime budget
- **Delivery**: single PR (Phase 1 slice); commit task 1.4 intentionally left unchecked — native review/receipt must precede commit
- **Mode**: Strict TDD (active; `openspec/config.yaml` strict_tdd + tdd true; runner `PATH=/data/node24/bin:$PATH pnpm test`)

## Completed Tasks

- [x] 1.1 [RED] Created `packages/business-domain/test/work-accepted-event.test.ts` (11 tests).
- [x] 1.2 [GREEN] Created `packages/business-domain/src/work-accepted-event.ts` — pure `buildWorkAcceptedEvent(work, now?)`, zero `@io/*`, per design §Interfaces (D3, D4).
- [x] 1.3 Exported `buildWorkAcceptedEvent` from `packages/business-domain/src/index.ts`.
- [ ] 1.4 Commit — pending native review/receipt (NOT done by design).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/business-domain/test/work-accepted-event.test.ts` | Unit | N/A (new file) | ✅ Written first — 13/13 failed (`buildWorkAcceptedEvent is not a function`, `ENOENT src/work-accepted-event.ts`) | ✅ 13/13 passed after 1.2+1.3 | ✅ 11 cases: shape, clocks, LLM-variant, different workId, optional clock, rebuild, derived non-time fields, grammar for hostile workIds, hb:/att: disjointness, exclusive source, zero `@io/*` | ✅ Clean (format-check converged, tsc clean, 0 lint findings) |
| 1.2 | (same test file) | Unit | N/A (new file) | N/A (RED from 1.1) | ✅ 13/13 passed (module created + export present) | ➖ covered by 1.1 cases | ✅ Clean |
| 1.3 | (same test file — imports from `../src/index.js`) | Unit | ✅ 330/330 baseline before index edit | N/A (RED from 1.1) | ✅ 13/13 passed after export | ➖ single export line | ✅ Clean |

## Work Unit Evidence

| Evidence | Required value |
|----------|----------------|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/work-accepted-event.test.ts` → `Test Files 1 passed (1); Tests 11 passed (11)` — smallest command proving this pure builder unit (final post-trim run; full run history below) |
| Runtime harness command/scenario and exact result | `N/A` — justified: no runtime boundary exists. Pure event builder: zero I/O, no process, no DB, no production caller yet (design D3/D4 pure function; D10 no caller). The focused Vitest command above is the bounded proof. |
| Rollback boundary | Revert `work-accepted-event.ts` + `work-accepted-event.test.ts` + the `index.ts` export line together; nothing else in the repo depends on the builder (no production caller — D10). |

## Check Gate (correction rerun) — `PATH=/data/node24/bin:$PATH pnpm check`

```
exit code: 0
$ pnpm run format-check && pnpm run typecheck && pnpm run build && pnpm run lint && pnpm run test
format-check → biome format .: Checked 209 files in 45ms. No fixes applied. (non-mutating)
typecheck    → tsc -p tsconfig.json: clean
build        → tsc -p tsconfig.build.json: clean
lint         → biome lint .: 0 errors (pre-existing warnings only in untouched files, e.g. parity.test.ts)
test         → vitest run: Test Files 99 passed | 3 skipped (102); Tests 1361 passed | 6 skipped (1367); Duration 26.71s
full log sha256: 30adcd8971004136000404c8e58475ca59f76c5fda66cfc352c850aedf88e619 (157 lines)
```

## Verification Evidence

### RED (1.1) — `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test/work-accepted-event.test.ts`
```
Test Files  1 failed (1)
     Tests  13 failed (13)
TypeError: buildWorkAcceptedEvent is not a function
Error: ENOENT: no such file or directory, open '.../src/work-accepted-event.ts'
```
Proven before any production code existed.

### GREEN (1.2 + 1.3) — same focused command
```
Test Files  1 passed (1)
     Tests  13 passed (13)
```
After creating `src/work-accepted-event.ts` and exporting from `src/index.ts`. (13 → 11 after trimming below the 200-line budget; all assertions retained, `expectTypeOf` merged into the shape test.)

### Final focused run (post-trim)
```
Test Files  1 passed (1)
     Tests  11 passed (11)
```

### Relevant suite — `PATH=/data/node24/bin:$PATH pnpm vitest run packages/business-domain/test`
```
Test Files  14 passed (14)
     Tests  341 passed (341)   # baseline 330 + 11 new; zero regressions
```

### Gates
- `pnpm run typecheck` — clean (tsc, no errors)
- `pnpm run format-check` — converged (checked 209 files, no fixes applied; one format fix applied to the test file BEFORE freeze, then re-verified convergent)
- `pnpm run lint` — 0 findings in changed files (9 pre-existing warnings in untouched files: parity.test.ts ×6, worker-reconcile.test.ts ×1, business-pg-roundtrip.integration.test.ts ×2)

## Contract Proof (spec business-event R1 + Idempotent Single Emission)

- `eventId = evt:acc:{workId}` determined SOLELY by `workId` — clocks, LLM-producible facts (description/proposer), companyId, version all excluded from identity.
- Non-time fields (`companyId`, `aggregateKind`, `aggregateId`, `eventType`, `source`, `payload`) deterministic from accepted Work facts (`payload = { workId, state, actor: proposer }`).
- `occurredAt = now?.() ?? Date.now()` — injected now, excluded from identity; optional clock defaults to ambient.
- `source: 'acceptor'` exclusive to this builder; namespace disjointness proven: hostile workIds (`att:acme:attempt-1`, `hb:deadbeef`) still yield `evt:acc:` segment; `evt:acc:`/`evt:hb:`/`evt:att:` segments are pairwise distinct.
- Zero `@io/*` imports — source imports only `./types.js` (type-only); asserted by the pure-surface test.

## Files Changed (Phase 1)

| File | Action | Lines | What |
|------|--------|-------|------|
| `packages/business-domain/src/work-accepted-event.ts` | Created | 34 | Pure `buildWorkAcceptedEvent(work, now?)` per design §Interfaces (D3, D4) |
| `packages/business-domain/test/work-accepted-event.test.ts` | Created | 154 | Identity determinism + grammar/ownership disjointness + pure-surface tests |
| `packages/business-domain/src/index.ts` | Modified | +1 | Export `buildWorkAcceptedEvent` |
| `openspec/changes/cold-start-discovery/tasks.md` | Modified | — | Checked 1.1–1.3; 1.4 stays unchecked (commit after native review) |

## Remaining Tasks

- [ ] 1.4 Commit `feat(business-domain): add pure work.accepted event builder with identity tests` — after native review/receipt.
- [ ] Phase 2: 2.1–2.4 (acceptWork widening + materiality)
- [ ] Phase 3: 3.1–3.4 (atomic PG acceptance seam + rollback proof)
- [ ] Phase 4: 4.1–4.3 (composition surface + real-path e2e)
- [ ] Phase 5: 5.1–5.3 (spec alignment, check-only gates, archive readiness)

## Deviations from Design

None — implementation matches design §Interfaces exactly (`eventId`, `payload` incl. `actor: work.proposer`, `occurredAt`, `source`).

## Rollback Boundary (work unit)

Revert `work-accepted-event.ts` + `work-accepted-event.test.ts` + the `index.ts` export line together; nothing else in the repo depends on the builder yet (no production caller — D10).
