# Archive Report: cold-start-discovery

> Terminal record of the SDD cycle. Describes the state of the change AT CLOSE.
> Archived: 2026-08-13 → `openspec/changes/archive/2026-08-13-cold-start-discovery/`.
> Artifact store: hybrid (OpenSpec canonical + Engram traceability).

## Verdict

**ARCHIVED — SDD cycle COMPLETE.** Verify **PASS** at final state: 5/5 requirements, 24/24 scenarios, 18/18 tasks complete, 0 blockers, 0 CRITICAL findings. Native SDD status: `apply: all_done`, `verify: all_done`, `archive: ready`, `nextRecommended: archive`, `blockedReasons: []`. Native `reviewGate.result: allow` — approved receipts exactly match authoritative native state and the current repository.

## What & Why

Accepted Work was invisible to supervisor discovery: acceptance committed only the Work CAS and emitted no BusinessEvent, so a zero-history company never appeared in `listCompanyIds()` and its accepted Work was never dispatched. This change makes acceptance emit a deterministic `work.accepted` event atomically with the Work CAS, declares it material for heartbeat novelty, and proves the full cold-start chain (propose → accept → discover → activate → dispatch → complete) through the real, unbypassed path.

## Scope

- **3 capabilities modified/synced**: `business-event` (atomic acceptance event emission, read-only discovery, idempotent single emission with disjoint `att:`/`hb:`/`acc:` namespaces), `heartbeat` (material set `['work.accepted', 'work.completed']`, cursor remains the ONLY novelty guard), `work-lifecycle` (atomic acceptance fact with typed-failure no-write semantics).
- **Delta summary**: 5 requirement blocks (2 ADDED — `Atomic Acceptance Event Emission`, `Atomic Acceptance Fact`; 3 MODIFIED — `Read-Only Company Discovery`, `Idempotent Single Emission`, `Declared Material Event Types`), 24 scenarios total (verify-validated).
- **Out of scope (non-goals)**: company/work-table discovery, second reactivation guard, supervisor/gate redesign, backfill of pre-change accepted Work, events for other transitions, taxonomy expansion, memory/learning/risk producers.

## Delivery: 4 Phases + Closeout + Remediation

| # | Commit | Delivered |
|---|--------|-----------|
| Phase 1 | `18cddf0` | Pure `buildWorkAcceptedEvent` builder + identity/namespacing tests (`feat(business-domain): add work accepted event builder`). |
| Phase 2 | `9fada4b` | `acceptWork` widening (append only on `ok:true`), `'work.accepted'` in `MATERIAL_EVENT_TYPES` (`feat(business-domain): emit work accepted event`). |
| Phase 3 | `a5315ea` | `acceptWorkAtomically` transaction-scoped seam, rollback-on-throw, typed-failure no-write proof (`feat(database): add atomic acceptance transaction`). |
| Phase 4 | `2565175` | Composition `acceptWork` seam in supervisor dispatch + real-path cold-start E2E (`feat(app): surface atomic accept in supervisor dispatch and prove cold-start e2e`). |
| Closeout | `f2c39de` | Phase 4 closeout (`docs(openspec): close cold-start discovery phase 4`). |
| Phase 5 | `80c8dfc` | Verification gates + evidence (`test(openspec): record cold-start discovery verification gates`). |
| Remediation | `5cad222` | No-backfill runtime proof — live-PG pre-change accepted Work not backfilled (`test(app): prove historical accepted work is not backfilled`). |
| Final verify | `1f9cdcf` | Final verify-report committed; PASS 5/5, 24/24, 18/18, zero CRITICAL (`test(openspec): verify cold-start discovery`). |

## Verification (final state)

- Envelope: `schema: gentle-ai.verify-result/v1`, `verdict: pass`, `evidence_revision: sha256:b9110152155b807a467374aef60dca7fbda726278d2c585d9fae7dac2519ea56`; test exit 0 (hash `sha256:af1643…428d`), build exit 0 (hash `sha256:24c42b…f7af8`).
- **5/5 requirements, 24/24 scenarios** compliant with passing runtime coverage.
- **18/18 tasks** checked, 0 pending.
- Fresh independent runtime: 1 file, 3/3 passed, 0 skipped, exit 0.
- Phase 5 committed gate `pnpm check`: 100 passed/3 skipped files; 1380 passed/6 skipped tests; exit 0. Phase 5 focused live-PG: 2 files, 62/62 passed, exit 0.
- Coverage: skipped — no coverage tool configured. Nine lint warnings are pre-existing and outside this change.
- Dedicated PG18.4 harness `io-phase4-iso-pg-3cdff5d7` (loopback 127.0.0.1:5434, `io_dev`): verified before start, stopped after the run and preserved; final state `exited`. Shared `io_pg` (5432) and unrelated databases were not targeted.

