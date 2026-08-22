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


# Slice 1E-a (reset) — descriptor-safe unknown-data foundation (work unit `safe-data-foundation`, base 9eb2966) — Status **4/25**; 1.5/1.6 unchecked
> **Split/reset history (NO delivery claimed):** the earlier oversized Slice 1E attempt (416 add/2 del = 418 total; claimed `parseExplicitPromotionEvidence` with TWO in-attempt gate corrections) was split/reset by the maintainer because it exceeded the 400-line budget. It is superseded and NOT delivered. This slice delivers ONLY the internal descriptor-safe unknown-data foundation; evidence parsers (`parseExplicitPromotionEvidence`/`parseAuthorityEvidence`) are NOT delivered and remain pending.
### TDD Cycle Evidence
| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-------|------------|-----|-------|-------------|----------|
| 1E-a foundation | Unit | ✅ 16/16 focused (1C/1D at HEAD); full 1450/6 | ✅ **RED 1 file failed / no tests** — module `validation/safe-data.js` missing (import failure) | ✅ **18/18** (focused) | ✅ plain vs null-proto; non-objects/arrays; injected/inherited(custom proto)/hidden/symbol/accessor-no-execute; dense/empty; holes/extra-key/symbol/accessor-index/custom-proto; revoked record+array proxies; fresh output ×2 + no-freeze | ✅ shared `record`/`array` helpers, merged adversarial loops; `pnpm check` GREEN |
### Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/safe-data.test.ts` — RED: **1 file failed, no tests** (module not found) → GREEN **18/18** |
| Runtime harness | N/A — pure descriptor guards; no runtime boundary (no app seam, no PG, no evaluator) |
| Rollback | drop `src/validation/safe-data.ts` + `test/safe-data.test.ts` + 1.5 note edit + this section — internal module, no consumers, NOT in index exports; 1A–1D untouched |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1468 passed / 6 skipped** (baseline 1450/6; +18 focused) |
| Line count | **230 additions / 1 deletion = 231 total** (vs base 9eb2966: safe-data.ts 72, safe-data.test.ts 134, apply-progress 23, tasks.md 1/−1; target ≤240) |

### Notes
1. `readClosedDataRecord`/`readDenseDataArray` are INTERNAL (`src/validation/safe-data.ts`); intentionally NOT exported from `packages/business-domain/src/index.ts`.
2. Descriptor-safe contract: plain `Object.prototype`/null records only; own enumerable DATA descriptors only; symbols/hidden/accessors/custom prototypes/injected keys rejected; revoked proxies and any reflection failure return the stable `… is not a safe plain data structure` failure, never throw; fresh containers reconstructed, input never mutated/frozen.
3. Inherited mandatory fields are rejected because a custom prototype is itself rejected (`… must be a plain object`) — inherited values can never satisfy the closed-record contract.
4. Superseded oversized Slice 1E attempt (418 lines, claimed parser delivery) preserved as history above and NOT counted as delivered; no `parseExplicitPromotionEvidence`/`ExplicitObservation`/`ExplicitPromotionEvidence` exports or parser tests remain in the worktree (verified: `git diff` vs HEAD touches only the two new files + tasks/apply-progress docs).

# Slice 1E-b — internal safe-data recursive clone/freeze (`cloneAndFreezeSafeData`, base d1815bd, branch `feat/safe-data-clone-freeze`) — Status **4/25**; 1.5/1.6 unchecked
> Native runtime attempt token: `sha256:627d2fadfeb6ad6f63dea1cdd605e39ea0d16f3e364b0db425db265a0cf4019e`; a passing settle later remediates `sha256:e487cc4afc893c14c32eb2db5f5b13dd7ce4b10f00241ec34aaa3227539a2168`. Strict TDD; hybrid (OpenSpec canonical + Engram progress). This slice delivers ONLY the internal recursive clone/freeze foundation; no observation/parser code, no package-index exports.
### TDD Cycle Evidence
| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-------|------------|-----|-------|-------------|----------|
| 1E-b clone/freeze | Unit | ✅ 18/18 focused (1E-a at HEAD); full 1468/6 | ✅ **RED 11 failed / 18 passed (29)** — `cloneAndFreezeSafeData is not a function` (module export missing) | ✅ **29/29** (focused) | ✅ scalars×7 + nested/null-proto + freeze×5 containers + isolation both directions + accessors×2 + unsupported×7 + adversarial×5 + revoked×2 + cycles×2 | ✅ merged accessor cases (1 test), shared `rejects` loop, `Sample` alias; consolidated 29→**28/28**; `pnpm check` GREEN |
### Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/safe-data.test.ts` — RED: **11 failed / 18 passed (29)** → GREEN **29/29** → REFACTOR consolidation **28/28** |
| Runtime harness | N/A — pure descriptor clone/freeze helper; no runtime boundary (no app seam, no PG, no evaluator) |
| Rollback | revert `cloneAndFreezeSafeData`/`ReadonlyDeep`/`isSupportedScalar`/`clone` from `src/validation/safe-data.ts` + 10 test blocks from `test/safe-data.test.ts` + 1.5 note edit + this section — internal module, no consumers, NOT in index exports; 1A–1E-a untouched |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1478 passed / 6 skipped** (baseline 1468/6; +10 focused) |
| Line count | net additions+deletions vs clean d1815bd: safe-data.ts +69, safe-data.test.ts +105/−1, tasks.md +1/−1, apply-progress.md +22 = **197 additions / 2 deletions = 199 total ≤ 200 target / 400 hard** |

