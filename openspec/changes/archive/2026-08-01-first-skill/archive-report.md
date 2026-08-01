# Archive Report: first-skill — Versioned Skill Definition + Cohort-Safe Activation

## Summary

Shipped the durable skill definition store and deterministic cohort-safe activation selection (DECLARED + SELECTED). A `Skill` type with explicit states, versioned append-only registry, tenant-scoped reads, and a pure activation function — persisted by INSERT-only PostgreSQL. Segment-7 rendering, worker execution, heartbeats, learning/promotion, and outcome events deferred to later slices.

**Verdict**: PASS (sequential full suite 922 passed | 6 skipped; live-PG skill round-trip 9/9 green; quality stages green). One pre-existing parallel-gate flake noted as WARNING.

## Change Metadata

| Field | Value |
|-------|-------|
| Change | `first-skill` |
| Phase | Archive |
| Mode | Hybrid (OpenSpec + Engram) |
| Baseline | `main@de154e5` |
| HEAD at archive | `main@c6340dc` |
| Requirements | 8/8 compliant |
| Scenarios | 10/10 compliant |
| Tasks | 10/10 complete |
| Verification | PASS WITH WARNINGS |

## Delivery History

### PR1 — business-domain (commit `0790e29`)
- `SkillState`, `SkillScope`, `Skill` type (`types.ts`)
- `isSkillState` guard + `activeSkillsFor` pure activation (`skill-activation.ts`, new)
- `SkillRepository` versioned port (`ports/repositories.ts`)
- `InMemorySkillRepository` fake (`ports/fakes.ts`)
- Exports (`index.ts`)
- 31 unit tests (`test/skill.test.ts`, new)

### PR2 — database (commit `c6340dc`)
- `007_skills.sql` DDL (new)
- `parseSkillRow` row guard (`row-guards.ts`)
- `PgSkillRepository` INSERT-only adapter (`skill-adapter.ts`, new)
- Exports (`index.ts`)
- 9 live-PG sequential round-trip tests (`skill-roundtrip.integration.test.ts`, new)
- Test updates: `sql-migrations.test.ts`, `row-guards.test.ts`, `boundary.test.ts`

## Requirements & Scenarios

| # | Requirement | Scenarios | Status |
|---|-------------|-----------|--------|
| R1 | Pure Versioned Skill | S1 | ✅ COMPLIANT |
| R2 | Append-Only Versioned Registry | S2 | ✅ COMPLIANT |
| R3 | Versioned In-Memory Repository | S3 | ✅ COMPLIANT |
| R4 | Explicit Skill Lifecycle | S4 | ✅ COMPLIANT |
| R5 | Cohort-Safe Deterministic Activation | S5, S6 | ✅ COMPLIANT |
| R6 | Insert-Only PostgreSQL Persistence | S7, S8 | ✅ COMPLIANT |
| R7 | Tenant-Scoped Skill Access | S9 | ✅ COMPLIANT |
| R8 | Stable-Prefix Isolation | S10 | ✅ COMPLIANT |

## Verification Result

**Sequential full suite**: 922 passed | 6 skipped (exit 0)
**Live-PG skill round-trip**: 9 passed | 0 skipped (exit 0)
**Quality stages** (format/typecheck/build/lint): all green
**Parallel gate** (`pnpm check`): 921 passed, 1 failed — **pre-existing PG race** in `business-pg-roundtrip.integration.test.ts` (`idempotency_journal_attempt_id_key`). NOT candidate-caused. Documented and recorded as WARNING only.

## Synced Spec

The delta spec was synced into the canonical capability spec:

- **Path**: `openspec/specs/skill/spec.md`
- **Action**: Created (new capability — no prior main spec existed)
- **Content**: 8 ADDED requirements → stripped delta header → canonical `# skill` spec with `## Purpose` + `## Requirements`
- No other specs required modification (context-compiler, worker-cycle, business-event unchanged).

## Archived Artifacts

All artifacts preserved in `openspec/changes/archive/2026-08-01-first-skill/`:

| Artifact | Present |
|----------|---------|
| exploration.md | ✅ |
| proposal.md | ✅ |
| specs/skill/spec.md (delta) | ✅ |
| design.md | ✅ |
| tasks.md | ✅ |
| apply-progress.md | ✅ |
| verify-report.md | ✅ |

## Engram Observations

| Topic | Observation ID |
|-------|---------------|
| sdd/first-skill/explore | #5899 |
| sdd/first-skill/proposal | #5900 |
| sdd/first-skill/spec | #5901 |
| sdd/first-skill/design | #5902 |
| sdd/first-skill/tasks | #5903 |
| sdd/first-skill/apply-progress | #5905 |
| sdd/first-skill/verify-report | #5909 |

## Carried-Forward Follow-Ups (NOT part of this change)

These items were explicitly out-of-scope per the proposal and remain for future slices:

1. **Pre-existing PG parallelism flake** — `business-pg-roundtrip.integration.test.ts` "two concurrent terminal closes" → `idempotency_journal_attempt_id_key`. Run gate with `--no-file-parallelism` or isolate the concurrent test.
2. **openspec/config.yaml metadata stale** — declares `artifact_store: openspec` but this cycle used hybrid persistence.
3. **Segment-7 compiler wiring** — CONTEXT_SCHEMA_VERSION bump + golden regen (the NEXT slice — renders active skills into the stable prefix).
4. **Worker activation/execution** — buildWorkerDeps wiring (Approach B).
5. **Skill outcome/activation BusinessEvents** — deterministic facts when skills execute.
6. **Heartbeats** (§13.2) — the roadmap slice after skills.
7. **Learning/promotion** (Increment 8) — candidate → active lifecycle.
8. **Extraction of Skill type** to canonical `competency/` package.

## Source of Truth Updated

The following spec now reflects the new behavior:

- `openspec/specs/skill/spec.md` — new canonical capability spec (8 requirements, 10 scenarios)
