# Proposal: Fencing Tokens (Zombie-Writer Protection)

## Intent

The idempotency journal is the only unfenced claim-owned write surface: `complete(attemptId)` is an unconditional UPDATE, `markRetryable` guards only `status='in_flight'`, and attemptId is deterministic per (company, key), kept across reopens — a stale holder clobbers the current holder's row. Work, receipts, events are already fenced by the T1 version CAS. Closes Increment-3 debt before recovery Scope B.

## Key Decisions

- Token minted server-side in claim CAS (`fencing_token = fencing_token + 1 … RETURNING`): monotonic, race-free.
- Retry/resume keeps the SAME token (no re-claim); only a fresh claim bumps; replay is token-free.
- Honest T2(ii) stale-holder UNRESOLVED close stays reachable: `complete` gets a status guard; the gate rides `markRetryable`.
- Migration 010 additive, `DEFAULT 0` = pre-fencing epoch.

## Scope

### In Scope
- Migration 010: `work.fencing_token` + `idempotency_journal.fencing_token` (additive, idempotent).
- Claim CAS mints; terminal-close CAS checks; `Work.fencingToken` in types, row-guards, fakes.
- Journal: `insertInFlight` stores token; `markRetryable` token-gated; `complete` status-guarded.
- Worker threads token claim → finalize/reconcile; tests + spec deltas.
- Two stacked, alone-verifiable slices (work-level, then journal), each < 400 lines.

### Out of Scope
- `recoverInFlightWork` supervisor wiring (recovery Scope B).
- §13.3 authority-tier SoD, riskClass producer, skill outcome events, Memory OS.
- `business-event`/`supervisor-timer` deltas, heartbeat-cursor fencing, KV-cache/prefix changes, new runtime deps.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `work-lifecycle`: gains `fencingToken`; claim CAS mints.
- `worker-cycle`: claim mints; terminal close token-checked; reconciliation token-gated, honest T2(ii) close preserved.
- `idempotency-journal`: `insertInFlight` stores, `markRetryable` token-gated, `complete` status-guarded.

## Approach

Exploration Approach 1 (minimal correct slice): mint at claim, check at claim-owned writes; receipts/events keep their in-tx CAS protection. Scope B-ready: recovery re-claim bumps token, old tokens stale.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/database` (`sql/010_fencing_tokens.sql` new; work-adapter, idempotency-adapter, row-guards) | New+Modified | Token columns, mint, close check, journal gates |
| `packages/business-domain/src` (types, ports, use-cases, fakes) | Modified | `fencingToken`, CAS semantics, parity |
| `packages/app/src/worker` (worker, finalize, reconcile) + tests | Modified | Thread token claim → finalize |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token gating breaks honest T2(ii) close | Med | `complete` status-guard only; gate on `markRetryable`; pinned in specs |
| Replay/resume bricked | Med | Pin same-token resume + token-free replay |
| Migration on live tables | Low | Additive `DEFAULT 0` column, idempotent (003 pattern) |
| Token leaks into compiled context bytes | Low | Byte-identity tests; never enters LLM context |

## Rollback Plan

Migration 010 is additive: `DEFAULT 0` columns are inert until code writes them. Rollback = revert slice 2, then 1; columns stay harmless (epoch 0 = legacy semantics), no backfill; `DROP COLUMN` optional.

## Dependencies

None new (PostgreSQL 18.4; no new runtime deps).

## Success Criteria

- [ ] Fresh claim mints N+1; stale-token terminal close rejected.
- [ ] Stale-holder `complete` of a live in_flight row rejected; stale `markRetryable` rejected.
- [ ] Honest T2(ii) UNRESOLVED close still lands.
- [ ] Replay token-free; resume keeps same token.
- [ ] Byte-identity, fake↔PG parity, `pnpm check` green; zero `@io/*` imports in business-domain.
