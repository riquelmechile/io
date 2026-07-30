# Archive Report — Add PostgreSQL Adapter (Injectable DbConnection)

> **SDD terminal record.** This report describes the state of the change AT CLOSE
> (final-state authority). `apply-progress` and `verify-report` are intermediate
> snapshots; where they disagreed with the final state, the final state is
> reported here and the snapshot claim is attributed to its source and time.

## Change

- **Name**: `add-postgres-adapter`
- **Capability**: `db-connection-port` — injectable synchronous DbConnection + PG-shaped evidence/audit adapters
- **Roadmap increment**: Increment 2 — PERSISTENCE, second slice (the adapter side of the port boundary `add-persistence-layer` closed)
- **Delivery strategy**: auto-chain / stacked-to-main (single slice, single PR)
- **Artifact store**: `hybrid` (OpenSpec canonical files + Engram cross-session audit trail)
- **Archived to**: `openspec/changes/archive/2026-07-30-add-postgres-adapter/`
- **Date**: 2026-07-30

## Final State

| Metric | Final value |
|--------|-------------|
| Implementation | **COMPLETE** — all 6 phases, single slice (commit `4ed3a28`, pushed) |
| Tests | **233 passed / 0 failed / 0 skipped** across 15 test files (49 new database + kernel unchanged) |
| `pnpm check` | **GREEN** (format-check → typecheck → build → lint → test); build exit 0 |
| Verify verdict | **PASS** — 5/5 requirements, 8/8 scenarios COMPLIANT |
| Critical findings | **0** |
| Warnings | **3** (all non-blocking, see below) |
| Suggestions | 1 non-blocking (workload vs. 400-line budget) |
| Tasks | 28/28 complete (persisted `tasks.md` has zero unchecked items) |

### Commits (pushed)

| Slice | Commit | Phases | Contents |
|-------|--------|--------|----------|
| 1 | `4ed3a28` | 1–6 | `packages/database/`: `DbConnection` port + `DbRow`, `PgEvidenceRepository` (R7), `PgAuditRepository` (R16), `InMemoryDbConnection` fake, shared `sql.ts` builder, local `disclosure.ts`, boundary guards, exports, README, tsconfig/biome wiring, 49 tests |

## Gate Authority — Native Review (HIGHEST RANK)

Archive requires `reviewGate.result: allow` (or `disabled/unmanaged` when ungoverned).
**This slice has an APPROVED native review.** The real authority is the native review
CAS in `.git/gentle-ai/` (Git common-dir), validated by
`gentle-ai review validate --gate=post-apply`, NOT the OpenSpec file layout.

- **`gentle-ai review validate --gate=post-apply`** →
  `result: "allow"`, `allowed: true`, `action: "continue"`,
  `reason: "authoritative transaction, current repository target, and content-bound
  artifacts match"`, `base_relationship_valid: true`.
  - lineage: `review-f60b1328d3086578`, generation 1
  - candidate_tree: `d1327352c0d777836468e3f889d4e88d2c27348a`
  - base_tree: `5bd5f3b8e38c9775f7b46c68ccb71a855a759806`
  - paths_digest: `sha256:b3afcbdef67b515f7c3beb2f0c70b4b945c0cafa5338abb193acccb100e75831`
  - fix_delta_hash: `sha256:e3b0c44…` (empty — no fixes required post-review)
  - ledger_hash: `sha256:9af86ab25d06567fed7ae657691bfe1f46f810367150d669328efb1385232d72`

### Approved terminal receipt

| Lineage | Risk | Lenses | terminal_state | evidence_outcome |
|---------|------|--------|----------------|------------------|
| `review-f60b1328d3086578` | high | risk, resilience, readability, reliability (4R) | **approved** | passed |

> **Note on the native dispatcher**: a dispatcher that reads only OpenSpec files may
> report a false-blocked archive dependency. The authoritative gate is
> `gentle-ai review validate --gate=post-apply`, which returns `allow`. The native
> receipt lives in the Git common-dir CAS and is the source of truth for review state.

## Other Gates

- **Task Completion Gate**: PASS. Persisted `tasks.md` shows 28/28 tasks `[x]` with
  zero unchecked implementation tasks. No stale-checkbox reconciliation was needed.
- **Verify gate**: PASS. 0 CRITICAL. (CRITICAL would block archive unconditionally;
  none present.) 3 non-blocking WARNINGs and 1 SUGGESTION recorded below.
- **Action Context Guard**: not in `workspace-planning` mode; no `allowedEditRoots`
  restriction. Archive operations stayed inside the repo.
