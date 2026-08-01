# Apply Progress — context-compiler (PR 1 + PR 2 + PR 3 merged)

**Change**: context-compiler
**Slice**: PR 1 of 3 (tasks 1.1–1.3) + PR 2 of 3 (tasks 2.1–4.2) + PR 3 of 3 (tasks 5.1–5.4), stacked-to-main
**Mode**: Strict TDD (RED → GREEN per task; tests ship with code)
**Status**: 13/13 tasks complete across all three PRs. Worker now compiles the canonical context via `compileContext`; legacy `stable-prefix.ts` deleted.
**Baseline**: PR 1 @ 3458b81 — 785 passed / 3 skipped. PR 2 final: 813 passed / 3 skipped. PR 3 final: **813 passed / 3 skipped, `pnpm check` exit 0 (E2E vs live PG ran: 5 files / 9 tests green, 0 PG skips)**.

---

## PR 1 slice (from previous batch — preserved)

### TDD Cycle Evidence (PR 1)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `packages/context/test/boundary.test.ts` | Unit (pkg boundary) | N/A (new) | ✅ Written — ENOENT `packages/context/package.json` | ✅ Passed 5/5 | ✅ 5 pkg assertions (name/deps/devDeps/peer/private+ESM) | ➖ None needed |
| 1.2 | `packages/context/test/context-compiler.test.ts` | Unit | N/A (new) | ✅ Written — `Cannot find module '../src/index.js'` | ✅ Passed 4/4 | ✅ 4 cases (13 rows, id order, positions 1–13, stable/dynamic partition + no-interleave) | ✅ Table rows + types only; no dead code |
| 1.3 | `packages/context/test/context-compiler.test.ts` | Unit | N/A (new) | ✅ Written — `TypeError: segment.render is not a function` (5 failing) | ✅ Passed 5/5 | ✅ 5 cases (2–10 ABSENT, 12–13 ABSENT, 1+11 present, fixed position no-shift, zero-byte concat) | ✅ Extracted `renderCurrentWork`; shared elide `() => ({present:false})` |

### Work Unit Evidence (PR 1)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm test packages/context` → 14 passed / 0 failed / 2 files |
| Runtime harness command/scenario | N/A — pure package, no I/O, no runtime boundary this slice (per tasks.md unit 1). Full `pnpm check` is the compile+lint gate. |
| Rollback boundary | Delete `packages/context/`; revert `tsconfig.json`, `tsconfig.build.json`, `biome.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` to main @ e7b5fe8. No other files touched. |

### Files Changed (PR 1)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/context/package.json` | Created | `@io/context`, private ESM, dep `@io/business-domain: workspace:*` ONLY, `@types/node` dev |
| `packages/context/src/segments.ts` | Created | 13-position §7.2 table (R1), `Segment`/`SegmentRender`/`CompileContextInput`, `render` elide (R4); seg 1 = migrated `STABLE_SYSTEM_PREFIX` bytes, seg 11 = migrated `buildUserTail` bytes, others ABSENT |
| `packages/context/src/index.ts` | Created | Public surface: `SEGMENTS` + segment/render types |
| `packages/context/test/boundary.test.ts` | Created | Package boundary: deps === business-domain only, zero peer/optional/bundle, private ESM (mirrors llm-client) |
| `packages/context/test/context-compiler.test.ts` | Created | R1 order tests (4) + R4 absent/elide tests (5) |
| `tsconfig.json` | Modified | +`packages/context/**/*.ts` include |
| `tsconfig.build.json` | Modified | +`packages/context/src/**/*.ts` include |
| `biome.json` | Modified | +context src/test/package.json includes (mirrors llm-client registration) |
| `pnpm-workspace.yaml` | Modified | Comment line for sixth package (glob `packages/*` already covers it) |
| `pnpm-lock.yaml` | Modified | `pnpm install` registered `packages/context` (lockfile importers + workspace link) |

### Boundary Evidence (PR 1)

