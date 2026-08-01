# Proposal: First Enterprise Vertical

## Intent

Stand up IO's first minimal, verifiable enterprise conduct on the archived harden foundation: founder proposes low-risk work → classification + grant → independent approval → worker executes one reversible sandbox action → independent verification → Work + evidence persist → a single business receipt registers identity, authority, and terminal result. Per architecture §15, the minimal company MUST run and produce evidence before autonomy grows. Serves a founder/principal needing one evidenced unit of work under delegated authority.

## Scope

### In Scope
- Worker cycle: `claim → authority → intent → effect OUTSIDE tx → reconcile → verify → terminal tx` (§13.1 low-risk form).
- Reversible `SandboxPort` (driven port in `packages/app`) + reversible fake + adapter.
- `packages/app` application layer (gains `package.json` + `src/`).
- E2E: `FakeLlmClient` + REAL PostgreSQL via real adapters + terminal transaction.
- Six lifecycle tests: restart, retry (replay/DENY), unique receipt, revocation, post-effect failure, verifier≠executor.

### Out of Scope
- Memory OS, minions, skills, learning, CEO agent, crypto/signed receipts.
- Context compiler (§7.2 — hard-coded minimal stable prompt prefix), real DeepSeek E2E, heartbeats, outbox/sagas.
- Any change to `business-domain`/`trust-kernel` purity.

## Non-negotiables
- SoD: proposer≠approver, executor≠verifier at EVERY tier, even low risk (`ABSOLUTE_PAIRS`).
- Authority window active at action time; revocation → DENY at action time.
- `companyId` scope on every operation.
- Effect OUTSIDE the terminal transaction (§9.8).
- One receipt per terminal event (`UNIQUE(work_id, terminal_event_id)`); idempotent replay/DENY.
- Effect reversible; post-effect failure → `undo()` + close attempt.
- Unresolvable → honest `UNRESOLVED_REQUIRES_HUMAN`, never fabricated.

## Capabilities

### New
- `worker-cycle`: claim→…→terminal orchestration; journal-anchored reconciliation; lifecycle recovery.
- `sandbox-port`: reversible driven effect boundary (port + fake + adapter + undo log).

### Modified
- None. The vertical CALLS the archived foundation; no existing spec requirement changes.

## Approach

Three chained slices (Approach A), auto-chain stacked, strict TDD, build order A→B→C:

| Slice | Delivers | Forecast | Budget |
|---|---|---|---|
| A | Sandbox + app shell | ~350–450 | `size:exception` |
| B | Worker core over fakes + lifecycle tests | ~450–550 | `size:exception` |
| C | E2E vs live PG + `FakeLlmClient` | ~550–700 | `size:exception` |

Every slice exceeds the 400-line budget (harden: forecast 330–390, landed 793/1,155/1,500); none pretends to fit.

## Affected Areas
- `packages/app/` — New: worker, SandboxPort + fake/adapter, E2E wiring.
- `packages/database/` — Tests only; no prod change.
- `business-domain`/`trust-kernel`/`llm-client` — Read-only; consumed, not modified.
- `openspec/specs/` — New: `worker-cycle`, `sandbox-port`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Scope drift into Paso 3 | High | Out-of-scope list; hard-coded prefix |
| Per-slice budget >400 | High | `size:exception`; never merge slices |
| Post-effect reconciliation | Med | Journal + undo-log; triangulate restart |
| Restart durability | Med | PG-backed journal; fake mirrors it |
| Low-risk SoD | Med | Distinct executor/verifier principals |
| Revocation semantics | Low/Med | Deny-at-action; record policy (ADR-0002) |
| App boundary leaks | Low | Boundary test; `openai` confined |
| Deferred harden follow-ups | Low | Adopt documented behavior |

## Rollback Plan

Additive: delete `packages/app` sources + new specs; existing packages untouched. Human keeps constitutional authority over capital, secrets, critical limits (principle 1).

## Dependencies

Archived harden foundation (`completeWorkAtomically`, CAS, journal, SoD, receipts); live PG 18.4 for Slice C.

## Success Criteria
- [ ] Worker cycle green over fakes AND E2E green vs live PG.
- [ ] All six lifecycle categories covered.
- [ ] Purity intact (business-domain/trust-kernel `@io/*`-free; `openai` confined).
- [ ] Single receipt proven; replay/DENY idempotent.
- [ ] SDD cycle green via `PATH=/data/node24/bin pnpm check`, no gate hacks.
