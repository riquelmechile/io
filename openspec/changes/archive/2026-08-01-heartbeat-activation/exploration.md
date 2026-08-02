# Exploration: heartbeat-activation — acting on the heartbeat decision

## Precise definition of the slice

The roadmap (`docs/PASOS_SIGUIENTES_INCREMENTO_4.md`, Rev 4, "Próximos pasos") names this as the
natural next slice: **ACT on the heartbeat decision** — the §13.2 payoff of the already-built
deterministic pre-gate. The architecture doc says the agents are available 24/7 but never call the
model without a useful signal:

> §13.2: "Los agentes estarán disponibles 24/7, pero no llamarán al modelo sin una señal útil.
> evento o timer → filtro determinístico → ¿existe novedad material? no → heartbeat sin LLM; sí →
> activar Flash" — the timer triggers *when* to evaluate; the filter decides *whether*
> (`openspec/specs/heartbeat/spec.md:7`).

Cost is part of reasoning (§2, item 8): "Cada activación tiene un presupuesto y una utilidad
esperada." The filter already exists and is fully spec'd (8 requirements, 14 scenarios); what does
not exist is any code path that **consumes** its decision. `no-llm-heartbeat` appears only in
`packages/business-domain/src/heartbeat.ts`; `evaluateHeartbeatForCompany`'s doc states it
explicitly: "The worker cycle / `runWorker` / `compileContext` are NOT on this path"
(`packages/app/src/heartbeat/evaluate.ts:18`).

## Current state (verified)

### The worker cycle (`packages/app/src/worker/worker.ts:44-260`)

`runWorker(input, deps)` is the only worker entry. **Grep shows no caller in `src`** — only tests and
the E2E harness invoke it; there is **no supervisor/timer loop anywhere in the codebase**. Cycle
order (doc lines 16-23 + code):

1. `parseCommand` (runtime guard; `workId` is **optional** at the parser, `validation/command.ts:19,44-47`);
   `runWorker` itself enforces `workId` required (`worker.ts:55-57`).
2. Resume-aware claim (B1): `journal.lookup` BEFORE the CAS (`worker.ts:72-120`) — own attempt
   (`in_flight | aborted_retryable`) resumes without re-claiming; fresh key claims via `startWork`
   CAS; in_progress-with-no-journal fails closed; terminal work routes through the journal (replay /
   DENY / UNRESOLVED).
3. Authority at action time (B2, `worker.ts:125-136`) — deterministic, deny keeps work in_progress.
4. Skills fetch + `prepareIntent` (B4) — **the only LLM call** (`intent.ts:70`, `llm.complete`,
   model `deepseek-v4-flash`).
5. `reconcilePreEffect` (B6) — pure table (`reconcile.ts:23-47`); `proceed` **commits
   `insertInFlight`** (durable write, `reconcile.ts:58-66`).
6. Effect OUTSIDE the terminal tx (B5, §9.8).
7. Verify (B8, distinct verifier, undo-log-confirmed).
8. Finalize T1 (B7): CAS + receipt + `journal.complete` + **ONE `work.completed` event**, one real
   transaction. CAS loss → T2(i) undo+markRetryable; T2(ii) UNRESOLVED.

### The heartbeat seam (`packages/app/src/heartbeat/evaluate.ts:20-30`)

`evaluateHeartbeatForCompany({ events }, companyId, cursor?)`: rejects empty `companyId` BEFORE any
read (R7); exactly one tenant-scoped `listByCompany`; zero writes (R6). `WorkerDeps.events` already
exists (`worker/types.ts:95`), pool-bound `PgBusinessEventRepository` at the composition root
(`composition/worker-deps.ts`). Domain filter `evaluateHeartbeat(events, cursor?)` is pure; cursor
semantics = insertion index (absent → -1; found at i; **missing → `events.length` → no-llm**);
`MATERIAL_EVENT_TYPES = ['work.completed']`.

### The two facts that shape everything

1. **`runWorker` is invoked per work unit, never per company/timer.** The "wake" already happened;
   a specific Work exists to process.
2. **The only material event type (`work.completed`) is produced by the worker's own finalize.** A
   fresh company starts with an empty stream.

## The crux: a company-level wake gate vs a per-work cycle

§13.2's filter sits between a wake signal (event/timer) and the model call. The archived design
deliberately kept the cycle off this path. Bridging them forces the question the branch must answer:
**what does `no-llm-heartbeat` MEAN for a cycle that already has an actionable Work?**

