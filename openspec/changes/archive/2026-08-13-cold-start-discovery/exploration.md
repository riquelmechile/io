# Exploration: Cold-Start Discovery

> Phase: EXPLORE — maps current state + decision options. Does NOT decide. Change: `cold-start-discovery` (audit finding #1: new company with accepted Work but zero BusinessEvents is invisible to the supervisor; the Work is never dispatched).
> State verified at commit c33bdde (Rev 8, archive of `supervisor-recovery`); working tree at 31a20a2.

## Verdict on the Audit Finding

**CONFIRMED — the audit chain is accurate end to end.** Every claim below was verified against current source. The gap was also **documented as a known limitation at design time**: the archived `work-dispatch` exploration (2026-08-02) states verbatim — *"companies with no events are not discoverable (`listCompanyIds` lists only companies WITH events)"* — and was never fixed.

## Current State (verified architecture map)

### 1. proposeWork / acceptWork emit NO BusinessEvents — CONFIRMED
- `packages/business-domain/src/use-cases/propose-work.ts:32` — INSERT only: `deps.work.save(work)`; zero `deps.events.*` calls.
- `packages/business-domain/src/use-cases/accept-work.ts:11` — `applyWorkTransition('accepted', cmd, deps.work)`: get → `canTransitionWork` → `updateIfVersion` CAS only (`use-cases/result.ts:111-136`); zero `deps.events.*` calls.
- Consequence: a Work in `proposed`/`accepted` NEVER produces a BusinessEvent, so a brand-new company has an empty event stream.

### 2. Only finalize emits material events — CONFIRMED (with one non-material nuance)
- `packages/app/src/worker/finalize.ts:321` — inside T1: `await events.append(buildWorkCompletedEvent(...))` — the ONLY `work.completed` emitter, committed atomically with the Work CAS + receipt + `journal.complete` (`evt:{attemptId}`, deterministic terminal-close facts only).
- `packages/app/src/supervisor/tick.ts:49` — the ONLY other append point: `appendIfAbsent(buildHeartbeatDecisionEvent(...))` — `heartbeat.decision`, **deliberately non-material** (heartbeat spec: MUST remain undeclared, MUST NOT renew novelty).
- **Material event universe = exactly one emitter: finalize.**

### 3. listCompanyIds queries business_event only — CONFIRMED
- `packages/database/src/business-event-adapter.ts:128-139` — `SELECT DISTINCT company_id AS "companyId" FROM business_event` (read-only, no ORDER BY).
- Production consumer: `packages/app/src/supervisor/supervisor.ts:45` (`tickAll` discovery, sequential per-company ticks). Fake parity at `packages/business-domain/src/ports/fakes.ts:277`.
- **A company with zero events can never be discovered → never ticked → heartbeat never evaluated → no activation → no dispatch.**

### 4. MATERIAL_EVENT_TYPES — CONFIRMED
- `packages/business-domain/src/heartbeat.ts:27` — `['work.completed']` only. `hasMaterialNovelty` is cursor-defined by insertion index (R4), never clock-defined.

### 5. Tests bypass the real path — CONFIRMED
- `packages/app/test/e2e/harness.ts:230-268` (`seedAcceptedWork`) — saves `company` + `delegation` + `work` **directly**; no event, no accept use-case, no discovery.
- **No test in the repo exercises accept → event → listCompanyIds → heartbeat → dispatch.** The closest is `packages/app/test/heartbeat/heartbeat.integration.test.ts:42-78`, which seeds via `seedAcceptedWork`, calls `runWorker` DIRECTLY (bypassing supervisor discovery and the gate as trigger), then evaluates the gate post-hoc and proves the cold-start symptom: `'fresh-co-unknown'` → `no-llm-heartbeat` (line 74-78). Supervisor tests append synthetic `work.completed`/`work.started` events directly.
- **No existing test pumps discovery + the supervisor tick.** `packages/app/test/e2e/recovery-e2e.integration.test.ts` seeds the company + `in_progress` Work DIRECTLY (`harness.work.save`, bypassing propose/accept) and calls `onRecovery(E2E_COMPANY)` with a hardcoded company. It does NOT invoke `listCompanyIds` discovery or `tickAll`/`tickCompany`. It is therefore a live-PG composition precedent, NOT a cold-start discovery/tick precedent — the cold-start e2e must be genuinely new and pump `listCompanyIds` → `tickCompany` → `evaluateHeartbeatGate` → `onActivate`.

### 6. The cold-start deadlock chain (evidence)
1. accept → no event (`accept-work.ts:11`)
2. → company absent from `listCompanyIds` (`business-event-adapter.ts:135`)
3. → supervisor never ticks it (`supervisor.ts:45-48`)
4. → heartbeat never evaluates → no activation (`tick.ts:46` → `evaluateHeartbeatGate`)
5. → `dispatchCompanyActivation` never runs (`dispatch.ts:26-38`) → Work stays `accepted` forever.

## Also Investigated

- **`company` has its own table** — `packages/database/sql/002_create_business_tables.sql:9-15` (`company_id`, `purpose`, `created_at`); `work.company_id` added in `003_harden_columns.sql:12`. A discovery supplement is technically possible (no migration needed) — see Approach B for why it does not fix the problem.
- **`io-persistence-recovery-contract`** — NO discovery-source constraint. R1–R17 records + W1/W2/W3 recovery matrix say nothing about how companies are discovered. No conflict with any option; also no help.
- **`supervisor-timer` spec DOES constrain discovery** — "Periodic Discoverable Lifecycle": "discover each tick's companies through `listCompanyIds()`". Approach A keeps this intact; Approach B requires a spec delta here.
- **`heartbeat` spec pins materiality** — "Declared Material Event Types": `MATERIAL_EVENT_TYPES` MUST remain `['work.completed']`. Any materiality change to add `work.accepted` requires an explicit spec delta.
- **`business-event` spec constrains the emitter universe** — "Read-Only Company Discovery" scenario: "terminal-close facts MUST remain the only worker-emitted events"; "Idempotent Single Emission" (pre-change wording): "The emitter prefixes MUST remain disjoint" (`evt:{attemptId}` worker / `evt:hb:{digest}` supervisor). NOTE: that "disjoint" framing is itself imprecise — `evt:hb:` starts with `evt:`, so the two are NOT string-prefix-disjoint; collision-freedom actually rests on the post-`evt:` segment + exclusive builder + `source`. A new accept emitter needs a third collision-free identity (`evt:acc:{workId}`, `source:'acceptor'`) + spec delta, and the delta corrects the "disjoint" wording to "collision-free by grammar and ownership" rather than asserting string-prefix disjointness.
- **Other emission gaps** — `startWork` (claim) emits nothing; `work.started` appears ONLY in heartbeat/supervisor **tests as a non-material sample** (`heartbeat.test.ts:122,255`; `supervisor.test.ts:135`). This is **by design**, not an oversight: the archived heartbeats exploration codified "the only emitted type is `work.completed`" with undeclared types excluded by the set. Adding `work.started`/claim events would be a taxonomy expansion — explicitly OUT of scope.
- **`acceptWork` has NO production caller today** — exported from `use-cases/index.ts`, used by tests; the emission change lives at the domain use-case seam (deps widening) + composition root.

## Affected Areas

- `packages/business-domain/src/use-cases/accept-work.ts` — add event emission (Approach A).
- `packages/business-domain/src/use-cases/result.ts` — if emission is threaded through `applyWorkTransition` (shared with reject/verify/start/complete).
- `packages/business-domain/src/heartbeat.ts` — `MATERIAL_EVENT_TYPES` (+ `isMaterialEvent` semantics) if `work.accepted` becomes material.
- `packages/database/src/business-event-adapter.ts` — unchanged (port surface `append | appendIfAbsent | listByCompany | listCompanyIds` is pinned by `business-event.test.ts:87`).
- `packages/app/src/composition/*` — bind the events repo to the accept call site so CAS + event share one transaction (finalize T1 precedent).
- `packages/app/test/e2e/harness.ts` + a NEW e2e — the real-path cold-start test (no `seedAcceptedWork` bypass for the cold-start case).
- Specs: `heartbeat`, `business-event`, `work-lifecycle` (accept command emits an event) — delta files.

## Approaches

1. **A — acceptWork emits `work.accepted`; add to MATERIAL_EVENT_TYPES**
   - accept CAS success → append one deterministic `work.accepted` event (`aggregateKind: 'work'`, `aggregateId: workId`), atomic with the CAS (finalize T1 / `completeWorkAtomically` transaction-scoped repos pattern), third disjoint emitter prefix, single-issuance via `uq_business_event_event_id` + the state machine (`proposed→accepted` fires once; a duplicate accept is `invalid-transition`).
   - Discovery: automatic — the new event puts the company in `listCompanyIds`.
   - Activation: `work.accepted` material → first accept ⇒ `activate` ⇒ dispatch drains oldest-first; each completion (`work.completed`, already material) renews novelty and keeps the queue draining one-per-activation; later accepts = new novel events → re-activation picks the next Work.
   - Cursor interaction: `hasMaterialNovelty` resolves by insertion index — an accepted event at/before the cursor is NOT novel, so no re-activation for already-seen events. Batched accepts before one tick = ONE activation (cursor advances to stream tail). Cost model: one activation per drained Work — exactly the §2 intent (one model call per Work); adds only 1 INSERT row per accept.
   - Pros: append-only design stays coherent (single discovery SoT = event log); supervisor-timer spec unchanged; gate/evaluator/cycle byte-identical; cold-start fixed everywhere (every accepted Work becomes dispatchable); the "novelty guard" question is answered by the existing cursor (no new guard code).
   - Cons: every accept is now a potential activation (that IS the desired behavior — each accepted Work SHOULD be processed); materiality spec delta; new emitter class + prefix (business-event spec delta); deps widening on `acceptWork` (test churn: `use-cases.test.ts:156-205`); atomicity seam must land correctly.
   - Effort: **Medium** (domain use-case + composition root + 3 spec deltas + 1 e2e + unit updates).

2. **B — Discovery from company/work table (supplement `listCompanyIds`)**
   - Add a discovery read over `company` (or accepted Work) and union it with the event log.
   - Pros: discovery surface is simple; no new emissions; no migration (both tables exist).
   - Cons: **does NOT fix the cold start** — even when discovered, the tick evaluates `evaluateHeartbeat` over an empty stream ⇒ `no-llm-heartbeat` ⇒ `onActivate` never runs ⇒ dispatch never runs. A company would be ticked forever, cost-free, permanently inactive (and with `tailCursor([]) === undefined`, never even checkpointed). It MUST be paired with activation-on-discovery or materiality change — collapsing back into A/C with strictly more surface (new port method + PG/fake parity + supervisor-timer spec delta + two sources of truth for discovery, breaking the event-universe coherence the supervisor-timer spec pins).
   - Effort: **Medium-High**, and incomplete as designed. **Dominated.**

3. **C — Hybrid: acceptWork emits for discovery + materiality, with a novelty guard**
   - The guard already exists: **the cursor IS the novelty guard** (`hasMaterialNovelty` — an event at/before the cursor is never novel; only stream-following material events activate). No new guard code is required; C reduces to A modulo one documented residual: a typed failure that SETTLES (`invalid-plan`, `denied`, …) consumes an activation without completing → the next accepted Work waits for the next accept/completion event (pre-existing cursor semantics; identical to today's behavior for the completion path; operator-triggerable).
   - Effort: same as A. **Recommendation: A, documented as the C-equivalent.**

## Recommendation

**Approach A.** `acceptWork` emits a deterministic `work.accepted` event, CAS-atomic, material (`MATERIAL_EVENT_TYPES` extended), disjoint prefix, plus:
1. Spec deltas: `heartbeat` (material set + rationale), `business-event` (new emitter class + third prefix + discovery-scenario text), `work-lifecycle` (accept command emits the fact).
2. One real-path e2e: propose → accept → events → `listCompanyIds` discovers → pump tick (`tickAll`/`tickCompany` → `evaluateHeartbeatGate`) → activate → dispatch → runWorker → finalize → `work.completed`, WITHOUT the `seedAcceptedWork` bypass and WITHOUT calling `onActivate`/`onRecovery` directly with a hardcoded company. No existing test is a precedent for this discovery+tick path (recovery-e2e seeds directly and calls `onRecovery` with a hardcoded company).
3. Explicit note in the delta: this closes the work-dispatch 2026-08-02 documented limitation.

## Risks

- **Atomicity seam** (highest): CAS + event append MUST share one PostgreSQL transaction (finalize T1 pattern). A plain pool-bound append after the CAS reintroduces the same gap (crash between CAS and append ⇒ accepted Work without event ⇒ still invisible). The domain use case only takes `{ work }` today — the composition root must bind both repos on the transaction-scoped connection.
- **Event identity**: must be deterministic, retry-stable, and a disjoint third prefix (business-event spec: `evt:` worker, `evt:hb:` supervisor). The accepted-state machine already guarantees single issuance (`proposed→accepted` is a one-shot transition), so `uq_business_event_event_id` is a backstop, not the primary guard.
- **Materiality cost**: each accept can activate one dispatch. Batched accepts coalesce into one activation (cursor advances to tail — no activation storm); each activation = exactly one worker cycle. A settling typed failure parks the next Work until another accept/completion event.
- **Spec churn**: the heartbeat spec's "MUST remain `['work.completed']`" is a verified constraint (heartbeat verify-report pins `heartbeat.ts:25-30`); the delta must update it deliberately. `worker-cycle` gate stays read-only (`no-llm-heartbeat` MUST emit nothing) — unchanged by A.
- **Event ordering**: accept must precede completion for the same Work (it does: accept → dispatch → finalize); per-company reads are `ORDER BY id ASC`.
- **`seedAcceptedWork` remains** for the legacy worker-path tests; the NEW cold-start e2e must not use it.

## Ready for Proposal

**Yes.** The orchestrator should tell the user: the audit finding is confirmed against real code (every link of the chain verified, and the gap was a documented design-time limitation since work-dispatch 2026-08-02). Recommended fix: acceptWork emits a deterministic, CAS-atomic `work.accepted` event made material — the minimal coherent change (one emitter, one material type added, zero supervisor/gate changes, one new e2e proving the real path). In scope: the fix + the real-path test + spec deltas (heartbeat, business-event, work-lifecycle). Explicitly out: Memory OS, learning/promotion, §13.3 SoD, riskClass producer, taxonomy redesign, import-boundary enforcement, DeepSeek CI stub, vitest split.