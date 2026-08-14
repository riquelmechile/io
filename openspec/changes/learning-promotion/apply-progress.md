# Apply Progress — learning-promotion (slice 1: candidate identity + types)

Work unit: `candidate-identity-types` (tasks 1.1 + 1.2 ONLY). Strict TDD active.
Delivery: auto-chain, stacked-to-main — PR1 slice 1 (`candidate-contracts` sub-boundary).
Clean chain from `fd4a761`; supersedes any stale WIP apply-progress for Git authority.
Runtime attempt token: `sha256:74a8a1ff…` — SAME attempt, corrected after the independent
apply gate FAILED slice 1A. No new budget was opened.

## Status: 2/25 (corrected — gate slice 1A FAILED, now fixed)

- [x] 1.1 RED `learning-candidate.test.ts`: `candidateIdFor` = length-prefixed `lc:<clen>:<co>:<slen>:<skill>:v<ver>` deterministic + collision-free across tenants/subjects/versions.
- [x] 1.2 GREEN `learning-candidate.ts`: types + `candidateIdFor`.
- Kept complete ONLY because corrected behavior is collision-free for all well-formed input AND rejects ill-formed (lone-surrogate) input before encoding.
- NOT touched: 1.3 `createLearningCandidate` (ParseResult NOT implemented), 1.9 port, evaluator, app, PG, later tasks.

## Correction log (independent apply gate FAILED slice 1A)

1. **Lone-surrogate collision (fixed)**: `TextEncoder` maps EVERY lone surrogate to the same U+FFFD bytes, so distinct lone high/low surrogates in companyId/skillId collapsed onto identical ids. Fix: `candidateIdFor` rejects ill-formed components BEFORE encoding by throwing a typed `InvalidCandidateIdComponentError extends RangeError` naming the offending component — deterministic fail-fast, no ParseResult (task 1.3 untouched). Well-formed surrogate pairs (astral chars) encode normally.
2. **Original RED truth (marked unsupported)**: the initially recorded RED "12 failed / 3 passed" is UNSUPPORTED/FAILED — a static import/module-load failure cannot produce a mixed pass/fail signature; it is not used as evidence. The correction regression RED is recorded exactly below; history preserved, nothing erased.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 (initial) | `test/learning-candidate.test.ts` | Unit | ✅ 1410 passed/6 skipped | ⚠️ unsupported claim "12 failed/3 passed" (see correction log) | ✅ 15/15 (initial code) | ✅ 12 behavioral cases | — |
| 1.1 (correction) | same | Unit | same | ✅ correction RED: **3 failed/16 passed (19)** — lone-surrogate tests written first | ✅ **19/19** | ✅ distinct high/low surrogates × both components + well-formed astral counter-case | ✅ `pnpm check` GREEN |
| 1.2 | `src/learning-candidate.ts` | Unit | same | (covered by correction RED) | ✅ 19/19 | ✅ type contracts asserted | ✅ biome format+lint clean |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/learning-candidate.test.ts` — correction RED: 3 failed/16 passed → GREEN: 19/19 passed |
| Runtime harness | N/A — pure domain unit slice; no runtime boundary (no app seam, no PG, no evaluator in this slice) |
| Rollback boundary | Drop `src/learning-candidate.ts` + `test/learning-candidate.test.ts`, remove index.ts export lines, revert 1.1/1.2 checkboxes — no consumers exist (1.3 not implemented) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` — GREEN: format ✓ typecheck ✓ build ✓ lint ✓ (9 pre-existing warnings) test **1429 passed / 6 skipped** (baseline 1410; first pass 1425; post-correction 1429) |

## Line count (net additions+deletions vs clean fd4a761)

| Path | Add | Del |
|------|-----|-----|
| `packages/business-domain/test/learning-candidate.test.ts` (new) | 201 | 0 |
| `packages/business-domain/src/learning-candidate.ts` (new) | 105 | 0 |
| `packages/business-domain/src/index.ts` | 9 | 0 |
| `openspec/changes/learning-promotion/tasks.md` (4 mechanical 0/25 resets + 2 completions) | 2 | 2 |
| `openspec/changes/learning-promotion/apply-progress.md` (OpenSpec copy) | 57 | 0 |
| **Total (net diff)** | **374** | 2 |

Gross component accounting: source 105 + tests 201 + index 9 + corrections 8 + completions 4 + apply-progress 57 ≈ 384 < 400.

## Notes