### Cursor resolution (must precede any branch)

| Option | Behavior with the worker | Verdict |
|--------|--------------------------|---------|
| (a) always-absent cursor | Fresh company + first work → empty stream → no-llm → **first work never processed (deadlock)**. After the first completion the stream always contains `work.completed` → always activates → meaningless. | REJECT |
| (b) derive cursor from the worker's own state | Nothing durable carries a stream cursor: journal rows hold status/requestHash/resultJson; `evidenceId = ev:companyId:idempotencyKey`; receipts keyed by attemptId. Not derivable without new state. | REJECT |
| (c) in-memory per-instance cursor | After the first completion, a NEW work sees cursor=wc#1, stream=[wc#1] → no-llm → **deadlocks every subsequent work too**; also nondeterministic across instances/restarts. | REJECT as sole semantics |
| (d) simpler activation rule | **The actionable Work IS the activation signal** (§13.1: the agent reads its inbox and selects Flash/Pro when there is something to do). A work-bearing invocation ALWAYS activates; `no-llm-heartbeat` fires only for WORKLESS wake-ups. | **RECOMMENDED** |

**Conclusion:** any branch that skips a work-bearing cycle on `no-llm-heartbeat` deadlocks the very
first work (empty stream → no-llm → never claimed → nothing ever activates). The roadmap's literal
branch ("skip `prepareIntent`/`llm.complete` on no-llm-heartbeat") is therefore **not implementable
inside the per-work cycle as stated**. The no-llm exit is only meaningful for workless invocations,
which today can only come from a supervisor/timer — which does not exist. Cursor persistence is only
needed by that supervisor (to avoid re-activating on the same event across wake-ups) and is cleanly
deferred — matching the archived roadmap's own question ("persistencia del cursor: ¿journal? ¿tabla
nueva? ¿in-memory?").

### What a no-llm heartbeat produces/returns

- **Outcome:** the gate returns the decision with **zero side effects** — no claim, no journal row,
  no receipt, no event, no LLM call. Placement **before the claim** (before `worker.ts:72`) is the
  only invariant-safe spot: nothing mutated ⇒ nothing to recover; resume/replay/deny/recovery paths
  are untouched because they only run on work-bearing cycles, which always activate.
- **Shape:** if the gate lives at the worker boundary and returns the existing `HeartbeatDecision`
  type, **no new `WorkerResult` member is needed**. If it were routed through `runWorker`'s result
  namespace, it would be a distinct `{ ok: true; kind: 'no-llm-heartbeat' }` member (never the
  ok:true work shape, never `replayed`).
- **Hard rule:** a no-llm exit must NEVER emit a `work.completed` event — it is the sole material
  type, so a heartbeat that emitted one would self-activate on the next evaluation (activation loop).
- **Answers to the placement questions:** on the no-llm path the cycle does NOT claim and does NOT
  check authority — it exits before ANY mutation. On the activate path the cycle is byte-identical
  (claim → authority → intent → … → finalize as today).

## Approaches

### Approach 1 — Worker-boundary heartbeat gate (recommended)

Add a worker-adjacent gate that consumes the existing seam at the cycle boundary — e.g.
`runHeartbeatCycle(companyId, deps): Promise<HeartbeatDecision>` in
`packages/app/src/heartbeat/` — enforcing R7 (non-empty `companyId` before any read) and R6 (one
`listByCompany`, zero writes) via the already-present `WorkerDeps.events`. `runWorker` stays
byte-identical: work-bearing cycles always activate (the work is the signal). Tests prove the
decision table at the boundary, zero LLM/claims/writes on no-llm, and the live-PG integration
(post-`runWorker` `work.completed` → activate). The future supervisor maps `activate` → pick work →
`runWorker`.

- Pros: zero invariant risk (no mutation on no-llm); no contract weakening; the seam becomes
  actionable at the worker boundary; ~100-150 authored lines; preserves the archived design posture
  ("cycle NOT on this path" stays true for the no-llm path); R7/R6 intact.
- Cons: the no-llm exit is unreachable in production until the supervisor lands — this slice ships
  plumbing + proofs, not production cost savings (honest, documented limitation); the roadmap's
  literal "branch in worker-cycle" is deferred with reasoning.
- Effort: **Low**.

### Approach 2 — Literal branch inside `runWorker` (workless mode)

