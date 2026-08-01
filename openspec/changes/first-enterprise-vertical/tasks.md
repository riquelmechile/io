# Tasks: First Enterprise Vertical

Assemble the first enterprise vertical on the archived harden foundation. Strict TDD: every behavior task is RED (failing test) → GREEN (minimal impl). Tests/docs ship WITH their code. Build order A→B→C; each slice is one chained PR, each `size:exception`. Scenario IDs: **IJ**=idempotency-journal, **SP**=sandbox-port, **WC**=worker-cycle.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | A ~450–550 · B ~500–600 · C ~550–700 · **total ~1500–1850** |
| 400-line budget risk | **High** (IO lands 2–3× naive; harden landed 793/1155/1500) |
| Chained PRs recommended | **Yes** |
| Suggested split | PR1 Slice A → PR2 Slice B → PR3 Slice C (each `size:exception`) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (cached: proposal "auto-chain stacked" + harden A→B→C precedent) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

auto-chain proceeds with Slice A using stacked-to-main; no fresh split decision required (chain strategy already cached).

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|----|----------------------|-----------------|-------------------|
| A | Journal marker + sandbox + app shell | PR1 | `PATH=/data/node24/bin pnpm vitest run packages/business-domain packages/app packages/database/test/idempotency-adapter.test.ts packages/database/test/sql-migrations.test.ts` | N/A — pure ports/fakes + fs-tmp sandbox; durability via JSON durable fake, live PG deferred to C | Revert journal port/fake/adapter + migration 005; delete `packages/app` src/test; existing completed/in_flight rows stay valid |
| B | Worker core over fakes + lifecycle + parity | PR2 | `PATH=/data/node24/bin pnpm vitest run packages/app` | N/A — InMemory + durable JSON fakes, no external service; live-PG E2E deferred to C | Delete `packages/app/src/worker` + worker tests; Slice A journal marker + sandbox stay intact |
| C | E2E vs live PostgreSQL 18.4 | PR3 | `PATH=/data/node24/bin pnpm vitest run packages/app/test/e2e` | Live PG 18.4: `docker run -d --name io_pg -e POSTGRES_USER=io -e POSTGRES_PASSWORD=io_dev -e POSTGRES_DB=io_dev -p 5432:5432 postgres:18.4`; `postgresql://io:io_dev@localhost:5432/io_dev`; full claim→…→terminal | Delete `packages/app/test/e2e` + CI guard delta; production worker (B) + foundation (A) untouched |

## Acceptance Notes (mandatory — from design re-validation)

1. **Reopen is a conditional UPDATE, never a fresh INSERT** — `insertInFlight` on an existing `aborted_retryable` row MUST `UPDATE … WHERE status='aborted_retryable' AND company_id=$ AND idempotency_key=$ AND request_hash=$` (keep `attempt_id`); a fresh INSERT would violate `UNIQUE(company_id, idempotency_key)`.
2. **Migration 005 rollback DROPS the CHECK** (or clears `aborted_retryable` rows first) — MUST NOT restore a two-value CHECK (fails on existing markers).
3. **Durable journal fake pinned**: unit restart tests use a JSON-durable `DurableJournalFake` (à la `DurableSandboxFake`); live-PG durability is proven in Slice C.
4. **`ABSOLUTE_PAIRS` is module-private** — reference it only through the exported `checkSod` (`trust-kernel/src/sod.ts`); NO implied export.

## Slice A — Journal marker + sandbox + app shell (PR1, ~450–550)

