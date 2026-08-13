# Archive Report: skill-outcome-events

**Archived**: 2026-08-13 · **Store**: hybrid (OpenSpec + Engram) · **Verdict**: archive complete — SDD cycle closed for this change.

The change is archived with all four delta specs merged into the canonical `openspec/specs/` source of truth, the full change folder moved to `openspec/changes/archive/2026-08-13-skill-outcome-events/`, and final-state verification recorded below. No commits, PR, or review receipt exist for this candidate; this archive is artifacts/spec-sync only.

## Final-State Facts (authoritative, at close)

| Fact | Value |
|------|-------|
| Apply gate | Final PASS — 19/19 tasks |
| Independent verify | PASS — 7/7 requirements, 24/24 scenarios, 19/19 tasks, 0 CRITICAL |
| Required-PG test run | `1411 passed`, `5 skipped` (unrelated token-gated/offline); exit 0 |
| Focused independent proof | `220 passed` / 14 files; exit 0 |
| Build/check | exit 0 (tsc build; format/typecheck/lint green) |
| Verify report | SHA-256 `055dbe9e51ed5661cd221ddc85db0ef07949a2201d781d57cc9ebb99c2d44843` — Engram #6598; native settle state complete |
| Verify harness | Isolated PG 18.4 container created and removed; absence confirmed (`CLEANUP=CONFIRMED_ABSENT`) |
| Review gate | `reviewGate` structurally absent in native status — no review was ever discovered for this uncommitted candidate; archive proceeded under ordinary repository policy. No review/delivery launched. |

## Specs Synced (delta → canonical)

| Domain | Action | Details |
|--------|--------|---------|
| business-event | Updated | 3 MODIFIED requirements: Pure Deterministic BusinessEvent (+skill-outcome builder contract, +1 scenario), Atomic Worker Terminal Emission (two-event T1, +skill-outcome emission), Idempotent Single Emission (4th `sk:` namespace, disjoint namespaces, exclusive builder/source ownership, non-materiality, no backfill; +1 scenario) |
| worker-cycle | Updated | 2 MODIFIED requirements: Intent Recorded Before the Effect (+version-drift scenario), Atomic Terminal Close (+composite `work.skill-outcome` emission contract; happy-path and stale-token scenarios widened to both events) |
| context-compiler | Updated | 1 MODIFIED requirement: Compiled Output Contract (+`activatedSkills` output, byte-stability, empty-selection explicit; +3 scenarios) |
| skill | Updated | 1 ADDED requirement: Intent-Captured Skill Usage Outcomes (composite `work.skill-outcome`, intent-time attribution, no fan-out, no backfill; 3 scenarios) |

Merge verified: every delta requirement block present verbatim in the merged main spec; zero duplicate requirement names; no requirement outside the delta modified. No REMOVED/RENAMED deltas — no destructive merge, so no archive warning was required (`rules.archive` satisfied).

Canonical specs updated:
- `openspec/specs/business-event/spec.md`
- `openspec/specs/worker-cycle/spec.md`
- `openspec/specs/context-compiler/spec.md`
- `openspec/specs/skill/spec.md`

## Archive Contents

`openspec/changes/archive/2026-08-13-skill-outcome-events/` — proposal.md, exploration.md, specs/{business-event,worker-cycle,context-compiler,skill}/spec.md, design.md, tasks.md (19/19 `[x]`, 0 unchecked), apply-progress.md, verify-report.md, archive-report.md (this file, additive).

Mechanical copy contract honored: change folder moved with a native `mv` (folder untracked, `git mv` fell back to `mv`); recursive pre-move snapshot compared with `diff -r` — output empty (byte-identical); verbatim readback recorded in the phase result. Active `openspec/changes/` no longer contains this change.

## Engram Observations (traceability)

Observation IDs read during archive (full content): proposal #6565, spec #6566, design #6567, tasks #6571, verify-report #6598. Apply-progress persisted across #6574/#6591 (referenced by tasks/verify, not re-read in full). This archive report: Engram `sdd/skill-outcome-events/archive-report` (capture_prompt false).

## Snapshot Attribution

`verify-report` and `apply-progress` are intermediate snapshots; their historical claims (per-unit counts, gate history) remain valid as history but are superseded for final state by the verify-report #6598 + orchestrator final-state facts above. No contradiction requiring resolution was found: every intermediate claim agrees with final state at the points covered by higher-ranked sources.

## Open Items

None. All 19 tasks complete; 24/24 scenarios compliant; 0 CRITICAL; harness cleaned; no commits/PR/review owed (archive-only close).
