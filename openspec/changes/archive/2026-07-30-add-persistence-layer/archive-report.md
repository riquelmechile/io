# Archive Report — Add Persistence Port Boundary (Evidence/Audit)

> **SDD terminal record.** This report describes the state of the change AT CLOSE
> (final-state authority). `apply-progress` and `verify-report` are intermediate
> snapshots; where they disagreed with the final state, the final state is
> reported here and the snapshot claim is attributed to its source and time.

## Change

- **Name**: `add-persistence-layer`
- **Capability**: persistence port boundary (evidence R7 / audit R16)
- **Roadmap increment**: Increment 2 — PERSISTENCE, first slice
- **Delivery strategy**: auto-chain / stacked-to-main (2 slices)
- **Artifact store**: `hybrid` (OpenSpec canonical files + Engram cross-session audit trail)
- **Archived to**: `openspec/changes/archive/2026-07-30-add-persistence-layer/`
- **Date**: 2026-07-30

## Final State

| Metric | Final value |
|--------|-------------|
| Implementation | **COMPLETE** — all 6 phases across 2 slices |
| Tests | **184 passed / 0 failed / 0 skipped** across 10 test files |
| `pnpm check` | **GREEN** (format-check → typecheck → build → lint → test); build exit 0 |
| Verify verdict | **PASS** — 8/8 requirements, 17/17 scenarios COMPLIANT |
| Critical findings | **0** |
| Warnings | **0** |
| Suggestions | 1 non-blocking (S-001, orthogonal, carried from prior change) |
| Tasks | 18/18 complete (persisted `tasks.md` has zero unchecked items) |

### Commits (both pushed)

| Slice | Commit | Phases | Contents |
|-------|--------|--------|----------|
| 1 | `3c9a13c` | 1–4 | `PersistentRecord`, `EvidenceRepository`/`AuditRepository` ports, in-memory fakes, universal boundary detector |
| 2 | `bff7d2c` | 5–6 | Optional repo routing in `finalize()`, `PersistenceOutcome` consumer contract, `buildPersistentRecord` helper, exports, exclusion guard |

## Gate Authority — Native Review (HIGHEST RANK)

Archive requires `reviewGate.result: allow` (or `disabled/unmanaged` when ungoverned).
**Both slices have APPROVED native reviews.** The real authority is the native review
CAS in `.git/gentle-ai/` (Git common-dir), validated by
`gentle-ai review validate --gate=post-apply`, NOT the OpenSpec file layout.

- **`gentle-ai review validate --gate=post-apply`** →
  `result: "allow"`, `allowed: true`, `action: "continue"`,
  `reason: "authoritative transaction, current repository target, and content-bound
  artifacts match"`, `base_relationship_valid: true`.
  - lineage: `review-93b0d737cab8dc06` (final slice), generation 1
  - candidate_tree: `ee8b391388532a632eebdb2f69b8d39ef8469404`
  - paths_digest: `sha256:a01661cb1a8f0bfa6cb698570a2965479ab4abc15cc6af46a9330abdea181f4a`
  - fix_delta_hash / ledger_hash: empty (no fixes required post-review)

### Approved terminal receipts

| Lineage | Risk | Lenses | terminal_state | evidence_outcome |
|---------|------|--------|----------------|------------------|
| `review-fc5dfdf23795fba9` (Slice 1) | high | risk, resilience, readability, reliability | **approved** | passed |
| `review-93b0d737cab8dc06` (Slice 2) | medium | reliability | **approved** | passed |

> **Note on the native dispatcher**: a dispatcher that reads only OpenSpec files may
> report a false-blocked archive dependency (observed on the prior change). The
> authoritative gate is `gentle-ai review validate --gate=post-apply`, which returns
> `allow`. The native receipts live in the Git common-dir CAS and are the source of
> truth for review state.

## Other Gates

- **Task Completion Gate**: PASS. Persisted `tasks.md` shows 18/18 tasks `[x]` with
  zero unchecked implementation tasks. No stale-checkbox reconciliation was needed.
- **Verify gate**: PASS. 0 CRITICAL, 0 WARNING. (CRITICAL would block archive
  unconditionally; none present.)
- **Action Context Guard**: not in `workspace-planning` mode; no `allowedEditRoots`
  restriction. Archive operations stayed inside the repo.
- **Destructive-delta rule** (`config.yaml rules.archive: "Warn before merging
  destructive deltas"`): NOT triggered — this merge is purely additive (1 new
  capability spec) plus 2 in-place requirement MODIFICATIONS with documented
  `(Previously: ...)` rationale. No requirement was REMOVED and no large section was
  deleted, so no destructive-delta warning was required.

## Snapshot-vs-Final Reconciliation