- No receipt fabricated: RDD clone-disabled; parent delivers under ordinary policy after independent gate validation.
- `candidateIdFor` = `lc:<companyByteLen>:<company>:<skillByteLen>:<skill>:v<version>` — canonical UTF-8 BYTE lengths; delimiter/collision + non-ASCII behavioral tests included.
- Fail-fast contract: lone surrogate in companyId or skillId → `InvalidCandidateIdComponentError` (typed RangeError) naming the component; well-formed astral chars unaffected.
- `TransitionEvidence` shape unspecified in design.md; minimal `{toState, occurredAt, reason}` chosen — extendable by 1.7.
- index.ts exports ONLY the types + `candidateIdFor` + the error type (1.3/1.9 exports omitted).

---

# Slice 1B — task 1.3 `createLearningCandidate` (work unit: `candidate-creation`)

Runtime token: `sha256:00b2ab5a…`; clean worktree from `50744e3`; diff = changes vs `50744e3` only. Strict TDD active; delivery auto-chain, stacked-to-main (PR1 slice 1B).

## Status: 3/25 (cumulative — 1A 1.1/1.2 preserved + 1B 1.3 corrected)

- [x] 1.3 corrected: deep-copy, closed-shape everywhere, Unicode on all identity strings, canonical `ParseResult` (gate-passed).

## TDD Cycle Evidence (Slice 1B — original + corrective)

