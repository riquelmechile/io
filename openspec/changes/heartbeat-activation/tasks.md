# Tasks: Heartbeat Activation — Worker-Boundary Gate

Strict TDD (RED → GREEN per task; tests ship with code). Single PR. `runWorker` byte-identical — no task touches `packages/app/src/worker/worker.ts`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~100–150 authored code (+ this artifact) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Boundary gate `evaluateHeartbeatGate` + decision table + zero-mutation/no-self-activation proofs + live-PG integration | PR 1 (only) | `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/heartbeat/cycle.test.ts` | Live PG (sequential): `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/heartbeat/heartbeat.integration.test.ts` — gate returns `activate` after a full `runWorker` cycle | Delete `cycle.ts` + `cycle.test.ts`, revert integration delta; `worker.ts` untouched — side-effect-free |

## Phase 1: Boundary Gate — Decision Table (R1)

- [x] **1.1 RED — decision table.** Create `packages/app/test/heartbeat/cycle.test.ts` importing `evaluateHeartbeatGate` from `../../src/heartbeat/cycle.js` (absent → RED). Mirror `evaluate.test.ts`/`RecordingEvents`. Tests: empty stream → `{kind:'no-llm-heartbeat'}` (S1.2); unseen `work.completed` → `{kind:'activate',model:'flash'}` (S1.3); seen cursor → `no-llm-heartbeat` (S1.4). Req R1. Verify: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/heartbeat/cycle.test.ts` → fails (module missing).
- [x] **1.2 GREEN — create the gate.** Create `packages/app/src/heartbeat/cycle.ts`: `evaluateHeartbeatGate(deps:{readonly events:BusinessEventRepository}, companyId:string, cursor?:HeartbeatCursor):Promise<HeartbeatDecision>` delegating to `evaluateHeartbeatForCompany` (no duplicated list/filter). Req R1. Verify: same command → GREEN; `PATH=/data/node24/bin:$PATH pnpm check`.

## Phase 2: Gate Contract Proofs (R1)

- [x] **2.1 workId excluded (S1.1).** RED→GREEN in `cycle.test.ts`: type-level proof — a work-scoped call is a compile error (`@ts-expect-error`, proven by `pnpm check`); runtime check the gate accepts only `({events}, companyId[, cursor])` with no workId slot. Req R1. Verify: `pnpm vitest run …/cycle.test.ts` + `pnpm check`.
- [x] **2.2 Tenant isolation (S1.5).** RED→GREEN: company A unseen `work.completed`, company B none → B `no-llm-heartbeat`; A's events never leak into B. Req R1. Verify: `pnpm vitest run …/cycle.test.ts`.
- [x] **2.3 Empty companyId rejected before read (S1.6).** RED→GREEN: `evaluateHeartbeatGate({events},'')` rejects `'a non-empty companyId is required'`; assert `events.listCalls === []`. Req R1. Verify: `pnpm vitest run …/cycle.test.ts`.

## Phase 3: Read-Only / Non-Self-Activating Proofs (R2) — isolated

- [x] **3.1 Zero-mutation both paths (S2.1).** RED→GREEN: snapshot `InMemoryWorkRepository` work states, `RecordingJournal.snapshot()`/`.log`, `RecordingReceipts.saves`, `RecordingEvents.appends` before/after BOTH no-llm and activate evaluations; all unchanged; `RecordingEvents.appends.length === 0`. Req R2. Verify: `pnpm vitest run …/cycle.test.ts`.
- [x] **3.2 Never invokes the LLM (S2.2).** RED→GREEN: construct a `FakeLlmClient` (`@io/llm-client/src/index.js`); evaluate gate both paths with only `{events}`; assert `fake.requests.length === 0`. Req R2. Verify: `pnpm vitest run …/cycle.test.ts`.
- [x] **3.3 No self-activation (S2.3).** RED→GREEN: after a no-llm evaluation, re-`listByCompany` material stream is identical and contains NO gate-emitted `work.completed` (`appends.length === 0`). Req R2. Verify: `pnpm vitest run …/cycle.test.ts`.

## Phase 4: Work-Bearing Preservation + Integration (R3)

- [x] **4.1 RED→GREEN — integration: gate activates post-cycle.** Modify `packages/app/test/heartbeat/heartbeat.integration.test.ts`: after the existing `runWorker` cycle, call `evaluateHeartbeatGate({events:harness.deps.events}, E2E_COMPANY)` → `{kind:'activate',model:'flash'}`; live event count still 1; work still `completed`. Req R3 (S3.1 activation). Verify (sequential PG): `PATH=/data/node24/bin:$PATH pnpm vitest run --no-file-parallelism packages/app/test/heartbeat/heartbeat.integration.test.ts`.
- [x] **4.2 Proof — work-bearing cycle bypasses gate (S3.1).** No code: confirm `worker.ts` has NO import of `cycle.js`/`evaluateHeartbeatGate` and `git diff packages/app/src/worker/worker.ts` is empty (byte-identical). Req R3. Verify: grep + `git diff --stat packages/app/src/worker/worker.ts`.
- [x] **4.3 Proof — terminal close + replay (S3.2, S3.3).** No new code: existing worker finalize/e2e tests (untouched) cover CAS + one receipt + journal completion + one `work.completed`, and idempotent replay. Req R3. Verify: `PATH=/data/node24/bin:$PATH pnpm vitest run packages/app/test/worker-finalize.test.ts`.

## Phase 5: Full Verification + Commit

- [x] **5.1 Full gate green.** `PATH=/data/node24/bin:$PATH pnpm test` (sequential PG) + `PATH=/data/node24/bin:$PATH pnpm check` green vs ~968-test baseline (main@24153c7).
- [ ] **5.2 Work-unit commit.** Single PR: `cycle.ts` + `cycle.test.ts` + integration delta + this `tasks.md` together. Conventional commit (no AI attribution).