### Notes
1. Supported-scalar semantics (documented, suitable for validated parser values): finite `number` (rejects `NaN`/`±Infinity`), `string`, `boolean`, `null`; rejects `undefined`, `symbol`, `function`, `bigint`.
2. Reuses the 1E-a descriptor guards (`isData`, `readDenseDataArray`) — every read is descriptor-based (getters never execute); reflection failures (revoked proxies) return the stable `… is not a safe plain data structure`, never throw.
3. Cycle detection tracks the ancestor chain (`seen` add/delete in `finally`): shared non-cyclic refs clone per occurrence; true cycles fail with `… must not contain a cycle`.
4. Fresh containers are `Object.freeze`d at every level; input is never mutated/frozen. `ReadonlyDeep<T>` is a local module type; callers get `ParseResult<ReadonlyDeep<T>>`. NOT exported from the package index.

# Slice 1E-b (corrected, same token) — independent gate FAILED → fixed; no settle
> Same active native token `sha256:627d2fadfeb6ad6f63dea1cdd605e39ea0d16f3e364b0db425db265a0cf4019e`; passing settle later remediates `sha256:e487cc4afc893c14c32eb2db5f5b13dd7ce4b10f00241ec34aaa3227539a2168`. Strict TDD; authentic RED→GREEN below. Prior 1E-b section above is preserved as history.
### Gate findings → fixes
1. **`__proto__`/`constructor`/`prototype` reconstruction unsafe in BOTH `readClosedDataRecord` and the recursive clone record path**: outputs were plain `{}`, so `out['__proto__'] = value` invoked the inherited `__proto__` setter → output prototype became attacker-controlled (`{marker:true}`) and inherited values (`marker`, `toString`) leaked. Fix: **null-prototype outputs** (`Object.create(null)`) in both record paths — own special data fields stay own data, output prototype can never be attacker-driven, zero inherited leakage. Dense-array outputs are unaffected (index-only keys).
2. **Unconstrained caller-selected generic `<T>` unsound**: `cloneAndFreezeSafeData<T>` let callers assert arbitrary shapes without validation. Fix: replaced with the concrete recursive unions `SafeData` (mutable) / `ReadonlySafeData` (readonly) and signature `cloneAndFreezeSafeData(raw, path): ParseResult<ReadonlySafeData>` — callers narrow with explicit category checks + casts before treating values as domain types (future observation foundation). `ReadonlyDeep<T>` removed.
### TDD Cycle Evidence (corrective)
| Task | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-------|------------|-----|-------|-------------|----------|
| 1E-b special keys (reader + clone, top-level + nested) | Unit | ✅ 28/28 focused; full 1478/6 | ✅ **RED 3 failed / 29 passed (32)** — tests written first; output prototype polluted (`__proto__` setter), own-data descriptor missing, inherited `marker`/`toString` leak | ✅ **32/32** (focused) | ✅ reader + clone top-level + clone nested × own `__proto__`/`constructor`/`prototype` data fields + proto-null + no-leak assertions | ✅ `Object.create(null)` in both record paths; docs updated; `pnpm check` GREEN |
| 1E-b concrete return type | Type | same | ✅ **typecheck RED: `TS2578 Unused '@ts-expect-error'`** — `cloneAndFreezeSafeData<{nope:string}>` accepted under generic (directive unused) | ✅ typecheck GREEN (TS2558 consumed by directive) | ✅ `@ts-expect-error` contract test + runtime frozen-union assertion | ✅ `SafeData`/`ReadonlySafeData` unions replace `ReadonlyDeep<T>` |
### Work Unit Evidence (corrective)
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/safe-data.test.ts` — RED: **3 failed / 29 passed (32)** → GREEN **32/32**; `pnpm run typecheck` RED `TS2578` → GREEN |
| Runtime harness | N/A — pure descriptor clone/freeze helper; no runtime boundary |
| Rollback | revert the 4 corrective tests + null-proto outputs + union types from the two safe-data files + this section — internal module, no consumers, no index exports; prior behavior preserved |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1482 passed / 6 skipped** (baseline 1478/6; +4 corrective) |
| Line count | cumulative vs clean d1815bd: safe-data.ts +84/−2, safe-data.test.ts +203/−1, tasks.md +1/−1, apply-progress.md +46 = **334 additions / 4 deletions = 338 total ≤ 400 hard** |

### Notes (corrective)
1. Null-prototype record outputs preserve ALL documented reader/clone expectations: `toEqual` is prototype-agnostic, outputs stay fresh containers, mutation/freeze/isolation tests unchanged and passing.
2. `SafeData`/`ReadonlySafeData` are module-local exports (NOT package index); the `@ts-expect-error` line is the permanent compile-time contract that no caller-selected shape may be asserted.

# Slice 1E-b1-v2 (gate-corrected) — internal bound promotion-observation foundation v2 (base f316921) — Status **4/25**; 1.5/1.6 unchecked
> Native token `sha256:8a6aacdb6b0f8aae32a832b2f70b32b064a8453c0353f53596d02b2b4107aee7` (max 400); no settle/commit/push/review. Strict TDD; hybrid; stacked-to-main. Rebuilds v1 semantics atop MERGED `cloneAndFreezeSafeData` (PR #79): successful callback values cloned+frozen by the merged helper (recursively readonly). Internal: NOT in package index; no `parseExplicitPromotionEvidence`/`parseAuthorityEvidence`.
## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.6a v2 | `test/promotion-observation.test.ts` | Unit | ✅ 48/48 focused; full 1482/6 | ✅ RED: 1 file failed / no tests; gate RED: subject getter executed + revoked proxy threw `TypeError`; 3rd gate RED: malformed identities silently skipped in list | ✅ **4/4** | ✅ binding/category/foreign-before-content/throw/clone-freeze/sort/dense + descriptor-safe subject probe + `@ts-expect-error` ReadonlyDeep contract + malformed-identity tables | ✅ shared `MALFORMED_SUBJECTS`/`MALFORMED_COMPANIES`, foreignReason reuses `parseSubject`; `pnpm check` GREEN |
## Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `pnpm exec vitest run packages/business-domain/test/promotion-observation.test.ts` — RED → GREEN **4/4** (three rounds). Runtime harness: N/A — pure descriptor-safe domain foundation; no runtime boundary |
| Rollback | drop `src/validation/promotion-observation.ts` + test + 1.6 note + this section — internal, no consumers, not in index |
| Full gate | `pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1486 passed / 6 skipped**. Warnings: **0 introduced** (9 pre-existing) |
| Notes | Internal; NOT in package index; no parser. EXACT live count vs f316921: source 182 + test 202 + tasks 1/−1 + this section 14 = **399 additions / 1 deletion = 400 total ≤ 400 hard**. Foreign-before-content: only WELL-FORMED differing identities are foreign (skip in list / fail with binding reason in single); malformed identities (empty, wrong-type, invalid Unicode, nonpositive version) fail as malformed in BOTH single and list — never silently skipped. Descriptor-safe probes (own DATA reads; getters never run; revoked nested proxies fail stable). Shared evidenceId uniqueness applies to ACCEPTED observations only; canonical `(observedAt, evidenceId)` sort; dense arrays only; fresh frozen output, input mutable/unfrozen. Value typed `ReadonlyDeep<T>` (recursively readonly — nested mutation compile-time rejected via `@ts-expect-error` contract); throwing `ObservationValueParser` callbacks return the stable failure `… could not be parsed`, never escape. |

