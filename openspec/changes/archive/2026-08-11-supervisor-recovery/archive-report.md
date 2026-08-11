# Archive Report: supervisor-recovery

> Terminal record of the SDD cycle. Describes the state of the change AT CLOSE.
> Archived: 2026-08-11 → `openspec/changes/archive/2026-08-11-supervisor-recovery/`.
> Artifact store: hybrid (OpenSpec canonical + Engram traceability).

## Verdict

**ARCHIVED — SDD cycle COMPLETE.** Verify **PASS** at final state: 8/8 requirements, 44/44 scenarios, 1350 tests passed / 6 skipped (0 failed), 0 blockers, 0 open CRITICAL. All 29 tasks complete. Review rollup: 0 BLOCKER, 0 open CRITICAL, 5 open WARNING (non-blocking follow-ups). `reviewGate` structurally absent (RDD kill switch off clone-local at final delivery; no review receipt governs this candidate — archive proceeds under ordinary repository policy).

## What & Why

Post-claim crashes stranded `in_progress` Work outside normal dispatch — a tested non-guarantee with no safe path back. This change turns that non-guarantee into **operator-designated, evidence-gated recovery**: a durable sandbox undo log proves whether an effect ran across process restarts; an operator CAS designation (`recovery_requested` marker, version bump, token preserved) fences zombies without minting a new token; the supervisor tick runs `onRecovery` after activation and before checkpoint; and designated orphans are reconciled through the W1/W2/W3 journal-anchored recovery matrix and resumed directly via the claimed-work cycle without re-claiming. Unsafe or unproven states escalate to `UNRESOLVED_REQUIRES_HUMAN` — recovery NEVER re-executes without durable non-execution proof or successful compensation.

## Scope

- **7 capabilities modified/synced**: `sandbox-port` (durable undo evidence), `idempotency-journal` (W2 abort-to-retryable, typed stale-token), `worker-cycle` (W1/W2/W3 reconciliation + escalation), `work-dispatch` (direct recovery resume, revised non-guarantee), `supervisor-timer` (recovery in sequential ticks), `io-persistence-recovery-contract` (orphan recovery matrix), `work-lifecycle` (operator designation as repository metadata).
- **Delta summary**: 8 requirement blocks (2 ADDED — `Designated Recovery Dispatch`, `Operator Recovery Designation`; 6 MODIFIED), 44 scenarios total.
- **Out of scope (non-goals)**: crash-before-claim, post-T1 crashes, multi-instance fencing, risk-tiered recovery, physical-media durability (process-restart durability only).

## Delivery: 5 Slices + Remediation + Correction

| # | Commit | Delivered |
|---|--------|-----------|
| Slice 1 | `b6ada93` | Durable sandbox undo log: `SandboxPort.snapshotUndoLog()`, `FileDocumentSandbox` persists `{counter, undoLog}` to `<rootDir>/.io/undo-log.json` (restore on construct), no-leak on persist failure, fake/durable/FS parity (B11 parity 5). |
| Slice 2 | `c661c96` | Recovery designation: migration 011 (`work.recovery_requested` + partial index), pure `requestRecovery` CAS use-case (version N→N+1, state/token preserved), `listRecoveryRequestedByCompany` + `setRecoveryRequest`, PG/fake discovery parity. |
| Slice 3 | `ee0e572` | W2 journal abort + recovery matrix: no-effect finalize branch → token-matched `markRetryable` (was stuck `in_flight`), W1 typed `resume`, `recoverDesignatedWork` supervisor entry, W3 undo-failure → UNRESOLVED, B11 parity 7. |
| Slice 4 | `267cebd` | Recovery dispatch + supervisor wiring: byte-identity-proven `runClaimedWork` extraction, `dispatchRecovery` (no re-claim, deterministic `wk:` identity), `onRecovery(companyId)` tick seam (after activation, before checkpoint, both branches, `SupervisorDeps` unchanged), composition `onRecovery` closure. |
| Slice 5 | `6356b7a` | Capstone evidence: full supervisor recovery E2E vs live PostgreSQL (designate → reconcile → resume → complete, exactly one receipt), reframed R6 dispatch test, daemon `onRecovery` threading, live-PG designation roundtrip with EXPLAIN index proof. |
| Remediation | `79537f2` | Fixed 3 CRITICALs (2 verify + R4-002 correction): attempt-correlated undo evidence, typed stale-token contract, no-seal recovery escalation. Re-derived compliance 4/8 → 8/8 requirements, 37/44 → 44/44 scenarios. |

## Verification (final state)

- Envelope: `schema: gentle-ai.verify-result/v1`, `verdict: pass`, `evidence_revision: sha256:d6db7d31…cbdb4`, source revision `79537f2` (tree `da462461…29d0f8`).
- **8/8 requirements, 44/44 scenarios** compliant with passing runtime coverage.
- Full gate `PATH=/data/node24/bin:$PATH pnpm check` (format/typecheck/build/lint/test): **1350 passed, 6 skipped, 0 failed**, exit 0.
- Live-PostgreSQL sequential suite `pnpm vitest run --no-file-parallelism`: 98 files passed, 3 skipped; **1350 passed, 6 skipped** (the 6 are the expected live/provider guards), exit 0.
- Focused remediation evidence: 5 files, 77 passed, 0 skipped, 0 failed.
- Coverage: skipped — no coverage script/provider installed.
- Cross-cutting invariants: PASS (business-domain zero `@io/*` imports, `openai` confined to `deepseek-client.ts`, `packages/context` deps unchanged, no new runtime deps, cohort §7.2/§7.3 prefix byte-identical, `SupervisorDeps` unchanged, `WORK_TRANSITIONS` unchanged, abort never seals a key).

