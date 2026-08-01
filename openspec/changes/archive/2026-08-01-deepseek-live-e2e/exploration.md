# Exploration: deepseek-live-e2e

**Change:** `deepseek-live-e2e` · Project: io · Hybrid artifact store
**Baseline:** `main @ 0c124fd` (context-compiler archived) · live PG 18.4 integration green · DeepSeek API key valid and live (probe HTTP 200)

## What the Live E2E Must Prove

One bounded slice of Paso 3: run the FULL worker cycle against the REAL DeepSeek model + live PostgreSQL — claim → authority → intent (REAL `DeepSeekClient.complete`) → effect (FileDocumentSandbox, outside the terminal tx, §9.8) → reconcile → verify → atomic finalize T1 → receipt + journal `completed`. Concretely the live run must prove:

1. **Compiled context drives the real model**: the `compileContext` output (stable prefix = seg1 protocol + seg8 business-process; user suffix = seg11 work; cohort `user = io:{companyId}:{process}:v1`) actually produces a `parseLlmPlan`-valid plan with a `create-document` step carrying a non-empty `relativePath` + string `content` — `prepareIntent` returns `ok: true`.
2. **Full cycle terminal against live PG**: `runWorker` returns `ok: true` with `work.state === 'completed'` (v3), EXACTLY ONE `business_receipt` row in the scratch DB, `idempotency_journal` status `completed`, the sandbox effect applied and reversible (undo works) — the same assertions as the C2 FakeLlmClient E2E, but with the real model.
3. **Model/thinking config against the live API**: `response.model === 'deepseek-v4-flash'` (echoed by the API), thinking disabled as `prepareIntent` sends it — confirms `thinking: { type: 'disabled' }` is accepted for flash and produces a plain completion.
4. **KV-cache economics surface**: `usage.promptCacheHitTokens` / `promptCacheMissTokens` are present and summed sensibly (prompt = hit + miss) — validating the derived cohort `user` is actually forwarded and the cache accounting is real.
5. **Composition-root wiring works for production**: the module the live E2E drives (recommendation C below) is the reusable `WorkerDeps` wiring (PG adapters + tx-scoped `repositories` factory + connection + sandbox) that a future production entrypoint reuses — resolving the deferred follow-up ("no production composition root").

## Current State

- **`runWorker` has ZERO production callers** — `grep runWorker` outside tests/worker.ts returns nothing. `packages/app` is library-only (`package.json` has no `main`/`exports`; `src/llm/` is an EMPTY directory). The composition root does not exist.
- **The harness IS the de facto composition root** (`packages/app/test/e2e/harness.ts`): it wires `PgDbConnection` + the real PG adapters + `connection: conn` + the `repositories(conn)` factory (T1 tx-scoped repos → atomic BY CONSTRUCTION, mirrors `completeWorkAtomically`) + `FileDocumentSandbox` + `FakeLlmClient`. The atomic-finalize wiring the deferred follow-up asked for is ALREADY PROVEN in harness code — only the LLM is faked (`cannedLlm()`).
- **The guarded live-test pattern is proven**: `packages/llm-client/test/deepseek-roundtrip.integration.test.ts` uses `describe.skipIf(!process.env.DEEPSEEK_API_KEY)`. Root vitest (`vitest.config.ts`) discovers `packages/**/test/**/*.test.ts`; CI (Toolchain workflow) runs the E2E against a postgres:18 service with `IO_REQUIRE_PG=1` and NO `DEEPSEEK_API_KEY` → any key-guarded live test SKIPS in CI automatically. Cost-safe by default.
- **`DeepSeekClient` is injectable and exported**: `new DeepSeekClient()` reads `deepseekApiKey()` (env-first `DEEPSEEK_API_KEY`); `close()` drops the reference. `deps.llm` is typed `LlmClient`, so swapping the fake is type-legal with zero worker-source changes.
- **Worker flow**: claim → authority → `prepareIntent` (compileContext + `parseLlmPlan` + `createDocumentActionFromPlan`) → `reconcilePreEffect` (journal `insertInFlight`, committed BEFORE the effect) → effect OUTSIDE the tx → verify → `finalizeInFlightWorkAtomically` T1. NOTE: `runWorker` has NO try/catch around `prepareIntent` — a thrown `LlmError` from the real client propagates out of `runWorker` as an exception, not a typed `WorkerResult` (matters for what the E2E asserts, see Risks).
- **Reliability boundary**: `prepareIntent` returns `invalid-plan` on ANY deviation (non-JSON, `parseLlmPlan` reject, missing create-document step, missing/empty `relativePath` or non-string `content`). Work then stays `in_progress` with NO journal row; a same-key retry fails closed at `startWork` (invalid transition). `buildParams` sends NO `temperature` (default 1.0) — no determinism lever exists today.

## Affected Areas

