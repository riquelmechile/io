# Design: Heartbeats — deterministic novelty filter (§13.2)

## Technical Approach

Option B: pure domain filter in `@io/business-domain` (precedent: `skill-activation.ts` / `activeSkillsFor`) plus a thin read-only app evaluator over existing `BusinessEventRepository.listByCompany`. No model call, timer, worker-cycle edit, compiler touch, or cursor persistence. Covers all 8 `heartbeat` spec requirements.

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Module home | types.ts vs new `heartbeat.ts` | types is data-only; skill rule lives alone | **NEW `packages/business-domain/src/heartbeat.ts`**, export via `index.ts` |
| Cursor | lastEventId \| count/offset \| seen-set | count breaks if stream filtered; set is heavier + deferred persist | **`HeartbeatCursor = { readonly lastEventId: string }`; param `cursor?: HeartbeatCursor`** |
| followsCursor | string-compare ids \| insertion index | eventIds are not lexicographically ordered | **insertion index in the supplied array** (mirrors PG `ORDER BY id ASC`) |
| Missing cursor id | treat as unseen \| treat as past end | missing = ahead/unknown; must not false-activate | **index = `events.length`** (nothing follows → no-llm) |
| App seam | WorkerDeps method \| free fn + events port | method invites runWorker coupling | **free `evaluateHeartbeatForCompany` + top-level `WorkerDeps.events`** (skills precedent) |
| events wiring | only T1 factory \| also pool-bound top-level | filter needs pool read outside T1 | **`buildWorkerDeps`: `events: new PgBusinessEventRepository(connection)`** additive; T1 factory unchanged |
| Material set | hardcode if \| declared constant | must stay extensible | **`MATERIAL_EVENT_TYPES = ['work.completed'] as const`** |

### Cursor comparison (precise)

Given `events` in insertion order (repo contract):

1. Absent `cursor` ⇒ cursor index = `-1` (precedes all).
2. Present `cursor.lastEventId` found at index `i` ⇒ cursor index = `i`.
3. Present but **not found** ⇒ cursor index = `events.length` (ahead of stream).
4. Event at index `j` **follows** cursor iff `j > cursorIndex`.
5. Material novelty = `events.some(e => isMaterialEvent(e) && followsCursor(e, events, cursor))`.
6. `evaluateHeartbeat` → novelty ? `{ kind: 'activate', model: 'flash' }` : `{ kind: 'no-llm-heartbeat' }`.

Never uses `occurredAt`, `Date.now`, LLM, randomness, or generated ids.

## Data Flow

```
caller (cursor?) ──► evaluateHeartbeatForCompany({ events }, companyId, cursor?)
                              │ reject empty companyId
                              ▼
                     events.listByCompany(companyId)   // READ ONLY
                              ▼
                     evaluateHeartbeat(events, cursor)  // pure domain
                              ▼
                     HeartbeatDecision
```

Worker cycle / `runWorker` / `compileContext` are **not** on this path.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/business-domain/src/heartbeat.ts` | Create | Decision type, cursor, material constant, pure filter |
| `packages/business-domain/src/index.ts` | Modify | Re-export heartbeat surface |
| `packages/business-domain/test/heartbeat.test.ts` | Create | Domain unit + boundary |
| `packages/app/src/heartbeat/evaluate.ts` | Create | Read-only evaluator seam |
| `packages/app/src/worker/types.ts` | Modify | Add `events: BusinessEventRepository` to `WorkerDeps` |
| `packages/app/src/composition/worker-deps.ts` | Modify | Pool-bound `PgBusinessEventRepository` on deps |
| `packages/app/test/worker-helpers.ts` | Modify | `RecordingEvents.listCalls`; harness satisfies `WorkerDeps.events` |
| `packages/app/test/heartbeat/evaluate.test.ts` | Create | Seam decision table + zero writes |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Create | Live-PG sequential proof |
| `packages/app/test/composition/worker-deps.test.ts` | Modify | Assert top-level `events` is `PgBusinessEventRepository` |

No deletes. No `runWorker`, `intent.ts`, `packages/context`, database adapter, or migration changes.

## Interfaces / Contracts

```typescript
// packages/business-domain/src/heartbeat.ts — zero @io/* imports
export type HeartbeatDecision =
  | { readonly kind: 'activate'; readonly model: 'flash' }
  | { readonly kind: 'no-llm-heartbeat' };

export type HeartbeatCursor = { readonly lastEventId: string };

export const MATERIAL_EVENT_TYPES: readonly ['work.completed'] = ['work.completed'];

export function isMaterialEvent(event: BusinessEvent): boolean;
export function hasMaterialNovelty(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): boolean;
export function evaluateHeartbeat(
  events: readonly BusinessEvent[],
  cursor?: HeartbeatCursor,
): HeartbeatDecision;
```

```typescript
// packages/app/src/heartbeat/evaluate.ts
export async function evaluateHeartbeatForCompany(
  deps: { readonly events: BusinessEventRepository },
  companyId: string,
  cursor?: HeartbeatCursor,
): Promise<HeartbeatDecision>;
// throws on empty companyId BEFORE list; one listByCompany; zero append/writes
```

`WorkerDeps` gains `events: BusinessEventRepository` (pool-bound). Worker cycle does not call it this slice.

## Testing Strategy

| Req | Layer / file | Approach |
|-----|--------------|----------|
| Pure Heartbeat Decision | `business-domain/test/heartbeat.test.ts` | Construct both branches; equality; zero `@io/*` src scan + empty package.json deps (copy business-event boundary) |
| Declared Material Types | same | Table: `work.completed` material; undeclared not; constant equals `['work.completed']` |
| Deterministic Novelty | same | Same inputs ⇒ same decision; signature admits only `(events, cursor)` |
| Cursor-Defined Novelty | same | Absent + material → activate; cursor at/after last material → no-llm; missing lastEventId → no-llm |
| No-LLM Guarantee | same | Inverse-poison: identical events+cursor under different fake work/delegation/context worlds → identical decision; no llm import |
| Read-Only Seam | `app/test/heartbeat/evaluate.test.ts` | RecordingEvents: empty → no-llm; unseen work.completed → activate; seen cursor → no-llm; `listCalls.length === 1`, `appends.length === 0` |
| Tenant-Scoped | domain + app | Cross-tenant fake isolation; empty companyId rejected before list |
| Stable-Prefix Isolation | domain boundary + package.json assert | No heartbeat in CompileContextInput; `packages/context` deps remain only `@io/business-domain` |
| Live-PG | `app/test/heartbeat/heartbeat.integration.test.ts` | Sequential; post-`runWorker` cycle via harness → activate; fresh company → no-llm. `describe.skipIf(!reachable && !e2eRequirePg)` |

Runner: `PATH=/data/node24/bin:$PATH pnpm test`. PG: `pnpm vitest run --no-file-parallelism`. Gate: `pnpm check`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Additive only. Stacked-to-main (review budget 400):

| PR | Scope | Est. authored lines |
|----|-------|---------------------|
| PR1 | business-domain heartbeat module + exports + unit tests | ~140–180 |
| PR2 | app evaluator + WorkerDeps.events + buildWorkerDeps + helpers + seam + live-PG + composition assert | ~130–170 |

Total ~270–350; each PR ≤400. Rollback = revert PR(s); zero data impact.

## Open Questions

None — cursor representation and composition shape resolved above.