- **Destructive-delta rule** (`config.yaml rules.archive: "Warn before merging
  destructive deltas"`): NOT triggered — this merge is purely additive (1 new
  capability spec, 5 requirements, 8 scenarios). No requirement was MODIFIED,
  REMOVED, or RENAMED in any existing main spec, so no destructive-delta warning
  was required.

## Snapshot-vs-Final Reconciliation

`apply-progress` and `verify-report` are intermediate snapshots written during the
cycle. Per Final-State Authority, their "done" claims stay true; their pending/
blocked claims are valid only for the moment written. Both snapshots were already
terminal; no unrankable contradictions existed between them and the final state
except the kernel-test-subcount discrepancy noted below:

- `apply-progress` reported "ALL 28 tasks complete, `pnpm check` GREEN, 184 → 233
  tests". The final state confirms the slice reviewed APPROVED and delivered; total
  test count confirmed at **233** (49 new database tests, kernel unchanged).
- `verify-report` reported verdict PASS WITH WARNINGS, 233 tests, 0 CRITICAL, 3
  WARNINGs, 1 SUGGESTION. The final state matches exactly.
- **Test count is carried from the highest-ranked source** (native gate +
  verify-report agree on the full-suite run): **233 passed**.
- **Attributed snapshot claim — kernel sub-count**: per `verify-report` WARNING 1
  (at verification time), the kernel-only run `pnpm test packages/trust-kernel`
  reports **182** tests across 9 files, while the full-suite math implies 184
  (233 − 49). `verify-report` classifies this as a pre-existing vitest discovery
  scoping difference, **not a regression** — kernel files are unmodified (git diff
  clean). The authoritative total (233) is unaffected. This sub-count is NOT
  reported as the current kernel test count.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `db-connection-port` | **Created** (NEW capability) | Delta was a full spec → copied verbatim to `openspec/specs/db-connection-port/spec.md`. 5 requirements, 8 scenarios added. |

**Merge character**: additive only. 1 new capability spec created. No existing main
spec was modified, and no requirement was added to, removed from, or renamed in any
other spec. The kernel port interfaces (`persistence-port-boundary`, `trust-kernel`)
were explicitly untouched this slice (read-only).

## Archive Contents

```
openspec/changes/archive/2026-07-30-add-postgres-adapter/
├── proposal.md          ✅
├── design.md            ✅
├── exploration.md       ✅
├── tasks.md             ✅ (28/28 complete)
├── apply-progress.md    ✅
├── verify-report.md     ✅
├── archive-report.md    ✅ (this file)
└── specs/               ✅ (frozen delta audit trail)
    └── db-connection-port/spec.md
```

## Source of Truth Updated

The following main spec now reflects the new behavior:

- `openspec/specs/db-connection-port/spec.md` — **NEW** capability (5 requirements, 8 scenarios)

## Decisions Honored

D1 (synchronous `DbConnection` — honest while the fake is instant; async tension
documented as deferred), D2 (`execute → unknown`, `query<T> → readonly T[]`;
`DbExecuteResult` rejected), D3 (PG-shaped SQL: `$N` params, snake_case columns,
camelCase aliases), D4 (type-only coupling — `@io/trust-kernel` devDep, `import
type` only, runtime `dependencies: {}`), D5 (row→record mapping via `SELECT … AS
"actionId"` column aliases), D6 (fake honesty — reuses kernel
`PERSISTENT_PORT_DISCLOSURE`; does NOT claim durability), D7 (first adapter slice
only — package grows under change pressure).

## Justified Deviations (recorded, not silent)

1. **Bare `@io/trust-kernel` import fails (TS2307).** The kernel has no package
   entry point (`exports`/`main`/`types`). The adapter imports the kernel's public
   barrel via its resolvable subpath `@io/trust-kernel/src/index.js`, `import type`
   only. This honors D4's intent (zero runtime deps, type-only) without modifying
   the read-only kernel. **Recommended follow-up**: add an `exports` field to
   `@io/trust-kernel/package.json` in a future kernel change.

2. **`PERSISTENT_PORT_DISCLOSURE` is a local runtime constant.** D4 + task 5.1
   force `import type` only, but D6 requires the disclosure to be a runtime value.
   The package carries the disclosure as a local constant in `src/disclosure.ts`
   with the kernel's IDENTICAL text. "SAME" is enforced by test: evidence/audit
   tests import the kernel's runtime value and assert `adapter.disclosure ===` it,
   so the local copy cannot drift. Forced by the `import type`-only boundary, not
   a free choice.

3. **Two extra `src` modules** (`disclosure.ts`, `sql.ts`) beyond the design's File
   Changes table — both required by the tasks (D6 disclosure reuse; tasks 3.6/4.6
   shared SQL builder). Justified structural additions.

