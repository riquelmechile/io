# Design: supervisor-timer — workless heartbeat wake-ups

## Technical Approach

Implement Exploration Approach A / proposal scope: a composable `@io/app` polling supervisor that discovers companies via additive `listCompanyIds()`, evaluates each company sequentially through the **unchanged** companyId-only `evaluateHeartbeatGate`, advances a durable per-company cursor on **both** decision paths, and invokes injectable `onActivate` only on `activate`. Pure `tailCursor` + `HeartbeatCursorStore` live in business-domain; PG migration `008` + adapters mirror 006/007. No daemon start this slice — module + tests only. Gate/evaluator/`runWorker` stay byte-identical (heartbeat R6; supervisor is a new caller).

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Cursor port home | `ports/cursors.ts` vs fold into `repositories.ts` | Separate file mirrors `ports/idempotency.ts` (non-aggregate checkpoint); repositories.ts stays aggregate-only | **`ports/cursors.ts`** + fake in `ports/fakes.ts` |
| Company discovery | `listCompanyIds` on events vs new Company list | Event universe is the right universe (zero-event cos evaluate no-llm anyway); CompanyRepository has no list | **Additive `listCompanyIds()` on `BusinessEventRepository`** |
| Tail source | Supervisor second read vs extend gate return | Gate contract/`Function#length===3` must stay; second SELECT cheap at 30–60s | **Two reads/tick** (gate + supervisor `listByCompany` → `tailCursor`) |
| Cursor advance | Activate-only vs both paths | Activate-only re-fires forever; both paths consume once; novelty renews | **Upsert on both paths** when tail exists |
| Composition | Extend `buildWorkerDeps` vs sibling | Worker root stays worker-only; supervisor not started here | **`buildSupervisorDeps` sibling** in `composition/supervisor-deps.ts` |
| Timer | Real `setInterval` only vs injectable schedule | Unit tests need zero wall-clock waits | **`schedule?` + `now?` injection**; default uses `setInterval` |
| Multi-instance | Fencing now vs later | Spec: single-instance this slice | **No fencing**; atomic upsert only |

## Data Flow

```
startSupervisor ──interval──► tickAll
                                 │
                    listCompanyIds()  (events port)
                                 │
              for companyId of ids  (SEQUENTIAL — await each)
                                 │
         ┌───────────────────────┴────────────────────────┐
         │ 1. cursors.get(companyId)                      │
         │ 2. evaluateHeartbeatGate({events}, id, cursor) │  ← gate's listByCompany
         │ 3. events.listByCompany(id) → tailCursor       │  ← supervisor read
         │ 4. if tail: cursors.upsert(id, tail)           │  ← BOTH paths
         │ 5. if activate: onActivate(id)                 │  ← after upsert
         └────────────────────────────────────────────────┘
```

**Why advance on both paths:** the cursor marks "seen through event X". After activate, without advance, the next tick re-sees the same `work.completed` and re-fires `onActivate`. Advancing (after the callback — see Tick order) consumes the activation so unchanged ticks do not re-fire; a later append renews novelty. Delivery of the activation side effect is at-least-once, not exactly-once: the checkpoint is written only after `onActivate` returns, so a crash during the callback re-fires on the next tick (a permitted duplicate).

