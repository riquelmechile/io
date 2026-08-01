# Proposal: BusinessEvent — Deterministic Append-Only Business-Fact Log (Write Side)

## Intent

The worker cycle ends at a *technical* terminal record (receipt + journal). The architecture (§8.2.2/§9.3/§9.8/§13.1/§13.2) mandates a *business-fact* record produced deterministically — never model-judged — that later slices consume (heartbeats, skills, Increment-5 memory, segment 12). None exists today. This slice creates it: the first append-only business-fact stream, written atomically with its producing change (§9.8 outbox pattern).

## Scope

### In Scope
- `BusinessEvent` type + append-only `BusinessEventRepository` port + in-memory fake (`packages/business-domain`).
- `PgBusinessEventRepository` (INSERT-only) + `parseBusinessEventRow` guard + `006_business_events.sql` (`packages/database`).
- Worker T1 appends one `work.completed` event in the SAME transaction as CAS + receipt + journal.complete; wired via `buildWorkerDeps`.
- Scoped read seam (`listByCompany`) for future consumers — none built.
- Unit, live-PG round-trip + boundary, worker integration, and E2E tests.

### Out of Scope
- Heartbeats, skills, learning, Memory OS / episodic ingestion, segment-12 sourcing.
- Domain-use-case parity emission (Option B) — documented follow-up.
- Outbox consumers, projections/replay, crypto receipts, CEO, minions.

## Capabilities

### New Capabilities
- `business-event`: deterministic append-only business-fact log — type, append-only port, PG persistence, atomic emission at worker terminal close, tenant-scoped read.

### Modified Capabilities
- None. `worker-cycle`, `business-receipt`, and `context-compiler` keep current behavior; the log is additive and `compileContext` is untouched (segment 12 stays ABSENT).

## Approach

Approach A (exploration recommendation): emit at the worker terminal close ONLY. Define type/port/fake in `business-domain` (zero `@io/*`); persist via a receipt-mirroring INSERT-only adapter + `006` migration; append `work.completed` inside `finalizeInFlightWorkAtomically`'s existing transaction. `eventId` derives deterministically (`evt:{attemptId}`), mirroring the receipt's single-issuance discipline. `completeWork` stays untouched.

## Constraints / Invariants
- No agentic/business frameworks; no new runtime deps; `openai` confined to `llm-client`.
- `business-domain` keeps ZERO `@io/*` imports; `packages/context` deps stay `@io/business-domain` only.
- Append-only by construction: port exposes `append` + scoped read; adapter INSERT-only; boundary guard forbids UPDATE/DELETE.
- Deterministic, not model-judged; atomic with the change (§9.8, same transaction; CAS loss rolls back); tenant scoped (ADR-0002, carries `companyId`).
- Exactly one event per terminal close; never enters the stable context prefix this slice.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/business-domain` | Modified | `BusinessEvent` type, append-only port, fake, exports, unit tests |
| `packages/database` | New + Modified | `PgBusinessEventRepository`, `parseBusinessEventRow`, `006_business_events.sql`, round-trip + boundary tests |
| `packages/app` | Modified | `events` in `WorkerRepositories`, T1 append in `finalize.ts`, `buildWorkerDeps` wiring, worker/E2E tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Scope drift into consumers | High | Write side only (Approach A); explicit out-of-scope |
| Atomicity slip (orphan event) | Med | Append in `connection.transaction`; CAS-loss rollback test |
| Append-only violation | Med | Port shape + boundary guard + unit tests |
| Duplicate events on replay | Med | Deterministic `eventId` + UNIQUE constraint |
| Budget pressure (~350–450 lines) | Med | Structure-not-output tests; auto-chain supports 2 stacked PRs |

## Rollback Plan

Revert the commit(s). Drop `006_business_events.sql` (new table; no data migration). Remove `events` from `WorkerRepositories`/`buildWorkerDeps`. Additive only — clean undo. No capital, secrets, or constitutional limits touched (doc principle 1).

## Dependencies

- Live PostgreSQL (postgresql://io:io_dev@localhost:5432/io_dev) for round-trip/E2E tests.

## Success Criteria

- [ ] One `business_event` row per terminal close, atomic with the receipt; rolled back on CAS loss.
- [ ] Adapter INSERT-only (boundary guard: no UPDATE/DELETE).
- [ ] `business-domain` has zero `@io/*` imports; no new runtime deps.
- [ ] `pnpm check` green; ~829-test baseline preserved.
