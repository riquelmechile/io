# Exploration: Context Compiler (Paso 3 — first bounded slice)

**Change:** `context-compiler` · Project: io · Hybrid artifact store
**Baseline:** `main @ e7b5fe8` (clean tree) · 757 passed / 3 skipped (Rev 3 roadmap) · live PG 18.4 integration green
**Sources:** architecture doc §6.5/§7.1/§7.2/§7.3/§9.9/§13.1/§14/§15, roadmap `PASOS_SIGUIENTES_INCREMENTO_4.md` Rev 3 Paso 3, ADR-0001/0002/0003, `first-enterprise-vertical` archive, live code in `packages/`.

## 1. What the context compiler must do (grounded in §7.2)

The context compiler is a **first-party infra component** (architecture §6.5 component list; §14 taxonomy home `context/`). It transforms worker inputs into the **ordered context segments** of the canonical §7.2 order, then hands a `LlmClient` call to the request:

```text
 1. Protocolo DeepSeek           ┐
 2. Constitución                 │
 3. Políticas corporativas       │
 4. Empresa y departamento       │  PREFIJO ESTABLE (1–9)
 5. Contrato del puesto          │  byte-identical across calls in a cohort
 6. Competencias certificadas    │
 7. Skills activadas             │
 8. Proceso empresarial          │
 9. Baseline del producto        ┘
─────────────────────────────────
10. Memoria recuperada           ┐
11. Trabajo actual               │  SUFIJO DINÁMICO (10–13)
12. Evidencia reciente           │  varies per request
13. Resultados de herramientas   ┘
```

**What "KV-cache prefix ordering" means concretely.** DeepSeek reuses identical token prefixes from the first token (server-side context caching); a cache hit costs Flash $0.0028/1M vs $0.14/1M on miss (§7.2 table). A single reordered or inserted byte **shifts every downstream token position → full prefix miss**. Therefore:

- Segments 1–9 MUST be rendered in a **fixed canonical order with byte-stable content** for every request in the same cache cohort.
- Segments 10–13 MUST be appended after the stable prefix and MAY vary per request.
- §7.2 explicitly forbids putting at the START: current date, random IDs, nonce, heartbeat, recent snapshot, variable message, tool result.
- §7.3 cache cohorts (`user` field): a cohort groups requests sharing policy, privacy, and the exact prefix, and MUST NOT contain PII. Two workers share a cohort only if they share that exact prefix.

The compiler therefore has three responsibilities: (1) **order** the segments canonically, (2) **guarantee the stable-prefix contract** (stable segments never change for a cohort; dynamic content never leaks into them), (3) **derive the cache cohort** so requests that share a prefix share a cohort.

## 2. Current state (verified from the live repo)

The worker cycle (`packages/app/src/worker/`) today builds the LLM context by hand in `intent.ts`:

- `packages/app/src/llm/stable-prefix.ts` exports the **hard-coded** `STABLE_SYSTEM_PREFIX` — a raw English system prompt instructing the model to emit exactly one create-document JSON plan. The archived design explicitly records this as "hard-coded stable system message + dynamic user tail — **NOT** the §7.2 prompt compiler": it was the deliberate minimal stand-in for the vertical.
- `prepareIntent` (`intent.ts`) assembles a 2-message request: `system = STABLE_SYSTEM_PREFIX`, `user = buildUserTail(work)` (per-work dynamic tail), `model: 'deepseek-v4-flash'`, `thinking: disabled`. The response is JSON-parsed and validated by `parseLlmPlan` (business-domain, untouched).
- The `LlmRequest.user` cache-cohort field (§7.3) is **never set** by the worker — the port and the DeepSeek adapter both support it (`deepseek-client.ts` `buildParams` forwards `request.user`), but no caller uses it. The KV-cache cohort is entirely absent today.
- `FakeLlmClient` (`packages/llm-client/src/fakes.ts`) is the test double: canned responses in order, records every `LlmRequest`. The E2E suite (`packages/app/test/e2e/`) runs the full cycle against live PG with `FakeLlmClient` — real DeepSeek is out of scope everywhere.
- Tests assert the exact prefix string (`worker-intent.test.ts`: `request.messages[0]` equals `STABLE_SYSTEM_PREFIX`; tail contains work/company info).