- `packages/context/package.json` dependencies === `{ "@io/business-domain": "workspace:*" }` ONLY.
- src imports scan: `packages/context/src/*.ts` import specifiers are `@io/business-domain/src/index.js` (type-only) + relative `./segments.js`. No `llm-client`, no `openai`, no `@io/app`, no forbidden builtins in src. (Full src-scan boundary test landed in task 4.2.)

---

## PR 2 slice (this batch) — tasks 2.1, 2.2, 3.1, 3.2, 4.1, 4.2

### TDD Cycle Evidence (PR 2)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `packages/context/test/context-compiler.test.ts` | Unit | ✅ 14/14 (PR 1 baseline) | ✅ Written — `TypeError: buildStablePrefix is not a function` (4 failing) | ✅ Passed 13/13 | ✅ 5 cases (real-table protocol lead, synthetic forbidden suffix excluded, segs 1–2 absent ⇒ seg 3 leads, empty prefix, dynamic-vs-stable never interleaved) | ✅ Optional `segments` param (default `SEGMENTS`) keeps canonical table immutable for R3 edge cases |
| 2.2 | `packages/context/test/prefix-stability.test.ts` (ISOLATED) | Unit + golden | ✅ 13/13 | ✅ Written — 3 failing (golden ENOENT + process/delegation purity; prefix was constant pre-seg5/8) | ✅ Passed 7/7 | ✅ 7 cases (golden pin, same-cohort≠work byte-identity, work leak guard, delegation id/PII leak guard, process purity, delegation purity, determinism/no-nonce) | ✅ Golden path derived from `CONTEXT_SCHEMA_VERSION` → bump without regenerating golden breaks the pin (R6 structural) |
| 3.1 | `packages/context/test/cohort.test.ts` | Unit | ✅ 25/25 | ✅ Written — `deriveCohort is not a function` (5 failing) | ✅ Passed 5/5 | ✅ 5 cases (shape `io:acme:planning:v2`, no-work-input purity, PII-free, version export, version-in-derivation) | ✅ deriveCohort input type `{companyId,process,schemaVersion}` = the PII-free allowlist itself |
| 3.2 | `packages/context/test/cohort.test.ts` | Unit | ✅ 30/30 | ✅ Written — bump contract tests (vN≠vN+1, same-cohort-same-version determinism, version embed) — GREEN on first run because 3.1's GREEN already shipped the generic `schemaVersion` parameter; documented honestly as contract pinning, not fake RED | ✅ Passed 8/8 | ✅ 3 cases (v1≠v2, v3 deterministic, `CONTEXT_SCHEMA_VERSION` embed) | ➖ None needed |
| 4.1 | `packages/context/test/compile-context.test.ts` | Unit | ✅ 33/33 | ✅ Written — `TypeError: compileContext is not a function` + `buildDynamicSuffix` missing (5 failing) | ✅ Passed 5/5 | ✅ 5 cases ([system prefix, user suffix] shape, structural LlmMessage-compat via local mirror type, derived user, pure+spy-not-invoked+deterministic, version embed R6) | ✅ `ContextMessage`/`CompiledContext` interfaces extracted; compileContext composes builders, no client coupling |
| 4.2 | `packages/context/test/boundary.test.ts` | Unit (pkg boundary) | ✅ 38/38 | ✅ Written — src-scan assertions; GREEN on first run because src was already BD-only (approval/pinning test; detector self-test proves scan is non-trivial) | ✅ Passed 9/9 | ✅ 4 cases (non-trivial discovery, detector catches `openai`/`node:fs`/`@io/llm-client`, per-file forbidden scan, non-relative imports === BD type-only) | ➖ None needed |

