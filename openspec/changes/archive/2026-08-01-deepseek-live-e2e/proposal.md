# Proposal: DeepSeek Live End-to-End Worker Cycle

**Change:** `deepseek-live-e2e` · Project: io · Hybrid artifact store
**Baseline:** `main @ 0c124fd` (context-compiler archived; 813 passed / 3 skipped) · live PG 18.4 green · DeepSeek key valid + live
**Grounded in:** `openspec/changes/deepseek-live-e2e/exploration.md` (recommendation C)

## Intent

Prove the full worker cycle runs end-to-end against the **real** DeepSeek model (`deepseek-v4-flash`) + **live** PostgreSQL — claim → authority → intent (real `DeepSeekClient.complete`) → effect → reconcile → verify → atomic finalize → receipt + journal `completed`. Today this is proven only with `FakeLlmClient`. This also resolves the deferred **"no production composition root"** follow-up by extracting a thin reusable wiring module from the E2E harness (which already wires PG adapters + tx-scoped `repositories` factory + connection + sandbox — only the LLM is faked).

## Business Problem & Users

- **Problem**: IO's value rests on the real model turning compiled context into valid reversible plans cheaply. Fake-client tests prove neither that the compiled context works against DeepSeek nor that KV-cache economics are real (cohort `user` forwarded; cache hit/miss accounting).
- **Beneficiaries**: the worker (production-reusable wiring + a real-model proof); the founder/board paying for inference (evidence the model + cache economics hold before autonomy grows).

## Business Rules

1. **Cost-safe by construction (mandatory)**: the live E2E is gated on `DEEPSEEK_API_KEY` **AND** `IO_LIVE_LLM=1`. A plain `pnpm test` / CI never spends — CI never holds the key.
2. **Atomic finalize preserved**: composition-root wiring keeps the tx-scoped repository factory (mirrors `completeWorkAtomically`); finalize T1 stays atomic by construction.
3. **Assert structure, not exact output**: the real model is non-deterministic — assert terminal state, one receipt, journal completed, model echo, cache fields; never exact plan content/path.
4. **Reliability via bounded retry in the TEST** (fresh idempotency key); no retry logic added to worker source this slice.
5. **Secret hygiene**: the key is env-guarded, never printed or committed.

## Scope

### In Scope
- Minimal reusable composition-root module (`buildWorkerDeps`) extracted from the harness: PG adapters + tx-scoped `repositories` factory + `connection` + sandbox + injected `LlmClient`.
- One guarded live E2E (`deepseek-live.integration.test.ts`) running the full cycle vs the real model + live PG.
- Harness `llm` option widened from `FakeLlmClient` to `LlmClient` (additive).
- `worker-cycle` capability delta (real-model live E2E + composition-root requirements).

### Out of Scope (later Paso 3 slices)
- BusinessEvent, skills, heartbeats.
- Full CLI/server/daemon production entrypoint.
- Memory OS / budget engine / evaluation engine.
- Live retry/restart (C5-style) with the real model.
- Live §9.8 error-mapping assertions.
- `temperature` / prompt changes in `llm-client` / `context`.

### Non-Goals
- No new runtime dependencies; no worker-source semantics change.
- No deterministic-output assertions; no induced 4xx/timeout in the live test.
- The composition module is library code, not a runnable process.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `worker-cycle`: ADD a real-model live end-to-end verification requirement (full cycle vs real DeepSeek + live PG, double-gated, structure-not-output assertions, model echo + cache fields) and a production composition-root requirement (reusable wiring assembling PG adapters + tx-scoped repository factory + connection + sandbox + injected `LlmClient`, keeping finalize atomic by construction).

**Decision record**: verified `openspec/specs/worker-cycle/spec.md` (Purpose + "End-to-end happy path against live PostgreSQL" scenario are `FakeLlmClient`-only today) and `openspec/specs/llm-client-port/spec.md`. `worker-cycle` is modified via a delta (ADDED requirements). `llm-client-port` is **not** modified — `DeepSeekClient` is already exported/injectable and its requirements (model echo, cache fields, thinking) are exercised but unchanged; `llm-client` source is read-only this slice. The composition root is infra wiring ([INF]) serving the worker cycle, so it lands as a `worker-cycle` requirement, not a separate capability.

## Approach

