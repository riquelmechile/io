# Design: DeepSeek Live End-to-End Worker Cycle

## Technical Approach

Extract harness PG wiring into `buildWorkerDeps` (recommendation C). Drive one double-gated live E2E with real `DeepSeekClient` + live PG. Worker/`llm-client` source stay read-only. Specs: all 6 ADDED `worker-cycle` requirements.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Placement | A test-only swap · B CLI entrypoint · **C thin module** | `packages/app/src/composition/worker-deps.ts` | Resolves deferred composition root; ~50-line harness extraction; CLI OUT |
| Dep direction | PG in worker · factory at root | App imports `@io/{database,llm-client,context,business-domain}`; `openai` stays in llm-client only | Matches boundary tests; worker stays PG-agnostic via factory |
| Harness reuse | Dual wiring · **delegate deps** | Harness builds scratch lifecycle + seed; deps via `buildWorkerDeps` | Single production wiring; C2–C5 stay green |
| Response capture | Surface on WorkerResult · **test recorder** | Test-only `RecordingLlmClient` wrapping `DeepSeekClient` | WorkerResult omits `LlmResponse`; no worker semantics change |
| Retry ownership | Worker retry · **test-only** | ≤2 attempts, fresh key, scratch reset | Spec; invalid-plan leaves no journal |
| Error boundary | Map LlmError now · **document later** | Thrown `LlmError` fails live test loudly | No catch around `prepareIntent`; §9.8 mapping OUT |

## Data Flow

```
Live E2E (double-gated)
  → createE2eHarness (scratch PG + migrate + seed)
  → RecordingLlmClient(DeepSeekClient) ──HTTPS──→ DeepSeek API
  → buildWorkerDeps({ connection, llm, sandboxRoot, principals })
       pool adapters (work/delegation/receipts/journal)
       FileDocumentSandbox(sandboxRoot)
       repositories(conn) → Pg* bound to conn  // mirrors completeWorkAtomically
  → runWorker (claim→authority→prepareIntent→reconcile→effect→verify→T1 finalize)
  → assert structure + recorder.lastRequest/lastResponse
```