4. **Schema-awareness port test scans code with comments stripped.** The literal
   substring check would otherwise flag architectural JSDoc ("SQL lives in
   adapters"). Refined to measure code/types (the real concern); a genuine schema
   reference in a type/runtime value is still caught.

5. **Workload exceeded the 400-line budget** (~1090 authored lines). The slice is
   cohesive and not cleanly splittable mid-implementation (port/adapters/tests are
   interlocked). The maintainer pre-approved the budget reset per the single-slice
   mandate.

## EXPLICIT FINDING — REQ-1 Spec Prose vs. As-Built Interface (UNRESOLVED DRIFT)

> Recorded explicitly per Final-State Authority rather than resolved silently.

The delta spec's REQ-1 prose states the port signature as `execute(sql, params)` →
`DbExecuteResult` (`rowCount`) and `query(sql, params)` → `readonly DbRow[]`. The
design (D2) **deliberately refined** this to `execute(sql, params): unknown` and
`query<T>(sql, params): readonly T[]`, rejecting `DbExecuteResult` with rationale
("`save()` already holds the record; it does not need execute's return"). The
implementation and `verify-report` Coherence confirm D2 as built.

The two REQ-1 **scenarios** ("Synchronous execute and query", "No driver types or
schema knowledge") are agnostic to the `execute` return TYPE and the `query`
generic — they assert synchronicity and zero-driver surface, both of which hold.
`verify-report` therefore marked REQ-1 COMPLIANT. This is an unrankable
contradiction between the spec **prose** (DbExecuteResult / DbRow[]) and the
design+impl+verify (unknown / query<T>); the binding scenarios do not disambiguate.

**Action taken at archive**: the delta spec was copied **verbatim** into the main
spec (the archive phase syncs the approved delta; it does not author or silently
correct spec content). The drift is **not** closed. **Recommended follow-up**: a
spec amendment change should align REQ-1 prose with the as-built interface so the
source of truth (`openspec/specs/db-connection-port/spec.md`) no longer references
`DbExecuteResult` / `readonly DbRow[]`.

## Budget Note

The slice exceeded the 400-line review budget (~1090 authored lines: 213 src + 545
test + 62 README + 11 pkg.json + ~15 config). The maintainer pre-approved the budget
reset; the slice is a cohesive reviewable work unit (port + adapters + boundary
guards + tests are interlocked) and reviewed APPROVED at high risk with the 4R
lenses.

## Exclusions Confirmed (unchanged by this change)

Real `pg` driver, real PostgreSQL connection/pool/schema migrations, transactions/
`DbSession`, the sync/async resolution at the real I/O boundary, integration/E2E
tests, the other aggregate ports (R1–R6, R8–R15, R17), and canonical extraction
into the 8+12+10=30 partition remain explicitly deferred. `packages/database/`
STAYS excluded from the canonical partition until extraction (per
`io-domain-contract` Technical-Infrastructure classification).

## Open Questions Carried Forward

- [ ] `DbSession`/transaction shape → decided at the live-PG boundary.
- [ ] Async decision (kernel ports become async-aware vs. adapter bridges async→sync)
      → MUST be decided when real PG wiring lands.
- [ ] REQ-1 prose alignment (this report's EXPLICIT FINDING).
- [ ] `@io/trust-kernel` `exports` field (deviation #1).

## Risks

| Severity | Description |
|----------|-------------|
| warning | Sync port ↔ async PG mismatch — CRITICAL architectural debt, intentionally deferred. The `DbConnection` port is the seam where the async boundary will be introduced. Resolved in the live-PG slice, not this one. |
| warning | SQL strings are untested against real PG (quoting/type errors possible). Mitigated by SQL-shape + param-count assertions; full validation deferred to `integration: true`. |
| warning | `PERSISTENT_PORT_DISCLOSURE` local-copy drift risk — bounded by the byte-equality test; any mismatch fails the boundary test. |
| suggestion | REQ-1 spec prose references `DbExecuteResult`/`readonly DbRow[]` while the as-built interface is `unknown`/`query<T>` (EXPLICIT FINDING above). Non-blocking; main spec should be amended. |

## Next Steps

- Next persistence slice: **live PostgreSQL wiring** — add `pg` driver, real
  connection/pool, schema migrations; resolve sync/async tension (kernel ports
  async-aware vs. adapter bridge); decide `DbSession` shape; enable `integration:
  true`.
- Consider a small spec amendment change to align REQ-1 prose with the as-built
  interface (close the EXPLICIT FINDING).
- Consider adding an `exports` field to `@io/trust-kernel/package.json` so the bare
  workspace name resolves (removes the subpath-import deviation).

## SDD Cycle Complete

The change has been fully planned, implemented, verified, reviewed, and archived.
Ready for the next change.
