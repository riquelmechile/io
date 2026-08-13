# Proposal: Skill Outcome BusinessEvents

## Intent

`work.completed` carries zero skill attribution: skills condition the plan via context segment 7, but the selected set is discarded inside `compileContext`. Verified skill usage is invisible to future consumers — skill promotion (arch §9.10/§10.3) needs verified-outcome evidence, Memory `feedback.linked_outcomes` needs outcome IDs, and §13.2 heartbeats see only BusinessEvents. This change records the intent-time skill selection as an atomic business fact at verified terminal close.

## Scope

### In Scope
- New pure deterministic builder `packages/business-domain/src/skill-outcome-event.ts` (zero `@io/*`), `eventType: 'work.skill-outcome'`, non-material.
- `compileContext` output surfaces intent-time `activatedSkills: [{skillId, version}]`; `messages`/`user` bytes unchanged (no golden churn, no schema bump).
- `prepareIntent` returns the selection; finalize threads it; T1 appends the event atomically with `work.completed` — verified success only.
- Spec deltas: `business-event`, `worker-cycle`, `context-compiler`, `skill`; tests: determinism, atomicity, no-backfill, live-PG round-trip.

### Out of Scope
- Failure-outcome events (`invalid-plan`, `denied`, `recovery-required` emit nothing).
- Per-skill fan-out (`skill.outcome`) — Increment-8 follow-up.
- Promotion/learning engine, `expectedOutcome` comparison, Memory OS, backfill.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `business-event`: fourth disjoint namespace `sk:`; exclusive `work.skill-outcome` builder with `source: 'worker'`; atomic with terminal close; type stays undeclared (heartbeat material set untouched).
- `worker-cycle`: intent records the selection; T1 appends the skill-outcome fact beside `work.completed`.
- `context-compiler`: output surfaces the selection; prefix bytes, cohort, and `user` unchanged.
- `skill`: "outcome events deferred" wording updated to reflect emitted usage outcomes.

## Approach

Approach A (composite per-work fact). Identity `evt:sk:att:{companyId}:{idempotencyKey}` — new disjoint `sk:` namespace, `occurredAt` excluded, retry-stable. Selection captured at intent from `compileContext` (segment-7 truth), never re-derived at finalize. One extra row per close in the existing T1 transaction via `BusinessEventRepository` + `uq_business_event_event_id`; no adapter, heartbeat, or materiality change. Precedent: `acceptWorkAtomically` builder + transaction-scoped emission.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/business-domain/src/skill-outcome-event.ts` | New | Pure deterministic builder |
| `packages/context/src/index.ts`, `segments.ts` | Modified | Surface selection; bytes stable |
| `packages/app/src/worker/intent.ts` | Modified | Return `activatedSkills` |
| `packages/app/src/worker/finalize.ts` | Modified | T1 appends fact after `work.completed` |
| `packages/app/src/worker/worker.ts` | Modified | Thread selection intent→finalize |
| 4 spec files under `openspec/specs/` | Modified | Delta specs |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Version drift (new skill version mid-cycle) | Med | Capture at intent; never re-derive at finalize |
| Failure paths yield no facts → harmful skills invisible | High | Accepted; document; failure events are a later slice |
| Spec churn on pinned "three namespaces" wording | Med | Delta widens to four; verify heartbeat wording untouched |
| Pre-change rows lack facts | High | Accepted; no backfill (append-only) |

## Rollback Plan

Remove the T1 append and the `compileContext` output field. Already-appended events are inert (undeclared type, zero consumers) and safe to leave — no migration. Reverts to pre-change behavior byte-for-byte.

## Dependencies

- `acceptWorkAtomically` precedent (pure builder + transaction-scoped emission).
- Existing `BusinessEventRepository`/`business_event` table; live-PG suite for round-trip.

## Success Criteria

- [ ] `compileContext` returns the selection with byte-identical `messages`/`user`.
- [ ] Every verified close appends exactly one `work.skill-outcome` atomically with `work.completed`; CAS loss leaves neither.
- [ ] Identity deterministic across retries; duplicate append rejected by unique constraint.
- [ ] `MATERIAL_EVENT_TYPES` unchanged; heartbeat bytes identical.
- [ ] No backfill; pre-change rows untouched.