| Round | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|-------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.3 original | `test/learning-candidate.test.ts` | Unit | ✅ 19/19 (1A) + 1429 full suite | ✅ **19 failed / 19 passed (38)** — `createLearningCandidate is not a function` (not exported yet); exact vitest capture | ✅ **29/29** (focused; RED's 19 tests consolidated to 10 `it` blocks, all behaviors retained) | ✅ 11 behavioral groups: root/copy/sort + invalid-input loops + binding/dup/injected/frozen | ✅ `pnpm check` GREEN |
| 1.3 corrective (independent gate FAILED → fixed) | same | Unit | same | ✅ **3 failed / 28 passed (31)** — deep-copy independence, closed-shape everywhere, ill-formed-Unicode on all identity strings (authentic regression, exact capture) | ✅ **24/24** (focused, table-driven) | ✅ deep-copy: input unfrozen/mutable, output frozen/independent; closed shape on command/subject/scope/outcome/nested-subject; Unicode on companyId/skillId/process/evidenceId/eventId/workId/nested skillId | ✅ `pnpm check` GREEN |

## Work Unit Evidence (Slice 1B)

| Evidence | Value |
|---|---|
| Focused test command + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/learning-candidate.test.ts` — original RED: **19 failed/19 passed (38)** → GREEN 29/29; corrective RED: **3 failed/28 passed (31)** → GREEN **24/24** |
| Runtime harness | N/A — pure domain unit slice; no runtime boundary (no app seam, no PG, no evaluator in this slice) |
| Rollback boundary | Remove `createLearningCandidate` + `ParseResult` re-export from `src/learning-candidate.ts`, revert 1.3 tests, drop index.ts export lines, revert 1.3 checkbox — no consumers (1.4–1.9, app, PG untouched) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` — GREEN: format ✓ typecheck ✓ build ✓ lint ✓ test **1434 passed / 6 skipped** (baseline 1429 + 5 new 1.3 test blocks). Warnings: **0 introduced by Slice 1B; 9 pre-existing** (parity.test.ts×6 noNonNullAssertion, business-pg-roundtrip.integration.test.ts×2 noUnusedFunctionParameters, worker-reconcile.test.ts×1 noUnusedImports — none in learning-candidate.test.ts; Slice 1B's 4 temporary noNonNullAssertion warnings removed via a guarded `firstOutcome` refactor). Pre-existing warnings are outside issue #67 scope and are tracked separately. |

## Corrective notes (independent apply gate)

1. Caller mutation: deep-copies EVERY nested object before `deepFreeze`; input stays unfrozen/mutable, output frozen/independent.
2. Closed shape: exact-key validation everywhere; Unicode on all identity strings (companyId/skillId/process/evidenceId/eventId/workId/nested skillId).
3. Final warning pass: replaced `input.outcomes[0]!` / `raw.outcomes[0]!` non-null assertions in the deep-copy test with a behaviorally-clear `firstOutcome` guard (`if (!firstOutcome) throw new Error('test setup: outcomes[0] is required')`), removing all 4 Slice 1B-introduced `noNonNullAssertion` warnings with zero rule suppression and unchanged behavior.

## Line count (Slice 1B corrected + final warning pass, vs clean 50744e3)

Source 147 + test 201/3 + index 6/1 + tasks 1/1 + this section 37/1 = **392 additions / 6 deletions = 398 total**, within the 400-line budget. Covers ONLY task 1.3 (pure domain); 1.4–1.8 remain the next stacked slice.
# Slice 1C — 1.4 RED + 1.5 policy-resolution (unit `promotion-policy-resolution`, token 1681819584…, base 5de9a15) — prior evidence preserved
Strict TDD; stacked-to-main. Status: **4/25** (1.4 complete; 1.5 PARTIAL — checkbox unchecked). No commit/push — parent gate decides next. Budget: NET additions+deletions = **397/3 = 400 ≤ 400**.
- Focused cmd (`PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/promotion-evaluation.test.ts`): original RED **11 failed / 0 passed** (`resolvePromotionPolicy is not a function`) → GREEN **7/7** (full gate 1441 passed / 6 skipped); corrective (independent gate FAILED) RED **3 failed / 10 passed** — rate rules rejected; bounds unenforced; foreign malformed identity poisoned → GREEN **6/6** (full gate 1440 passed / 6 skipped).
- REFACTOR: ✅ tests green after every step; consolidated to budget: loop-based explicit reconstruction, table-driven its, explicit helpers kept (generic parsePair/parseIdentity merges reverted — biome net losses).
- Runtime harness: N/A — pure domain resolver `resolvePromotionPolicy`; no runtime boundary (no app seam, no PG, no evaluator in this slice).
- Rollback: drop `src/promotion-evaluation.ts` + `test/promotion-evaluation.test.ts`, remove index.ts/lc export lines, revert 1.4 `[x]` + 1.5 PARTIAL note + this section — no consumers; prior slices 1A/1B untouched.
- Warnings: **0 introduced** by changed files; **9 pre-existing** remain (parity.test.ts×6, business-pg-roundtrip×2, worker-reconcile×1) — total 9, never claim zero total warnings.
- Full gate: `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1440 passed / 6 skipped**; line count **397 additions / 3 deletions = 400 total**.

---

# Slice 1D (corrected) — 1.5 `PromotionEvidence` + `aggregateSkillOutcomes` (unit `promotion-outcome-evidence`, token sha256:5692aa1b…, base a9afc73) — gate FAILED → corrected, same attempt
Strict TDD; stacked-to-main. Status: **4/25** (1.5 PARTIAL/unchecked).
### TDD Cycle Evidence
| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-------|------------|-----|-------|-------------|----------|
| 1.5 aggregate | Unit | ✅ 6/6 | ✅ original **15F/6P (21)**; gate **2F/15P (17)** (routing-envelope/8-field/full-fact first); final structural fix **1F/15P (16)** (`{skillId,version}` vs `{skillId,version,extra:undefined}` first) | ✅ **16/16** | ✅ 14 groups (gold, boundaries/empty, permutation, replay/conflict incl. divergent decoy/candidate + malformed-undefined, foreign-before-validation, malformed, routing-envelope, 8-field envelope, decoys, composite, sibling, no-evidence, immutability, invalid binding) | ✅ inlined refs loop; structural `factOf`; merged helpers; `pnpm check` GREEN |
### Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/promotion-evaluation.test.ts` — correction RED 2F/15P → GREEN 16/16; final fix RED 1F/15P → GREEN **16/16** |
| Runtime harness | N/A — pure domain aggregator; no runtime boundary (no app seam, no PG, no evaluator) |
| Rollback | revert aggregate block (`PromotionEvidence`/`aggregateSkillOutcomes`/`structural`/envelope+identity) + index exports + test block + 1.5 note + this section — no consumers; 1A–1C untouched |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1450 passed / 6 skipped** (baseline 1440) |
| Line count | **395 additions / 5 deletions = 400 total** |

## Gate findings → fixes (all code + tests): 1. Routing envelope: well-formed `eventType`/`aggregateKind`/`source` or fail closed; well-formed wrong routing = decoy. 2. Exact closed 8-field BusinessEvent envelope: plain proto + `badExtra` rejects injected keys. 3. Full-fact identity: JSON.stringify dropped `undefined` values so `{skillId,version}` collapsed as replay with `{skillId,version,extra:undefined}` — replaced by structural serialization (absent key ≠ present undefined ≠ array hole), order-independent. 4. Compact tables above; 5. budget ≤400 via consolidation; 6. 1.5 unchecked/PARTIAL.