# Slice 1F — complete PUBLIC `parseExplicitPromotionEvidence` envelope (work unit `explicit-promotion-envelope`, base 59cb543)
> Native runtime token: `sha256:47d06b3176fa7ff1de81d4155f2babc61637bd981582aa35e14013c759dbb11d` (max 400). No settle/commit/push/review. Strict TDD; hybrid; stacked-to-main. Delivers ONLY the public envelope atop the merged safe-data + promotion-observation foundation; NOT authority/evaluator/events/repos/app/PG. Status: **4/25** (1.6 remains unchecked/PARTIAL — explicit parser complete, authority pending).
## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.6 explicit envelope | `test/explicit-promotion-evidence.test.ts` | Unit | ✅ 4/4 focused (promotion-observation) + full 1486/6 | ✅ **RED 12 failed / 12** (import failure — parser + 2 types not exported) | ✅ **12/12** (focused) | ✅ 12 groups: gold/minimal/types/top-closed/required-optional/global-duplicates/foreign-single/order/repeat/freeze/revoked/category-malformed | ✅ `pnpm check` GREEN |
## Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/explicit-promotion-evidence.test.ts` — RED: **12 failed/12** (module import error) → GREEN **12/12** |
| Runtime harness | N/A — pure domain envelope parser; no runtime boundary (no app seam, no PG, no evaluator in this slice) |
| Rollback | drop `ExplicitObservation`/`ExplicitPromotionEvidence`/`parseExplicitPromotionEvidence`/`parseEnvelopeSingle`/`parseEnvelopeList` + `ENVELOPE_KEYS`/`REQUIRED_ENVELOPE_KEYS` from `src/validation/promotion-observation.ts`, remove index.ts export lines, drop `test/explicit-promotion-evidence.test.ts`, revert 1.6 note + this section — no consumers (authority/evaluator not implemented); 1A–1E-b1-v2 untouched |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1498 passed / 6 skipped** (baseline 1486/6; +12 focused) |
| Line count | net additions+deletions vs clean 59cb543: promotion-observation.ts +109/−1, explicit-promotion-evidence.test.ts +195, index.ts +5, tasks.md 1/−1, apply-progress.md +21 = **331 additions / 2 deletions = 333 total ≤ 400 hard** |
## Notes
1. Public surface: index exports ONLY `parseExplicitPromotionEvidence` + `ExplicitObservation` + `ExplicitPromotionEvidence`; `RateValue`/`ConflictValue`/`VetoValue`/`ReadonlyDeep`/`BoundPromotionObservation`/binding/category parsers stay internal (no value-alias leaks).
2. `ExplicitObservation<T>` = public alias of `BoundPromotionObservation<T>` (recursively readonly `ReadonlyDeep<T>` value; `@ts-expect-error` mutation contract in the types test).
3. Envelope semantics: closed descriptor-safe record (5 keys); required `conflicts`/`catastrophicVetoes` (missing → fail); optional `confidence`/`sourceAuthority`/`rateObservations` absent when key absent, malformed when present `undefined`; ONE shared evidenceId set across all categories (cross-category duplicate → fail); foreign single observation omitted (well-formed differing identity), foreign list items skipped (foundation list parser); canonical `(observedAt, evidenceId)` list order; output `Object.freeze`d over already-frozen observations/lists, input never mutated/frozen; category errors propagate with `envelope.<category>` paths; revoked proxies fail stable, getters never execute.
4. Reuses foundation internals directly: `readClosedDataRecord`, `foreignReason`, `OBS_KEYS`, `parseBoundPromotionObservation`, `parseBoundPromotionObservationList`, all five category value parsers — no duplicated validation.