Recommendation **C (hybrid)**: extract a thin reusable composition-root module (`buildWorkerDeps`, ~40–60 lines) from the harness and drive it from the new double-gated live E2E with a real `DeepSeekClient`; CLI/server stays OUT. Rationale: the deferred follow-up is the real deliverable; the harness already proves the wiring, so this is a ~50-line extraction, not greenfield; the live E2E then proves the whole claim on the same code a production entrypoint will reuse. Expected diff ~200–300 lines, within the 400-line budget. Design details deferred to sdd-design.

## Current-State Gap

- `runWorker` has **zero** production callers; `packages/app` is library-only (no `main`/`exports`; `src/llm/` empty).
- The harness is the de facto composition root with only the LLM faked — wiring knowledge lives in test code.
- No guarded live E2E against the real model exists.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/app/src/composition/worker-deps.ts` | New | `buildWorkerDeps({ connection, llm, sandboxRoot, principals })` → `WorkerDeps` with tx-scoped repository factory |
| `packages/app/test/e2e/deepseek-live.integration.test.ts` | New | Double-gated live E2E, C2 assertion family vs real model |
| `packages/app/test/e2e/harness.ts` | Modified | `llm` option widened `FakeLlmClient` → `LlmClient` (additive, ~10 lines) |
| `openspec/specs/worker-cycle/spec.md` | Modified | Delta: real-model live E2E + composition-root requirements |
| `packages/app/src/worker/*`, `packages/llm-client/src/deepseek-client.ts` | Read-only | No source semantics change |

## Implications, Impact & Edge Cases

- **Real-model non-determinism → `invalid-plan` flake**: mitigate with bounded fresh-key retry (test-owned DB reset to `accepted`/v1), permissive guard, structure assertions.
- **Accidental spend**: mitigate with mandatory `IO_LIVE_LLM=1` second gate; CI never holds the key.
- **`LlmError` propagates uncaught out of `runWorker`** (no catch around `prepareIntent`): a live outage surfaces as a thrown error, not a typed result — acceptable this slice, documented as later hardening.
- **Harness churn**: keep widening additive; do not break passing C2–C5 suites or the default `FakeLlmClient` path.

## Constraints & Tradeoffs

- No new runtime deps; forbidden couplings hold (`openai` confined to `llm-client`; business-domain zero `@io/*`).
- Strict TDD (`pnpm test`, gate `pnpm check`).
- The live test is the **only** place real money is spent and it is double-gated.
- **Accepted tradeoff**: the composition module is exercised only by the live E2E until a real entrypoint lands — still strictly better than test-only wiring.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Real-model `invalid-plan` flake | Med | Bounded fresh-key retry, permissive guard, assert structure |
| Accidental spend | Low | Mandatory `IO_LIVE_LLM=1` gate; CI never holds key |
| `LlmError` uncaught out of `runWorker` | Low | Acceptable this slice; documented later hardening |
| Harness churn breaks C2–C5 | Low | Additive widening only; default fake path unchanged |
| Composition module unused by production yet | Low | Accepted interim; reusable when entrypoint lands |

## Rollback Plan

Revert the change commit(s): delete `worker-deps.ts` + `deepseek-live.integration.test.ts`, restore the `harness.ts` widening, revert the `worker-cycle` delta. No persisted schema/data changes (scratch `io_dev_e2e_*` DBs are dropped on close); no secrets committed. Baseline `main @ 0c124fd` (813 passed / 3 skipped) is restored by revert.

## Dependencies

- Live PG 18.4 reachable (same as existing E2E).
- Valid env-guarded `DEEPSEEK_API_KEY` + `IO_LIVE_LLM=1` for a deliberate run.
- `DeepSeekClient` exported from `@io/llm-client` (confirmed).

## Success Criteria

- [ ] `buildWorkerDeps` assembles PG adapters + tx-scoped repository factory + connection + sandbox + injected `LlmClient`; finalize stays atomic.
- [ ] Guarded live E2E runs the full cycle vs the real model + live PG and asserts: valid plan from compiled context, work `completed` v3, exactly one receipt, journal `completed`, sandbox effect applied + reversible.
- [ ] `response.model === 'deepseek-v4-flash'`; cache hit/miss tokens present (prompt = hit + miss).
- [ ] Plain `pnpm test` / CI never spends (double-gated skip); `pnpm check` green; C2–C5 suites unaffected.
