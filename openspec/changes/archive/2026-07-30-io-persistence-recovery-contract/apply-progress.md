# Apply Progress: IO Persistence Recovery Contract

> Documentation-only contract change. No runtime code, no RED tests (threat matrix
> N/A per `design.md`). Evidence is structural/traceability review against
> `exploration.md` and ADR-0001/0002/0003, not runtime execution.

- **Change**: `io-persistence-recovery-contract`
- **Artifact store mode**: `openspec` (filesystem tasks.md `[x]` marks) + Engram
  apply-progress observation (per orchestrator directive for this launch)
- **Mode**: Standard (Strict TDD N/A — documentation-only, no code under test;
  `tasks.md` and `design.md` explicitly state no RED tests, threat matrix N/A)
- **Delivery strategy**: auto-chain · **Chain strategy**: stacked-to-main
- **Work unit this batch**: WU4 — Archive Readiness (prepared in apply; executed
  at `sdd-archive`). WU1, WU2, and WU3 preserved below.

## Cumulative Task Status

| Task | Status | Work Unit |
|------|--------|-----------|
| 1.1  | [x] done | WU1 |
| 1.2  | [x] done | WU1 |
| 1.3  | [x] done | WU1 |
| 1.4  | [x] done | WU1 |
| 1.5  | [x] done | WU1 |
| 1.6  | [x] done | WU1 |
| 1.7  | [x] done | WU1 |
| 1.8  | [x] done | WU1 |
| 1.9  | [x] done | WU1 |
| 1.10 | [x] done | WU1 |
| 1.11 | [x] done | WU1 |
| 2.1  | [x] done | WU2 |
| 2.2  | [x] done | WU2 |
| 3.1  | [x] done | WU3 |
| 3.2  | [x] done | WU3 |
| 3.3 | [x] done | WU3 |
| 4.1 | [x] done | WU4 |
| 4.2 | [x] done | WU4 |
| 4.3 | [x] done | WU4 |

**Totals**: 19/19 tasks complete. Phases 1–4 fully complete (tasks.md lists
exactly 19 implementation/validation tasks: 1.1–1.11, 2.1–2.2, 3.1–3.3, 4.1–4.3).
All apply-owned work is done; the `proposal.md` Success-Criteria checkboxes are
separate from tasks.md and are owned by verify/archive, not apply.

## Phase 1 Validation Evidence (WU1)

Each task validated against the new-capability spec
(`specs/io-persistence-recovery-contract/spec.md`), `exploration.md`, and the
accepted ADRs. No downstream mechanism (DDL, ORM, retry constants, receipt
signing, crypto-erasure) leaked into the normative contract — all explicitly
deferred (exploration §13; spec Purpose, Required Records, Receipt Integrity).

