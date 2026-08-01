# Archive Report: context-compiler

**Change**: `context-compiler`  
**Date archived**: 2026-08-01  
**Mode**: Hybrid (OpenSpec filesystem + Engram)  
**Baseline**: `main @ e7b5fe8`  
**Verdict**: **PASS**  

---

## Executive Summary

The context compiler is a new pure `packages/context` capability that transforms worker inputs into canonically ordered, byte-stable LLM context segments. It implements the §7.2 prefix ordering contract (13 segments: 1–9 stable prefix → system message, 10–13 dynamic suffix → user message), derives a cache-cohort field (`user` = `io:{companyId}:{process}:v{schemaVersion}`), and wires into `prepareIntent`. The legacy `STABLE_SYSTEM_PREFIX` constant was migrated into segment 1 (protocol). All 7 requirements and 12 scenarios passed; full gate 813/3 green; live-PG E2E 9/9 tests green.

---

## Verification Verdict

| Metric | Value |
|--------|-------|
| Requirements compliant | 7/7 (R1–R7) |
| Scenarios covered | 12/12 |
| `pnpm check` | 813 passed / 3 skipped, exit 0 |
| Live PostgreSQL E2E | 5 files / 9 tests, 0 PG skips |
| Blockers | 0 |
| CRITICAL findings | 0 |

---

## Implementation Commits

| Commit | Description |
|--------|-------------|
| `42f9df6` | Planning artifacts (proposal, design, tasks, exploration) |
| `3458b81` | PR1: `@io/context` scaffold + §7.2 segment table + absent rendering |
| `54a1905` | PR2: byte-stable prefix + cache cohort + compileContext (+ seg 5→ABSENT correction) |
| `5dcd699` | PR3: worker intent wiring + delete legacy stable-prefix |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `context-compiler` | Created (NEW capability) | 7 requirements, 12 scenarios → synced to `openspec/specs/context-compiler/spec.md` |

---

## Corrections During Cycle

### Correction 1: R2 Cache-Poisoning (PR2 Adversarial Review — CRITICAL finding, fixed)

**Problem**: PR2 sourced segment 5 (role-contract) from `delegation` (`authorityScope.scope`/`actions` + `expectedOutcome`). But `deriveCohort` discriminates only on `{companyId, process, schemaVersion}` — delegation detail is NOT a cohort discriminator. Two inputs in the SAME cohort with different delegation rendered DIFFERENT stable-prefix bytes, violating R2 ("segments 1–9 byte-identical per cohort") → DeepSeek KV-cache poisoning (a cache hit serves a role contract the current request never supplied).

**Fix**: Reverted segment 5 to ABSENT this slice. Per-delegation detail is per-request DYNAMIC content, never cohort-stable, so it MUST NOT appear in the stable prefix. The legacy prompts never contained a role contract. Stable prefix is now `{seg 1 protocol, seg 8 business-process}` — a pure function of `{companyId, process, schemaVersion}` ≡ the cohort. No schema bump needed (segment table positions unchanged; this is a v1 bugfix).

**Evidence**: New inverse test in `prefix-stability.test.ts` — same cohort + 4 delegation variants ⇒ identical prefix bytes AND identical cohort value. Passed.

**Tracked in**: `design.md` amendment paragraph, `apply-progress.md` PR2 adversarial review section, `verify-report.md` R2 Correction Confirmation.

### Correction 2: R4 Stale Scenario Example (Verify Phase)

**Problem**: The R4 scenario example predated the design's decision to source segment 8 (business-process) from `process`. The example named segments 1 & 11 as present but omitted segment 8.

**Fix**: Amended the scenario to "segments 1, 8, 11 present; 2–7, 9–10, 12–13 unsourced → ABSENT holding position". The R4 requirement itself was unchanged and already satisfied by implementation.

**Evidence**: Test asserts exact present-position set `[1, 8, 11]`; zero-byte ABSENT rendering for all listed unsourced positions; segment 11 remains at position 11. Passed.

