# Tasks: Context Compiler

Threat matrix N/A (design) — no threat RED tasks. Strict TDD: each task RED→GREEN, tests ship with code. `R#`=spec requirement; deps = prior task in phase unless stated.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (authored) | ~650–800 (≈9 create / ≈7 modify / 1 delete; golden excluded) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

IO forecasts run 2–3× under; pure-package tests (order, golden pin, cohort, boundary) dominate. Total exceeds 400 → auto-chain chains automatically, no split decision.

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----------------------|-----------------|-------------------|
| 1 | @io/context shell + segment table + absent rendering + boundary skeleton | PR 1 | `PATH=/data/node24/bin:$PATH pnpm test packages/context` | N/A — pure logic, no I/O this slice | delete packages/context; revert tsconfig*/pnpm-workspace |
| 2 | stable-prefix byte-stability + golden pin + cohort + compileContext + boundary scan | PR 2 | `PATH=/data/node24/bin:$PATH pnpm test packages/context` | N/A — golden pin IS the byte-stability harness | revert packages/context/src + tests; PR1 shell inert |
| 3 | worker wiring + FakeLlmClient integration + delete stable-prefix | PR 3 | `PATH=/data/node24/bin:$PATH pnpm test packages/app` then `pnpm check` | in-memory runWorker cycle + FakeLlmClient; e2e green transitively (no new live-PG) | revert app edits; restore stable-prefix.ts; context unused |

## Phase 1: Foundation — package + segment model (PR 1)

- [x] 1.1 **Scaffold @io/context** — `packages/context/package.json` (private ESM; dep `@io/business-domain:workspace:*` ONLY; `@types/node` dev); `tsconfig.json`+`packages/context/**/*.ts`, `tsconfig.build.json`+`packages/context/src/**/*.ts`, `pnpm-workspace.yaml` comment. RED: `test/boundary.test.ts` pkg block (deps===BD, private, ESM) → GREEN. AC: resolves, BD-only. Deps none.
- [x] 1.2 **Segment table + canonical order** — `src/segments.ts`: 13-position table (stable/dynamic; render present/absent). RED→GREEN: order 1→13, suffix never interleaves 1–9 (R1). AC: ordered.
- [x] 1.3 **Absent rendering, fixed position** — `src/segments.ts` elide (D4). RED→GREEN: segs 1 & 11 present, 2–10 ABSENT hold place (R4). AC: zero bytes, no shift.

## Phase 2: Stable prefix + byte stability (PR 2 — complex task isolated)

- [ ] 2.1 **buildStablePrefix + forbidden-leading guard** — `src/segments.ts`/`index.ts`: prefix 1–9 → messages[0] system. RED→GREEN: date/id/nonce/heartbeat/snapshot/tool cannot lead; segs 1–2 absent ⇒ seg 3 leads (R3 both). AC: first byte = lowest present stable seg.
- [ ] 2.2 **Byte-stability golden pin + structural purity + leak guard** (COMPLEX, ISOLATED) — golden file pins prefix bytes for `CONTEXT_SCHEMA_VERSION=1`. RED→GREEN: same-cohort≠work ⇒ identical messages[0]; unique seg10–13 absent from prefix; same cohort ⇒ byte-identical (R2 both + R6 silent-change). AC: prefix reads only companyId/process/delegation/version; work only seg 11; no clock/ids/nonce.
- [ ] 3.1 **deriveCohort + CONTEXT_SCHEMA_VERSION** — `src/index.ts`: `io:{companyId}:{process}:v{version}`, never caller-supplied. RED→GREEN: `io:acme:planning:v2`; ignores work; excludes name/email/work (R5 three). AC: derived, PII-free.
- [ ] 3.2 **Schema-versioned cohort bump** — `src/index.ts`. RED→GREEN: version bump changes `user`, vN≠vN+1 (R6 bump). AC: stable-seg change ⇒ new cohort.
- [ ] 4.1 **compileContext assembly + output contract** — `src/index.ts`: `compileContext(input)→{messages,user}`; buildDynamicSuffix 10–13 → messages[1] user. RED→GREEN: messages LlmMessage[]-compatible, user derived, client spy NOT invoked (R7). AC: pure; [system prefix, user suffix].
- [ ] 4.2 **Boundary src-scan** — `test/boundary.test.ts`: mirror llm-client; src BD-only, no llm-client/openai/app, no forbidden builtins. RED→GREEN. AC: deps===BD only.

## Phase 3: Worker wiring + integration (PR 3)

- [ ] 5.1 **checkAuthority surfaces delegation** (D5) — `app/src/worker/authority.ts`: success → `{ok:true; delegation}`. RED→GREEN: authority test asserts surfaced delegation, no 2nd fetch. AC: additive success; fail unchanged. Deps 4.1.
- [ ] 5.2 **intent compiles context** — `app/src/worker/intent.ts`: add `processTokenFor(delegation)`←`authorityScope.scope`; `prepareIntent` calls `compileContext`, sets `request.user`; `IntentInput`+`delegation`; delete `buildUserTail`/`buildIntentMessages`/STABLE import. RED→GREEN: `worker-intent.test.ts` L38 → compiled prefix, request.user `io:acme:low-risk-documents:v1`, suffix via FakeLlmClient. AC: compiled shape + cohort.
- [ ] 5.3 **Plumb + delete legacy** — `worker.ts` passes `authority.delegation` to `prepareIntent`; delete `app/src/llm/stable-prefix.ts`; add `@io/context` to `app/package.json`; drop test L3 import + L77–82 buildUserTail assert. GREEN: worker-intent + cycle green. AC: no STABLE_SYSTEM_PREFIX refs.
- [ ] 5.4 **Integration proof** — `worker-intent.test.ts`: FakeLlmClient records system=prefix, user-msg=work, request.user cohort; run `pnpm check`. AC: green; baseline 771/3 @ e7b5fe8 preserved/grown; e2e green transitively.
