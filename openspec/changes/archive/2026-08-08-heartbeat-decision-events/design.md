# Design: heartbeat-decision BusinessEvents

## Technical Approach

One `heartbeat.decision` per gate evaluation (both branches), supervisor-owned. Pure digest factory in `business-domain`; port `appendIfAbsent` (at-most-once); wire in `tickCompany` after gate, before `onActivate`/upsert. Proposal Option 1 + all 6 MODIFIED requirements. No migration/npm deps; `cycle.ts`/`evaluate.ts`/`supervisor.ts`/worker byte-identical.

## Architecture Decisions

| Decision | Options | Choice |
|----------|---------|--------|
| Factory home | `heartbeat.ts` / new file | **`heartbeat-decision-event.ts`** — gate stays pure; mirrors `evidence-id.ts` |
| ∅ sentinel | `''` / Unicode ∅ | **`''`** — UTF-8 preimage `companyId\0{lastEventId\|''}\0kind`; real eventIds non-empty |
| Return type | event / `{inserted,event}` | **`Promise<Readonly<BusinessEvent>>`** like `append`; conflict returns **stored original** |
| PG path | RETURNING / rowCount+SELECT | **`INSERT…ON CONFLICT(event_id) DO NOTHING` + `rowCount`; if 0, SELECT+parse** |
| Clock | supervisor `now` / factory | **Factory `now?.()??Date.now()`** — no tick signature change |
| Hash | npm / builtin | **`node:crypto` `createHash`** — zero package deps |

## Data Flow

```
get(cursor) → gate(decision) → listByCompany → tailCursor(PRE-append)
  → appendIfAbsent(buildHeartbeatDecisionEvent(companyId, decision, cursor))
       throw ⇒ tick fails, cursor unadvanced; dup ⇒ no-op, original kept
  → activate? onActivate(companyId) → tail? upsert(companyId, tail)
```

## File Changes

| File | Action |
|------|--------|
| `packages/business-domain/src/heartbeat-decision-event.ts` | Create factory |
| `…/ports/repositories.ts` | Add `appendIfAbsent` |
| `…/ports/fakes.ts` | Fake impl |
| `…/index.ts` | Export factory |
| `packages/database/src/business-event-adapter.ts` | PG impl |
| `packages/app/src/supervisor/tick.ts` | Emit (PR2) |
| `…/test/heartbeat-decision-event.test.ts` | Create factory unit |
| `…/test/fakes.test.ts` | Fake semantics |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Live PG |
| `packages/database/test/business-adapters.test.ts` | Adapter SQL |
| `packages/app/test/supervisor/supervisor.test.ts` | Tick scenarios (PR2); `TracingEvents` |
| `packages/app/test/worker-helpers.ts` | `RecordingEvents.appendIfAbsent` |

**Byte-identical:** `cycle.ts`, `evaluate.ts`, `supervisor.ts`, worker finalize, context-compiler, migrations.

## Interfaces / Contracts

### Factory

```typescript
// packages/business-domain/src/heartbeat-decision-event.ts
import { createHash } from 'node:crypto';
import type { HeartbeatCursor, HeartbeatDecision } from './heartbeat.js';
import type { BusinessEvent } from './types.js';

const EMPTY_CURSOR = ''; // ∅

export function buildHeartbeatDecisionEvent(
  companyId: string,
  decision: HeartbeatDecision,
  cursor?: HeartbeatCursor,
  now?: () => number,
): BusinessEvent {
  const cursorKey = cursor?.lastEventId ?? EMPTY_CURSOR;
  const digest = createHash('sha256')
    .update(`${companyId}\0${cursorKey}\0${decision.kind}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
  return {
    eventId: `evt:hb:${digest}`,
    companyId,
    aggregateKind: 'heartbeat',
    aggregateId: companyId,
    eventType: 'heartbeat.decision',
    occurredAt: now?.() ?? Date.now(),
    payload: {
      decision: decision.kind,
      ...(decision.kind === 'activate' ? { model: 'flash' as const } : {}),
      cursor: cursor?.lastEventId ?? null,
    },
    source: 'supervisor',
  };
}
```

Identity = `(companyId, cursor?.lastEventId ?? '', decision.kind)`. Prefix `evt:hb:` ≠ worker `evt:{attemptId}`.

### Port

```typescript
append(event): Promise<Readonly<BusinessEvent>>;        // throws on dup
appendIfAbsent(event): Promise<Readonly<BusinessEvent>>; // no-op → original
```

- **Fake:** by `eventId`; exist → original (no push); else push+return input.
- **PG:** same cols as `append`; `ON CONFLICT (event_id) DO NOTHING`; `rowCount>0` → input; else `SELECT … WHERE event_id=$1` + `parseBusinessEventRow`. Empty `companyId` rejected.
- **Tick:** never catch append errors.

### Exports

`export { buildHeartbeatDecisionEvent } from './heartbeat-decision-event.js';`

### tick.ts (PR2)

```typescript
const cursor = await deps.cursors.get(companyId);
const decision = await evaluateHeartbeatGate({ events: deps.events }, companyId, cursor);
const stream = await deps.events.listByCompany(companyId);
const tail = tailCursor(stream);
await deps.events.appendIfAbsent(buildHeartbeatDecisionEvent(companyId, decision, cursor));
if (decision.kind === 'activate') await onActivate?.(companyId);
if (tail !== undefined) await deps.cursors.upsert(companyId, tail);
```

## Testing Strategy

| Layer | File | Covers |
|-------|------|--------|
| Domain unit | `heartbeat-decision-event.test.ts` | shape; clock≠id; empty/set cursor; kinds; `evt:hb:` |
| Fake unit | `fakes.test.ts` | insert+dup preserves original; `append` throws |
| Adapter unit | `business-adapters.test.ts` | ON CONFLICT SQL; empty companyId |
| Live PG **SEQUENTIAL** | `business-event-roundtrip.integration.test.ts` | double appendIfAbsent → one row |
| Tick unit PR2 | `supervisor.test.ts` | both branches; order; retry; append fail; multi-co |
| Defensive | heartbeat unit | decision not material |
| Compile | `TracingEvents`, `RecordingEvents` | new method |

### Req → tests (6 / 21)

| Req | # | Tests |
|-----|---|-------|
| Sequential Checkpointed Tick | 7 | supervisor tick (+ pump multi-co) |
| Non-Invasive Activation Seam | 2 | no-op + no-edit cycle/evaluate/supervisor |
| Append-Only Repository Port | 3 | fake + adapter + live PG seq |
| Model-Independent Event Facts | 2 | factory (+ existing worker) |
| Idempotent Single Emission | 4 | factory + appendIfAbsent (+ existing worker) |
| Declared Material Event Types | 3 | heartbeat unit + context absence |

`PATH=/data/node24/bin:$PATH pnpm test` / `pnpm check`; live PG `--no-file-parallelism`. Strict TDD.

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/executable/process boundary.

## Migration / Rollout

No migration (`business_event` + `uq_business_event_event_id`). Stacked-to-main:

| PR | Scope | ~LOC | Alone |
|----|-------|------|-------|
| 1 | factory+port+fake+PG+exports+tests; doubles | ~240 | Yes |
| 2 | tick wiring + supervisor scenarios | ~150 | on PR1 |

Rollback: revert PR2 then PR1.

## Open Questions

None blocking. Residual: ~1 row/tick/company (by design); 16-hex collision → benign no-op.
