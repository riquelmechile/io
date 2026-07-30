# Archive Report: io-persistence-recovery-contract

> **SDD cycle complete.** The `io-persistence-recovery-contract` capability is
> now canonical; the `io-ports-trust-contract` records requirement hands its
> persistence/recovery semantics to it by reference. This is the terminal record
> of the change at close.

## Quick path

1. New canonical spec promoted to `openspec/specs/io-persistence-recovery-contract/spec.md`.
2. `io-ports-trust-contract` MODIFIED requirement applied, preserving R1–R17 and all other requirements.
3. Change folder moved to `openspec/changes/archive/2026-07-30-io-persistence-recovery-contract/`.
4. Verification: 19/19 tasks complete, 0 unchecked; merged specs carry 17/17 records and all requirements.

## Final State (authoritative)

Final state is reported from the **Native Review Authority** (highest rank) and
the orchestrator's terminal facts. Intermediate snapshots (`verify-report.md`,
`apply-progress.md`) are cited by source and time; their stale or superseded
claims are not restated as current.

| Fact | Value | Source |
|------|-------|--------|
| Review gate result | `allow` | structured status `reviewGate` (native authority) |
| Post-apply review | `review-7f143969c8d5d45e` — approved | orchestrator final-state facts |
| Verify candidate review | `review-35af0f9888cf4398` — approved, bound to SDD after `verify-report.md` added | orchestrator final-state facts |
| Current SDD binding revision | `sha256:a7debb69f558ba768615036ff52a363747fdfde3d648caba7fa3b2abeded637b` | orchestrator final-state facts |
| Verify runtime attempt — finished | PASSED at `sha256:2265495b9ae146675c9bff3f26aa948fc06af96c90bae092b8352c357bc53cf8` | orchestrator final-state facts |
| Verify evidence revision | `sha256:7ba89daf5d7bec1fcaa28e4ef42fd8c0c57f1560a58e9568b90bba7d9968cd05` | orchestrator final-state facts |
| Verify verdict | PASS — 0 blockers, 0 critical findings | native review authority + `verify-report.md` |
| Requirements | 11/11 (10 new capability + 1 ports/trust MODIFIED) | native review authority |
| Scenarios | 12/12 | native review authority |
| Tasks | 19/19 complete, 0 incomplete | persisted `tasks.md` artifact |
| Project check | `pnpm check` passed under Node 24.18.1 (format-check, typecheck, build, lint, test; 2 tests passed) | native review authority + `verify-report.md` |

### Recorded discrepancy (audit hashes)

The persisted `verify-report.md` snapshot (written at verification time, now in
this archive) records its own audit identifiers: `evidence_revision
sha256:8e5b52fd...`, review lineage `review-7f143969c8d5d45e`, SDD binding
revision `sha256:d45d6e8f...`, and runtime attempt begin
`sha256:96ec21397...`. The orchestrator's terminal facts record a *later*,
authoritative binding revision `sha256:a7debb69...`, attempt-finish
`sha256:2265495b...`, evidence `sha256:7ba89daf...`, and a verify candidate
review `review-35af0f9888cf4398`.

These binding/evidence/attempt revisions differ between the intermediate
snapshot and the terminal facts. Per the Final-State Authority hierarchy the
terminal facts (above) govern; the snapshot's hashes are valid history of what
was true when `verify-report.md` was written, not current state. The
**substantive verdict is consistent across both** — PASS, 0 blockers, 0
critical findings, 11/11 requirements, 12/12 scenarios, 19/19 tasks — so this
discrepancy does not affect the close. It is recorded here rather than silently
resolved.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `io-persistence-recovery-contract` | Created (new canonical) | Full spec promoted verbatim: Purpose + 10 requirements (Authoritative State Ownership; Single-Aggregate Transaction Boundary; Required Records Carriage; Append-Only Integrity & Privacy Deletion; Atomic Idempotency; At-Least-Once Outbox/Inbox Safety; Lease Fencing; External-Effect UNKNOWN-Outcome Recovery; Receipt Integrity; Recovery Matrix), R1–R17 table, 10 Given/When/Then scenarios. |
| `io-ports-trust-contract` | Updated (1 MODIFIED requirement) | "Required Persistence and Recovery Records" replaced in full: R1–R17 table intact (17 rows, ADR labels preserved); "Records present for every required area" scenario preserved verbatim; "Persistence and recovery handoff resolved" scenario added intentionally; narrative now carries semantics into the new capability by reference. 6 other requirements (Product Surface, Command-Bound Authority Envelope, Default-Deny Authority, Separation-of-Duties Tiers, Bounded Role Model, Delegation Separation) preserved unchanged. |

**No REMOVED or RENAMED requirements** exist in this change; the destructive-delta
warning condition was not triggered. Record field detail stays authoritative in
`io-ports-trust-contract`; persistence/recovery semantics have one normative
owner in `io-persistence-recovery-contract`.

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | Preserved |
| `specs/io-persistence-recovery-contract/spec.md` | Preserved (delta) |
| `specs/io-ports-trust-contract/spec.md` | Preserved (delta) |
| `design.md` | Preserved |
| `tasks.md` | Preserved — 19/19 tasks complete, 0 unchecked |
| `apply-progress.md` | Preserved (intermediate snapshot) |
| `verify-report.md` | Preserved (intermediate snapshot) |
| `exploration.md` | Preserved |

## Gates Passed at Close

- **Native Review Receipt Gate**: `reviewGate.result: allow`; post-apply and
  verify candidate reviews approved. No blocker.
- **Task Completion Gate**: `tasks.md` has 19/19 checked, 0 unchecked
  implementation tasks.
- **CRITICAL-issue gate**: 0 blockers, 0 critical findings in verification.
- **Action Context Guard**: operations confined to `/data/io`
  (`allowedEditRoots`); mode not `workspace-planning`.
- **Destructive-delta warning**: not triggered (no `## REMOVED` deltas).

## Verification Performed After Archive

- New canonical spec `openspec/specs/io-persistence-recovery-contract/spec.md`
  exists with 10 requirements and 17 record rows.
- Merged `io-ports-trust-contract/spec.md` retains 7 requirements
  (6 unchanged + 1 MODIFIED), 17/17 record rows, the preserved scenario, and the
  new handoff scenario.
- Active changes directory no longer contains this change.
- Archived `tasks.md` has 0 unchecked implementation tasks.

## Standing Non-Blocking Warning

Governance drift: `openspec/config.yaml` declares `artifact_store: hybrid` and
`strict_tdd: true`, while the launch status resolved `openspec` mode and the
cached init state says `strict_tdd: false`. This does not block this
documentation-only archive (TDD cannot apply to documentation with no code under
test). Recommend reconciling the cache/config before a future code-bearing change.

## Source of Truth Updated

- `openspec/specs/io-persistence-recovery-contract/spec.md` — new canonical persistence/recovery contract.
- `openspec/specs/io-ports-trust-contract/spec.md` — records requirement now hands persistence/recovery semantics to the new capability.

## SDD Cycle

Planned → specified → designed → tasked → applied → verified → **archived**.
Ready for the next change.
