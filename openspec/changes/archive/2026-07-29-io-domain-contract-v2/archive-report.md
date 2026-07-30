# Archive Report: io-domain-contract-v2

> **Status at close**: ARCHIVED — all gates satisfied, SDD cycle complete.
> The change formalized an already-approved exploration into a new `io-domain-contract`
> spec. No application code, packages, tests, config, ADRs, or exploration content were changed.

## Quick path

1. Synced the delta spec as a **new** main spec (main spec did not exist → non-destructive copy).
2. Moved the full change folder to a dated archive.
3. Recorded the **final corrected** state below, not stale intermediate snapshots.

## Final state at close

| Topic | Final value | Source (rank) |
|-------|-------------|---------------|
| Verdict | PASS | `verify-report.md` + native review authority |
| Critical findings | 0 (none) | `verify-report.md` corrected body |
| Blockers | 0 | `verify-report.md` |
| Requirements / scenarios | 6 / 6 | `verify-report.md` + `sdd-verify-validate` (6/6 valid/pass) |
| Tasks complete | 8 / 8 (pending 0) | persisted `tasks.md` — all `- [x]` |
| Review gate (post-apply) | **allow** | native `reviewGate`; `gentle-ai review validate --gate post-apply --cwd /data/io` |
| Corrected review lineage | `review-83a021fb6d592ce5` | orchestrator final-state facts + native review authority |
| Corrected binding revision | `sha256:eae595572a5f0d4897ec441762d8561b06e2ce084c9fb7b6e1e1a5a959b8926c` | orchestrator final-state facts |
| Runtime attempt | ordinal 2, complete/passed (bounded correction) | orchestrator final-state facts |
| No-regression check | `pnpm check` passed under Node 24.18.1 | orchestrator final-state facts; `verify-report.md` evidence |

## Specs synced

| Domain | Action | Details |
|--------|--------|---------|
| `io-domain-contract` | Created (new capability) | Delta is a full spec, not a delta-of-delta. Copied 1:1 to main specs. No MODIFIED/REMOVED/RENAMED blocks (new capability; nothing replaced). 6 requirements added, 0 modified, 0 removed. |

**Synced spec path**: `openspec/specs/io-domain-contract/spec.md`
**Verified byte-identical** to `…/changes/…/specs/io-domain-contract/spec.md` (non-destructive; no existing main spec was overwritten — `openspec/specs/io-domain-contract/` did not exist before archive).

## Archive location & contents

**Archive path**: `openspec/changes/archive/2026-07-29-io-domain-contract-v2/`

| Artifact | Present |
|----------|---------|
| exploration.md | ✅ (unchanged; sole semantic source) |
| proposal.md | ✅ |
| specs/io-domain-contract/spec.md | ✅ |
| design.md | ✅ |
| tasks.md | ✅ (8/8 implementation tasks `- [x]`) |
| apply-progress.md | ✅ |
| verify-report.md | ✅ |
| archive-report.md | ✅ (this file) |

The active changes directory no longer contains this change (verified).

## Correction history (why intermediate snapshots differ)

This change went through a bounded correction cycle. The final-state facts outrank the
intermediate snapshots per the Final-State Authority hierarchy:

- **Initial verify** created `verify-report.md` and passed Node 24 checks, but the native
  review then surfaced a CRITICAL finding: `R3-primary-responsibility-contract-not-self-contained`.
- **Bounded correction** added the exact 30-package classification table (8 Core Business,
  12 Platform-Enabled Domain, 10 Technical Infrastructure) to the delta spec, and updated
  `verify-report.md` so the compliance matrix cites the self-contained package inventory.
- **Targeted correction validation** passed and resolved the CRITICAL finding. The corrected
  review lineage `review-83a021fb6d592ce5` is approved and bound to SDD.
- **No CRITICAL issues remain** in the final `verify-report.md`.

### Recorded discrepancy (review lineage field)

The persisted `verify-report.md` body is the **corrected** content (PASS, 0 critical,
compliance matrix cites the 30-package inventory table). However, its lineage-citation
field still reads `review-77439f7ed7870f93` — the lineage identifier at the moment the
corrected report body was written. The most authoritative sources (orchestrator
final-state facts and the native post-apply review gate) confirm the **corrected terminal
lineage is `review-83a021fb6d592ce5`**, bound with revision
`sha256:eae595572a5f0d4897ec441762d8561b06e2ce084c9fb7b6e1e1a5a959b8926c`.

The corrected lineage is reported here as final state. The persisted `verify-report.md`
lineage field was left unmodified (archive artifacts are an immutable audit trail); this
report records both values and their sources rather than silently resolving them.

## Gate evidence summary

| Gate | Result | Evidence |
|------|--------|----------|
| Task Completion | ✅ Pass | `tasks.md`: 8/8 `- [x]`, 0 `- [ ]` implementation tasks |
| CRITICAL (verify) | ✅ Pass | `verify-report.md`: `critical_findings: 0`, `CRITICAL: None` (after correction) |
| Native Review Receipt | ✅ allow | corrected lineage `review-83a021fb6d592ce5`; `gentle-ai review validate --gate post-apply` = allow |
| Verify validation | ✅ valid/pass | `gentle-ai sdd-verify-validate --requirements 6 --scenarios 6` |
| Non-destructive merge | ✅ Confirmed | main spec was absent; new file created, none overwritten (`rules.archive`: warn-before-destructive — N/A) |
| Action context | ✅ No restriction | no `workspace-planning` mode, no `allowedEditRoots` |

## Checks used at close

- `diff -q <delta spec> <main spec>` → IDENTICAL (byte-for-byte copy)
- `mv` change folder → dated archive (filesystem move)
- Directory listings confirm active changes no longer contain this change and archive contains all 7 original artifacts

## Next

SDD cycle complete for `io-domain-contract-v2`. The next changes in the active set
(`io-ports-trust-contract-v2`, `io-persistence-recovery-contract`, `io-delivery-quality-contract`)
remain queued and are unaffected by this archive.