**What is missing vs §7.2:** only 2 of the 13 segments exist; no canonical ordering machinery; no stable/dynamic contract enforcement; no cache cohort; no `user` field; no segment instrumentation (§9.9 — deferred). Content sources for segments 2/3/4/6/7/9/10/12 (constitution, policies, company, competencies, skills, baseline, memory, evidence) do not exist yet — they arrive in later increments.

## 3. Affected areas

- `packages/app/src/llm/stable-prefix.ts` — replaced: the constant migrates into the compiler (as the process/protocol instruction segment).
- `packages/app/src/worker/intent.ts` — `prepareIntent` calls the compiler instead of assembling strings by hand; keeps `llm.complete` + `parseLlmPlan`.
- `packages/app/src/worker/worker.ts` — passes the delegation (already fetched for `checkAuthority`) to the intent phase so the compiler can render the contract/process segments.
- `packages/app/src/worker/types.ts` — intent input surface (delegation/company inputs) if the signature grows.
- `packages/app/test/worker-intent.test.ts` — prefix assertions change from the raw constant to the compiled shape (order, stability, cohort).
- `packages/llm-client` — types consumed (`LlmMessage`, `LlmRequest`); `FakeLlmClient` reused for worker-level tests; no code change.
- Monorepo wiring (`tsconfig.json`, `tsconfig.build.json` include arrays, `pnpm-workspace.yaml` comment) — only if the compiler becomes a new package (Approach A).
- New spec: `context-compiler` capability (proposal/spec phases, later).

## 4. Approaches

### A. New transitional package `packages/context` (recommended)
A pure compiler module exporting `compileContext(input): { messages, user }` — canonical segment table, stable-prefix builder (segments 1–9), dynamic suffix builder (10–13), cohort derivation — in its own first-party package, matching the §14 `context/` infra home. The app (composition root) wires the compiled request into the injected `LlmClient`.

- Pros: canonical §14 home; precedent = `deepseek-client` extracted as `packages/llm-client` under change pressure; keeps `business-domain` pure (compiler imports domain TYPES only, never the other way); keeps the `llm-client` boundary green (compiler needs domain types the adapter package must not import); reusable by future entry points (daemon/CLI/server); zero-SDK boundary testable like `llm-client`; pure → trivially unit-testable with no network, plus `FakeLlmClient` at the worker level.
- Cons: monorepo surface (new `package.json`, tsconfig includes, boundary test); one more package in the transitional set.
- Effort: Medium.

### B. Evolve inside `packages/app/src/llm/`
Rename `stable-prefix.ts` → `context-compiler.ts` and build the compiler as a module of `@io/app`.

- Pros: minimal footprint; zero monorepo churn; the current code already lives there; fastest to land.
- Cons: `@io/app` is the composition root ("Not a canonical package") — business-shaped compilation logic hardens inside the shell and must be extracted later under change pressure; not reusable by the future daemon/CLI/server entry points without a refactor; the §14 taxonomy explicitly names `context/` as an infra package, so the code will move anyway.
- Effort: Low–Medium.

### C. Inside `packages/llm-client`
Extend the adapter package with the compiler.

- Pros: closest to the message/request types; no new package.
- Cons: `llm-client` ships exactly one runtime dep (`openai`) and its boundary test forbids extra imports — the compiler needs `business-domain` types, which would couple the adapter package to the domain and break the driver-free spirit; compiler is a distinct concern (prompt economics) from the wire adapter; wrong dependency direction for future content sources.
- Effort: Medium (fights the boundary).

## 5. Recommendation — Approach A

Build the first slice as a **pure `packages/context` compiler** that produces `{ messages, user }` (never calls `LlmClient` itself), keeping the established 2-message request shape: `system` = stable prefix (segments 1–9 rendered from the segments that have data), `user` = dynamic suffix (segment 11 current work today). The worker keeps `llm.complete` + `parseLlmPlan` unchanged.

Design rules for the slice:

1. **Fixed canonical order table** (1–13, §7.2). Segments with no data source render as **absent** (their table position is fixed, not their content) — a later change that adds a segment **bumps the schema-versioned cohort**, never silently changes bytes.
2. **Stable-prefix contract**: the system message MUST be a pure function of (companyId, delegation, schemaVersion) — never of the work description, clock, ids, or nonce. Test asserts byte-identity across calls with different works in the same cohort.
3. **Cohort derivation** (`user`, §7.3, no PII): e.g. `io:${companyId}:${process}:v${schemaVersion}` — stable for a cohort, differs when the prefix can differ (per-company prefix fragmentation is BY DESIGN: §7.2 puts company in segment 4, so hits are per-company). The cohort is a derived value, not user-supplied.
4. **Model selection stays out** of the compiler for now (§7.1 policy is a separate concern); `prepareIntent` keeps `model`/`thinking`.
5. **Process/protocol instruction text** migrates from `STABLE_SYSTEM_PREFIX` into the compiler as the process segment; input domain objects (Work, Delegation, companyId) come from the worker, which already fetched the delegation for `checkAuthority`.
6. **Tests**: (a) compiler unit — canonical order, prefix byte-stability, dynamic tail variance, cohort identity/derivation, no forbidden dynamic content in the prefix; (b) worker integration with `FakeLlmClient` — the recorded `LlmRequest` carries the compiled messages + cohort; (c) package boundary — zero SDK/network/fs imports, single-purpose package.json (mirror `llm-client` boundary).

## 6. Scope boundaries (first bounded slice)

**IN**
- `packages/context`: canonical segment ordering, stable-prefix + dynamic-suffix builders, cohort derivation, exported `compileContext`.
- Migration of the existing `STABLE_SYSTEM_PREFIX` instruction text into the compiler.
- Worker wiring: `prepareIntent` compiles then calls the injected `LlmClient`; delegation input plumbed from the worker.
- Tests: compiler unit + worker integration (FakeLlmClient) + package boundary. Existing tests updated where they assert the raw constant.

**OUT (explicitly deferred — later Paso 3 changes / future increments)**
- DeepSeek live E2E (separate change; needs `DEEPSEEK_API_KEY`).
- BusinessEvent (separate change).
- Skills (segment 7) and heartbeats (separate changes).
- Memory retrieval (segment 10, Increment 5), recent evidence (segment 12), tool results (segment 13).
- Content sources for constitution/policies/company/competencies/baseline (segments 2/3/4/6/9 — domain packages don't exist yet).
- KV-cache manager, §9.9 compiled-context instrumentation (memory ids, tokens, cost, hit/miss), telemetry/budget/evaluation (Increment 5).
- §7.1 model-policy selection.

## 7. Risks

- **Scope drift into the rest of Paso 3** (live DeepSeek, BusinessEvent, skills, heartbeats) — HIGH; the slice is the compiler alone.
- **Prefix-stability violation**: work-specific content leaking into a stable segment, or a segment added without a cohort bump, silently destroys cache hits across a cohort — mitigated by the byte-stability test and schema-versioned cohort.
- **Cohort misuse**: putting PII in `user` (forbidden §7.3) or coupling the cohort to the varying work — test asserts cohort ignores work description.
- **Test churn**: `worker-intent.test.ts` asserts the exact constant; those assertions change with the compiled shape. No live-cache invalidation cost exists (no real DeepSeek E2E has run, so no cached prefix is being invalidated).
- **Monorepo surface** (Approach A): new package touches tsconfig includes + pnpm-workspace + carries boundary obligations.
- **Unknowns**: no real-API validation of the `user` cohort semantics (deferred to the live E2E change); no constitution/policy content to render yet; §14 taxonomy is "initial hypothesis, change-pressure-revalidated", so package placement is transitional.

## 8. Ready for Proposal

**Yes** — this is a clean, bounded first slice of Paso 3. The orchestrator should tell the user: the compiler is a new pure `packages/context` package (canonical §7.2 ordering + stable-prefix contract + cohort derivation), wired into `prepareIntent` with `FakeLlmClient` tests only; model selection stays in the worker; DeepSeek live E2E, BusinessEvent, skills, and heartbeats remain separate changes. Expect ~250–400 changed lines (review budget: auto-chain, one PR).
