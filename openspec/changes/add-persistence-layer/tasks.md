# Tasks: Add Persistence Port Boundary (Evidence/Audit)

> Increment 2 PERSISTENCE, slice 1 (auto-chain / stacked-to-main). Strict TDD: every behavior group = RED test → GREEN impl → REFACTOR, committed as ONE GREEN work unit (test + impl together so the repo stays green per commit). Exclusions held: no real PG/adapter, no HTTP/db/daemon/LLM/framework, no crypto or durable overclaim, no canonical extraction. `package.json` and all toolchain globs stay UNCHANGED — generic types + `import type` ⇒ zero runtime deps (D3/D4); globs are already recursive over `src/**/*.ts`, so `src/ports/` is covered with no wiring edit.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~410–440 authored (add+del): 1 type block in `model.ts` + 2 new `ports/` files + `pipeline.ts`/`index.ts` edits + `boundary.test.ts` edits + 1 new `test/ports.test.ts` (~190) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | 2 stacked-to-main slices (ports+record+fakes+boundary → wiring+verify) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Port interfaces + `PersistentRecord` + fakes + universal boundary proof (Ph 1–4). NO pipeline change ⇒ behavior byte-identical; all prior tests stay green | PR 1 → main | `pnpm test packages/trust-kernel/test/{boundary,ports}.test.ts` | N/A — pure in-memory, no transport/daemon/app to exercise | Revert `src/ports/`, drop `PersistentRecord`+aliases from `model.ts`, revert `boundary.test.ts` ports/ assertions |
| 2 | Optional repo routing + `PersistenceOutcome` consumer contract + honesty + exclusion guard (Ph 5–6) | PR 2 → main | `pnpm test packages/trust-kernel/test/ports.test.ts` then `pnpm check` | N/A — pure in-memory | Revert `pipeline.ts` optional repo fields + `finalize()` routing + `result.persistence`; revert `index.ts` exports |

## Phase 1: PersistentRecord & Honesty Discriminant — Req 3 (Threat: type confusion)

- [x] 1.1 RED `test/ports.test.ts`: a routed record carries `persistent: true` literal + disclosure; `InMemoryRecord` (`persistent:false`) and `PersistentRecord` (`persistent:true`) coexist, discriminated by the literal; tsc rejects cross-assignment (compile-time type guard).
- [x] 1.2 GREEN: add `PersistentRecord` + `PersistentEvidence`/`PersistentAuditEntry` aliases to `src/model.ts` (D8).
- [x] 1.3 REFACTOR: mirror `InMemoryRecord` field order; `pnpm check`.

## Phase 2: Repository Port Interfaces — Req 1, 2, 6 (Threat: driver leakage)

- [x] 2.1 RED `test/ports.test.ts`: `EvidenceRepository.save→get` round-trips AND the port accepts a generic session/transaction context (spec R7 prose; default `unknown`); `AuditRepository.append` preserves insertion order and returns a NEW state (prior log reference unmutated); the ports module imports only generic kernel types (no `pg`/ORM/framework).
- [x] 2.2 GREEN: create `src/ports/repositories.ts` — `EvidenceRepository<R, S = unknown>` (`save(record, session?)` + `get(actionId)`), `AuditRepository<R>` (`append` + `getLog`), `PersistenceOutcome`, `PERSISTENT_PORT_DISCLOSURE`; `import type` only (D3/D4).
- [x] 2.3 REFACTOR: generic record default = `PersistentRecord`; `pnpm check`.

## Phase 3: In-Memory Fake Adapters — Req 4 (Threat: honesty overclaim)

- [x] 3.1 RED `test/ports.test.ts`: `InMemoryEvidenceRepository`/`InMemoryAuditRepository` satisfy their ports and store→read round-trips; fakes import only in-memory structures (no driver/net/daemon/framework); the fake-supplied disclosure is honest and NON-durable (MUST NOT claim "durable in PostgreSQL") (D6).
- [x] 3.2 GREEN: create `src/ports/fakes.ts` — Map/array backed, immutable returns, honest `PERSISTENT_PORT_DISCLOSURE`.
- [x] 3.3 REFACTOR: share immutable append/return helpers; `pnpm check`.

## Phase 4: Boundary Detector — Universal Scan of ports/ — Req 6, trust-kernel delta (Threat: leakage)

- [x] 4.1 RED `test/boundary.test.ts`: `ports/*.ts` ARE discovered by the recursive src scan (UNIVERSAL — `ports/` is NOT exempted, D7); every `ports/` file imports nothing forbidden; `package.json` still declares zero runtime deps; the existing offender-catch + every-src-file-clean assertions stay green.
- [x] 4.2 GREEN: assert `ports/` files are present in the discovered list and clean ON MERIT (no production change — the recursive scan already covers `ports/`).
- [x] 4.3 REFACTOR: centralize the ports-present assertion; `pnpm check`.

## Phase 5: Pipeline Wiring — Optional Repo Routing — Req 5, trust-kernel delta (Threat: backward-compat break)

- [ ] 5.1 RED `test/ports.test.ts`: no-repo `evaluate()` is byte-identical to today (decision/evidence/audit/receipt/steps unchanged; `result.evidence`/`auditLog` carry `InMemoryRecord` `persistent:false`; no `persistence` field); with repos present, `finalize()` routes — `result.evidence`/`auditLog` STILL carry the captured `InMemoryRecord`, AND `result.persistence.evidenceRecord`/`auditRecord` carry the routed `PersistentRecord` (`persistent:true`) (consumer contract D5); evidence is saved via the evidence port and audit appended via the audit port; routing never mutates the prior audit log.
- [ ] 5.2 GREEN: add optional `evidenceRepository?`/`auditRepository?` to `EvaluationInput`; in `finalize()` build a `PersistentRecord` + route through the ports when present, setting `result.persistence`; add optional `persistence?: PersistenceOutcome` to `EvaluationResult`; export ports + fakes + `PersistentRecord` from `index.ts`.
- [ ] 5.3 REFACTOR: extract a `buildPersistentRecord` helper; `pnpm check`.

## Phase 6: Final Verification & Exclusion Guard — Req 6 (Threat: leakage/overclaim/deferred)

- [ ] 6.1 Full `pnpm check` GREEN (format-check → typecheck → build → lint → test); every prior test stays green (no-repo byte-identity intact).
- [ ] 6.2 Exclusion guard: no forbidden import (fs/net/http/db/daemon/LLM/framework) anywhere in src incl. `ports/`; no real PG driver; no crypto or durable overclaim; no canonical extraction performed this slice; `ports/` is a forward extraction signal ONLY and the kernel stays excluded from the 8+12+10=30 canonical partition.
- [ ] 6.3 Confirm deferred items remain deferred: real PG storage, canonical extraction into `organization/policy/approvals/evidence/receipts/audit`, the other aggregate ports (R1–R6, R8–R15, R17), cryptographic receipts, and real approval chains.