# Slice 1G — tasks 1.11 + 1.12 (work unit `authority-reference-and-scope`, token sha256:daea2865…, base c719b56) + corrective pass. Strict TDD; hybrid; stacked-to-main. Status: **7/32** (1.1–1.4, 1.6, 1.11, 1.12 complete; 1.5 PARTIAL). No commit/push/settle.
## TDD Cycle Evidence
| Task | Test File | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-----|-------|-------------|----------|
| 1.11 `parseAuthorityEvidence` | `test/authority-evidence.test.ts` | ✅ **7F/7** (`is not a function`) | ✅ **7/7** | ✅ missing×2, malformed×19, foreign×3, descriptor-safe×4, freeze, repeat | ✅ clean (table-driven) |
| 1.12 `promotionScopeFor`/`parsePromotionScope` | `test/promotion-scope.test.ts` | ✅ **11F/11** | ✅ **11/11** | ✅ ascii/utf8-byte/astral/colon/prefix/counts/versions/re-encode/freeze | ✅ clean (table-driven) |
## Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/authority-evidence.test.ts packages/business-domain/test/promotion-scope.test.ts` — RED 18F/18 → GREEN **18/18** |
| Runtime harness | N/A — pure domain parsers; no runtime boundary (no app seam, no PG, no evaluator in this slice) |
| Rollback | drop `src/promotion-scope.ts`, authority block in `src/validation/promotion-observation.ts`, both test files, index exports, revert 1.6/1.11/1.12 checkboxes + this section — no consumers (1.7/1.9/app/PG not implemented) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ (0 new warnings; 9 pre-existing) — test **1512/6** (baseline 1498/6; +14 refactored focused) |
| Corrective pass | The 399-line claim was invalid: it excluded mandated planning restoration. Gate recount (immutable base/tree c719b56/9bc0e392…) = **564** (apply-progress 20, design 76, tasks 95, index 10, promotion-observation 60, promotion-scope 83, authority test 107, scope test 113). REFACTOR-only correction, RED→GREEN history preserved: table-driven tests, condensed comments/flow, design.md merged (base prose kept where accurate + authority/scope contract inserted). Exact candidate vs HEAD AFTER correction: **392 ≤ 400** (apply-progress 15, design 27, tasks 95, index 6, promotion-observation 44, promotion-scope 68, authority test 81, scope test 56 — every tracked+untracked path counted, planning included). Focused 14/14; full gate GREEN (1512/6). Notes: `AuthorityUnavailableReason` 11-member union per design (envelope emits missing/malformed/foreign; repository resolve emits the rest); scope parser consumes UTF-8 BYTE counts (astral/colon-safe, mirroring `candidateIdFor`); the byte-for-byte re-encode gate rejects trailing bytes, wrong counts, leading zeros, and lossy/unsafe versions; GREEN fix was a TEST expectation bug (astral round-trip asserted `subject.skillId` instead of `companyId`). Remediates evidence revision sha256:ed5129be…; attempt token sha256:d231d370… settlement left to orchestrator. |