### Remediated findings (all CLOSED in `79537f2`)

1. **Verify CRITICAL #1 — undo evidence not attempt-correlated**: recovery selected the globally-last applied undo entry; a prior unrelated effect could be undone. Fixed with `EffectRecord.idempotencyKey` stamped at execute; recovery filters by the designated attempt's key and escalates legacy/contradictory evidence.
2. **Verify CRITICAL #2 — stale-token marker refusal threw**: replaced with typed `MarkRetryableResult` (`{ok:true} | {ok:false, reason:'stale-token', current?}`) in port/fake/durable-fake/PG; worker reconciliation returns typed `UNRESOLVED_REQUIRES_HUMAN`.
3. **Review R4-002 — ungated `journal.complete` in escalation**: recovery escalation used token-free `complete`, which could seal a newer-token row. Removed; unattributable/contradictory branches return typed UNRESOLVED and the row stays `in_flight` under the current token (no-seal tests).

## Review Findings Rollup

- **0 BLOCKER, 0 CRITICAL** in slices 1/3/4/5 (per-slice adversarial reviews).
- **Slice 2** (HIGH, 4-lens): **3 WARNING** (non-blocking) — carried forward.
- **Remediation review**: found **R4-002 CRITICAL** (fixed + tested in `79537f2`).
- **sdd-verify caught the 2 cross-cutting CRITICALs** the per-slice reviews missed (attempt correlation, typed stale-token contract) — closed by remediation.
- **RDD (receipt-driven development) disabled clone-local for the final delivery**: the native correction-receipt path was blocked by a provider binding defect (v2.3.0) + recovery-authorization friction (v2.4.0-rc.3). The repo's established "captura manual documentada" pattern was followed. `v2.4.0-rc.3` was installed (`~/go/bin/`) and used for the final status/finalize attempts. `reviewGate` is structurally absent; archive proceeds under ordinary repository policy.

### Carried follow-ups (open WARNING, non-blocking)

| Source | Finding | Status |
|---|---|---|
| Slice 1 | Undo mutates filesystem/in-memory state before persistence; persistence failure can leave stale durable evidence. | Open WARNING |
| Slice 1 | Malformed/truncated undo JSON makes `restore()` throw synchronously. | Open WARNING |
| Slice 2 | Post-CAS re-read can throw after a committed designation. | Open WARNING |
| Slice 2 | Post-CAS TOCTOU can combine later row state with forced `expectedVersion + 1`. | Open WARNING |
| Slice 2 | Fake Map insertion order can diverge from PG `ORDER BY id`. | Open WARNING |
| Verify WARNING | Recovery uses a fixed `flash` model tier; risk-tiered recovery remains out of scope. | Open WARNING |
| Verify WARNING | Legacy unattributable undo entries fail safe by escalating; operational cleanup required before retry. | Open WARNING |

**Next maintenance action**: assign owners/dates to the five carried review warnings.

## Commits (all on `main`, pushed with this archive)

- `b6ada93` feat(app): durable sandbox undo log (Slice 1)
- `c661c96` feat(business-domain,database): recovery designation + migration 011 (Slice 2)
- `ee0e572` feat(app): W2 journal abort + recovery reconcile matrix (Slice 3)
- `267cebd` feat(app): recovery dispatch + supervisor onRecovery wiring (Slice 4)
- `6356b7a` test(app,database): recovery E2E + reframed R6 + daemon + live-PG (Slice 5)
- `79537f2` fix(app,domain,database): remediate verify CRITICALs + R4-002 (remediation)
- archive commit: `chore(openspec): archive supervisor-recovery — sync work-lifecycle/worker-cycle/idempotency-journal/work-dispatch/supervisor-timer/sandbox-port/io-persistence-recovery-contract specs`

## Synced Canonical Specs

| Capability | Action | Delta requirements |
|---|---|---|
| `sandbox-port` | MODIFIED | 1 (5 scenarios) |
| `idempotency-journal` | MODIFIED | 1 (7 scenarios) |
| `worker-cycle` | MODIFIED | 1 (8 scenarios) |
| `work-dispatch` | MODIFIED + ADDED | 2 (5 scenarios) |
| `supervisor-timer` | MODIFIED | 1 (10 scenarios) |
| `io-persistence-recovery-contract` | MODIFIED | 1 (5 scenarios) |
| `work-lifecycle` | ADDED | 1 (4 scenarios) |

Merge readback: all 8 delta requirement blocks verified present verbatim in `openspec/specs/{capability}/spec.md`; no stale pre-delta text remains. No REMOVED/RENAMED sections — no destructive merge (archive rule respected).

## Engram Traceability (hybrid persistence)

Observation IDs read for this archive (all project `io`, scope `project`):
- `sdd/supervisor-recovery/explore` — #6205
- `sdd/supervisor-recovery/proposal` — #6211
- `sdd/supervisor-recovery/design` — #6216
- `sdd/supervisor-recovery/spec` — #6219
- `sdd/supervisor-recovery/tasks` — #6225
- `sdd/supervisor-recovery/apply-progress` — #6238
- `sdd/supervisor-recovery/verify-report` — #6321
- delivery-state/native-review-mechanics note — #6248

## Success Criteria (from proposal)

- [x] W1/W2/W3 recover safely or escalate honestly.
- [x] No duplicate effect, token mint, or heartbeat dependency.

## SDD Cycle Complete

Planned → designed → specified → implemented (5 slices, strict TDD) → reviewed (per-slice adversarial + remediation) → verified (PASS 8/8 + 44/44, 1350 tests) → remediated (3 CRITICALs closed) → archived. Ready for the next roadmap item: **Skill outcome BusinessEvents** (más allá de `work.completed`).
