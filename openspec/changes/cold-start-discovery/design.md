# Design: Cold-Start Discovery

> Grounded at main `c33bdde` / worktree `31a20a2`; every claim is `file:symbol` verified via CodeGraph. Implements Approach A (proposal); tracks the corrected deltas (Engram `sdd/cold-start-discovery/gate-correction` #6440). No code implemented this phase.

## Technical Approach

Widen `acceptWork` (`accept-work.ts:7`) to append one deterministic `work.accepted` event after the CAS succeeds, with both repositories bound to ONE transaction-scoped connection — mirroring `completeWorkAtomically` (`complete-work-flow.ts:28`). Declare the type material. The cursor stays the sole novelty guard; `listCompanyIds` (`business-event-adapter.ts:128`), the heartbeat evaluator, dispatch, and the worker cycle are byte-unchanged — one extra event row surfaces a zero-history company.

## Architecture Decisions

| # | Decision | Choice | Rationale (rejected alternative inline) |
|---|---|---|---|
| D1 | Emission seam | Widen `acceptWork` deps to `{ work, events, now? }`; append only on `ok:true`, local to `acceptWork` | Shared `applyWorkTransition` (`result.ts:111`) serves 5 transitions (11 callers); widening it violates "MUST NOT alter any other transition". |
| D2 | Atomicity | New `acceptWorkAtomically(conn, cmd)` in `packages/database/src/`, mirroring `completeWorkAtomically` | `PgDbConnection.transaction` (`pg-connection.ts:92`) is `BEGIN→fn(tx)→COMMIT`; only a THROW in `fn`→`ROLLBACK`. A pool-bound append after CAS reintroduces the eventless-accepted-Work gap on crash. |
| D3 | Builder location | Pure `buildWorkAcceptedEvent(work, now?)` in `packages/business-domain/src/work-accepted-event.ts`, zero `@io/*` | Spec mandates a pure builder. `buildWorkCompletedEvent` (`finalize.ts:366`) rejected (carries `@io/*`); correct precedent is `buildHeartbeatDecisionEvent` (`heartbeat-decision-event.ts:25`). |
| D4 | Identity, collision-freedom, determinism | Acceptor `eventId=evt:acc:{workId}` depends SOLELY on `workId`; the other non-time routing/typing/payload fields (`source:'acceptor'`, `eventType:'work.accepted'`, `aggregateKind:'work'`, `aggregateId:workId`, `companyId`, `payload`) derive deterministically from the accepted Work facts — LLM output, randomness, and generated identifiers MUST NOT alter them; `occurredAt=now?.()??Date.now()` derives from injected `now`, EXCLUDED from identity | **Three disjoint post-`evt:` namespaces with exclusive builder/source ownership and DB uniqueness backstop.** All three IDs share the `evt:` root (so they are NOT prefix-disjoint): worker `evt:{attemptId}` (`finalize.ts:373`) where `attemptId` follows `att:{companyId}:{idempotencyKey}` (`intent.ts:27`) — full `evt:att:{companyId}:{idempotencyKey}`, `source:'worker'`; supervisor `evt:hb:{digest}` (`heartbeat-decision-event.ts:37`), `source:'supervisor'`; acceptor `evt:acc:{workId}`, `source:'acceptor'`. The segment immediately after `evt:` is exactly one of `att:`/`hb:`/`acc:` — disjoint namespaces + one-builder-per-segment + exclusive `source` keep them collision-free; `uq_business_event_event_id` is the persistence backstop. `proposed→accepted` is one-shot. |
| D5 | Materiality | `MATERIAL_EVENT_TYPES`→`readonly ['work.accepted','work.completed']`; `isMaterialEvent`/`hasMaterialNovelty` unchanged | Cursor (insertion-index) novelty already gates activation (D9); declaring the type material is the whole change. `heartbeat.decision` stays undeclared. |
| D6 | Typed failures | Every typed failure RESOLVES before any write → commit-on-resolved of an empty tx persists NEITHER Work NOR event; only a post-CAS THROW (e.g. duplicate `append`) rolls back | `applyWorkTransition` (`result.ts:118-135`): `invalid-command`/`not-found`/`invalid-transition`/`version-conflict` return pre-write; a lost CAS UPDATE matches 0 rows and returns the winner. `transaction` commits the resolved value; rolls back ONLY on throw (`fakes.ts:249`/`uq_business_event_event_id`). **Typed failures are NOT rollback — they are `{ok:false}` values, never throws.** |
| D7 | Other emissions preserved | Keep `work.completed` (`finalize.ts:321`) and `heartbeat.decision` (`tick.ts:49`); only acceptance emits `work.accepted` | A blanket "no transition other than accept may append any event" is rejected — it would wrongly prohibit the REQUIRED existing emitters. Constraint scopes to `work.accepted` only. |
| D8 | Migration | None; emission covers future acceptances only | Spec scenario "Pre-change accepted Work is not backfilled" authoritative. |
| D9 | Settled-failure residual | Documented as operational limitation; NOT fixed | A settled dispatch appends no further material event → cursor advances past the accept → next Work waits for the next accept/completion (pre-existing cursor behavior). |

## Production Acceptance Composition Seam (D10)

`acceptWork` has **NO production caller today** (blast radius: only `use-cases/index.ts` re-export + tests). The daemon consumes `buildSupervisorDispatch` (`supervisor-dispatch.ts:48`) for SUPERVISION only (`onActivate`/`onRecovery`/`requestRecovery`); it does NOT drive acceptance, and this design does NOT claim daemon usage. The atomic accept is surfaced through the SAME composition root: add `acceptWork:(cmd)=>acceptWorkAtomically(connection,cmd)` to `buildSupervisorDispatch`'s return. The e2e and any future operator/admin entry consume that one seam.

## Data Flow

```
acceptWorkAtomically(conn,cmd)                      [database — NEW, mirrors completeWorkAtomically]
  conn.transaction(tx ⇒ acceptWork(cmd, { work, events, now }))   // repos bound to tx
    ├─ ok:true  ⇒ COMMIT  ⇒ Work@vN+1 + 1 event row (atomic)
    ├─ ok:false ⇒ COMMIT  (empty tx; persists NEITHER — D6)
    └─ throw    ⇒ ROLLBACK (post-CAS dup-append ⇒ persists NEITHER)
                         ▼
listCompanyIds() returns the company → tickAll (supervisor.ts:43) → tickCompany (tick.ts:36) →
evaluateHeartbeatGate (material ⇒ activate) → onActivate → dispatchCompanyActivation →
runWorker → finalize → work.completed (already material)
```

## Interfaces / Contracts

```ts
// packages/business-domain/src/work-accepted-event.ts — PURE, zero @io/*
// Determinism contract (spec business-event R1): eventId depends SOLELY on workId;
// companyId/aggregateKind/aggregateId/eventType/source/payload derive deterministically
// from the accepted Work facts (no LLM output, randomness, or generated identifiers);
// occurredAt derives from injected `now` and is EXCLUDED from identity.
export function buildWorkAcceptedEvent(work: Work, now?: () => number): BusinessEvent {
  return {
    eventId: `evt:acc:${work.workId}`,          // SOLELY workId
    companyId: work.companyId, aggregateKind: 'work', aggregateId: work.workId,
    eventType: 'work.accepted',
    occurredAt: now?.() ?? Date.now(),           // injected now; EXCLUDED from identity
    payload: { workId: work.workId, state: work.state, actor: work.proposer },
    source: 'acceptor',
  };
}
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/business-domain/src/work-accepted-event.ts` | Create | Pure `buildWorkAcceptedEvent` (D3). |
| `packages/business-domain/src/use-cases/accept-work.ts` | Modify | Widen deps; conditional append on `ok:true` (D1,D6). |
| `packages/business-domain/src/heartbeat.ts` | Modify | `MATERIAL_EVENT_TYPES`→add `'work.accepted'` (D5). |
| `packages/business-domain/src/index.ts` | Modify | Export `buildWorkAcceptedEvent`. |
| `packages/database/src/accept-work-flow.ts` | Create | `acceptWorkAtomically(conn,cmd)` (D2). |
| `packages/database/src/index.ts` | Modify | Export `acceptWorkAtomically`. |
| `packages/app/src/composition/supervisor-dispatch.ts` | Modify | Return `acceptWork:(cmd)=>acceptWorkAtomically(connection,cmd)` (D10). |
| `packages/app/test/e2e/cold-start-e2e.integration.test.ts` | Create | Real-path e2e (no `seedAcceptedWork`, no direct callbacks). |
| `packages/business-domain/test/use-cases.test.ts` | Modify | Update callers for widened deps. |
| `packages/business-domain/test/work-accepted-event.test.ts` | Create | Identity determinism + grammar/ownership disjointness. |
| `packages/database/test/business-pg-roundtrip.integration.test.ts` | Modify | Add live-PG empty-commit/rollback cases. |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | `buildWorkAcceptedEvent`: equal `workId` + different clocks/LLM outputs ⇒ equal `eventId` (SOLELY `workId`); non-time routing/typing/payload fields deterministic from the accepted Work facts; `occurredAt` excluded from identity. `acc:` built ONLY by the acceptor builder with `source:'acceptor'`, distinct from the `hb:` supervisor namespace and the `att:{companyId}:{idempotencyKey}` worker namespace (full `evt:att:…`), though none is prefix-disjoint from the shared `evt:` root. `acceptWork` success appends one event; each typed failure returns `{ok:false}` and appends nothing. Two novel accepts + one tick ⇒ one `activate`. | Fakes; vitest. |
| Integration (live PG) | `acceptWorkAtomically`: success COMMITS Work@vN+1+event; each typed failure COMMITS an empty tx (persists NEITHER); duplicate-append post-CAS THROWS⇒ROLLBACK⇒persists NEITHER; duplicate accept⇒`invalid-transition`. | docker PG; `pnpm vitest run --no-file-parallelism`. |
| Spec seam | `InMemoryBusinessEventRepository.append` THROWS on duplicate eventId (`fakes.ts:249`) — extend to `source:'acceptor'`. | Existing fake. |
| E2E (real path) | propose → **accept via the composition's `acceptWork` seam (D10)** → assert `listCompanyIds()` contains the company → **pump via `startSupervisor(deps,{ intervalMs, schedule:oneShot, onActivate, onRecovery })` then `handle.stop()`** so the companyId flows from discovery (`tickAll`→`listCompanyIds` (`supervisor.ts:45`)→`tickCompany` (`tick.ts:36`)→`evaluateHeartbeatGate`→`onActivate`)→`dispatchCompanyActivation`→`runWorker`→finalize→assert `work.completed`+Work `completed`. **MUST NOT use `seedAcceptedWork`; MUST NOT invoke `onActivate`/`onRecovery` directly with a hardcoded company.** `tickAll` is unexported (`supervisor.ts:43`); the injectable `Schedule` (`types.ts:57`) is the source-true one-shot pump. | E2E harness, live PG. |

> **No precedent:** `recovery-e2e.integration.test.ts` seeds `in_progress` Work directly (`harness.work.save`, lines 60-73) and calls `onRecovery(E2E_COMPANY)` directly (line 132) — it never calls `listCompanyIds` or `tickAll`/`tickCompany`, so it is NOT a discovery/tick precedent.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration, no feature flag (D8). **Rollback**: revert builder, deps widening, `acceptWorkAtomically`, materiality constant, composition binding, e2e, and the three spec deltas together. Appended `work.accepted` rows remain immutable history; after rollback the type is undeclared ⇒ no longer material ⇒ no longer activates — facts persist, activation stops.

## Open Questions

None blocking. The settled-failure residual (D9) is a documented operational limitation, not an open question — consistent with the proposal's "no scope expansion" assumption.