- [ ] **A1** App shell — *files*: `packages/app/package.json` (`@io/app`; deps `@io/business-domain`,`@io/database`,`@io/trust-kernel`,`@io/llm-client`), `packages/app/tsconfig.json`, root `tsconfig.json` refs, `pnpm-workspace.yaml` honesty comment. *RED/GREEN*: infra — `pnpm install` resolves `@io/app`; `pnpm check` builds. *DoD*: app is a workspace member; comment no longer says "no vertical logic".
- [ ] **A2** Journal status domain + `markRetryable` port — *files*: `business-domain/src/ports/idempotency.ts`. *RED*: `test/idempotency.test.ts` asserts 3-value domain; `markRetryable` in_flight→aborted_retryable clears `resultJson`, rejects missing/completed. *GREEN*: add `'aborted_retryable'`, add port op. *Scen*: IJ marker-distinct. *DoD*: port compiles, domain=3.
- [ ] **A3** Fake mirror + reopen + durable journal fake — *files*: `business-domain/src/ports/fakes.ts`, `test/fakes.test.ts`, `test/idempotency.test.ts`. *RED*: lookup table (none/completed+same→replay/completed+diff→DENY/in_flight never replayed/tenant scope); `markRetryable`; reopen (aborted_retryable+same→UPDATE keep attemptId, +diff→conflict, in_flight|completed→reject); JSON-durable `DurableJournalFake` survives simulated restart. *GREEN*: implement. *Scen*: IJ status-domain(5)+marker-distinct+retryable-no-replay+completed-replay+completed-deny. *DoD*: fake mirrors PG domain+reopen, no UNIQUE brick (notes 1,3).
- [ ] **A4** Migration 005 — *files*: `database/sql/005_journal_retryable_status.sql`, `database/test/sql-migrations.test.ts`. *RED*: 005 adds three-value CHECK idempotently; rollback DROPS CHECK. *GREEN*: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT … CHECK (status IN ('in_flight','completed','aborted_retryable'))`. *Scen*: supports IJ marker-durable. *DoD*: idempotent; rollback drops CHECK (note 2).
- [ ] **A5** PG adapter — *files*: `database/src/idempotency-adapter.ts`, `database/test/idempotency-adapter.test.ts` (over `connection-fake.ts`). *RED*: `markRetryable`=`UPDATE … SET status='aborted_retryable',result_json=NULL WHERE attempt_id=$ AND status='in_flight'` (no-op/throw 0 rows); reopen=conditional UPDATE (never INSERT). *GREEN*: implement. *Scen*: IJ marker+reopen (adapter). *DoD*: adapter mirrors fake; reopen is conditional UPDATE (note 1). Unit over fake; live PG in C.
- [ ] **A6** SandboxPort + types + undo log — *files*: `packages/app/src/sandbox/sandbox-port.ts` (`SandboxAction`,`UndoHandle`,`EffectRecord`,`SandboxPort`), undo-log module. *RED*: `test/sandbox-port.test.ts` — execute returns record+handle; one undo entry per effect; undo log reflects applied state. *GREEN*: implement. *Scen*: SP reversible-port(2)+universal-reversibility(2). *DoD*: undo log = applied SoT.
- [ ] **A7** Reversible fakes (InMemory + Durable) — *files*: `packages/app/src/sandbox/in-memory-sandbox.ts`, `durable-sandbox-fake.ts` (JSON `durabilityPath`). *RED*: in-memory execute/undo round-trip; durable fake undo log + effect state survive restart. *GREEN*: implement. *Scen*: SP fake-executes/undoes + fake-mirrors-durability. *DoD*: `DurableSandboxFake` restart-safe (note 3 model).
- [ ] **A8** FileDocumentSandbox adapter — *files*: `packages/app/src/sandbox/file-document-sandbox.ts`, `test/file-document-sandbox.test.ts`. *RED*: create-document exclusive create (`wx`); undo=`unlink`; `wasApplied` truthful; post-effect failure reverses (no leak). *GREEN*: implement (fs tmp). *Scen*: SP adapter-executes/undoes + no-leak(post-effect). *DoD*: real fs effect reversible.
- [ ] **A9** Composition-root boundary (sandbox modules) — *files*: `packages/app/test/boundary.test.ts`. *RED*: app does NOT re-export business-domain/trust-kernel internals; `openai` only in `deepseek-client.ts`. *GREEN*: keep exports clean. *Scen*: SP composition-root(2). *DoD*: boundary green.

## Slice B — Worker core over fakes (PR2, ~500–600)

- [ ] **B1** Worker scaffold + CAS claim — *files*: `packages/app/src/worker/worker.ts`, `worker/types.ts` (`WorkerPrincipals={proposer,approver,executor,verifier}`), `test/worker-claim.test.ts`. *RED*: exactly one winner among concurrent claimants via `startWork`; loser gets `version-conflict`, no effect, no receipt. *GREEN*: implement claim. *Scen*: WC single-winner(2). *DoD*: loser stops cleanly.
- [ ] **B2** Authority at action time + SoD threading — *files*: `packages/app/src/worker/authority.ts`, `test/worker-authority.test.ts`. *RED*: active grant+distinct principals proceeds; revoked→DENY at action; expired/out-of-window→DENY; verifier==executor→DENY via `checkSod`. *GREEN*: `DelegationRepository.get`+`isWindowActive`+!revoked+`checkSod`+`checkGrant`. *Scen*: WC authority(4). *DoD*: deny-at-action; SoD via exported `checkSod`, no `ABSOLUTE_PAIRS` export (note 4).
- [ ] **B3** Tenant scope — *files*: worker ops, `test/worker-scope.test.ts`. *RED*: empty companyId rejected; wrong-tenant→not-found. *GREEN*: thread `companyId`. *Scen*: WC tenant-scope(2). *DoD*: every op scoped.
- [ ] **B4** Intent-before-effect + validation + evidenceId + LLM prefix — *files*: `packages/app/src/worker/intent.ts`, `packages/app/src/llm/stable-prefix.ts` (`STABLE_SYSTEM_PREFIX`), `test/worker-intent.test.ts`. *RED*: `insertInFlight` committed BEFORE `sandbox.execute`; malformed plan rejected (`parseLlmPlan`); malformed command rejected (`parseCommand`); `evidenceId`=`ev:${companyId}:${idempotencyKey}` stable across retry; `FakeLlmClient` canned `LlmPlanShape` w/ create-document step; stable system prefix + dynamic user tail. *GREEN*: implement. *Scen*: WC intent-before-effect(1)+runtime-validation(2)+evidenceId-stable(1). *DoD*: intent pre-effect; typed rejects; stable evidenceId.
- [ ] **B5** Effect outside terminal tx — *files*: worker cycle wiring, `test/worker-effect.test.ts`. *RED*: `sandbox.execute` NOT within finalize tx; runs after intent commit. *GREEN*: order effect outside tx. *Scen*: WC effect-outside-tx(1). *DoD*: §9.8 boundary held.
- [ ] **B6** Pre-effect journal lookup reconciliation — *files*: `packages/app/src/worker/reconcile.ts`, `test/worker-reconcile.test.ts`. *RED*: decision table (completed+same→REPLAY stop; completed+diff→DENY; aborted_retryable+same→reopen→execute; aborted_retryable+diff→DENY; in_flight→recovery no re-insert; none→insertInFlight→execute). *GREEN*: implement. *Scen*: WC reconciliation pre-effect + IJ retryable/completed lookup parity. *DoD*: matches design table.
- [ ] **B7** `finalizeInFlightWorkAtomically` twin (T1/T2) — *files*: `packages/app/src/worker/finalize.ts`, `test/worker-finalize.test.ts`. *RED*: T1 success get→`updateIfVersion(completed)`→`receipts.save`→`journal.complete`→COMMIT (one receipt); T1 CAS-loss→STOP before `receipts.save`→ROLLBACK (pre-committed in_flight survives); T2(i) in_progress+applied→`sandbox.undo`+T2 `journal.markRetryable` (own commit)→`cas-lost-retryable`; T2(ii) already terminal+applied→no undo/no marker, T2' `journal.complete(UNRESOLVED_REQUIRES_HUMAN)`. *GREEN*: implement twin. *Scen*: WC atomic-close(replay/deny/one-receipt)+CAS-loss-sets-marker+unresolvable-honest. *DoD*: T1/T2 boundary; two CAS-loss sub-cases; marker not failure-complete.
- [ ] **B8** Verify step + post-effect/verify-fail reconciliation — *files*: `packages/app/src/worker/verify.ts`, `test/worker-verify.test.ts`. *RED*: verifier≠executor; verify fail w/ in_progress+applied→undo+`markRetryable`; applied reversed then closed; no effect→clean replay (no undo). *GREEN*: implement. *Scen*: WC reconciliation(applied-reversed/no-effect-replay)+SP no-leak(failed-verification). *DoD*: verify-fail reconciles as CAS-loss (i).
- [ ] **B9** Durable restart recovery — *files*: `packages/app/test/worker-restart.test.ts`. *RED*: crash after `insertInFlight`+effect w/ durable journal row→fresh worker reads in-flight, reconciles to terminal; durable fake mirrors journal durability. *GREEN*: implement recovery. *Scen*: WC durable-restart(2). *DoD*: non-vacuous over `DurableJournalFake` (note 3); live-PG durability in C.
- [ ] **B10** App boundary (assembled wiring) — *files*: `packages/app/test/app-boundary.test.ts`. *RED*: assembled app composes worker+fakes without leaking internals; `openai` confined. *GREEN*: wiring clean. *Scen*: supports SP composition-root (app level). *DoD*: boundary green.
- [ ] **B11** Parity tests (two) — *files*: `packages/app/test/parity.test.ts`. *RED*: (1) app replay/DENY ≡ `completeWork`; (2) CAS-loss→`markRetryable`→retry-wins ≡ foundation rollback-then-retry (`complete-work.ts:103-108`). *GREEN*: assert equivalence. *Scen*: WC reconciliation parity + IJ no-zombie foundation parity. *DoD*: both parity assertions green.

## Slice C — E2E vs live PostgreSQL 18.4 (PR3, ~550–700) — ALL tasks run against live PG

- [ ] **C1** E2E harness — *files*: `packages/app/test/e2e/harness.ts`. *RED/GREEN*: harness boots vs `io_pg`, applies 001–005, wires worker+`FakeLlmClient`+REAL PG adapters+real terminal tx+`FileDocumentSandbox`. *DoD*: connects, migrates, wires real adapters. **LIVE PG.**
- [ ] **C2** E2E happy path — *files*: `packages/app/test/e2e/worker-e2e.integration.test.ts`. *RED*: full cycle vs live PG→work terminal + exactly one receipt persisted. *GREEN*: run. *Scen*: WC E2E-happy(1). *DoD*: one receipt in live PG. **LIVE PG.**
- [ ] **C3** E2E replay/DENY — *RED*: same key+same hash→replay recorded result, no new effect/receipt; same key+diff hash→DENY. *GREEN*: run. *Scen*: WC atomic-close replay/deny (E2E) + IJ completed-replay/completed-deny (E2E). *DoD*: idempotent replay/DENY. **LIVE PG.**
- [ ] **C4** E2E single receipt + atomic close — *RED*: re-attempt same `(work_id, terminal_event_id)`→no second receipt (`UNIQUE`); close all-or-nothing. *GREEN*: run. *Scen*: WC one-receipt(E2E) + IJ single-receipt-across-retry. *DoD*: UNIQUE enforced. **LIVE PG.**
- [ ] **C5** E2E marker durability + restart — *RED*: write `aborted_retryable`→restart (fresh conn)→row survives; retry after marker wins CAS→completes+single receipt. *GREEN*: run. *Scen*: IJ marker-survives-restart + retry-after-marker-succeeds + single-receipt-across-retry. *DoD*: marker durable across restart; controlled retry succeeds. **LIVE PG.**
- [ ] **C6** CI guard alignment — *files*: CI config / integration skip-guard. *RED*: integration tests RUN (not skipped) when PG reachable; skip-guard honest. *GREEN*: align so `PATH=/data/node24/bin pnpm check` runs E2E vs live PG. *DoD*: E2E ran (0 skipped) — skipped integration hides defects. **LIVE PG.**
