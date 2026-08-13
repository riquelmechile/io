# Tasks: Skill Outcome BusinessEvents

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~550–750 |
| 400-line budget risk | High (contractual indicator) |
| Real review budget (cached) | 800 |
| Chained PRs recommended | Yes — the contractual 400-line indicator is High and the user resolved the chain strategy after tasks; although the forecast total fits within 800, delivery runs as autonomous stacked-to-main slices |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (user-resolved after tasks) |

Decision needed before apply: No (resolved — user chose stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Threat matrix: **N/A** (design §Threat Matrix — no routing/shell/subprocess/VCS/executable/process boundary). No threat-matrix RED tests.

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|-------------------|
| 1 | Pure builder + domain types (zero-deps) | `pnpm vitest run packages/business-domain/test/skill-outcome-event` | `pnpm typecheck` (purity/boundary) | Remove `skill-outcome-event.ts` + export; inert, no consumer |
| 2 | Compiler single-pass selection (byte-stable) | `pnpm vitest run packages/context/test/context-compiler packages/context/test/prefix-stability` | golden diff = empty | Drop `activatedSkills` from `CompiledContext`; bytes unchanged |
| 3 | Intent→worker→finalize threading + atomic T1 append | `pnpm vitest run packages/app/test/worker-intent packages/app/test/worker-finalize` | N/A unit-level; live-PG proven in unit 4 | Remove `FinalizeInput.activatedSkills` + second `append`; reverts byte-for-byte |
| 4 | Atomic live-PG proof + boundaries/non-materiality/no-backfill + spec gates | `pnpm vitest run packages/app/test/e2e/worker-e2e.integration packages/database/test/business-event-roundtrip.integration packages/app/test/app-boundary` | `docker compose up` then `pnpm test` (live PG; `pg-required` fails loudly in CI) | Test-only; no behavior revert |

## Phase 1: Domain Foundation (Unit 1)

- [x] 1.1 RED — Create `packages/business-domain/test/skill-outcome-event.test.ts`: identity `evt:sk:att:{companyId}:{idempotencyKey}` retry-stable with `occurredAt` excluded; `aggregateId = closed workId`; payload `{version:1, activatedSkills}`; determinism/equality; empty-selection payload. *(business-event: Event construction deterministic; Composite empty selection; Skill-outcome identity deterministic)*
- [x] 1.2 GREEN — Create `packages/business-domain/src/skill-outcome-event.ts`: `buildSkillOutcomeEvent({companyId, workId, attemptId, occurredAt, activatedSkills})` → `source:'worker'`, `aggregateKind:'work'`, `aggregateId:workId`, `eventType:'work.skill-outcome'`, `eventId=evt:sk:${attemptId}`; mirror `buildWorkAcceptedEvent` purity.
- [x] 1.3 Export `ActivatedSkillRef = Readonly<{skillId:string; version:number}>` + input/payload types from `packages/business-domain/src/index.ts`.
- [x] 1.4 REFACTOR — assert zero `@io/*` imports; `pnpm typecheck`.

## Phase 2: Compiler Single-Pass Selection (Unit 2)

- [x] 2.1 RED — `packages/context/test/context-compiler.test.ts`: `activatedSkills` equals segment-7 cohort in order; empty list when none; `LlmClient` spy proves `compileContext` makes zero client calls. *(context-compiler: Exact selected identities; Empty selection explicit; LlmClient-compatible result)*
- [x] 2.2 RED — `packages/context/test/prefix-stability.test.ts`: `messages`/`user` byte-identical pre/post extension; golden unchanged. *(Output extension is byte-stable)*
- [x] 2.3 GREEN — `packages/context/src/index.ts`: add `readonly activatedSkills: readonly ActivatedSkillRef[]` to `CompiledContext`; compute selection ONCE from existing segment-7 selection; accept no `LlmClient`, return data only.
- [x] 2.4 GREEN — `packages/context/src/segments.ts`: map the already-selected segment-7 `Skill[]` to ordered refs (same array, no re-select); preserve absent zero-byte behavior.
- [x] 2.5 REFACTOR — `pnpm vitest run packages/context`; confirm golden diff empty.

## Phase 3: Intent → Worker → Finalize Threading (Unit 3)

- [x] 3.1 RED — `packages/app/test/worker-intent.test.ts`: `prepareIntent` returns intent-captured `activatedSkills`; version drift after intent leaves selection unchanged. *(worker-cycle: Version drift; skill: Captured version attributed; Intent Recorded Before the Effect)*
- [x] 3.2 RED — `packages/app/test/worker-finalize.test.ts`: verified close appends `work.completed` → exactly one `work.skill-outcome` → `journal.complete`; CAS loss leaves neither event; replay/invalid-plan/denied/recovery-required emit no skill-outcome. *(business-event: Terminal close commits; CAS loss leaves no orphan; Atomic Worker Terminal Emission; skill: Failure emits no usage outcome)*
- [x] 3.3 GREEN — `packages/app/src/worker/intent.ts`: return `activatedSkills` from `compileContext` in `IntentResult`; project only `{messages,user}` to `LlmRequest`.
- [x] 3.4 GREEN — `packages/app/src/worker/worker.ts`: thread `activatedSkills` intent → `FinalizeInput`.
- [x] 3.5 GREEN — `packages/app/src/worker/finalize.ts`: extend `FinalizeInput`; build + `events.append` the `work.skill-outcome` inside T1 after `work.completed`, before `journal.complete`; skip on non-success; no finalize-time re-selection.
- [x] 3.6 REFACTOR — `pnpm vitest run packages/app/test/worker-`. *(Worker suite 119/119; full `pnpm test` 1402 passed | 6 skipped; byte-identity pins re-pinned + normalization proofs extended for the Unit-3 threading; stale one-event live-PG assertions updated to the two-event contract; typecheck/format/build clean)*

## Phase 4: Atomic Proof, Boundaries & Spec Gates (Unit 4)

- [x] 4.1 RED/GREEN — `packages/app/test/e2e/worker-e2e.integration.test.ts`: full cycle vs live PG persists Work + one receipt + `work.completed` + one skill-outcome in same close; stale-token rollback leaves Work/journal/receipt/both events unchanged. *(worker-cycle: End-to-end happy path; Stale-token close rolls back)*
- [x] 4.2 RED/GREEN — `packages/database/test/business-event-roundtrip.integration.test.ts`: v1 payload round-trip byte-identical; duplicate `evt:sk:` rejected by `uq_business_event_event_id`; historical rows untouched (no backfill). *(Idempotent Single Emission: Duplicate throwing append rejected; Completed replay does not append; skill: Historical Work remains untouched)*
- [x] 4.3 RED/GREEN — `packages/app/test/app-boundary.test.ts`: `business-domain` zero runtime deps + builder zero `@io/*`; `openai` confined to `llm-client`; `work.skill-outcome` NOT in `MATERIAL_EVENT_TYPES`; heartbeat bytes unchanged. *(business-event: Skill-outcome identity deterministic and non-material; Pure Deterministic BusinessEvent)*
- [x] 4.4 GATE — `pnpm check` GREEN (format/typecheck/build/lint/test); spec-alignment sweep: every delta scenario → passing test; namespaces disjoint `sk:`/`att:`/`hb:`/`acc:`; no migration/backfill.

UNIT 4 (2026-08-13, apply): tasks 4.1–4.4 marked [x] — atomic live-PG proof, boundaries & spec gates (284 changed lines ≤ 360 cap): 4.1 live-PG stale-token close rolls back Work/journal/receipt/BOTH events (RED caught a missing `E2E_REQUEST_HASH` import → repaired → GREEN); 4.2 v1 skill-outcome payload round-trip byte-identical + duplicate `evt:sk:` rejected via `uq_business_event_event_id` + historical rows untouched (no backfill, replay does not append); 4.3 package boundaries (`business-domain` zero runtime deps package-wide + builder zero `@io/*`), `openai` confined to `llm-client`, `work.skill-outcome` NOT in `MATERIAL_EVENT_TYPES`, heartbeat bytes sha256-pinned unchanged; 4.4 GATE `pnpm check` exit 0 — full `pnpm test` 1411 passed | 5 skipped (isolated dedicated PG harness `io-unit4-iso-pg-9cad4d9e` on 127.0.0.1:55432, `IO_REQUIRE_PG=1`; PG tests ran, none skipped). Details in `sdd/skill-outcome-events/apply-progress`.