| Task | Verdict | Evidence |
|------|---------|----------|
| 1.1 10 reqs + scenarios | PASS | Spec defines exactly 10 requirements, each with ≥1 Given/When/Then scenario: Authoritative State Ownership; Single-Aggregate Transaction Boundary; Required Records Carriage; Append-Only Integrity & Privacy Deletion; Atomic Idempotency; At-Least-Once Outbox/Inbox Safety; Lease Fencing; External-Effect Unknown-Outcome Recovery; Receipt Integrity; Recovery Matrix. |
| 1.2 PG sole authority | PASS | Req 1: "PostgreSQL MUST be the sole business-authoritative state source; memory, LLM context, filesystem, and daemon MUST NOT hold business-authoritative data." Scenario "PG down rejects mutations". ↔ exploration §1 [SRC] S6.3, §10. |
| 1.3 Transaction boundary | PASS | Req 2: one aggregate + embedded immutable snapshot + audit (R16) + idempotency terminal + outbox, committed atomically. ↔ exploration §2. |
| 1.4 R1–R17 + dual-ref | PASS | Req 3 full R1–R17 table; R10 links Work↔Delegation, R15 binds Work ID + Delegation/policy-authority ID. Scenario "All records recoverable". ↔ exploration §3 R10/R15 [ADR-0002]; ADR-0002 confirms separate Delegation/Work identities and receipt identifies both. |
| 1.5 Append-only/privacy | PASS | Req 4: DB roles/permissions/constraints/triggers (NOT app booleans); mandated delete = true hard delete; tombstone ONLY if legally permitted; redaction/crypto-erasure = alternatives not substitutes. ↔ exploration §4.1/§4.2. |
| 1.6 Idempotency | PASS | Req 5: scoped/serialized/atomic; rollback leaves no completed marker & no orphan pending; key reuse with different hash DENIED; separate durable attempt record for pre-external-call. ↔ exploration §5.1/§5.3/§5.4. |
| 1.7 Outbox/inbox | PASS | Req 6: outbox same-tx; never mark processed before durable effect; at-least-once only (no exactly-once); dead-letter after max retries with human recovery + audit. ↔ exploration §6.1–§6.3. |
| 1.8 Fencing | PASS | Req 7: monotonic token scoped to resource/aggregate/lease; stale token rejected; heartbeat/expiry alone insufficient; expired holder cannot commit; lease expiry does NOT auto-retry external effects. ↔ exploration §7.1/§7.2. |
| 1.9 UNKNOWN recovery | PASS | Req 8: timeout = UNKNOWN, reconcile before retry; impossible reconciliation → terminal `UNRESOLVED_REQUIRES_HUMAN` with immutable disposition; non-compensable escalates immediately. ↔ exploration §8.3/§8.4/§9.3. |
| 1.10 Receipt integrity | PASS | Req 9: hash = local integrity only, MUST NOT claim non-repudiation; signing/key custody/transparency-log anchoring deferred & MUST NOT be claimed satisfied. ↔ exploration §11.2/§11.3. |
| 1.11 Recovery matrix | PASS | Req 10 matrix = exactly 7 failure rows (PG down mid-tx; worker crash after external call; worker crash before external call; daemon disconnect; lease expiry mid-workflow; outbox max retries; non-compensable unknown), each with Safe action + Terminal condition + Human path. Scenario "Idempotency orphan ruled out" by atomic-commit invariant. ↔ exploration §12 (exploration has 8 rows incl. orphan N/A; spec folds orphan into a scenario, leaving 7 matrix rows — content-equivalent). |

## Work Unit Evidence (WU1)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | No command applies — WU1 is documentation-only contract validation. Substituted evidence: structural/traceability review above (11/11 PASS). Rationale: no runtime code exists; `design.md` Testing Strategy + Threat Matrix state "No unit, integration, E2E, or RED tests are added … this change has no runtime implementation" and "N/A". |
| Runtime harness command/scenario and exact result | N/A — documentation-only, no runtime behavior. |
| Rollback boundary | Files for WU1 only: `proposal.md`, `design.md`, `specs/io-persistence-recovery-contract/spec.md`, `exploration.md`, plus this `apply-progress.md` and `tasks.md` checkbox marks. Reverting these leaves the prior `io-ports-trust-contract` authoritative. No WU2/WU3/WU4 artifacts touched. |

## Phase 2 Validation Evidence (WU2)