# Slice 2A (work-unit-2 child 1) — task 1.9 repository ports (unit `repository-validation-ports`, base 5befe0a)
> Work unit 2 (1.5r/1.7–1.9) exceeded the 400-line contract at apply (uncut candidate ≈767): auto-split along the chores' named sub-boundary per tasks.md, stacked-to-main. Child 1 = ports only; child 2 = evaluator + corpus (preserved in-session for the next child). Status: **8/32**; 1.5/1.7/1.8/1.10 remain unchecked for child 2.
## TDD Cycle Evidence (2A)
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.9 ports | `test/promotion-repositories.test.ts` | Type contract | ✅ 1512/6 full gate | ✅ tsc **11 errors** (8 TS2305/TS2724 exports missing + 3 unused `@ts-expect-error`) | ✅ typecheck clean + **2/2** | ✅ closed verb set ×5, `current:true` & command literal negatives | ✅ docs condensed; `pnpm check` GREEN |
## Work Unit Evidence (2A)
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `pnpm exec vitest run packages/business-domain/test/promotion-repositories.test.ts` — **2/2**; `pnpm run typecheck` — RED 11 errors → GREEN clean |
| Runtime harness | N/A — type-only port contracts; no runtime boundary (no fakes, adapters, app, or PG in this slice) |
| Rollback | revert ports additions (`LearningCandidateAppendResult`/`LearningCandidateTransition`/`LearningCandidateRepository`/`AuthorityTransitionProof`/`PromotionAuthority*`), index.ts 8-line export block, `test/promotion-repositories.test.ts`, 1.9 checkbox + this section — no consumers (fakes 2.3 / adapters 3.4,3.11 not implemented) |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ — test **1514/6** (baseline 1512/6; +2) |
| Line count | Exact candidate vs clean 5befe0a: ports +99, index +10, repositories test +99 (untracked), tasks +1/−1, apply-progress +22 = **232 ≤ 400** (every tracked+untracked path counted) |

### Delivery gate (2A) — STOPPED, maintainer action required
Native review lifecycle followed verbatim (status → collect selection → `review.start` with `--consent=relay`):
1. **Blocking consent envelope (`gentle-ai.review-integration.consent/v3`, target sha256:24b98af0c32ddb15d06b1c3f74d8fdd987cb7dda1c5140da7797ab97ee05feb9)** returned at `review.start` — answers `granted`/`declined` are the human's; NOT answered by apply.
2. `review validate --gate pre-commit` → `receipt_scope_changed` (`review-37c9cafbfe3cc4ab` @ sha256:85dba34ec2dc7c12360ab2873c20f3a0c1f34492c917b80f223157e73a36803b → 8 differing paths vs live). `next_action: explicit-maintainer-action` via `review.recover` (predecessor/successor lineage, disposition, reason, actor). `repair --preflight`: 112 lineages, 0 eligible candidates — no automated path.
3. No commit/push/PR performed (gates must not be forced).
4. **Split geometry (raw counts vs baseline 5befe0a)**: child 1 (delivered above) 1.9 ports = **232 ≤ 400**; child 2 candidate 1.7/1.8 evaluator+corpus = **≈650 pre-compression (evaluator +185, corpus +465)** — exceeds 400 even alone, so the stacked chain resolves as THREE children: 2A ports (this slice), 2B `evaluatePromotion` GREEN + a lean green-focused policy/veto/authority gate set, 2C the full 1.8 quality corpus (gold/decoy/reorder/missing/veto-count/absent-revoked-authority/retired/boundary) + 1.5r completion + 1.10. 2B/2C sources+tests preserved in `/tmp/opencode/slice-b/{evaluator-full.ts,corpus-full.ts}`; each child keeps tests with its behavior and lands only after its predecessor merges.

