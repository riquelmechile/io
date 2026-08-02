# Design: Heartbeat Activation — Worker-Boundary Gate

## Technical Approach

Ship Approach 1 as a **standalone boundary gate** over the existing read-only seam. New `packages/app/src/heartbeat/cycle.ts` exports `evaluateHeartbeatGate`, which accepts only `{ events }`, `companyId`, and optional `cursor`, then **delegates** to `evaluateHeartbeatForCompany` (no duplicated list/filter logic). Returns the existing `HeartbeatDecision`. Covers all three ADDED `worker-cycle` requirements. Production no-llm savings land with a future supervisor; this slice is plumbing + proofs.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Gate placement | Inside `runWorker` vs standalone `heartbeat/cycle.ts` | In-cycle branch deadlocks empty-stream first work; standalone keeps work-bearing path unchanged | **Standalone** `cycle.ts`; `worker.ts` **byte-identical** |
| Export name | `runHeartbeatCycle` vs `evaluateHeartbeatGate` vs `heartbeatGateForCompany` | "run/cycle" confuses with `runWorker`; gate name matches supervisor entry semantics | **`evaluateHeartbeatGate`** — evaluate + gate role |
| Logic ownership | Reimplement list+filter vs wrap seam | Duplication risks drift from R6/R7 | **Thin wrap** of `evaluateHeartbeatForCompany` only |
| Deps shape | Full `WorkerDeps` vs `{ events }` | Full deps invites accidental claim/LLM wiring | **`{ readonly events: BusinessEventRepository }` only** |
| workId | Accept workId vs companyId-only | workId enables future-supervisor deadlock trap | **companyId-only** (type-level: no workId param) |
| Empty companyId | Gate re-check vs seam-only | Seam already throws before list | Delegate; seam enforces R7 (same error string) |
| Cursor | Persist now vs optional arg only | Persistence is supervisor concern | **Optional `cursor?` passthrough; no store** |

## Data Flow

```
Future supervisor (OUT this slice)
    │  companyId [, cursor]
    ▼
evaluateHeartbeatGate({ events }, companyId, cursor?)
    │  delegate (no extra I/O)
    ▼
evaluateHeartbeatForCompany  ──listByCompany(companyId)──► BusinessEventRepository
    │
    ▼
evaluateHeartbeat(events, cursor)  →  HeartbeatDecision
    │
    ├─ { kind: 'activate', model: 'flash' }  → supervisor picks Work → runWorker (unchanged)
    └─ { kind: 'no-llm-heartbeat' }          → exit; zero mutations; no work.completed

Work-bearing path (this slice, unchanged):
    caller ──► runWorker(input, deps)  ──► claim → … → finalize T1
               (NEVER calls evaluateHeartbeatGate)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/app/src/heartbeat/cycle.ts` | Create | `evaluateHeartbeatGate` — thin boundary wrap (~25–35 lines incl. docs) |
| `packages/app/test/heartbeat/cycle.test.ts` | Create | Decision table + zero-mutation + structural proofs (~60–90) |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Modify | Post-`runWorker` gate returns `activate`; live PG (~15–25) |
| `packages/app/src/worker/worker.ts` | **Unchanged** | Byte-identical; work-bearing cycle bypasses gate |
| `packages/app/src/heartbeat/evaluate.ts` | Unchanged | Seam stays the single list+filter owner |
| `packages/business-domain/**` | Unchanged | `HeartbeatDecision` / `evaluateHeartbeat` reused as-is |

## Interfaces / Contracts

```typescript
// packages/app/src/heartbeat/cycle.ts
import {
  type BusinessEventRepository,
  type HeartbeatCursor,
  type HeartbeatDecision,
} from '@io/business-domain/src/index.js';
import { evaluateHeartbeatForCompany } from './evaluate.js';

/**
 * Worker-boundary heartbeat gate (Approach 1). Future supervisor entry:
 * activate → pick work → runWorker. NEVER accepts workId (deadlock prevention).
 * Read-only: delegates to evaluateHeartbeatForCompany; no claim/journal/receipt/LLM.
 */
export async function evaluateHeartbeatGate(
  deps: { readonly events: BusinessEventRepository },
  companyId: string,
  cursor?: HeartbeatCursor,
): Promise<HeartbeatDecision> {
  return evaluateHeartbeatForCompany(deps, companyId, cursor);
}
```

**Structural guarantees**
- Signature has no `workId` — TypeScript rejects work-scoped calls.
- Deps expose only `events` — cannot call work/journal/receipts/llm without a type error.
- Empty `companyId` → seam throws `'a non-empty companyId is required'` before `listByCompany` (`evaluate.ts:25-27`).
- No-llm path returns the decision only; never appends `work.completed` (sole material type → no self-activation).

## Testing Strategy

Strict TDD. Runner: `PATH=/data/node24/bin:$PATH pnpm test`. Gate: `PATH=/data/node24/bin:$PATH pnpm check`. PG files: `pnpm vitest run --no-file-parallelism`.

| Spec requirement | File | Approach |
|------------------|------|----------|
| **R1 Company-Scoped Gate** | NEW `cycle.test.ts` | Decision table via `RecordingEvents` (mirror `evaluate.test.ts`): empty → no-llm; unseen `work.completed` → activate flash; seen cursor → no-llm; tenant A/B isolation; empty `companyId` rejects + `listCalls === []`. **workId excluded**: assert `Parameters`/`typeof` of gate has arity/shape without workId (type-level comment + runtime arity check on function length / call with only companyId). |
| **R2 Read-Only Non-Self-Activating** | NEW `cycle.test.ts` | Before/after snapshots on both paths: `RecordingEvents.appends` length stable; `RecordingJournal.snapshot()` / `log` unchanged; `RecordingReceipts.saves` empty; `InMemoryWorkRepository` work states unchanged; `FakeLlmClient.requests.length === 0` (gate never receives llm — construct unused fake and assert still empty). No-llm: re-`listByCompany` material stream identical; no gate-emitted `work.completed`. |
| **R3 Work-Bearing Preservation** | Unit: existing worker tests unchanged (no gate import in `worker.ts`). Integration: MODIFY `heartbeat.integration.test.ts` | After full `runWorker` on live PG harness, call `evaluateHeartbeatGate({ events: harness.deps.events }, E2E_COMPANY)` → `{ kind: 'activate', model: 'flash' }`; event count still 1; work still `completed`. Terminal close + replay stay covered by existing worker finalize/e2e tests (untouched). |

**Helpers reused**: `RecordingEvents`, `RecordingJournal`, `RecordingReceipts`, `harness`/`seed` from `worker-helpers.ts`; `FakeLlmClient` from `@io/llm-client`; live fixtures from `e2e/harness.ts`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Single PR (~100–150 authored lines): gate + unit tests + integration extension. Under 400-line review budget; **no PR split**. Rollback: delete `cycle.ts` + `cycle.test.ts`, revert integration delta. Side-effect-free.

### PR slice plan

| Slice | Contents | Est. lines |
|-------|----------|------------|
| **PR1 (only)** | `cycle.ts` + `cycle.test.ts` + integration extension | ~100–150 authored |

`delivery_strategy=auto-chain` does not force a chain when under budget.

## Open Questions

None — approach, signature, and proofs are fixed by proposal + verified code.