**Empty tail:** `tailCursor([]) === undefined` → skip upsert (no checkpoint row). Discovered companies always have ≥1 event, so this is defensive only.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/business-domain/src/heartbeat.ts` | Modify | Add pure `tailCursor` |
| `packages/business-domain/src/ports/cursors.ts` | Create | `HeartbeatCursorStore` port |
| `packages/business-domain/src/ports/repositories.ts` | Modify | `listCompanyIds()` on events port |
| `packages/business-domain/src/ports/fakes.ts` | Modify | Cursor fake + `listCompanyIds` on event fake |
| `packages/business-domain/src/index.ts` | Modify | Export new surface |
| `packages/database/sql/008_heartbeat_cursor.sql` | Create | `heartbeat_cursor` DDL |
| `packages/database/src/heartbeat-cursor-adapter.ts` | Create | `PgHeartbeatCursorRepository` |
| `packages/database/src/row-guards.ts` | Modify | `parseHeartbeatCursorRow` |
| `packages/database/src/business-event-adapter.ts` | Modify | `listCompanyIds` SQL |
| `packages/database/src/index.ts` | Modify | Export adapter + guard |
| `packages/app/src/supervisor/types.ts` | Create | Deps/options/handle types |
| `packages/app/src/supervisor/tick.ts` | Create | `tickCompany` sequential step |
| `packages/app/src/supervisor/supervisor.ts` | Create | `startSupervisor` → `{ stop }` |
| `packages/app/src/composition/supervisor-deps.ts` | Create | Wire PG events + cursor store |
| `packages/business-domain/test/heartbeat.test.ts` | Modify | `tailCursor` cases |
| `packages/business-domain/test/fakes.test.ts` | Modify | Cursor fake + listCompanyIds |
| `packages/app/test/supervisor/supervisor.test.ts` | Create | Unit (fakes, injectable schedule) |
| `packages/database/test/heartbeat-cursor-roundtrip.integration.test.ts` | Create | PG 008 + upsert isolation |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Modify | `listCompanyIds` distinct |
| `packages/database/test/sql-migrations.test.ts` | Modify | Ship/shape asserts for 008 |

**Untouched:** `runWorker`, `cycle.ts`, `evaluate.ts`, context, llm-client. No new runtime deps.

## Interfaces / Contracts

```typescript
// business-domain/src/heartbeat.ts
export function tailCursor(
  events: readonly BusinessEvent[],
): HeartbeatCursor | undefined;

// business-domain/src/ports/cursors.ts
export interface HeartbeatCursorStore {
  get(companyId: string): Promise<HeartbeatCursor | undefined>;
  upsert(companyId: string, cursor: HeartbeatCursor): Promise<void>;
}

// repositories.ts — additive only
interface BusinessEventRepository {
  append(event: BusinessEvent): Promise<Readonly<BusinessEvent>>;
  listByCompany(companyId: string): Promise<readonly BusinessEvent[]>;
  listCompanyIds(): Promise<readonly string[]>; // NEW read-only
}

// app/src/supervisor/types.ts
export type SupervisorDeps = {
  readonly events: BusinessEventRepository;
  readonly cursors: HeartbeatCursorStore;
};

export type StartSupervisorOptions = {
  readonly intervalMs: number;
  readonly now?: () => number; // reserved; decision is not clock-defined
  readonly onActivate?: (companyId: string) => void | Promise<void>;
  /** Default: setInterval. Tests inject a manual pump. */
  readonly schedule?: (
    tick: () => void | Promise<void>,
    intervalMs: number,
  ) => { stop: () => void };
};

export function startSupervisor(
  deps: SupervisorDeps,
  options: StartSupervisorOptions,
): { stop: () => void };

