# Design: Skill Outcome BusinessEvents

## Technical Approach

Capture the exact segment-7 selection once during `compileContext`, expose immutable identities as `ActivatedSkillRef[]`, and thread them through `prepareIntent` → `runClaimedWork` → `FinalizeInput`. On verified close, T1 appends a deterministic composite `work.skill-outcome` immediately after `work.completed`; no finalization-time selection, adapter change, heartbeat change, schema bump, or backfill occurs.

## Architecture Decisions

| Decision | Alternatives / tradeoff | Choice and rationale |
|---|---|---|
| Selection ownership and compiler purity | Re-select in `finalize` risks version drift; letting compilation call an LLM would mix data preparation with an external effect. | `compileContext` computes `activeSkillsFor` once and remains a pure data transformation: it does not accept or invoke `LlmClient` and returns only `{ messages, user, activatedSkills }`. Internal stable-prefix rendering receives the selected `Skill[]`; the same array maps to ordered refs, preserving bytes and ordering. |
| Outcome shape | Per-skill events improve indexing but multiply rows and partial-write risk. | One event per successful Work, including an empty selection. Payload v1 is `{ version: 1, activatedSkills }`; identity is `evt:sk:${attemptId}` = `evt:sk:att:{companyId}:{idempotencyKey}`, and `aggregateId` is exactly the closed `workId`. |
| Atomic placement | Separate transaction permits orphan facts; conditional append hides duplicate close defects. | Use throwing `events.append` twice inside existing T1: after receipt, append `work.completed`, then `work.skill-outcome`, then `journal.complete`. Any append/CAS/journal failure rolls back Work, receipt, and both events. |
| Compatibility | Persist selection in journal or modify adapters/heartbeat. | Additive in-memory contracts only. Existing `business_event.payload` already stores arbitrary JSON; `MATERIAL_EVENT_TYPES`, adapters, migrations, and heartbeat remain unchanged. |

## Data Flow

    skills.listByCompany → compileContext(select once)
                           ├→ messages/user (same bytes)
                           └→ activatedSkills
      prepareIntent → runClaimedWork → FinalizeInput
                                      └→ T1: Work CAS → receipt → work.completed
                                                                → work.skill-outcome
                                                                → journal.complete

Replay exits before T1 and emits nothing. CAS loss throws inside T1, rolls back both appends, then follows existing T2 reconciliation. A controlled retry rebuilds the same namespaced ID from the same attempt identity and can commit once; unique `event_id` rejects duplicate append. Finalize never reads Skills or re-derives selection.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/business-domain/src/skill-outcome-event.ts` | Create | Pure v1 input/payload types and deterministic builder. |
| `packages/business-domain/src/index.ts` | Modify | Export builder contracts. |
| `packages/context/src/segments.ts` | Modify | Render a caller-supplied selected array; preserve absent zero-byte behavior. |
| `packages/context/src/index.ts` | Modify | Define/export `ActivatedSkillRef`; return it from `compileContext` after one selection. |
| `packages/app/src/worker/intent.ts` | Modify | Return compiler selection while projecting only `messages`/`user` to `LlmRequest`. |
| `packages/app/src/worker/worker.ts` | Modify | Thread intent selection into finalization. |
| `packages/app/src/worker/finalize.ts` | Modify | Extend `FinalizeInput`, build and append the second event in T1. |
| `packages/business-domain/test/skill-outcome-event.test.ts` | Create | Builder identity, `aggregateId = closed workId`, payload v1, determinism, empty selection, and purity boundary. |
| `packages/context/test/context-compiler.test.ts`, `packages/context/test/prefix-stability.test.ts` | Modify | Exact refs/order, empty selection, single selection behavior, byte/golden stability, and an `LlmClient` spy proving compilation makes zero client calls. |
| `packages/app/test/worker-intent.test.ts`, `packages/app/test/worker-finalize.test.ts`, `packages/app/test/e2e/worker-e2e.integration.test.ts` | Modify | Threading, append order, rollback, replay/retry/version drift, live-PG atomic close. |
| `packages/database/test/business-event-roundtrip.integration.test.ts` | Modify | Live-PG v1 payload round-trip, duplicate rejection, and historical no-backfill assertion. |
| `packages/app/test/app-boundary.test.ts` | Modify | Enforce package boundaries: all `business-domain` source and manifest declarations retain zero runtime dependencies; `openai` remains confined to `llm-client`; the new builder has zero `@io/*` imports. |

## Interfaces / Contracts

`ActivatedSkillRef = Readonly<{ skillId: string; version: number }>`; `CompiledContext` adds `readonly activatedSkills: readonly ActivatedSkillRef[]`. `compileContext(input)` accepts no client and synchronously returns data only; `prepareIntent` alone projects `{ messages, user }` and invokes `LlmClient.complete`. Builder input is `{ companyId, workId, attemptId, occurredAt, activatedSkills }`; output uses `source: 'worker'`, `aggregateKind: 'work'`, `aggregateId: workId` (the closed Work identity), `eventType: 'work.skill-outcome'`, and payload `{ version: 1, activatedSkills }`.

## Testing Strategy

| Layer | Coverage |
|---|---|
| Unit | Builder determinism/identity and explicit `aggregateId = closed workId`; selection order/empty result; byte pins; client spy proving `compileContext` invokes no `LlmClient`; intent-to-finalize capture; append order; rollback; replay/failure no-emission. |
| Integration | Existing fake transaction harness plus live PostgreSQL round-trip, full worker close with two events, duplicate constraint, and pre-change rows remaining untouched. |
| Boundary | Scan every `business-domain` source import and its package manifest to prove zero runtime dependencies; assert `openai` imports/dependency remain confined to `llm-client`; separately assert zero `@io/*` imports in the builder. Keep `MATERIAL_EVENT_TYPES`, context schema/cohort, adapters, and heartbeat behavior unchanged. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration or backfill. Roll back by removing the second append, threaded field, compiler output, and builder; already persisted non-material events remain inert and safe.

## Open Questions

None.