- `packages/app/test/e2e/harness.ts` — `E2eHarnessOptions`/`E2eHarness.llm` widen from `FakeLlmClient` to `LlmClient` to accept the real client (small, ~10 lines). The `repositories`/`connection` wiring is untouched (already production-correct).
- `packages/app/src/composition/worker-deps.ts` (NEW, if recommendation C) — reusable `buildWorkerDeps({ connection, llm, sandboxRoot, principals })` returning `WorkerDeps` with the tx-scoped repository factory; the deferred composition-root follow-up.
- `packages/app/test/e2e/deepseek-live.integration.test.ts` (NEW) — guarded live E2E: `describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')`, mirrors the C2 assertions with the real model.
- `packages/app/test/e2e/worker-e2e.integration.test.ts` — unchanged (FakeLlmClient C2 stays the default CI path); reference for assertions.
- `packages/llm-client/src/deepseek-client.ts` — read-only; `buildParams` currently sends no `temperature` (flag only, no change in this slice).
- `packages/app/src/worker/*` (`worker.ts`, `intent.ts`, `finalize.ts`, `types.ts`) — read-only; no source semantics change.

## Approaches

1. **A — Guarded live E2E test only (swap client in the harness)**
   Widen the harness option to inject an `LlmClient`, add `deepseek-live.integration.test.ts` driving the existing harness with `new DeepSeekClient()`.
   - Pros: Minimal (~120 lines total), zero production surface, fastest to prove the model+PG cycle, reuses all proven harness wiring.
   - Cons: Leaves the composition-root debt (wiring knowledge stays in test code; a future production entrypoint re-implements it); nothing reusable for production.
   - Effort: Low.

2. **B — Full production composition root + live E2E**
   Build a runnable composition root (module + entrypoint wiring PG + DeepSeekClient + worker, full CLI/server shape) and drive it from the live E2E.
   - Pros: Resolves the deferred follow-up completely; production entrypoint is tested by the E2E.
   - Cons: Pulls in CLI/server concerns that are OUT of the bounded slice; larger diff (review budget risk at 400 lines); premature — no production consumer exists yet.
   - Effort: High.

3. **C — Hybrid: thin reusable composition-root module + live E2E** (RECOMMENDED)
   Extract a small library module (no CLI/process), e.g. `buildWorkerDeps` in `packages/app/src/composition/`, wiring PG adapters + `connection` + tx-scoped `repositories` factory + sandbox + injected llm. The live E2E drives it with a real `DeepSeekClient`; the harness may later delegate to it (optional refactor, not required for this slice).
   - Pros: Resolves the deferred follow-up with a tested, production-reusable wiring module (~40–60 lines); live E2E proves exactly what production will run; keeps CLI/server OUT; fits the 400-line review budget; atomic finalize is wired by construction.
   - Cons: Slightly more surface than A; the module is exercised only by the new E2E until a real entrypoint lands (still a strict improvement over test-only wiring).
   - Effort: Medium.

## Recommendation

**C — hybrid**. Build the minimal reusable composition module (`buildWorkerDeps`), drive it from a new guarded live E2E with the real `DeepSeekClient`, and keep the full CLI/server/daemon OUT of scope. Rationale:

- The deferred follow-up (production composition root with the tx-scoped repository factory so finalize T1 stays atomic) is the real deliverable; the harness already proves the wiring pattern, so the module is a ~50-line extraction, not greenfield.
- The live E2E then proves the WHOLE claim: real compiled context → real plan → sandbox execute → atomic finalize → single receipt + completed journal against live PG, on the same code a production entrypoint will use.
- Churn risk to the existing passing C2–C5 E2E suites stays minimal (harness option widening only; no behavior change).

## Cost-Control Strategy

- **Two-gate guard (mandatory)**: `describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')`. The key is LIVE in `/data/io/.env` (gitignored) — an explicit `IO_LIVE_LLM=1` opt-in flag is REQUIRED so a plain `pnpm test` on a machine with the key never spends money. The round-trip test's single-key guard is NOT sufficient alone.
- **Single completion per attempt, bounded total**: one `DeepSeekClient.complete` per cycle attempt; bounded retry (see Reliability) caps a deliberate run at ~2–3 completions. Expected spend per run is sub-cent (Flash non-thinking: $0.14/1M input-miss, $0.28/1M output; prompt ~1–2K tokens).
- **CI never spends**: CI has no `DEEPSEEK_API_KEY` → always skipped; never add the key to any workflow/secret.
- **Scratch-DB isolation already proven**: each run uses a fresh `io_dev_e2e_*` database dropped on close — a failed live run cannot pollute `io_dev`.
- Document the opt-in command in the test header (e.g. `IO_LIVE_LLM=1 pnpm vitest run packages/app/test/e2e/deepseek-live.integration.test.ts`).

## Real-Model Reliability Strategy