T1: `connection.transaction(tx => repositories(tx)` → CAS + receipt + journal.complete) — atomic by construction.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/app/src/composition/worker-deps.ts` | Create | `buildWorkerDeps` + input type |
| `packages/app/test/composition/worker-deps.test.ts` | Create | Unit/integration: wiring, injectivity, atomic finalize (FakeLlm + live PG or harness) |
| `packages/app/test/e2e/deepseek-live.integration.test.ts` | Create | Double-gated live E2E + recorder + bounded retry |
| `packages/app/test/e2e/harness.ts` | Modify | `llm: LlmClient`; optional `options.llm`; deps via `buildWorkerDeps`; default `cannedLlm()` unchanged |
| `packages/app/src/worker/*`, `packages/llm-client/**` | Read-only | No semantics change |

## Interfaces / Contracts

```typescript
// packages/app/src/composition/worker-deps.ts
export type BuildWorkerDepsInput = {
  connection: DbConnection;       // pool; T1 uses transaction-scoped client
  llm: LlmClient;                 // Fake or DeepSeek — injectable
  sandboxRoot: string;            // FileDocumentSandbox root
  principals: WorkerPrincipals;
  now?: () => number;
};

export function buildWorkerDeps(input: BuildWorkerDepsInput): WorkerDeps;
// Returns: pool-bound work/delegation/receipts/journal + sandbox + llm +
// principals + connection + repositories(conn) => {
//   work: new PgWorkRepository(conn),
//   receipts: new PgBusinessReceiptRepository(conn),
//   journal: new PgIdempotencyJournalRepository(conn),
// }
```

**Harness widening (additive):** `E2eHarness.llm: LlmClient`; `E2eHarnessOptions.llm?: LlmClient` (default `cannedLlm()`). `openFreshWorkerStack` also calls `buildWorkerDeps`.

**RecordingLlmClient (test-local, not exported from app src):** wraps `LlmClient`; stores `lastRequest` / `lastResponse` / `callCount`; delegates `complete`.

## Live E2E Design

**Path:** `packages/app/test/e2e/deepseek-live.integration.test.ts`

**Gate (mandatory):**
```ts
describe.skipIf(!process.env.DEEPSEEK_API_KEY || process.env.IO_LIVE_LLM !== '1')
```
Never print key value. Header documents: `IO_LIVE_LLM=1 pnpm vitest run packages/app/test/e2e/deepseek-live.integration.test.ts`. CI has no key → always skip. Never add key to workflows.

**Bootstrap:** `createE2eHarness({ databaseName: 'io_dev_e2e_deepseek_live' })` then replace `deps` by rebuilding via `buildWorkerDeps` with `RecordingLlmClient(new DeepSeekClient())` + same `conn`/`sandboxRoot`/`principals` — OR harness accepts injected llm and builds deps once. Prefer single path: pass `llm` into harness options so deps are built once through `buildWorkerDeps`.

**Happy-path assertions (structure-not-output):**
- `result.ok`, work `completed` v3 (result + stored), exactly one `business_receipt`, journal `completed`
- Effect applied (`existsSync`, `wasApplied`) and reversible (`undo` → gone)
- Plan shape only via effect: `create-document`, non-empty `relativePath`, `typeof content === 'string'` — **no** exact path/content/plan JSON
- `recorder.lastResponse.model === 'deepseek-v4-flash'`
- Cache: `promptCacheHitTokens`/`promptCacheMissTokens` present, `>= 0`; `promptTokens === hit + miss`
- Cohort: `recorder.lastRequest.user === deriveCohort({ companyId: E2E_COMPANY, process: 'low-risk-documents', schemaVersion: CONTEXT_SCHEMA_VERSION })` (matches `processTokenFor` / seed scope)

**Bounded reliability retry (test-only, max 2 completions):**
1. Attempt with fresh `idempotencyKey` (`live-${n}-${uuid}`).
2. If `result.reason === 'invalid-plan'` and attempts < 2: reset scratch Work via raw SQL (`UPDATE work SET state='accepted', version=1 WHERE …`) — `save` is INSERT-only; `updateIfVersion` only increments. No journal row exists pre-effect, so no journal cleanup. Sandbox clean (no effect yet).
3. Retry with **new** key. Stop after 2 model completions. Never retry non-`invalid-plan`. No retry in worker source.
4. Assert final terminal success (or fail loudly).

**Cost:** 1 completion/attempt; ≤2 completions/run; double gate prevents accidental spend.

**LlmError:** propagates from `runWorker` (no try/catch on `prepareIntent`). Live test does not catch — failure is loud. Later hardening OUT of slice.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit/int | `buildWorkerDeps` | FakeLlm + live PG (or harness): injectivity (`deps.llm === supplied`); factory binds tx conn; full cycle atomic finalize (1 receipt) |
| E2E (CI default) | C2–C5 | Unchanged behavior; default FakeLlm path; type widen only |
| E2E (opt-in) | Live DeepSeek | Double gate; structure + cache + cohort; bounded retry |

Strict TDD: RED unit for `buildWorkerDeps` → GREEN module → RED live suite (skip without gates) → GREEN wiring → deliberate `IO_LIVE_LLM=1` run proves real model.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Live HTTPS is existing `DeepSeekClient` surface; secrets stay env-only.

## Migration / Rollout

No migration. Feature is test + library module. Rollout = merge; deliberate live run is manual opt-in.

## Open Questions

- None blocking. Empirical unknowns (first-attempt plan rate, fresh-cohort hit tokens often 0) resolved by live run; presence + accounting asserted, not hit>0.
- Follow-ups (not this slice): map thrown `LlmError` to typed `WorkerResult`; optional `temperature: 0` if flaky; CLI entrypoint reusing `buildWorkerDeps`.

## Spec Traceability

| Requirement | Design answer |
|-------------|----------------|
| Production Composition Root | `buildWorkerDeps` + tx factory |
| Real-Model Live E2E | `deepseek-live.integration.test.ts` + DeepSeekClient |
| Cost-Safe Double Gate | `skipIf(!KEY \|\| IO_LIVE_LLM !== '1')` |
| Structure-Not-Output | Terminal/receipt/journal/effect only |
| Bounded Reliability Retry | Test loop ≤2, fresh key, SQL reset |
| KV-Cache Economics | Recorder usage + `user` cohort assert |