### Work Unit Evidence (PR 2)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm test packages/context` → 42 passed / 0 failed / 5 files (2.1–4.2). 2.2 isolated run: `pnpm test packages/context/test/prefix-stability.test.ts` → 7/7. |
| Runtime harness command/scenario | N/A — golden pin IS the byte-stability harness (per tasks.md unit 2): `test/fixtures/prefix.v1.golden.txt` (529 bytes) pinned and read back byte-for-byte; no runtime boundary exists in a pure package. |
| Rollback boundary | Revert `packages/context/src/{index,segments}.ts` + `packages/context/test/{context-compiler,boundary,prefix-stability,cohort,compile-context}.test.ts` + delete `packages/context/test/fixtures/`; PR 1 shell inert. No root-config files touched in PR 2. |

### Files Changed (PR 2)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/context/src/segments.ts` | Modified | +`buildStablePrefix` (1–9 → system prefix, forbidden-leading guard R3), +`buildDynamicSuffix` (10–13 → user suffix), sourced seg 5 `renderRoleContract` (delegation → authorityScope+expectedOutcome, ABSENT without delegation) and seg 8 `renderBusinessProcess` (process token) per design component table |
| `packages/context/src/index.ts` | Modified | +`CONTEXT_SCHEMA_VERSION = 1` (D6/R6), +`deriveCohort` (R5), +`ContextMessage`/`CompiledContext` (D2 structural), +`compileContext` (R7 pure: [system prefix, user suffix] + derived user) |
| `packages/context/test/context-compiler.test.ts` | Modified | +R3 forbidden-leading tests (2.1); PR 1 R4 tests updated to compiler-slice present-set (seg 8 sourced from process; seg 5 sourced with delegation) |
| `packages/context/test/prefix-stability.test.ts` | Created | 2.2 (ISOLATED): golden pin + byte-identity + leak guards + structural purity + determinism |
| `packages/context/test/fixtures/prefix.v1.golden.txt` | Created | Golden pin: exact prefix bytes (529) for `CONTEXT_SCHEMA_VERSION=1` — protocol + role-contract + business-process, zero work/ids |
| `packages/context/test/cohort.test.ts` | Created | 3.1 (R5 derivation) + 3.2 (R6 bump contract) |
| `packages/context/test/compile-context.test.ts` | Created | 4.1 (R7 output contract) |
| `packages/context/test/boundary.test.ts` | Modified | +4.2 src-scan: forbidden specifiers (llm-client/openai/@io-app/none-BD packages + I/O/network/subprocess/os builtins), BD type-only enforcement |

### Boundary Evidence (PR 2)

- `packages/context/package.json` dependencies === `{ "@io/business-domain": "workspace:*" }` ONLY (unchanged from PR 1).
- **src-scan (4.2, mirrors llm-client)**: every src file import is either relative (`./segments.js`) or `@io/business-domain/src/index.js` **type-only** (`import type`). **ZERO** `@io/llm-client`, **ZERO** `openai`, **ZERO** `@io/app`, **ZERO** forbidden builtins (fs/net/http/https/dgram/dns/tls/child_process/cluster/worker_threads/os/path) in `packages/context/src/`. Boundary test asserts all four conditions file-by-file (9 assertions in the boundary block).

### Golden Pin Mechanics (2.2)

- Path: `packages/context/test/fixtures/prefix.v1.golden.txt` (filename derives from `CONTEXT_SCHEMA_VERSION` — currently 1).
- Byte-stability is STRUCTURALLY guaranteed three ways:
  1. `buildStablePrefix` filters positions 1–9 only — dynamic segments 10–13 can never enter the prefix.
  2. Seg 5 reads only `authorityScope` + `expectedOutcome` (no delegationId/names/emails); seg 8 reads only `process`; seg 11 (work) is in the suffix. Work/ids/nonce/clock have no path into prefix bytes (proven by leak-guard + determinism tests).
  3. The golden pin: any silent change to prefix bytes fails `buildStablePrefix(seed) === golden` until the golden is regenerated AND `CONTEXT_SCHEMA_VERSION` is bumped — R6 silent-change prohibition is enforced by the test itself.

### Deviations from Design