**Tracked in**: `verify-report.md` R4 Re-verification section.

---

## Forbidden Coupling Invariants Confirmed

| Constraint | Evidence |
|------------|----------|
| Business domain has zero `@io/*` imports | `git grep` over `packages/business-domain/src` returned no matches |
| `openai` confined to llm-client source | Only found in `packages/llm-client/src/deepseek-client.ts` |
| Context dependencies === business-domain only | `packages/context/package.json` has exactly one dep |
| Only new app runtime dep is `@io/context` | Manifest diff adds only `@io/context` |
| Legacy stable-prefix coupling absent | Zero `STABLE_SYSTEM_PREFIX` references under `packages/` |

---

## Adversarial Reviews

| PR | Review | Finding | Resolution |
|----|--------|---------|------------|
| PR1 | Inline verified | None | GREEN |
| PR2 | Adversarial review | **CRITICAL**: R2 cache-poisoning (seg 5 delegated content leaked into stable prefix) | BLOCKER → fixed (seg 5→ABSENT); re-verified GREEN |
| PR3 | Inline verified | None | CLEAN |

---

## Deferred Follow-ups

1. **Transitional `processTokenFor`**: Currently maps `delegation.authorityScope.scope` → process token. Will be replaced when a process-domain package lands.
2. **Per-delegation dynamic content**: `expectedOutcome`/`actions` are intentionally NOT in the stable prefix (per R2 fix). Future work to add them to the dynamic suffix if needed.
3. **Degenerate cohort**: Empty `authorityScope.scope` yields a cohort like `io:{companyId}::v1` (non-crashing, double-colon gap). Low severity — expected until process domain exists.

---

## Bugs Found & Fixed During Cycle

| Bug | Severity | Fix |
|-----|----------|-----|
| R2 cache-poisoning (seg 5 → delegation content in stable prefix) | CRITICAL | Seg 5→ABSENT; inverse test added |
| R4 stale scenario example | WARNING | Scenario amended to match design |

---

## Archive Contents

| Artifact | Path |
|----------|------|
| exploration.md | `openspec/changes/archive/2026-08-01-context-compiler/exploration.md` |
| proposal.md | `openspec/changes/archive/2026-08-01-context-compiler/proposal.md` |
| design.md (amended) | `openspec/changes/archive/2026-08-01-context-compiler/design.md` |
| tasks.md (all [x]) | `openspec/changes/archive/2026-08-01-context-compiler/tasks.md` |
| specs/context-compiler/spec.md | `openspec/changes/archive/2026-08-01-context-compiler/specs/context-compiler/spec.md` |
| apply-progress.md | `openspec/changes/archive/2026-08-01-context-compiler/apply-progress.md` |
| verify-report.md | `openspec/changes/archive/2026-08-01-context-compiler/verify-report.md` |
| archive-report.md | `openspec/changes/archive/2026-08-01-context-compiler/archive-report.md` |

---

## Source of Truth Updated

The following spec is now the authoritative definition for the `context-compiler` capability:

- `openspec/specs/context-compiler/spec.md` — 7 requirements, 12 scenarios

---

## Next Steps (Paso 3 Continues)

1. DeepSeek live E2E (swap FakeLlmClient for real DeepSeek API)
2. BusinessEvent integration
3. One-skill heartbeats (segment 7)
4. Roadmap planning for remaining segments (constitution, policies, company, competencies, memory, evidence, tool results)

---

## Key Learnings

1. Cohort-derived values must exclude any content not used as a discriminator or cache hits will serve mismatched data.
2. Golden pins enforce byte-stability structurally — any silent change fails the pin until schema version is bumped.
3. Adversarial review during implementation caught a CRITICAL cache-poisoning bug that verification alone would not have prevented.
4. Segment rendering decisions should distinguish cohort-stable from per-request-dynamic content before adding to the stable prefix.
5. Transitional stand-ins (processTokenFor) are acceptable when clearly documented and scoped to later replacement.