# Slice 2B (work-unit-2 child 2) — 1.5r + 1.7 `evaluatePromotion` — stacked-to-main, base d2dc757 — Status **10/32**
Strict TDD; hybrid. Full evidence in Engram `sdd/learning-promotion/apply-progress`; summary below.
TDD: `test/promotion-evaluation.test.ts` (Unit) — safety ✅ focused 16/16 + full 1514/6; RED ✅ **14F/16P** (`evaluatePromotion is not a function`); GREEN ✅ **21/21**; TRIANGULATE ✅ 6 gate families (gold/order/frozen-ids, inactive, conflict+veto-before-thresholds, undelegated+reserved, authority missing/revoked/mismatch/foreign, insufficient positive/linked/harmful-cap); REFACTOR ✅ `pnpm check` GREEN after every step (format-compliant consolidation for the 400-line contract).
Focused: `PATH=/data/node24/bin:$PATH pnpm exec vitest run packages/business-domain/test/promotion-evaluation.test.ts` → 21/21. Runtime harness: N/A — pure domain evaluator (no app seam/PG in this slice).
Full gate: `PATH=/data/node24/bin:$PATH pnpm check` GREEN — format ✓ typecheck ✓ build ✓ lint ✓ (0 new warnings; 9 pre-existing) — test **1520 passed / 6 skipped**.
Rollback: remove `evaluatePromotion`/`PromotionResult`/`PromotionReason` block from `src/promotion-evaluation.ts`, revert 1.7 test section, revert `src/index.ts` export lines, revert 1.5/1.7 checkboxes + this section — consumers are only the 2C corpus (preserved in /tmp); 2A ports and prior slices untouched.
Deviations (defined in 2A delivery + Engram `sdd/learning-promotion/evaluator-semantics` #6863): 5th param is `PromotionAuthorityResolution` (not raw `AuthorityEvidence`) so absent/revoked authority reaches `needs-review` in the pure domain; reserved gate = `delegatedRiskClasses` ∋ `critical` ⇒ `'risk-reserved'` at evaluation; escalation order: policy-inactive → conflict-unresolved → veto-triggered → risk-undelegated → risk-reserved → source-authority-not-allowed → authority reasons.
Out: 1.8 exhaustive corpus and 1.10 final gate remain CHILD 2C (unchecked; 1.5r completion fully landed here).
Line count (vs d2dc757, code+tests+planning): 392 additions / 3 deletions = **395 ≤ 400**.

### Correction pass (R3-001, bounded 96-line budget): `evaluatePromotion` now binds EVERY explicit observation to the candidate (companyId + subject equality) BEFORE escalation/threshold logic — foreign conflicts/vetoes/rate observations ignored; foreign confidence/sourceAuthority become typed `*-unavailable` (never binding, never escalated); missing stays unknown/never-harmful. Strict TDD: RED **4F/22P** → GREEN **26/26**; full gate **1524/6**; 0 new warnings (9 pre-existing); no ports/index/corpus changes.

# Slice 2C (work-unit-2 child FINAL) — task 1.8 promotion quality corpus + 1.10 full gate (unit `promotion-quality-corpus`, base 34528a7)
> Work unit 2 stacked chain: 2A ports (merged) → 2B evaluator (merged PR #87) → **2C FINAL child** targets `main`. Strict TDD; hybrid; 400-line budget. No production-code edits in this child — corpus characterizes the MERGED `evaluatePromotion` against locked semantics (Engram #6863 evaluator-semantics + #6867 R3-001 binding).
## Status: 12/32 (1.1–1.4, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12 complete; 1.5 closed via 1.5r in 2B). Work unit 2 (1.5r, 1.7–1.10) COMPLETE.
## HONEST TDD evidence (corpus vs pre-merged evaluator)
- RED: **n/a by construction** — `evaluatePromotion` merged at 34528a7 (PR #87) before this slice. The corpus is a behavioral characterization of the locked contracts (escalation-before-thresholds, candidate-bound explicit evidence, typed `*-unavailable` reasons). No RED fabricated; the STOP-condition (corpus case failing against the merged evaluator) did NOT trigger.
- First observed run (corpus written → focused runner): `pnpm exec vitest run packages/business-domain/test/promotion-quality-corpus.test.ts` → **8 passed (8) immediately**. No patch to evaluator/ports/index in this child; zero production lines changed.
## TDD Cycle Evidence (2C)
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.8 | `test/promotion-quality-corpus.test.ts` | Unit | ✅ 1524/6 full suite (merged main baseline) | ➖ n/a — production pre-merged (characterization corpus) | ✅ **8/8** first run | ✅ 8 table-driven families: gold(×2 incl. all optional gates), decoy, reorder-identical, missing-never-harmful(×4 reasons), veto-count 1/5, absent+revoked authority, retired+history-intact, Stage-4 boundary | ✅ biome format (1 file); full gate GREEN |
## Work Unit Evidence (2C)
| Evidence | Value |
|----------|-------|
| Focused command + exact result | `pnpm exec vitest run packages/business-domain/test/promotion-quality-corpus.test.ts` — **8 passed / 8** (first run; no failures observed) |
| Runtime harness | N/A — pure domain corpus over the pure evaluator; no runtime boundary (no app seam, no PG in this slice) |
| Rollback boundary | Drop `packages/business-domain/test/promotion-quality-corpus.test.ts`, revert the two tasks.md checkboxes + this section — zero production files touched; 2A/2B and all prior slices untouched |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate (task 1.10) | `pnpm check` — **exit 0**: format ✓ typecheck ✓ build ✓ lint ✓ (9 pre-existing warnings) → test **1532 passed / 6 skipped** (baseline 1524/6 + 8 corpus) |
| Line count (vs 34528a7) | corpus 281 + tasks.md 2 (net) + this section 45 = **328 additions ≤ 400** |

# Slice W3A (work-unit-3 child 1) — 2.3 candidate fake + 2.4 candidate tests (unit `learning-candidate-fake`, base 7003f50)
> Work unit 3 (2.1–2.6) crossed 400 at apply (uncut candidate ≈1350): auto-split per tasks.md contingency along named sub-boundaries (fakes, learning/, verify hook) — and because the "fakes" sub-boundary alone (candidate+authority) ≈650, it splits further into W3A (candidate fake) + W3B (authority fake). Stacked-to-main; each child targets main after its predecessor merges. Strict TDD; hybrid.
## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.3 candidate fake | `test/learning-candidate-fake.test.ts` | Unit | ✅ 1532/6 full baseline | ✅ **11 failed / 11** (`InMemoryLearningCandidateRepository` not exported) | ✅ **11/11** | ✅ replay/collision/stale/conflict/races ×2/tenant/INSERT-only | ✅ biome format (1 pass); `pnpm check` GREEN |
## Work Unit Evidence
| Evidence | Value |
|----------|-------|
| Focused cmd + exact result | `pnpm exec vitest run packages/business-domain/test/learning-candidate-fake.test.ts` — RED 11F/11 → GREEN **11/11** |
| Runtime harness | N/A — pure in-memory fake; no runtime boundary (no PG/daemon/adapters in this child) |
| Rollback | revert `InMemoryLearningCandidateRepository` from `ports/fakes.ts` + index export + drop `test/learning-candidate-fake.test.ts` + this section — no consumers (authority fake, app seam, PG adapter not implemented) |
| Warnings | **0 introduced**; **9 pre-existing** (parity×6, business-pg-roundtrip×2, worker-reconcile×1) |
| Full gate | `pnpm check` — exit 0: format ✓ typecheck ✓ build ✓ lint ✓ → test **1543 passed / 6 skipped** (baseline 1532/6; +11) |
| Line count (vs 7003f50) | fakes.ts +95, index.ts +1, test +264, this section +15 = **375 additions ≤ 400** |
### Semantics (locked for W3B/3.x parity)
1. appendInitial: revision-1 candidate only (else throw); ON CONFLICT DO NOTHING — equal digest 'replayed', divergent digest 'idempotency-collision', original preserved.
2. appendTransition: parent missing / expectedRevision 0 or > leaf → 'stale'; occupied parent claim equal digest → 'replayed'; divergent digest → 'conflict' (one winner current); parent == leaf → append revision+1 with state/toState, supersedesRevision, transition copied; subject/scope/outcomes carried from parent.
3. Serialized critical section = synchronous decision block (no internal awaits); concurrent identical appends → exactly one appended; concurrent divergent transitions → exactly one winner.
4. Tenant guard on EVERY operation (empty companyId throws); foreign tenant resolves undefined/empty; INSERT-only (no update/delete surface, compile-time proven).

# Slice W3B1 (work-unit-3 child 2a) — 2.3 authority fake code + core tests (unit `promotion-authority-fake`, base 7003f50)
> The "fakes" sub-boundary alone (candidate+authority) exceeded 400 (~650 raw), so it splits further: W3A candidate fake (merged before this), then W3B1 authority fake CODE + core tests and W3B2 the extended coverage tests. Stacked-to-main; strict TDD; hybrid.
TDD: `test/promotion-authority-fake.test.ts` (Unit) — safety ✅ baseline 1532/6 (and 1543/6 with W3A); RED ✅ **17F** (missing export, full matrix drafted first in one attempt); GREEN ✅ **8/8 core** (+10 extended verified on the ephemeral W3B1+coverage tree → 18/18). TRIANGULATE ✅ 8 core families. REFACTOR ✅ trimmed docs; `pnpm check` GREEN.
Focused: `pnpm exec vitest run packages/business-domain/test/promotion-authority-fake.test.ts` → **8/8**. Runtime harness: N/A — pure in-memory fake (no PG/daemon/adapters). Warnings: 0 introduced; 9 pre-existing. Full gate: `pnpm check` exit 0 → **1540/6**.
Line count (vs 7003f50): fakes.ts +205, index.ts 3/−1, core test +181, this section +9 = **397 ≤ 400**.
Semantics (locked, Engram mirror): PK (companyId, proofId, proofRevision); per-tenant UNIQUE transition identity with SAME-proof-chain exempt (self-FK supersede); supersede target MUST exist; revocation = superseding revoked revision; resolve order = binding→revoked→command→principal→policy→scope→issuedAt→proof-own window→delegation backing (missing/absent→proof-unavailable; grant/delegate/action/scope/states trap) →clamped window; 0 rows→missing; >1 leaves→ambiguous; fail closed without delegation backing.

# Slice W3B2 (work-unit-3 child 2b) — 2.4 authority extended coverage (unit `promotion-authority-coverage`, base 7003f50)
> Completes the 2.3/2.4 delivery together with W3A + W3B1. Strict TDD; hybrid. Test-only child (2C corpus precedent): behavior already merged W3B1; extended matrix characterizes locked fake semantics.
TDD: `test/promotion-authority-coverage.test.ts` (Unit) — RED ✅ **10F** on main-base (import failure, honest — W3B1 not merged) → GREEN ✅ **10/10** on the combined tree (18/18 with core). Families: ambiguous×1, foreign×2, principal×2, policy×1, forged-command×1, stale×3, delegation backing×3 (absent/missing-row/revoked/delegate/clamped-window), transition identity, PK tenant isolation.
Focused: `pnpm exec vitest run packages/business-domain/test/promotion-authority-coverage.test.ts` — RED 10F (main-base) → GREEN **10/10** (W3B1+W3B2 tree). Runtime harness: N/A (pure fake). Warnings: 0 new; 9 pre-existing.
Rollback: drop the coverage test file + revert the two tasks.md checkboxes + this section (no production files touched in this child).
Line count (vs 7003f50): coverage test +222, tasks.md 2/−2, this section +7 = **231 ≤ 400**.

# Work unit 3 children W3C1–W3D2 (app seam + verify hook, stacked on W3A/B1/B2)
> Stacked-to-main; strict TDD; hybrid. Each child's diff vs its predecessor: W3C1 seam 397 (evaluate.ts 184 + core test 3/3), W3C2 gates 158 (3/3), W3C3 typed matrix 341 (9/9 incl. authority never-promote matrix, skill guards, malformed/zero/conflict/foreign isolation), W3D1 verify hook 394 (verify.ts 116 + 3/3: atomic win/rollback-proof/invalid-state), W3D2 hook coverage 223 (3/3: revocation supersede, delegation-missing, version-conflict zero-writes).
TDD: W3C1 RED ✅ 1 file failed/no tests (module missing) → GREEN 3/3; W3C2/W3C3 characterization over the shipped seam (2C precedent) → GREEN 3/3 + 9/9; W3D1 RED ✅ 1 file failed/no tests → GREEN 3/3; W3D2 GREEN 3/3. Safety net: baseline 1532/6 → final **1582/6**.
Gate (task 2.5): `pnpm check` exit 0 — format ✓ typecheck ✓ build ✓ lint ✓ (9 pre-existing warnings) — test **1582 passed / 6 skipped**.
Deviations (Engram `sdd/learning-promotion/app-seam` + `sdd/learning-promotion/verify-hook`): seam deps = {events, skills, authority, trusted{principalId,actorId}} (design listed only {events,skills}; repository authority resolution requires the extra ports); verify-hook transition identity = (workId, 1) canonical (design left identity free); work-unit 3 split into EIGHT children (W3A/W3B1/W3B2/W3C1/W3C2/W3C3/W3D1/W3D2) because the named sub-boundaries "fakes" and "learning/" each also crossed 400 at apply — no size:exception.
Runtime harness: N/A — app-layer seam + hook over pure in-memory fakes; no PG/daemon/runtime boundary in this work unit.
Rollback: per child — drop the child's files + revert its checkbox/section; all files are new modules with no prior consumers.
