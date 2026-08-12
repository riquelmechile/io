# Tasks: Cold-Start Discovery

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~500 (450–550) |
| 400-line budget risk | Medium (above 400 default; under 800 session budget) |
| Chained PRs recommended | No (fits 800-line session budget; atomicity proof ships with its seam) |
| Suggested split | Single PR, 4 work-unit commits |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (cached; not activated) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure `work.accepted` builder + identity tests | PR 1 | `pnpm vitest run packages/business-domain/test/work-accepted-event.test.ts` | same (pure unit, no I/O) | `work-accepted-event.ts` + test + `index.ts` export |
| 2 | `acceptWork` widening + materiality | PR 1 | `pnpm vitest run packages/business-domain` | same (fakes) | `accept-work.ts` deps + `heartbeat.ts` constant + caller tests |
| 3 | Atomic PG seam + rollback proof | PR 1 | `pnpm vitest run --no-file-parallelism packages/database/test/business-pg-roundtrip.integration.test.ts` | docker PG live round-trip | `accept-work-flow.ts` + db export + live-PG cases + fake dup-seam |
| 4 | Composition surface + real-path e2e | PR 1 | `pnpm vitest run --no-file-parallelism packages/app/test/e2e/cold-start-e2e.integration.test.ts` | docker PG + supervisor one-shot pump | `supervisor-dispatch.ts` seam + e2e test |

## Phase 1: Pure Event Builder (business-domain)

- [x] 1.1 [RED] Create `packages/business-domain/test/work-accepted-event.test.ts`: equal `workId` + different clocks/LLM outputs ⇒ equal `eventId = evt:acc:{workId}`; non-time routing/typing/payload fields deterministic from accepted Work; `occurredAt` excluded from identity; `acc:` produced ONLY by acceptor builder with `source:'acceptor'`, distinct from `hb:` supervisor and `evt:att:{companyId}:{idempotencyKey}` worker namespaces.
- [x] 1.2 [GREEN] Create `packages/business-domain/src/work-accepted-event.ts`: pure `buildWorkAcceptedEvent(work, now?)`, zero `@io/*`, per design §Interfaces (D3, D4).
- [x] 1.3 Export `buildWorkAcceptedEvent` from `packages/business-domain/src/index.ts`.
- [x] 1.4 Commit `feat(business-domain): add work accepted event builder` — committed as `18cddf0`.

## Phase 2: acceptWork Widening + Materiality (business-domain)

- [x] 2.1 [RED] Extend `packages/business-domain/test/use-cases.test.ts` (update existing callers): success appends exactly one `work.accepted`; each typed failure (`version-conflict`/`invalid-transition`/`not-found`/`invalid-command`) returns `{ok:false}` appending nothing; two novel accepts + one tick ⇒ one `activate`; `complete` still appends `work.completed`, supervisor still appends `heartbeat.decision`.
- [x] 2.2 [GREEN] Modify `packages/business-domain/src/use-cases/accept-work.ts`: widen deps to `{ work, events, now? }`; build via `buildWorkAcceptedEvent` and append only on `ok:true`; typed failures resolve pre-write — no thrown control flow, no `@io/*` (D1, D6).
- [x] 2.3 [GREEN] Modify `packages/business-domain/src/heartbeat.ts`: add `'work.accepted'` to `MATERIAL_EVENT_TYPES` (readonly); leave `isMaterialEvent`/`hasMaterialNovelty`/cursor unchanged (D5, D9).
- [ ] 2.4 Commit `feat(business-domain): emit work.accepted on accept and declare it material`.

## Phase 3: Atomic PostgreSQL Acceptance Seam + Rollback Proof (database)

- [ ] 3.1 [RED] Extend `packages/database/test/business-pg-roundtrip.integration.test.ts`: success COMMITS Work@vN+1 + one event; each typed failure COMMITS an empty tx (persists NEITHER); post-CAS duplicate-`append` THROWS ⇒ ROLLBACK ⇒ persists NEITHER; duplicate accept ⇒ `invalid-transition`. Extend the in-memory fake `append`/`appendIfAbsent` to throw on duplicate `source:'acceptor'` eventId (`ports/fakes.ts`).
- [ ] 3.2 [GREEN] Create `packages/database/src/accept-work-flow.ts`: `acceptWorkAtomically(conn, cmd)` mirroring `completeWorkAtomically` (`complete-work-flow.ts:28`); bind work + event repos to one `conn.transaction(tx ⇒ acceptWork(cmd, { work, events, now }))`; commit-on-resolved, rollback-on-throw (D2).
- [ ] 3.3 Export `acceptWorkAtomically` from `packages/database/src/index.ts`.
- [ ] 3.4 Commit `feat(database): add atomic acceptance transaction with rollback proof`.

## Phase 4: Production Composition Surface + Real-Path E2E (app)

- [ ] 4.1 [RED] Create `packages/app/test/e2e/cold-start-e2e.integration.test.ts`: propose → accept via the composition `acceptWork` seam → assert `listCompanyIds()` contains the company → pump `startSupervisor(deps, { intervalMs, schedule: oneShot, onActivate, onRecovery })` then `handle.stop()` → assert discovery → `activate` → dispatch → `runWorker` → finalize → `work.completed` + Work `completed`. MUST NOT use `seedAcceptedWork`; MUST NOT call `onActivate`/`onRecovery` directly (D10).
- [ ] 4.2 [GREEN] Modify `packages/app/src/composition/supervisor-dispatch.ts`: add `acceptWork: (cmd) => acceptWorkAtomically(connection, cmd)` to the return (D10).
- [ ] 4.3 Commit `feat(app): surface atomic accept in supervisor dispatch and prove cold-start e2e`.

## Phase 5: Spec Alignment, Check-Only Gates, Archive Readiness

- [ ] 5.1 Run `pnpm check` (ordered gates: tsc typecheck, biome lint/format, vitest) — all GREEN; run `pnpm build` — clean.
- [ ] 5.2 Spec-alignment sweep: no backfill (D8); cursor-only novelty, no second guard (D5/D9); existing emitters unchanged — `work.completed` (`finalize.ts:321`) + `heartbeat.decision` (`tick.ts:49`) (D7); three disjoint namespaces `evt:att:`/`evt:hb:`/`evt:acc:` with exclusive builder/source ownership; typed-failure no-write behavior (D6); thrown post-CAS rollback (D2).
- [ ] 5.3 Archive readiness: deltas match implementation; rollback plan coherent (revert builder + widening + atomic flow + materiality + composition + e2e + three deltas together); `verify-report.md` prerequisites met.

## Implementation Order

Phase 1 (pure builder, no deps) → Phase 2 (widening depends on builder + declares materiality) → Phase 3 (atomic seam depends on widened use case) → Phase 4 (composition surface consumes the seam; e2e proves the real path) → Phase 5 (whole-change verification + archive readiness). Each phase is one work-unit commit; tests ship with the code they verify (strict TDD).