export async function tickCompany(
  deps: SupervisorDeps,
  companyId: string,
  onActivate?: (companyId: string) => void | Promise<void>,
): Promise<void>;
```

### Migration 008 + upsert

```sql
-- packages/database/sql/008_heartbeat_cursor.sql
CREATE TABLE IF NOT EXISTS heartbeat_cursor (
  company_id TEXT PRIMARY KEY,
  last_event_id TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

```sql
INSERT INTO heartbeat_cursor (company_id, last_event_id, updated_at)
VALUES ($1, $2, $3)
ON CONFLICT (company_id) DO UPDATE
SET last_event_id = EXCLUDED.last_event_id,
    updated_at = EXCLUDED.updated_at;
```

`get`: `SELECT last_event_id AS "lastEventId" FROM heartbeat_cursor WHERE company_id = $1` → `parseHeartbeatCursorRow` → `{ lastEventId }` or undefined. Reject empty `companyId` before SQL (fake parity).

`listCompanyIds`: `SELECT DISTINCT company_id AS "companyId" FROM business_event` — no ORDER required by spec; fake returns insertion-first-seen unique ids.

### Tick order (normative)

1. `require` non-empty `companyId`
2. `cursor = await cursors.get(companyId)`
3. `decision = await evaluateHeartbeatGate({ events }, companyId, cursor)`
4. `stream = await events.listByCompany(companyId)`; `tail = tailCursor(stream)`
5. if `decision.kind === 'activate'`: `await onActivate?.(companyId)` — **side effect first**
6. if `tail !== undefined`: `await cursors.upsert(companyId, tail)` — **checkpoint last**

**Crash safety (at-least-once, fixes R4-001):** the cursor checkpoint is persisted ONLY AFTER the activation side effect (`onActivate`) returns. A transient failure or process crash during `onActivate` leaves the cursor un-advanced, so the next tick (or a restart resuming from the stored cursor) re-evaluates the same stream tail and re-invokes `onActivate` — at-least-once delivery, consistent with the spec's Durable Cursor Recovery guarantee. A crash after `onActivate` returns but before the upsert re-activates on the next tick (a duplicate, which at-least-once permits). The `no-llm-heartbeat` path has no side effect, so its cursor upsert is unconditional and safe. The supervisor MUST NOT advance the cursor before the callback completes.

`tickAll`: `ids = await events.listCompanyIds()` then `for (const id of ids) await tickCompany(...)` — **no** `Promise.all`.

`startSupervisor`: register `schedule(async () => { await tickAll }, intervalMs)`; `stop` clears the schedule and MUST prevent further discovery/evaluation. Default schedule wraps `setInterval` (fire-and-forget tick errors logged/swallowed — no process crash this slice). **Do not** auto-start from any runner/CLI.

### Composition

```typescript
// composition/supervisor-deps.ts
export function buildSupervisorDeps(connection: DbConnection): SupervisorDeps {
  return {
    events: new PgBusinessEventRepository(connection),
    cursors: new PgHeartbeatCursorRepository(connection),
  };
}
```

Pool-bound only (no tx twin). Not called by `buildWorkerDeps`.

## Testing Strategy

| Layer | File | What |
|-------|------|------|
| Unit | `bd/test/heartbeat.test.ts` | `tailCursor` non-empty/empty; pure (no ambient) |
| Unit | `bd/test/fakes.test.ts` | Cursor get miss / upsert / tenant isolation; `listCompanyIds` distinct + no mutation |
| Unit | `app/test/supervisor/supervisor.test.ts` | Injected schedule drives tick; stop blocks later ticks; cursor advances on no-llm **and** activate; activate once then renew after new `work.completed`; sequential company order (record call order); restart-from-checkpoint (fresh supervisor + same fake store); `onActivate` recorded no-op; no real timers |
| PG int | `db/test/heartbeat-cursor-roundtrip.integration.test.ts` | Apply 008; upsert round-trip; ON CONFLICT replace; A/B tenant isolation; empty companyId reject; `describe.skipIf(!reachable)`; TRUNCATE beforeEach |
| PG int | `db/test/business-event-roundtrip.integration.test.ts` | `listCompanyIds` distinct across interleaved companies; snapshot unchanged |
| Structure | `db/test/sql-migrations.test.ts` | 008 ships; PK on company_id; columns present |

Runner: `PATH=/data/node24/bin:$PATH pnpm vitest run <path>`. PG: add `--no-file-parallelism`. Gate: `pnpm check`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Supervisor is an in-process composable module; process/daemon wiring is out of scope.

## Migration / Rollout

Additive only. Apply `008_heartbeat_cursor.sql` via `PgDbConnection.execute()` (idempotent `IF NOT EXISTS`), same as 001–007. No feature flag. No daemon enablement. Rollback: drop table / delete supervisor + additive lines — existing paths byte-identical so purely subtractive.

## Open Questions

None blocking. Deferred by design: real work dispatch from `onActivate`, heartbeat-decision events, fencing tokens, process lifecycle.