Relax the `workId`-required guard (`worker.ts:55-57`) so a workless invocation reaches a gate before
the claim; no-llm → new `{ ok: true; kind: 'no-llm-heartbeat' }` result member; activate → nothing to
process today (returns the decision or an explicit nothing-to-do result). Needs a heartbeat-mode
discriminator so a buggy missing-`workId` command is not silently accepted as a heartbeat.

- Pros: literally delivers "branch in worker-cycle"; single entry.
- Cons: weakens the `invalid-command` contract (requires a `BusinessCommand` extension); new
  `WorkerResult` member; still unreachable in production (no supervisor); strictly more surface for
  the same behavior as Approach 1.
- Effort: **Medium**.

### Approach 3 — Defer entirely until the supervisor

Change nothing: the seam already exists and is already tested (`heartbeat/evaluate.test.ts` +
`heartbeat.integration.test.ts`). The next slice is the supervisor/timer, which then calls the seam
and `runWorker`.

- Pros: zero code; avoids shipping unreachable plumbing; the decision integration is already proven.
- Cons: the roadmap's named slice delivers nothing measurable; "act on the decision" stays unproven
  at the cycle boundary.
- Effort: **None**.

### Related finding (not this slice)

`prepareIntent` (the LLM call) runs BEFORE `reconcilePreEffect`, so **replay / deny / recovery
cycles pay a model call that the journal decision never needed**. A future cost slice could move
reconcile before intent (deterministic decisions first). Flag only — it is a journal question, not a
heartbeat-novelty question.

## Recommendation

**Approach 1**, scoped as: a worker-boundary gate consuming the existing
`evaluateHeartbeatForCompany` seam (`WorkerDeps.events`), returning the typed `HeartbeatDecision`
with R7/R6 enforced, plus tests (decision table at the boundary; zero LLM/claims/writes on no-llm
via `FakeLlmClient.requests.length === 0`, `RecordingEvents.appends.length === 0`; live-PG
integration extension) and a doc note naming the supervisor as the follow-up that makes the no-llm
exit reachable.

### Expected changed files / lines

| File | Action | Est. lines |
|------|--------|-----------|
| `packages/app/src/heartbeat/cycle.ts` | Create — boundary gate over the seam | ~25-35 |
| `packages/app/test/heartbeat/cycle.test.ts` | Create — decision table + zero-mutation proofs | ~60-90 |
| `packages/app/test/heartbeat/heartbeat.integration.test.ts` | Modify — boundary gate returns `activate` after a full `runWorker` cycle | ~15-25 |
| `openspec/specs/worker-cycle/spec.md` | Delta in the spec phase — heartbeat-gate requirement (work-bearing unchanged; gate is the supervisor entry) | later phase |

Total **~100-150 authored lines**, well under the 400-line review budget. No `runWorker`, intent,
compiler, business-domain, database, or migration changes.

## Non-goals (explicit)

- **Timer / scheduler / cadence** — OUT; the supervisor that makes no-llm reachable in production.
- **Cursor persistence** — OUT; only the supervisor needs it (deferral named in the archived
  roadmap).
- **Pro escalation** — OUT; a separate §13.3 risk-tier decision.
- **`work.created` as a material event** — OUT; would be a schema + spec change (and is the
  alternative precondition that would make a work-bearing gate meaningful).
- **Memory OS, learning/promotion, scorecard/episodio** — OUT; scorecard/episodio exist only as doc
  intent (§13.1 tail), zero code.
- **Reconcile-before-intent reorder** — OUT; related cost slice, flagged above.

## Risks

- **Deadlock trap:** the future supervisor MUST treat the actionable work as the signal — never gate
  a work-bearing cycle on no-llm-heartbeat (empty-stream deadlock). Mitigated structurally: the gate
  takes only `companyId`, never a workId.
- **Unreachable in production:** the no-llm exit fires only from workless wake-ups until the
  supervisor lands; the slice delivers plumbing + proofs, not production savings. State this in the
  proposal so the user can choose to defer entirely if no supervisor is planned.
- **Cursor absence:** per-company the gate always activates after the first completion — irrelevant
  for the boundary entry (the supervisor passes the cursor later); persistence deferred.
- **Spec ripple:** worker-cycle spec needs a delta requirement; the heartbeat spec is untouched (the
  seam is already compliant with all 8 requirements).

## Ready for Proposal

**Yes** — Approach 1 is a clean, bounded, invariant-safe slice with explicit deferrals. The proposal
should surface the reachability caveat up front so the user decides: ship the boundary gate now
(plumbing + proof) or defer until the supervisor slice.