## Review Authority (native reviewGate: allow)

Native `reviewGate.result: allow` — "approved receipt exactly matches authoritative native state and the current repository". Both discovered review lineages validated:

1. **`review-b22a8cc50ed7283d`** (no-backfill runtime proof; paths `apply-progress.md`, `evidence/remediation-no-backfill-focused.log`, `packages/app/test/e2e/cold-start-e2e.integration.test.ts`; candidate tree `702218f2…` = `5cad222`). Terminal `approved`, evidence `passed`, 0 findings (reliability lens). Pre-commit gate `allow`.
2. **`review-7ce54ea0fcabb233`** (final verify-report; path `verify-report.md`; candidate tree `a24fa707…` = `1f9cdcf` = HEAD). Terminal `approved`, evidence `passed`, 0 findings (reliability lens).

Receipts cross-checked against the git common-dir review store (`/data/io/.git/gentle-ai/review-transactions/v2/`): both published (`receipt_published: true`), `fix_delta_hash` empty (no corrections), candidate trees match committed HEAD. No open findings, no carried CRITICAL, no stale intermediate claims reproduced.

## Synced Canonical Specs

| Capability | Action | Delta requirements |
|---|---|---|
| `business-event` | ADDED + MODIFIED | 3 (`Atomic Acceptance Event Emission` added; `Read-Only Company Discovery`, `Idempotent Single Emission` modified) |
| `heartbeat` | MODIFIED | 1 (`Declared Material Event Types` — material set widened, cursor-only novelty preserved) |
| `work-lifecycle` | ADDED | 1 (`Atomic Acceptance Fact`) |

Merge readback: all 5 delta requirement blocks verified **verbatim** (byte-identical) in `openspec/specs/{capability}/spec.md` via automated block extraction; unrelated requirements preserved; no REMOVED/RENAMED sections — no destructive merge (archive rule respected). Archive folder move verified by recursive `diff -r` snapshot readback: empty diff (byte-identical), output included in the phase result.

## Archive Contents

- `proposal.md` ✅
- `specs/` ✅ (3 domains: business-event, heartbeat, work-lifecycle)
- `design.md` ✅
- `exploration.md` ✅
- `tasks.md` ✅ (18/18 tasks complete; no unchecked implementation tasks)
- `apply-progress.md` ✅
- `verify-report.md` ✅
- `evidence/` ✅ (phase gates, live-PG logs, remediation proof)

## Engram Traceability (hybrid persistence)

Observation IDs read for this archive (all project `io`, scope `project`):
- `sdd/cold-start-discovery/explore` — #6424
- `sdd/cold-start-discovery/proposal` — #6427
- `sdd/cold-start-discovery/design` — #6434 (corrected)
- `sdd/cold-start-discovery/spec` corrections — #6440, #6431
- `sdd/cold-start-discovery/tasks` — #6447
- `sdd/cold-start-discovery/apply-progress` — #6450
- `sdd/cold-start-discovery/verify-report` — #6543
- Native review store (git common-dir, not Engram topics): `review-b22a8cc50ed7283d` and `review-7ce54ea0fcabb233` (receipt + state + finalize journal + final evidence records).

## Success Criteria (from proposal)

- [x] Successful acceptance commits one deterministic event atomically; typed failures commit neither mutation.
- [x] A zero-history company is discovered and its accepted Work reaches completion through the supervisor path.
- [x] Existing cursor, prefix-disjointness, domain-boundary, and no-bypass constraints remain verified.

## SDD Cycle Complete

Planned → explored → specified → designed → implemented (4 phases + closeout, strict TDD, verified commit chain `18cddf0` → `1f9cdcf`) → reviewed (2 approved review lineages under native receipt authority, `reviewGate: allow`) → verified (PASS 5/5 requirements, 24/24 scenarios, 18/18 tasks, zero CRITICAL) → archived. No backfill, no push, no commit made by this archive phase — the parent owns the final commit.