`apply-progress` and `verify-report` are intermediate snapshots written during the
cycle. Per Final-State Authority, their "done" claims stay true; their
pending/blocked claims are valid only for the moment written. No contradictions
existed between snapshots and the final state on this change — both snapshots were
already terminal:

- `apply-progress` reported "Slice 2: COMPLETE, ready for native review → delivery"
  and 184 tests. The final state confirms Slice 2 reviewed APPROVED and delivered;
  test count unchanged at 184.
- `verify-report` (revision `sha256:e3536f8…`) reported verdict PASS, 184 tests, 0
  CRITICAL/WARNING, 1 non-blocking SUGGESTION. The final state matches exactly.
- Test count is carried from the highest-ranked source (native gate + verify-report
  agree): **184**.

No unrankable contradictions were found.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `persistence-port-boundary` | **Created** (NEW capability) | Delta was a full spec → copied verbatim to `openspec/specs/persistence-port-boundary/spec.md`. 6 requirements, 12 scenarios added. |
| `trust-kernel` | **Updated** (2 MODIFIED requirements) | In-place replacement of "Transitional In-Memory Boundary" (now permits generic `ports/` interfaces + optional repo injection; +1 scenario "Ports permitted; drivers and frameworks still forbidden") and "In-Memory Evidence and Audit" (now permits optional repository routing; +1 scenario "Optional repository routes records"). `(Previously: …)` migration notes preserved per repo convention. |

**Merge character**: additive only. 1 new capability spec created; 2 requirements
modified in place (no additions to, removals from, or renames of other requirements).
All 6 other trust-kernel requirements preserved unchanged: Neutral Identity, Risk
Classification, Deny-by-Default, Scoped Pipeline, SOD, Honest Receipt.

## Archive Contents

```
openspec/changes/archive/2026-07-30-add-persistence-layer/
├── proposal.md          ✅
├── design.md            ✅
├── exploration.md       ✅
├── tasks.md             ✅ (18/18 complete)
├── apply-progress.md    ✅
├── verify-report.md     ✅
└── specs/               ✅ (frozen delta audit trail)
    ├── persistence-port-boundary/spec.md
    └── trust-kernel/spec.md
```

## Source of Truth Updated

The following main specs now reflect the new behavior:

- `openspec/specs/persistence-port-boundary/spec.md` — **NEW** capability
- `openspec/specs/trust-kernel/spec.md` — 2 requirements MODIFIED

## Decisions Honored

D1 (optional injection in `src/ports/`), D2 (optional repos on `EvaluationInput`),
D3/D4 (zero runtime deps via generics + `import type`), D5 (`PersistenceOutcome`
consumer contract keeping captured `InMemoryRecord` separate), D6 (honest
NON-durable fake disclosure), D7 (universal boundary detector scans `ports/` on
merit — NOT exempted), D8 (`PersistentRecord` mirrors `InMemoryRecord` field order).

### Justified deviation (recorded)

`EvidenceRepository` accepts a generic session param `S = unknown`
(`save(record, session?)`) although the design's illustrative snippet deferred it.
The spec R7 prose + task 2.2 REQUIRED it, and spec R7 outranks the design's
deferral — so the implementation followed spec + task (higher authority). `AuditRepository<R>`
has no session param (R16/Req 2 does not call for one). Confirmed in
`verify-report` Coherence (Slice-1 session param: ✅ Yes).

## Budget Note

Both slices exceeded the 400-line review budget (Slice 1 ≈ 670, Slice 2 ≈ 590
authored). The maintainer pre-approved the budget reset per the auto-chain /
stacked-to-main delivery strategy; each slice is a cohesive reviewable work unit
(tests + impl inseparable). Both slices reviewed APPROVED.

## Exclusions Confirmed (unchanged by this change)

Real PostgreSQL adapter, canonical extraction into
`organization/`/`policy/`/`approvals/`/`evidence/`/`receipts/`/`audit/`, the other
aggregate ports (R1–R6, R8–R15, R17), cryptographic receipts, and real approval
chains remain explicitly deferred. `ports/` is a forward extraction signal ONLY; the
kernel stays excluded from the 8+12+10=30 canonical partition.

## Risks

| Severity | Description |
|----------|-------------|
| suggestion | S-001 (carried, orthogonal): prior change noted R3-002 expiry-boundary "could triangulate with exactly-at-expiry or past-expiry fixtures". Unresolved by this change (orthogonal); stands for the next change that touches expiry logic. |
| suggestion | Open design questions remain (PG adapter package location; `DbSession` shape) — deferred to the next persistence slice. |

## Next Steps

- Next persistence slice: real PostgreSQL adapter (needs `integration: true` + `psql`).
- Subsequent slices: other aggregate ports, canonical extraction, crypto receipts,
  real approval chains.
- Consider S-001 expiry triangulation when expiry logic is next touched.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, reviewed, and archived.
Ready for the next change.
