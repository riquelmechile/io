# Design: BusinessEvent — Deterministic Append-Only Business-Fact Log

## Technical Approach

Approach A: emit one `work.completed` `BusinessEvent` at the **worker** terminal close only. Define pure type + append-only port + ordered fake in `business-domain` (zero `@io/*`); persist via INSERT-only `PgBusinessEventRepository` + `006_business_events.sql` + row guard; append inside `finalizeInFlightWorkAtomically`'s existing `connection.transaction` alongside CAS + receipt + `journal.complete`. `eventId = evt:{attemptId}` (single-issuance). `completeWork` / `completeWorkAtomically` untouched. `compileContext` untouched (segment 12 stays ABSENT). Covers all 9 `business-event` requirements.

## Architecture Decisions

| Decision | Options | Choice + rationale |
|----------|---------|-------------------|
| Emit site | A worker-only / B + domain use case / C + consumers | **A** — smallest runtime path that actually runs; proves §9.8; Option B is a documented follow-up |
| Type shape | Factory vs plain struct | **Plain readonly interface** (mirror `BusinessReceipt`) + `buildWorkCompletedEvent` helper next to `buildReceipt` in `finalize.ts` |
| Port home | New `ports/events.ts` vs `repositories.ts` | **`repositories.ts`** — existing home for all aggregate ports |
| Fake storage | Map by id vs ordered array | **Array + eventId uniqueness check** — insertion order matches PG `ORDER BY id ASC` |
| Tx order inside T1 | event before/after receipt | **CAS → receipt.save → events.append → journal.complete** — event facts include receipt identity; CAS loss throws before any of the three writes |
| `completeWorkAtomically` | Wire events / leave alone | **Leave alone** (Approach A parity gap) |
| Payload content | Full Work snapshot vs terminal facts only | **Terminal facts only** (workId, state, receiptId, evidenceId, attemptId, actor, terminalState) — never LLM plan/output |

## Data Flow

```
worker cycle (effect OUTSIDE tx)
  → finalizeInFlightWorkAtomically
      journal.lookup (pool) ── replay/DENY early return (no event)
      connection.transaction(tx):
        repos = repositories(tx)   // work, receipts, journal, events
        work.get → state guard → updateIfVersion(completed)  // CAS loss → throw → ROLLBACK
        receipts.save(rcpt:{attemptId})
        events.append(evt:{attemptId}, work.completed)       // same tx
        journal.complete(attemptId, completed)
      COMMIT  // Work + receipt + event + journal together
```