- **The guard is already permissive**: `parseLlmPlan` accepts any `{ steps: [{ action, args }], intent? }` object; only `createDocumentActionFromPlan` narrows to `create-document` + `relativePath` + `content`. The compiled system prompt is strongly constrained (seg1 protocol + seg11 "Produce a single reversible create-document plan").
- **Bounded retry in the TEST, not the worker** (max 2 attempts: 1 initial + 1 retry): an `invalid-plan` run leaves work `in_progress` with no journal row, so a retry uses a FRESH idempotency key after resetting the owned scratch-DB work row to `accepted`/v1 (the test owns the DB). Cap = 2 completions + 1; assert the FINAL result is terminal. Do NOT add retry logic to worker source in this slice.
- **Assert structure, not exact output**: assert the terminal state + one receipt + journal completed; do NOT assert the exact document content/path the model chose (assert it is a non-empty string via the effect record).
- **Flag, don't change**: `buildParams` sends no `temperature` today; if the first slice proves flaky, a follow-up may add `temperature: 0` (llm-client change with its own unit tests) or prompt tightening — deferred unless empirically needed.
- **Model config**: `deepseek-v4-flash`, thinking `disabled` (per `intent.ts`) — the live E2E confirms acceptance; assert `response.model` echo; do NOT assert absence of `reasoningContent` (don't over-constrain).

## Error Mapping (§9.8) — Scope Decision

**OUT of the live E2E.** `LlmError('failed')` (4xx) vs `LlmError('unknown')` (timeout/ambiguous) is already unit-tested (`llm-error.test.ts`, `deepseek-client.test.ts`); inducing a real 4xx/timeout in the live E2E is flaky and buys nothing. The E2E asserts the happy path only; a live API rejection during a deliberate run fails loudly with the propagated `LlmError` — acceptable for a manual, cost-opted-in run. NOTE for the record: `runWorker` currently propagates LLM transport failures as thrown `LlmError` (no catch around `prepareIntent`), not a typed `WorkerResult` — a candidate hardening in a later slice, NOT this one.

## Scope Boundaries

**IN (this slice):**
- Minimal reusable composition-root module (`buildWorkerDeps` or equivalent) wiring PG + DeepSeekClient + worker deps with the tx-scoped repository factory.
- One new guarded live integration test in `packages/app/test/e2e/` (key + `IO_LIVE_LLM=1` gated), happy path with bounded retry, same assertion family as C2.
- Harness option widening (`LlmClient` injection, `IO_LIVE_LLM` guard constants).
- Update `openspec/specs/worker-cycle/spec.md` (or a delta) documenting the real-model E2E requirement/scenario.

**OUT (later Paso 3 slices):**
- BusinessEvent, skills, heartbeats.
- Full CLI/server/daemon production entrypoint (the composition module is library code, not a process).
- Memory OS, budget engine, evaluation engine.
- Live retry/restart (C5-style) with the real model (FakeLlmClient restart tests already cover durability).
- Live §9.8 error-mapping assertions.
- `temperature`/prompt changes in `llm-client`/`context` (deferred unless flakiness is observed).

## Risks

- **Real-model non-determinism → `invalid-plan` flake**: mitigated by bounded retry + fresh key + permissive guard; worst case a deliberate run fails loudly at ~sub-cent cost.
- **Accidental spend**: key is live in `.env`; mitigated by the mandatory `IO_LIVE_LLM=1` second gate and CI never holding the key.
- **`LlmError` propagates uncaught out of `runWorker`**: a live API outage surfaces as a thrown error, not a typed result — acceptable for this slice; documented as later hardening.
- **Harness churn could affect passing C2–C5 suites**: keep the option widening additive; do not change the default FakeLlmClient path.
- **Composition module only exercised by the new E2E until a real entrypoint lands**: acceptable interim state; strictly better than test-only wiring.

## Dependencies / Unknowns

- **Dependencies**: live PG 18.4 (`io_pg`) reachable (same as existing E2E); valid `DEEPSEEK_API_KEY` + `IO_LIVE_LLM=1` for a deliberate run; `DeepSeekClient` exported from `@io/llm-client` (confirmed).
- **Unknowns (resolved empirically by the live E2E)**: whether `thinking: { type: 'disabled' }` is accepted for `deepseek-v4-flash` (round-trip test only exercised enabled + default); how often the real model emits a guard-valid plan on the first attempt; whether the KV-cache hit fields behave as expected on a fresh cohort (only field presence is asserted in this slice).

## Ready for Proposal

**Yes.** The orchestrator should tell the user: this slice proves the full worker cycle against the real DeepSeek model + live PG by building a minimal reusable composition-root module (deferred follow-up) driven by a cost-opted-in, key-guarded live E2E; scope excludes BusinessEvent/skills/heartbeats/CLI; expected diff ~200–300 lines fits the 400-line budget; the only real uncertainty is real-model first-attempt plan validity, bounded with a fresh-key retry.