Each task validated against the ports/trust delta
(`specs/io-ports-trust-contract/spec.md`), the new-capability spec, the design
"Delta review" row (Handoff ownership: references the new capability without
redefining its semantics), and `proposal.md` Success Criteria ("Existing
ports/trust spec links to the new contract without duplicating implementation
detail"). The delta carries semantics by reference into
`io-persistence-recovery-contract` and redefines none of the 10 normative
requirements (those live only in the new-capability spec).

| Task | Verdict | Evidence |
|------|---------|----------|
| 2.1 MODIFIED carries semantics | PASS | Delta opens with `## MODIFIED Requirements` (OpenSpec MODIFIED marker). Requirement "Required Persistence and Recovery Records" explicitly states the full semantic set — "ownership, transaction boundary, append-only integrity, privacy deletion, idempotency, outbox/inbox, lease fencing, external-call UNKNOWN recovery, daemon outcomes, receipts, and the failure recovery matrix — are carried into and defined by the `io-persistence-recovery-contract` capability." Change-note "(Previously … now their persistence/recovery semantics are explicitly carried into …)." confirms intentional MODIFIED. ↔ design Delta-review row; proposal Modified Capabilities. |
| 2.2 No duplication / R1–R17 intact / handoff resolved / unchanged preserved | PASS | (a) **No duplication**: delta names `io-persistence-recovery-contract` twice and asserts "MUST NOT duplicate those semantics; it references them by capability." It redefines NONE of the 10 normative requirements (Authoritative State Ownership, Single-Aggregate Transaction Boundary, Required Records Carriage, Append-Only/Privacy, Atomic Idempotency, Outbox/Inbox, Lease Fencing, UNKNOWN Recovery, Receipt Integrity, Recovery Matrix) — those exist only in the new-capability spec; record field detail stays authoritative here per new spec Purpose. (b) **R1–R17 intact**: table lists all 17 rows R1→R17 with R9 `[ADR-0001]`, R10/R15 `[ADR-0002]` dual-reference labels preserved. (c) **Handoff resolved intentionally**: scenario "Persistence and recovery handoff resolved" THEN clause sources semantics from the new capability and forbids redefinition/duplication here. (d) **Unchanged preserved**: scenario "Records present for every required area" keeps the unchanged R1–R17 presence + Work/authority dual-reference identifiable in R10/R15. |

## Work Unit Evidence (WU2)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | No command applies — WU2 is documentation-only ports/trust delta validation. Substituted evidence: structural/traceability review above (2/2 PASS). Rationale: no runtime code exists; `design.md` Testing Strategy + Threat Matrix state "No unit, integration, E2E, or RED tests are added … this change has no runtime implementation" and "N/A". |
| Runtime harness command/scenario and exact result | N/A — documentation-only, no runtime behavior. |
| Rollback boundary | Files for WU2 only: `specs/io-ports-trust-contract/spec.md` (the delta under this change folder), plus this `apply-progress.md` and `tasks.md` checkbox marks. Canonical `openspec/specs/io-ports-trust-contract/spec.md` is NOT touched until archive (Phase 4), so reverting the delta leaves the prior ports/trust contract authoritative. No WU1/WU3/WU4 artifacts touched. |

## Phase 3 Validation Evidence (WU3)

Each task validated against the new-capability spec
(`specs/io-persistence-recovery-contract/spec.md`), `exploration.md` (esp.
§3 records table and §14 Provenance and Claim Labels), the ports/trust delta,
`design.md` (Testing Strategy + Threat Matrix), and the accepted ADRs
(`docs/adr/0001/0002/0003`). Label authority lives in exploration §14; the
new-capability spec expresses those claims as normative prose without inline
labels, so traceability runs FROM each requirement/scenario TO the labeled
exploration section + governing ADR. No runtime code exists, so evidence is
structural traceability and contradiction/threat review, not execution.

### Task 3.1 — Requirement/Scenario → exploration + ADR traceability (PASS)

All 10 requirements and 10 scenarios traced; each appears in exactly one row
(no double-counting). All four label types are exercised and each cited once:
`[SRC]` (foundational-doc sources S6.3 / S9.8 / S12.1 / S3.11), `[INF]`
(domain/transactional inferences, every requirement), `[ADR]` (ADR-0001/0002/0003
on the records they govern), `[HYP]` (signing/key-custody deferral §11.3, and
the delta's `[HYP]` inline marker). `[PORTS]` labels the full R1–R17 carry
(§3) and R15 (§11.1).

| Req | Requirement (new-cap spec) | Exploration § | ADR | Labels (§14 authority) |
|-----|----------------------------|---------------|-----|------------------------|
| 1 | Authoritative State Ownership & Degradation | §1, §1.1, §1.3, §10 | ADR-0001 (neutral cross-context IDs) | [SRC] S6.3; [INF] |
| 2 | Single-Aggregate Transaction Boundary | §2 (items 1–5) | — | [INF] |
| 3 | Required Records Carriage (R1–R17) | §3, §1.2 | R6/R9 [ADR-0001]; R10/R15 [ADR-0002]; R1/R3/R4/R5 [ADR-0003] | [PORTS]; [ADR]; [INF] |
| 4 | Append-Only Integrity & Privacy Deletion | §4.1, §4.2 | — | [SRC] S9.8; [INF] |
| 5 | Atomic Idempotency | §5.1, §5.3, §5.4 | — | [SRC] S9.8; [INF] |
| 6 | At-Least-Once Outbox & Inbox Safety | §6.1, §6.2, §6.3 | — | [INF] |
| 7 | Lease Fencing | §7.1, §7.2 | — | [INF] |
| 8 | External-Effect Unknown-Outcome Recovery | §8.1, §8.3, §8.4, §9.3 | — | [INF] |
| 9 | Receipt Integrity | §11.1, §11.2, §11.3 | ADR-0002 (receipt binds Work + Delegation/policy-authority ID) | [SRC] S12.1/S3.11; [PORTS]; [ADR-0002]; [INF]; [HYP] |
| 10 | Recovery Matrix (7 rows + orphan scenario) | §12 (+ §5.1 orphan ruled out) | — | [INF] |

Scenario trace (each cited once): PG down rejects mutations → §10; Embedded
snapshot proves the decision → §2 item 2; All records recoverable → §3 (dual-ref
R10/R15 [ADR-0002]); Mandated hard delete destroys content → §4.2; No orphan
pending after rollback → §5.1; Processed only after durable effect → §6.2;
Expired holder cannot commit → §7.1; Timeout reconciled before retry → §8.3/§8.4;
Hash is local integrity only → §11.2; Idempotency orphan ruled out → §12 orphan
row (content-equivalent to a matrix row) + §5.1. ADR cross-check confirms
ADR-0001 "neutral principal/position identifiers" + "retain assignment IDs and
effective dates" (R6/R9); ADR-0002 "separate identities, lifecycles, histories…
independently auditable" + "receipts can identify both the executed work and the
delegation or policy authority used" (R10/R15); ADR-0003 "risk class before
authority evaluation" + "five distinct principals… DENY on overlap" (R1/R3/R4/R5).

### Task 3.2 — Delta vs new-capability scenario contradiction check (PASS)

| Delta scenario (ports/trust) | Asserted THEN | New-capability counterpart | Verdict |
|------------------------------|---------------|----------------------------|---------|
| Records present for every required area | R1–R17 present; Work/authority dual-reference identifiable in R10 and R15 | "All records recoverable" (Req 3): R1–R17 present; Work/authority dual-reference identifiable in R10 and R15 | CONSISTENT — identical assertion (presence + dual-reference). Reinforcing, not contradictory. |
| Persistence and recovery handoff resolved | Semantics sourced FROM `io-persistence-recovery-contract`; MUST NOT be redefined or duplicated here | All 10 new-capability requirements (the single normative owner) | CONSISTENT — pure pointer/deference; asserts no persistence semantic that could conflict. Explicitly forbids redefinition. |

No contradiction found. The delta scenarios are a strict subset (record presence
+ handoff reference) and reference the new capability rather than restating it.
The "Records present for every required area" delta scenario deliberately mirrors
the new-capability "All records recoverable" scenario so the presence invariant
is stated once per owner (record-presence in ports/trust; persistence/recovery
semantics in the new capability) — no semantic drift, no duplication of
normative semantics. ↔ design "Delta review" row; proposal Success Criteria #2.

### Task 3.3 — Threat matrix N/A + no RED tests (PASS)

`design.md` Threat Matrix states: "N/A — no routing, shell, subprocess, VCS/PR
automation, executable-file classification, or process-integration boundary is
introduced by this documentation/specification change." Every threat-matrix
category is therefore N/A for a documentation/specification change with no
runtime code:

| Threat category | Status | Reason |
|-----------------|--------|--------|
| Routing | N/A | No code paths, request handlers, or URL/dispatch logic introduced. |
| Shell / subprocess execution | N/A | No shell, exec, or process spawning; doc-only Markdown. |
| VCS / PR automation | N/A | No git/PR hooks or automation authored in this change. |
| Executable-file classification | N/A | No files authored that could be executed. |
| Process-integration boundary | N/A | No daemon/IPC/process contract introduced; daemon semantics are normative prose only. |

No RED tests required: `design.md` Testing Strategy — "No unit, integration, E2E,
or RED tests are added: this change has no runtime implementation. Future
implementation must add RED tests for each applicable normative scenario." The
`tasks.md` routing header repeats "No runtime code, no RED tests (threat matrix
N/A)". Strict TDD cannot apply to documentation (no code under test); this batch
ran in Standard Mode per the orchestrator directive.

## Work Unit Evidence (WU3)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | No command applies — WU3 is documentation-only traceability + threat-matrix review. Substituted evidence: structural review above (3/3 PASS — 10 reqs + 10 scenarios traced; 0 delta/new-cap contradictions; 5/5 threat categories N/A). Rationale: `design.md` Testing Strategy + Threat Matrix state no runtime implementation and N/A. |
| Runtime harness command/scenario and exact result | N/A — documentation-only, no runtime behavior. |
| Rollback boundary | Files for WU3 only: this `apply-progress.md` (Phase 3 section + status-table updates) and `tasks.md` checkbox marks for 3.1–3.3. No spec, design, exploration, or canonical files touched; no WU1/WU2/WU4 artifacts altered. Reverting reverts the Phase 3 evidence and re-opens 3.1–3.3. |

## Phase 4 Validation Evidence (WU4)

Each task validates **archive readiness** (prepared here, executed at
`sdd-archive`) by confirming the promotion path, the ports/trust MODIFIED delta
applicability, and the destructive-delta condition. Evidence is structural
review against the canonical specs, the OpenSpec file convention, `design.md`
(File Changes + Migration/Rollout), and `proposal.md` (Affected Areas). No
archive files are created or moved in this phase — promotion and the folder move
belong to `sdd-archive`. No runtime code exists, so evidence is structural, not
execution.

### Task 4.1 — Promotion path: new canonical spec created at archive (PASS)

`openspec/specs/io-persistence-recovery-contract/spec.md` does NOT yet exist
(glob of `openspec/specs/*/spec.md` returns only `io-ports-trust-contract`,
`development-toolchain`, `io-domain-contract`) — correct, since it is created at
archive, not during apply. Three independent artifacts agree on the path and
intent:

| Source | Statement | Verdict |
|--------|-----------|---------|
| `design.md` File Changes | `openspec/specs/io-persistence-recovery-contract/spec.md` → Action **Create on archive**, "Canonical promoted capability." | Consistent |
| `design.md` Migration/Rollout | "On archive, promote the new capability to `openspec/specs/io-persistence-recovery-contract/spec.md` and apply the `io-ports-trust-contract` delta." | Consistent |
| `proposal.md` Affected Areas | `openspec/specs/io-persistence-recovery-contract/spec.md` \| **New** \| "Source capability after archive." | Consistent |

The change spec
(`openspec/changes/.../specs/io-persistence-recovery-contract/spec.md`) is a
**complete spec** (Purpose + 10 Requirements, each with Given/When/Then
scenarios), not a delta using `## ADDED`/`## MODIFIED` markers. OpenSpec archive
promotes a complete new-capability spec verbatim to the canonical path — no
merge semantics needed because there is no prior canonical block to merge
against. Promotion path is well-defined, unambiguous, and consistent across
proposal, design, and the spec itself. **PASS**.

### Task 4.2 — ports/trust MODIFIED delta applies preserving R1–R17 + scenarios (PASS)

Validated against the canonical `openspec/specs/io-ports-trust-contract/spec.md`
(line 156 requirement) and the OpenSpec convention ("MODIFIED replaces the full
matching requirement block in the main spec; the delta MUST contain the entire
updated requirement, including unchanged scenarios that must be preserved").

**(a) Heading match (OpenSpec MODIFIED requires a name match):**
- Canonical (line 156): `### Requirement: Required Persistence and Recovery Records`
- Delta (line 5): `### Requirement: Required Persistence and Recovery Records`
- **EXACT MATCH** → the MODIFIED replaces the correct block; no orphan/ambiguous
  target.

**(b) R1–R17 table integrity (all 17 rows preserved on apply):**
Both canonical (lines 161–179) and delta (lines 16–34) list all 17 rows R1→R17
with identical content and scope text; ADR labels preserved — R9 `[ADR-0001]`,
R10 `[ADR-0002]`, R15 `[ADR-0002]`. No row added, dropped, or relabeled.
**R1–R17 intact.**

**(c) Scenario preservation + intentional addition:**
| Scenario | Canonical | Delta | On apply |
|----------|-----------|-------|----------|
| Records present for every required area | present (181–185) | present verbatim (38–42): identical GIVEN/WHEN/THEN | PRESERVED |
| Persistence and recovery handoff resolved | absent | added (44–48): semantics sourced FROM new capability; MUST NOT be redefined/duplicated here | NET ADDITION (intentional MODIFIED update) |

No scenario is dropped; the existing scenario is preserved verbatim; one
intentional handoff scenario is added. Content-preserving MODIFIED.

**(d) Semantics sourced from the new capability ONLY (no duplication):**
Delta narrative (lines 7–14): "The persistence and recovery semantics for ALL of
these records … are carried into and defined by the `io-persistence-recovery-contract`
capability. This contract MUST NOT duplicate those semantics; it references them
by capability." Handoff scenario THEN clause (line 48): "they MUST be sourced
from the `io-persistence-recovery-contract` capability and MUST NOT be redefined
or duplicated here." Applying the delta therefore references the new capability;
it copies none of the 10 normative requirements (those live only in the
new-capability spec). Record **field detail** stays authoritative in
`io-ports-trust-contract` (new-capability spec Purpose) — the split the design
specifies.

**(e) Narrative change is non-destructive:** canonical closes with "storage
mechanisms are downstream. [INF] [HYP]"; delta carries forward the same
`[INF] [HYP]` labels and the "storage mechanisms remain downstream" statement,
adding the handoff-by-reference clause — an additive, label-preserving edit.
**PASS.**

### Task 4.3 — Archive folder naming + destructive-delta warning satisfied (PASS)

**(a) Archive folder naming:** The OpenSpec convention states the change folder
moves to `openspec/changes/archive/YYYY-MM-DD-{change-name}/`. The archive
directory exists and already holds three prior changes following exactly this
pattern: `2026-07-29-bootstrap-development-toolchain`,
`2026-07-29-io-domain-contract-v2`, `2026-07-30-io-ports-trust-contract-v2`
(today's date prefix is `2026-07-30`). This change would archive as
`openspec/changes/archive/2026-07-30-io-persistence-recovery-contract/`.
**Naming convention confirmed and consistent.**

**(b) Destructive-delta warning (`config.yaml` archive rule: "Warn before merging
destructive deltas"):** A destructive delta in OpenSpec is a `## REMOVED
Requirements` block (deletes a requirement) — or a `## RENAMED` that drops
behavior without a preserving MODIFIED. This change contains:
- New-capability spec: a complete spec promoted as a NEW canonical capability
  (additive — no prior block removed).
- ports/trust delta: `## MODIFIED Requirements` only (content-preserving
  replace-in-full; confirmed in 4.2 — no requirement deleted, no scenario
  dropped, R1–R17 intact).

**No `## REMOVED` markers exist anywhere in this change.** The destructive-delta
warning condition is therefore NOT triggered; archive can proceed without
destructive-delta intervention. **PASS.**

## Work Unit Evidence (WU4)

| Evidence | Required value |
|---|---|
| Focused test command and exact result | No command applies — WU4 is documentation-only archive-readiness review. Substituted evidence: structural review above (3/3 PASS — promotion path confirmed across proposal/design/spec; MODIFIED delta matches canonical heading, preserves R1–R17 + scenario verbatim, sources semantics by reference; archive naming matches 3 prior archives; no REMOVED/destructive deltas). Rationale: no runtime code exists; `design.md` Testing Strategy + Threat Matrix state no runtime implementation and N/A; archive promotion itself is owned/executed by `sdd-archive`, not apply. |
| Runtime harness command/scenario and exact result | N/A — documentation-only, no runtime behavior; archive move/promotion is a filesystem/spec-merge operation owned by `sdd-archive`, not an executable runtime path in apply. |
| Rollback boundary | Files for WU4 only: this `apply-progress.md` (Phase 4 section + status-table updates) and `tasks.md` checkbox marks for 4.1–4.3. No spec, design, exploration, canonical, or archive files created or moved (apply prepares readiness; archive owns promotion + the folder move). Reverting reverts the Phase 4 evidence and re-opens 4.1–4.3 without affecting any WU1/WU2/WU3 artifact or any canonical/archive state. |

## Deviations from Design

None — the validation confirms the new-capability spec matches the design intent
and exploration invariants. One content-model note (not a deviation): the
exploration's recovery matrix has 8 rows (incl. an "Idempotency pending orphan —
N/A" row); the spec represents that orphan as a scenario under the 7-row
Recovery Matrix requirement. Content-equivalent; task 1.11 was written against
the spec's 7-row form and is satisfied.

WU2 (Phase 2): None — the ports/trust delta matches the design's Delta-review
intent (handoff by reference, no semantic duplication). The record field-detail
ownership stays in `io-ports-trust-contract` while persistence/recovery
semantics move to the new capability — exactly the split the design specifies.

WU3 (Phase 3): None — every requirement/scenario traces cleanly to a labeled
exploration section and the governing ADR; the delta scenarios reinforce (do not
contradict) the new-capability scenarios; the threat matrix is N/A by design for
a doc-only change. One content-model note carried forward from WU1 (still
content-equivalent, not a deviation): exploration §12 carries 8 matrix rows incl.
an explicit "Idempotency pending orphan — N/A" row; the new-capability spec folds
that orphan into the "Idempotency orphan ruled out" scenario, leaving 7 matrix
rows — identical coverage, different representation.

WU4 (Phase 4): None — the archive-readiness review confirms the promotion path,
MODIFIED delta applicability, and destructive-delta condition all match the
OpenSpec convention, `design.md` File Changes/Migration, and `proposal.md`
Affected Areas. No deviation: apply prepares readiness only; promotion + the
folder move remain owned by `sdd-archive` (as the routing header and design both
state).

## Issues Found

- **Governance cache drift (non-blocking, flag for orchestrator)**:
  `openspec/config.yaml` declares `artifact_store: hybrid` and `strict_tdd: true`,
  but this launch's structured status resolved to `openspec` mode and `strict_tdd:
  false` (Standard). The discrepancy suggests the `sdd-init/io` cache may be stale
  relative to `config.yaml`. It does NOT affect this doc-only WU: TDD cannot apply
  to documentation (no code under test), and this batch followed the orchestrator's
  explicit openspec + Standard directive while ALSO mirroring progress to Engram
  (matching hybrid behavior). Recommend reconciling the cache before any future
  code-bearing WU where the flag choice would change behavior.

No new issues in WU2. The governance drift noted in WU1 still stands
(non-blocking for documentation-only work).

No new issues in WU3. The WU1 governance-cache drift (config.yaml
`artifact_store: hybrid` + `strict_tdd: true` vs this launch's `openspec` +
Standard resolution) still stands and remains non-blocking for doc-only work;
this batch again followed the orchestrator's explicit `openspec` + Standard
directive while mirroring progress to Engram (matching hybrid behavior), as the
orchestrator instructed for this WU.

No new issues in WU4. The WU1 governance-cache drift (config.yaml
`artifact_store: hybrid` + `strict_tdd: true` vs this launch's `openspec` +
Standard resolution) still stands and remains non-blocking for doc-only work;
this batch again followed the orchestrator's explicit `openspec` + Standard
directive while mirroring progress to Engram (matching hybrid behavior), as the
orchestrator instructed for this WU. Archive promotion and the folder move are
owned by `sdd-archive`, not apply; WU4 only confirmed readiness and did not
create or move any archive/canonical files.

## Next Steps

- WU1 (Phase 1): DONE — new-capability contract validated (10 reqs, R1–R17,
  recovery matrix; 11/11 PASS).
- WU2 (Phase 2): DONE — ports/trust delta validated (MODIFIED carries semantics;
  no duplication; R1–R17 intact; handoff resolved by reference).
- WU3 (Phase 3): DONE — traceability labels traced to exploration § + ADR-0001/
  0002/0003 (10 reqs + 10 scenarios, each cited once); delta scenarios do not
  contradict new-capability scenarios; threat matrix N/A with reasons; no RED
  tests.
- WU4 (Phase 4): DONE — archive readiness confirmed (3/3 PASS): promotion path
  for `openspec/specs/io-persistence-recovery-contract/spec.md` (create on
  archive); ports/trust MODIFIED delta matches canonical heading, preserves
  R1–R17 + scenario verbatim, adds handoff scenario, sources semantics by
  reference; archive naming matches convention; no REMOVED/destructive deltas so
  the destructive-delta warning is satisfied. Promotion + folder move remain
  owned by `sdd-archive`.
- All apply phases (1–4) complete: 19/19 tasks done.
- Next: `sdd-verify` writes `verify-report.md` (never an apply checkbox);
  `sdd-archive` promotes canonical specs and moves the change folder to
  `openspec/changes/archive/2026-07-30-io-persistence-recovery-contract/`.