CAS loss / thrown `FinalizeCasLostError` aborts the transaction → no orphan event. Completed replay returns before T1 → no second append.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/business-domain/src/types.ts` | Modify | Add `BusinessEvent` |
| `packages/business-domain/src/ports/repositories.ts` | Modify | Add `BusinessEventRepository` |
| `packages/business-domain/src/ports/fakes.ts` | Modify | Add `InMemoryBusinessEventRepository` |
| `packages/business-domain/src/index.ts` | Modify | Export type, port, fake |
| `packages/business-domain/test/business-event.test.ts` | Create | Unit: shape, determinism, port surface, order, tenant, duplicate id |
| `packages/database/sql/006_business_events.sql` | Create | `business_event` table + indexes |
| `packages/database/src/business-event-adapter.ts` | Create | `PgBusinessEventRepository` |
| `packages/database/src/row-guards.ts` | Modify | `parseBusinessEventRow` |
| `packages/database/src/index.ts` | Modify | Export adapter + guard |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Create | Live PG round-trip + duplicate reject (sequential) |
| `packages/database/test/boundary.test.ts` | Modify | Export surface + INSERT-only guard on adapter source |
| `packages/database/test/sql-migrations.test.ts` | Modify | Assert `006` DDL shape |
| `packages/app/src/worker/types.ts` | Modify | `events` on `WorkerRepositories` |
| `packages/app/src/worker/finalize.ts` | Modify | `events` on `FinalizeRepositories`; `buildWorkCompletedEvent`; append in T1 |
| `packages/app/src/composition/worker-deps.ts` | Modify | `events: new PgBusinessEventRepository(conn)` in factory (+ pool field if needed for reads later — only factory required) |
| `packages/app/test/worker-helpers.ts` | Modify | Event fake / recording double in harness |
| `packages/app/test/worker-finalize.test.ts` | Modify | One event/close; atomic with receipt; CAS-loss rollback |
| `packages/app/test/composition/worker-deps.test.ts` | Modify | Factory binds events adapter |
| `packages/app/test/e2e/harness.ts` | Modify | Apply `006_business_events.sql` |
| `packages/app/test/e2e/*` (structure-not-output) | Modify | Assert one `business_event` row after full cycle |
| `packages/app/test/parity.test.ts` | Modify | Mechanical: include event fake where repos constructed |

**Not touched:** `complete-work-flow.ts`, `packages/context/**`, LLM client, domain use cases.

## Interfaces / Contracts

### `BusinessEvent` (`types.ts`)

```ts
export interface BusinessEvent {
  readonly eventId: string;       // evt:{attemptId}
  readonly companyId: string;     // non-empty tenant
  readonly aggregateKind: string; // 'work'
  readonly aggregateId: string;   // workId
  readonly eventType: string;     // 'work.completed'
  readonly occurredAt: number;    // deps.now?.() ?? Date.now()
  readonly payload: Readonly<Record<string, unknown>>;
  readonly source: string;        // 'worker'
}
```

Construction: plain object (no factory class). Worker helper:

```ts
// finalize.ts — deterministic; inputs = terminal Work + receipt + FinalizeInput + executor
function buildWorkCompletedEvent(deps, input, completed, receipt): BusinessEvent {
  return {
    eventId: `evt:${input.attemptId}`,
    companyId: input.companyId,
    aggregateKind: 'work',
    aggregateId: completed.workId,
    eventType: 'work.completed',
    occurredAt: deps.now?.() ?? Date.now(),
    payload: {
      workId: completed.workId,
      state: completed.state,           // 'completed'
      receiptId: receipt.receiptId,    // rcpt:{attemptId}
      terminalState: receipt.terminalState,
      evidenceId: evidenceId(input.companyId, input.idempotencyKey),
      attemptId: input.attemptId,
      actor: deps.executor,
    },
    source: 'worker',
  };
}
```

No LLM field is read. Equal terminal facts → equal events.

### `BusinessEventRepository` (`ports/repositories.ts`)

```ts
export interface BusinessEventRepository {
  append(event: BusinessEvent): Promise<Readonly<BusinessEvent>>;
  listByCompany(companyId: string): Promise<readonly BusinessEvent[]>;
}
```

No update/delete/overwrite/get-by-id required this slice.

### `InMemoryBusinessEventRepository`

- Storage: `private readonly entries: BusinessEvent[] = []`
- `append`: `requireCompanyId`; reject if any `eventId` already present; push; return event
- `listByCompany`: filter `companyId`, return copy in insertion order (array index order)

### `PgBusinessEventRepository` (`business-event-adapter.ts`)

Mirror `PgBusinessReceiptRepository`: constructor `(conn: DbConnection)`; methods async.

**append SQL** (INSERT-only):

```sql
INSERT INTO business_event
  (event_id, company_id, aggregate_kind, aggregate_id, event_type,
   occurred_at, payload, source, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
```

Params: event fields + `JSON.stringify(payload)` + `Date.now()` for `created_at`. Reject empty `companyId`. UNIQUE(`event_id`) → driver error on duplicate (no upsert).

**listByCompany SQL**:

```sql
SELECT event_id AS "eventId", company_id AS "companyId",
       aggregate_kind AS "aggregateKind", aggregate_id AS "aggregateId",
       event_type AS "eventType", occurred_at AS "occurredAt",
       payload, source
FROM business_event
WHERE company_id = $1
ORDER BY id ASC
```

Each row through `parseBusinessEventRow`; throw on corrupt.

### `006_business_events.sql`

```sql
CREATE TABLE IF NOT EXISTS business_event (
  id              SERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  company_id      TEXT NOT NULL,
  aggregate_kind  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  occurred_at     BIGINT NOT NULL,
  payload         JSONB NOT NULL,
  source          TEXT NOT NULL,
  created_at      BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_event_event_id
  ON business_event (event_id);
CREATE INDEX IF NOT EXISTS idx_business_event_company_id
  ON business_event (company_id);
CREATE INDEX IF NOT EXISTS idx_business_event_aggregate
  ON business_event (aggregate_kind, aggregate_id);
```

All `IF NOT EXISTS` (idempotent, same as 001–005). Applied via harness migration list + integration setup (no migration runner).

### `parseBusinessEventRow`

Mirror `parseBusinessReceiptRow`: object check; non-empty strings for `eventId`, `companyId`, `aggregateKind`, `aggregateId`, `eventType`, `source`; `occurredAt` number; `payload` plain object (not null/array). Return `RowGuardResult<BusinessEvent>`.

### Worker T1 wiring (`finalize.ts` ~240–266)

```ts
export interface FinalizeRepositories {
  work: WorkRepository;
  receipts: BusinessReceiptRepository;
  journal: IdempotencyJournalPort;
  events: BusinessEventRepository;  // NEW
}
// inside transaction:
const { work, receipts, journal, events } = deps.repositories(tx);
// ... CAS ...
const receipt = await receipts.save(buildReceipt(...));
await events.append(buildWorkCompletedEvent(deps, input, completed, receipt));
await journal.complete(input.attemptId, completed);
```

`WorkerRepositories` gains the same `events` field. Replay path (completed + same hash) still returns **before** T1 — no append. Idempotency: if T1 somehow re-ran with same `attemptId`, UNIQUE(`event_id`) rejects; normal path never reaches that.

### `buildWorkerDeps`

```ts
repositories: (conn) => ({
  work: new PgWorkRepository(conn),
  receipts: new PgBusinessReceiptRepository(conn),
  journal: new PgIdempotencyJournalRepository(conn),
  events: new PgBusinessEventRepository(conn),  // NEW — tx-bound when conn is tx
}),
```

Pool-level `WorkerDeps` does not need a top-level `events` field for this slice (finalize only uses the factory). Optional top-level omit keeps surface minimal; tests that construct deps manually must supply `events` inside `repositories`.

### Idempotency

| Path | Behavior |
|------|----------|
| First close | `evt:{attemptId}` inserted in T1 |
| Completed replay | Early return at lookup — zero writes |
| Duplicate append same id | PG UNIQUE / fake throw; original preserved |
| CAS loss | Full T1 rollback — event gone |

## Testing Strategy

| Req | Scenarios | File | PG? |
|-----|-----------|------|-----|
| Pure Deterministic BusinessEvent | equal facts → equal events; no `@io/*` in package | `business-event.test.ts` + existing domain purity/boundary | No |
| Append-Only Port | only `append` + `listByCompany` keys | `business-event.test.ts` | No |
| Ordered In-Memory | interleaved companies → insertion order | `business-event.test.ts` | No |
| Insert-Only PG | round-trip all fields; source has INSERT, no UPDATE/DELETE | `business-event-roundtrip.integration.test.ts`, `boundary.test.ts`, `sql-migrations.test.ts` | Yes (sequential) |
| Atomic Worker Emission | one event on commit; CAS loss → 0 events | `worker-finalize.test.ts` (TxTrackingConnection pattern) | No |
| Model-Independent Facts | same terminal facts, different LLM content → same event | `worker-finalize.test.ts` or `business-event.test.ts` | No |
| Idempotent Single Emission | replay no second; duplicate id rejected | worker unit + PG round-trip | Partial |
| Tenant-Scoped | list A excludes B | unit fake + PG round-trip | Partial |
| Stable-Prefix Isolation | no context package changes; segment 12 still ABSENT | existing context tests unchanged (no new wiring) | No |
| E2E structure | one `business_event` row after full cycle | `packages/app/test/e2e/*` + harness `006` | Yes (sequential) |

Runner: `PATH=/data/node24/bin:$PATH pnpm test`; gate `pnpm check`. Live PG sequential: `pnpm vitest run --no-file-parallelism`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Additive only: ship `006_business_events.sql` (empty new table). No data backfill. Rollback = revert commits + drop table. Delivery: **stacked-to-main auto-chain**, 400-line review budget.

### PR slice plan (stacked-to-main)

| PR | Scope | Est. authored lines |
|----|-------|---------------------|
| **PR1** `business-domain` | type, port, fake, exports, `business-event.test.ts` | ~120–160 |
| **PR2** `database` | `006`, adapter, row guard, index export, round-trip + boundary + sql-migrations tests | ~180–240 |
| **PR3** `app` | finalize T1 + types + `buildWorkerDeps` + helpers + worker/composition/E2E/parity tests | ~200–280 |

Each PR ≤ 400 lines. PR3 depends on PR1+PR2. No consumer or Option B work in any PR.

## Open Questions

- None blocking. Domain-use-case parity (Option B) deferred by proposal.