1. **Seg 5/8 sourced in PR 2** (design component table: "Source this slice") — PR 1 shipped them ABSENT; the compiler slice sources role-contract (delegation) and business-process (process) so the prefix is a real pure function of cohort inputs. Consequence: 3 of PR 1's R4 tests were updated from the shell present-set `[1, 11]` to the compiler present-set `[1, 8, 11]` (documented inside the test file). R4's elide mechanism is unchanged.
2. **`buildStablePrefix`/`buildDynamicSuffix` take an optional `segments` param** (default `SEGMENTS`) — needed to exercise R3's "segs 1–2 ABSENT ⇒ seg 3 leads" without mutating the canonical immutable table. Pure, defaults to the constant; no contract change.
3. **`buildStablePrefix`/`buildDynamicSuffix`/`CONTEXT_SCHEMA_VERSION` exported from `index.ts`** — the design's public-API block lists only `compileContext`/`deriveCohort`, but the builders + version are the compiler's building blocks, needed by tests (and PR 3's wiring will only touch `compileContext`). Zero extra coupling.
4. **3.2 RED noted as contract pin, not failing test** — 3.1's GREEN delivered `deriveCohort` with the generic `schemaVersion` parameter, so 3.2's bump assertions passed on first run. The tests still pin vN≠vN+1 and version-embed (regression-proof against a hardcoded `v1`); the end-to-end R6 "compiled user changes on bump" is covered in 4.1 via `CONTEXT_SCHEMA_VERSION` embed. Recorded honestly — no fake RED.
5. **4.2 RED noted as approval/pinning test** — src was already BD-only from PR 1; the scan pins that invariant and its detector self-test proves it catches real offenders (`openai`, `node:fs`, `@io/llm-client`).

## PR 2 Adversarial Review Amendment — seg 5 → ABSENT (CRITICAL fix)

**Finding (CRITICAL, candidate-caused):** PR 2 sourced seg 5 (role-contract) from `delegation` (`authorityScope.scope`/`actions` + `expectedOutcome`). But `deriveCohort` = `io:{companyId}:{process}:v{schemaVersion}` discriminates ONLY on `{companyId, process, schemaVersion}` — `expectedOutcome`/`actions`/`scope` are NOT cohort discriminators. Proven empirically: two inputs with the SAME cohort but different `expectedOutcome` (or `actions`) rendered DIFFERENT stable-prefix bytes → violates R2 ("segments 1–9 byte-identical per cohort") → DeepSeek KV-cache poisoning (a cache hit serves a role contract the current request never supplied). The prior 2.2 test "prefix IS a function of delegation" codified the bug as a feature.

**Decision (architecture §7.2/§7.3):** per-delegation detail is per-request DYNAMIC content, never cohort-stable, so it MUST NOT appear in the stable prefix. No cohort-stable role-contract source exists this slice → seg 5 reverts to ABSENT (matching the legacy prompts, which never contained a role contract). Stable prefix is now `{seg 1 protocol, seg 8 business-process}` — a pure function of `{companyId, process, schemaVersion}` ≡ the cohort; `deriveCohort` is injective w.r.t. prefix content. Per-delegation dynamic content is future work — NOT added to the suffix this slice.

**Strict-TDD evidence:**
- RED: new inverse test `R2 inverse: same cohort + ANY delegation variation ⇒ byte-identical prefix AND same cohort` (prefix-stability.test.ts) FAILED pre-fix — different `expectedOutcome` produced `...expected outcome: a completely different outcome...` vs the baseline bytes, cohort identical.
- GREEN: reverted seg 5 to `render: () => ({ present: false })`, deleted `renderRoleContract`; inverse test passes (4 delegation variants — different outcome/actions/scope + delegation-undefined — all yield identical prefix bytes AND identical `user`).
- Bad test fixed: removed "prefix IS a function of delegation"; replaced with the correct cohort-only contract.

**No schema bump:** segment table positions unchanged; only seg 5's rendered content went from a buggy delegation-read to ABSENT — a v1 bugfix, not a schema change. Golden filename stays coupled to `CONTEXT_SCHEMA_VERSION=1`.

**Supersedes (within PR 2 evidence above):** the rows/notes claiming seg 5 is "sourced" (Files-Changed seg 5 line, Golden-Pin-Mechanics item 2 "Seg 5 reads only authorityScope+expectedOutcome", Deviation 1 "seg 5 sourced") are historical and now superseded by this amendment — seg 5 is ABSENT.

| File | Action | Amendment change |
|------|--------|------------------|
| `packages/context/src/segments.ts` | Modified | seg 5 `renderRoleContract` deleted → `render: () => ({ present: false })`; `Delegation` import kept (still types `CompileContextInput.delegation`, reserved for future dynamic use) but the prefix no longer reads it; `SEGMENTS` array + each segment `Object.freeze`-d (immutability WARNING); doc comments updated |
| `packages/context/test/prefix-stability.test.ts` | Modified | +R2 inverse test (same cohort + 4 delegation variants ⇒ identical prefix + identical cohort); removed the wrong "prefix IS a function of delegation" test; header/seed/leak-guard comments corrected (delegation is NOT a cohort input) |
| `packages/context/test/context-compiler.test.ts` | Modified | comment corrected: seg 5 ABSENT this slice (R2), not "present only with delegation"; present-set assertion `[1, 8, 11]` unchanged (correct — seg 5 absent) |
| `packages/context/test/fixtures/prefix.v1.golden.txt` | Regenerated | 529 → 395 bytes: protocol + business-process; role-contract sentence removed (no seg 5) |
| `openspec/changes/context-compiler/design.md` | Modified | component table seg 5 → "ABSENT this slice"; byte-stability statement drops `delegation`; amendment paragraph added |

**Gate after amendment:** `PATH=/data/node24/bin:$PATH pnpm check` → 813 passed / 3 skipped, exit 0 (== baseline). Coupling unchanged: `packages/context` deps === `@io/business-domain` only.

---

## PR 3 slice (this batch) — tasks 5.1, 5.2, 5.3, 5.4 (worker wiring + delete legacy)

### TDD Cycle Evidence (PR 3)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1 | `packages/app/test/worker-authority.test.ts` | Unit | ✅ 129/129 (packages/app) | ✅ Written — ALLOWs test `toEqual({ok:true, delegation})` failed: actual `{ok:true}` lacked `delegation` (1 failed / 10 passed) | ✅ Passed 11/11 | ✅ Success + `vi.spyOn(get)` toHaveBeenCalledTimes(1) (D5 no-2nd-fetch); 6 DENY branches unchanged | ✅ D5 comment at the surface return; re-ran 11/11 |
| 5.2 | `packages/app/test/worker-intent.test.ts` | Unit + integration (FakeLlmClient) | ✅ 129/129 | ✅ Written — compiled-context test failed: worker emitted legacy prefix without `Business process:` and no `user`; cycle tests crashed `authorityScope of undefined` until worker.ts plumbing (1 failed / 7 passed, then 3 failed / 5 passed) | ✅ Passed 9/9 | ✅ 2nd delegation scope (`onboarding`) → different prefix + cohort `io:acme:onboarding:v1` (processTokenFor reads the delegation, not a hardcoded token) | ✅ `LlmMessage` type import dropped with the deleted builder; `IntentInput` gains `delegation` |
| 5.3 | `packages/app/test/worker-intent.test.ts` + `app-shell.test.ts` | Unit (boundary) | ✅ 129/129 | ✅ (folding note) — package.json dep contract test RED: pinned 4 deps, actual 5 after `@io/context` link (approval update) | ✅ Passed 129/129 | ✅ `rg STABLE_SYSTEM_PREFIX packages/` → ZERO refs after deleting the module + rewording 2 provenance comments in segments.ts | ✅ stable-prefix.ts deleted; app-shell contract updated to 5 deps |
| 5.4 | `packages/app/test/worker-intent.test.ts` (integration proof) | Integration (FakeLlmClient) + full gate | ✅ 129/129 | ✅ (proof test = 5.2's compiled-context test) | ✅ Full `pnpm check`: 813 passed / 3 skipped, exit 0; E2E vs live PG: 5 files / 9 tests passed, 0 PG skips | ✅ messages[0]=compiled prefix, messages[1]=work tail, user=`io:acme:low-risk-documents:v1` (pinned via compiler-derived expected + literal) | ➖ None needed |

### Work Unit Evidence (PR 3)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `PATH=/data/node24/bin:$PATH pnpm test packages/app` → 129 passed / 0 failed / 22 files (after each task's RED→GREEN; 5.2/5.3 intermediate runs captured above). |
| Runtime harness command/scenario | In-memory `runWorker` cycle through the full intent path with `FakeLlmClient` (worker-intent cycle tests: insertInFlight-before-execute, canned-plan effect, invalid-plan stop) + FULL `PATH=/data/node24/bin:$PATH pnpm check` (format/typecheck/build/lint/test) → **813 passed / 3 skipped, exit 0**; live-PG E2E suite (`packages/app/test/e2e`, 5 files / 9 tests) ran and passed — worker cycle claim/effect/finalize logic untouched, only the LLM request messages/user are compiled now. |
| Rollback boundary | Revert `packages/app/src/worker/{authority,intent,worker}.ts`, `packages/app/test/{worker-intent,worker-authority,app-shell}.test.ts`, `packages/app/package.json` (+`pnpm-lock.yaml`), `packages/context/src/segments.ts` comments; restore `packages/app/src/llm/stable-prefix.ts`. `@io/context` package remains but inert (nothing consumes it) — same state as PR 1/2. No worker-cycle logic (claim/reconcile/finalize) touched. |

### Files Changed (PR 3)

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/app/src/worker/authority.ts` | Modified | D5: success branch returns `{ok:true, delegation}` — the delegation checkAuthority ALREADY fetched (no second repository read); `AuthorityDecision` gains `delegation: Delegation`; failure branches byte-identical |
| `packages/app/src/worker/intent.ts` | Modified | +`processTokenFor(delegation)`←`authorityScope.scope` (transitional D3 stand-in); `IntentInput`+`delegation`; `prepareIntent` calls `compileContext({companyId, process, delegation, work})` → `request.messages` = compiled messages, `request.user` = compiled cohort; DELETED `buildUserTail`, `buildIntentMessages`, `STABLE_SYSTEM_PREFIX` import |
| `packages/app/src/worker/worker.ts` | Modified | Passes `authority.delegation` into `prepareIntent` (5.3 plumbing; forced by 5.2 GREEN compile) |
| `packages/app/src/llm/stable-prefix.ts` | Deleted | Legacy constant removed — migrated to seg 1 (protocol) in `@io/context` |
| `packages/app/package.json` | Modified | +`"@io/context": "workspace:*"` (5th first-party dep; the only new runtime dep — constraint-honoring) |
| `packages/app/test/worker-intent.test.ts` | Modified | L3 STABLE import dropped; compiled-context test (messages[0]=compiled prefix, messages[1]=work tail, user=`io:acme:low-risk-documents:v1` via FakeLlmClient); +triangulation (onboarding scope); buildUserTail test removed; all prepareIntent inputs gain `delegation` |
| `packages/app/test/worker-authority.test.ts` | Modified | ALLOWs test asserts `{ok:true, delegation: activeDelegation()}` + `vi.spyOn(get)` exactly-once (D5 no 2nd fetch); 6 DENY branches unchanged |
| `packages/app/test/app-shell.test.ts` | Modified | Dep contract updated: 4 → 5 first-party workspace deps (business-domain, context, database, llm-client, trust-kernel) |
| `packages/context/src/segments.ts` | Modified | Reworded 2 provenance comments to drop the deleted `STABLE_SYSTEM_PREFIX` token (zero refs); no behavior change |
| `pnpm-lock.yaml` | Modified | `pnpm install` registered the `@io/context` → `@io/app` workspace link |
| `openspec/changes/context-compiler/tasks.md` | Modified | 5.1–5.4 marked `[x]` |

### Integration Proof (5.4)

`worker-intent.test.ts` — FakeLlmClient recorded request:

```
request.messages[0] = { role: 'system', content: <compiled prefix> }   // == compileContext(...).messages[0].content
                                                          // contains 'Business process: low-risk-documents.' (seg 8)
request.messages[1] = { role: 'user', content: <work tail> }          // == compileContext(...).messages[1].content ('execute the quarterly close')
request.user       = 'io:acme:low-risk-documents:v1'                  // == compileContext(...).user (derived cohort; never PII)
```

The expected bytes come from `compileContext` itself (imported from `@io/context`) — the worker MUST emit exactly the compiler's output; no hard-coded strings. Cohort is pinned both via `compiled.user` and the literal `io:acme:low-risk-documents:v1` (process = fixture `authorityScope.scope`).

### Gate + Coupling Evidence (5.4)

- `PATH=/data/node24/bin:$PATH pnpm check` → format ✅ / typecheck (tsconfig + build) ✅ / build ✅ / lint ✅ / test ✅ — **813 passed / 3 skipped, exit 0** (baseline preserved/grown).
- E2E vs live PG (`packages/app/test/e2e`, 5 files / 9 tests) ran and passed — **0 PG skips**. The 3 suite skips are pre-existing: 1 pg-required reachability probe + 2 real-DeepSeek round-trip tests (require live API).
- `rg -n "STABLE_SYSTEM_PREFIX" packages/` → **ZERO** references (module deleted; 2 provenance comments rewired).
- openai confinement: `packages/app/test/boundary.test.ts` asserts `openai` appears ONLY in `packages/llm-client/src/deepseek-client.ts` across all package src trees — green.
- app deps now: `@io/business-domain`, `@io/context`, `@io/database`, `@io/llm-client`, `@io/trust-kernel` (all `workspace:*`); `packages/context` deps === `@io/business-domain` only (unchanged).

### Deviations from Design

1. **Task-order folding (5.3 → 5.2):** the `@io/context` workspace link (task 5.3's package.json step) and `worker.ts` delegation plumbing were forced into 5.2's RED/GREEN — a test importing `@io/context` cannot resolve until the link exists, and `IntentInput.delegation` is a compile error in the only caller until `worker.ts` passes it. Also, deleting `buildUserTail`/`buildIntentMessages` (5.2) forces the test-file cleanup (L3 import + L77–82 buildUserTail test) in the same task — you cannot delete an export a test still imports and keep the suite green. 5.3's remaining scope (delete stable-prefix.ts, zero-refs proof) landed as specified. Recorded honestly — no fake RED.
2. **app-shell dep contract updated** — the app-boundary test pinned exactly 4 first-party deps; the design's File-Changes table adds `@io/context`, so the approval test now pins 5. This is a required contract change, not a scope creep (constraint: only new runtime dep is the `@io/context` link).
3. **segments.ts comment rewording** — two provenance comments named the deleted `STABLE_SYSTEM_PREFIX` constant; reworded to keep the zero-refs AC while preserving provenance meaning. No behavior change.

## Status

**13/13 tasks complete across PR 1 + PR 2 (incl. seg 5→ABSENT amendment) + PR 3.** Worker now compiles the canonical context (seg 1 protocol + seg 8 business-process prefix, seg 11 work tail, derived cohort in `user`) and emits exactly `compileContext`'s output through the injected LlmClient. Legacy `stable-prefix.ts` deleted; zero `STABLE_SYSTEM_PREFIX` references. Full gate green: **813 passed / 3 skipped, exit 0**; E2E vs live PG ran and passed. Tree left dirty (uncommitted) for orchestrator adversarial review. Next phase: sdd-verify.
