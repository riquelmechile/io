# Tasks: Learning promotion (stages 2+3)

> Prereq: `nvm use` (Node 24.18.1, `.nvmrc`) before every command. Canonical repo contract = **400 changed lines / review unit** — the 800 session target does NOT override it. TDD strict (RED→GREEN→REFACTOR); tests ship WITH behavior in the same slice. No operator numeric policy values — tests use fixture values solely to prove behavior. No Skill/worker/T1/event/`MATERIAL_EVENT_TYPES`/Stage-4 changes. Threat matrix **N/A** (no routing/shell/process boundary) — omitted per skill rules.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1050–1150 total |
| 400-line budget risk | High (total); Medium per unit |
| Chained PRs recommended | Yes |
| Suggested split | PR1 domain → PR2 app+fake → PR3 PG/concurrency |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure domain: candidate contracts + promotion evaluator + repo port | PR1 | `pnpm exec vitest run packages/business-domain/test/learning-candidate.test.ts packages/business-domain/test/promotion-evaluation.test.ts` | N/A — pure unit (no runtime boundary) | drop `learning-candidate.ts`,`promotion-evaluation.ts` + port/index exports; no consumers |
| 2 | App read-only seam + append-only in-memory fake repo | PR2 | `pnpm exec vitest run packages/app/test/learning/evaluate.test.ts packages/business-domain/test/learning-candidate-fake.test.ts` | N/A — pure unit | drop `packages/app/src/learning/` + `InMemoryLearningCandidateRepository` |
| 3 | PG migration + row guards + INSERT-only adapter + concurrency + parity + E2E wiring | PR3 | `docker compose up -d && pnpm exec vitest run packages/database/test/learning-candidate-roundtrip.integration.test.ts packages/database/test/sql-migrations.test.ts` | `docker compose up -d` (PG 18.4) + `IO_REQUIRE_PG=1 pnpm check` (sequential, never silent-skip) | `DROP learning_candidate_revision` + remove adapter/row-guard/exports + remove `012` from E2E `MIGRATIONS` |

**Auto-chain contingency (no human decision):** if a unit crosses 400 changed lines at apply, auto-split along its named sub-boundary (stacked-to-main, each child targets the prior slice branch): PR1 → `candidate-contracts+port` | `evaluator+quality-corpus`; PR2 → `app-seam` | `in-memory-fake`; PR3 → `schema+row-guard+adapter-reads+basic-integration` | `transition-concurrency+fake↔PG-parity`.

## Phase 1: Pure domain — candidate contracts + promotion evaluator (PR1)

- [x] 1.1 RED `learning-candidate.test.ts`: `candidateIdFor` = length-prefixed `lc:<clen>:<co>:<slen>:<skill>:v<ver>` deterministic + collision-free across tenants/subjects/versions.
- [x] 1.2 GREEN `learning-candidate.ts`: types `LearningSubject`,`LearningCandidateState`,`LearningCandidate`,`CreateCandidateCommand`,`SkillOutcomeEvidence`,`TransitionEvidence` + `candidateIdFor`.
- [x] 1.3 RED+GREEN `createLearningCandidate`: require non-empty tenant/subject, exact resolved scope, ≥1 validated matching outcome, canonical evidence sorted `(occurredAt,eventId)`, unique derived `linkedOutcomeIds`, `revision:1`,`state:'candidate'`, caller `createdAt`; invalid identity/state/revision/dup-id/tenant → `ParseResult` fail, NO mutation.
- [x] 1.4 RED `promotion-evaluation.test.ts` `resolvePromotionPolicy`: 0→`policy-not-found`; malformed→`policy-invalid`; >1 applicable→`policy-ambiguous`; exactly-1 valid; `effectiveFrom<=at<effectiveUntil`; company+scope+(optional)exact-subject match; window `[max(from,at-win),at)`; no event read/mutation; no numeric defaults.
- [ ] 1.5 GREEN `promotion-evaluation.ts`: types `PromotionPolicy`,`PolicyResolution`,`PromotionEvidence`,`ExplicitPromotionEvidence`,`AuthorityEvidence`,`PromotionResult`,`PolicyRef`,`PromotionReason` + `resolvePromotionPolicy` + `aggregateSkillOutcomes` (same-tenant `work.skill-outcome`,`aggregateKind:'work'`,`source:'worker'`,payload `{version:1,activatedSkills:[…]}`+matching subject; dedupe eventId; sort `(occurredAt,eventId)`; foreign excluded; missing ≠ harmful; read-only). — PARTIAL: policy-resolution + aggregation sub-slices delivered (`PromotionPolicy`,`PolicyResolution`,`PolicyRef`,`RiskClass` + `resolvePromotionPolicy` in 1C; `PromotionEvidence` + `aggregateSkillOutcomes` in 1D); Slice 1E delivered ONLY internal descriptor-safe foundations in `src/validation/safe-data.ts` (not exported): 1E-a `readClosedDataRecord`/`readDenseDataArray`, 1E-b `cloneAndFreezeSafeData` recursive deep clone/freeze — evidence parsers NOT delivered; authority parser, `evaluatePromotion` pending.
- [ ] 1.6 RED+GREEN `parseExplicitPromotionEvidence`+`parseAuthorityEvidence`: unique stable evidence id/provenance + exact tenant/subject binding per observation; missing required → typed `harmful-evidence-unavailable`|`success-rate-unavailable`|`confidence-unavailable`|`source-authority-unavailable`.
- [ ] 1.7 RED+GREEN `evaluatePromotion`: outcomes `promote`|`remain-candidate`|`needs-review` + typed reasons + `policyRef` + `outcomeIds`; ANY conflict / unresolved-risk / reserved-category / triggered-veto → `needs-review` BEFORE thresholds; veto never averaged away; insufficient non-conflicting → `remain-candidate`.
- [ ] 1.8 RED quality corpus (Req 7): gold→`promote`; decoy→remain/needs-review; semantically-equivalent reorder→identical result; missing→not harmful; catastrophic veto→`needs-review` regardless of count; retired policy→fail closed while history intact; assert `SkillState`,`MATERIAL_EVENT_TYPES` unchanged.
- [ ] 1.9 GREEN `ports/repositories.ts`: `LearningCandidateRepository` port (`appendInitial`|`appendTransition`|`getCurrent`|`listRevisions`) + typed results `appended`|`replayed`|`stale`|`conflict`|`idempotency-collision`; export all new symbols from `business-domain/src/index.ts`.
- [ ] 1.10 `nvm use && pnpm check` green (format→typecheck→build→lint→test).

## Phase 2: App read-only seam + append-only in-memory fake repository (PR2)

- [ ] 2.1 GREEN `packages/app/src/learning/evaluate.ts` `evaluateLearningPromotionForCompany`: resolve exact tenant Skill version via `skills.listByCompany`→its `{process,schemaVersion}` scope; resolve one policy at caller `at`; ONE read-only `events.listByCompany`; validate payload + match activated subject; filter `[windowStart,at)`; aggregate; runtime-validate explicit/authority evidence after policy resolution; evaluate; reject empty tenant BEFORE any read; carry NO clock/write (mirrors `heartbeat/evaluate.ts`).
- [ ] 2.2 RED app `learning/evaluate.test.ts`: exactly one `listByCompany`, zero writes/mutations; tenant scoping (foreign facts excluded); zero/invalid/ambiguous policy → fail closed / typed-escalate, NO nearest-policy selection; no Skill/worker/T1/event/materiality change.
- [ ] 2.3 GREEN `ports/fakes.ts` `InMemoryLearningCandidateRepository`: one serialized critical section mirroring every PG check; INSERT-only surface; NO update/delete; export from `business-domain/src/index.ts`.
- [ ] 2.4 RED fake repo test: identical command/policy/evidence bytes+digest →`replayed`; reused digest w/ unequal bytes →`idempotency-collision`; stale/superseded →`stale` (no transition); equal-revision concurrent → exactly one `appended` winner, rest `conflict`; replay converges; losing/stale attempts cause NO mutation.
- [ ] 2.5 `nvm use && pnpm check` green.

## Phase 3: PostgreSQL migration + INSERT-only adapter + concurrency + parity (PR3)

- [ ] 3.1 GREEN `sql/012_learning_candidates.sql`: `learning_candidate_revision` PK `(company_id,candidate_id,revision)`; composite self-FK `(company_id,candidate_id,parent_revision)`→PK; root/successor CHECK; UNIQUE partial parent claim; UNIQUE `command_digest`; immutable guarded JSONB (subject/scope, canonical full `outcomeEvidence`+derived ids, policy snapshot, explicit+authority snapshots, result/reasons, lineage, digest); idempotent `IF NOT EXISTS` on every statement.
- [ ] 3.2 RED+GREEN extend `packages/database/test/sql-migrations.test.ts`: ship 012; assert table/PK/self-FK/CHECK/parent-claim/`command_digest` uniqueness + `IF NOT EXISTS` per statement.
- [ ] 3.3 GREEN `row-guards.ts` `parseLearningCandidateRow`: validate every column + JSONB snapshots; reject malformed without cross-tenant disclosure; export from `database/src/index.ts`.
- [ ] 3.4 GREEN `learning-candidate-adapter.ts` `PgLearningCandidateRepository`: `appendInitial` = `INSERT…ON CONFLICT DO NOTHING` + fetch + compare canonical creation bytes/digest (replay vs `idempotency-collision`); `appendTransition` = one transaction `INSERT…SELECT` from expected tenant/candidate/revision where parent eligible AND `NOT EXISTS` child, `revision=parent+1`, unique parent claim picks single winner; `getCurrent` = leaf via `NOT EXISTS` child; `listRevisions`; every read tenant-predicated; empty `companyId` rejected BEFORE any SQL; no UPDATE/DELETE.
- [ ] 3.5 GREEN extend `packages/database/test/connection-fake.ts` for new adapter SQL (`ON CONFLICT DO NOTHING`; `INSERT…SELECT`/subquery only if a unit test exercises it).
- [ ] 3.6 GREEN E2E wiring: append `012_learning_candidates.sql` to `packages/app/test/e2e/harness.ts` `MIGRATIONS`; export `PgLearningCandidateRepository`+`parseLearningCandidateRow` from `database/src/index.ts`.
- [ ] 3.7 RED `learning-candidate-roundtrip.integration.test.ts` (live PG; `describe.skipIf(!reachable)`; `beforeEach` TRUNCATE; sequential via `fileParallelism:false`): round-trip survives `parseLearningCandidateRow`; replay converges; reused-digest collision; stale/superseded → no transition; concurrent equal revisions → one winner; cross-tenant isolation; malformed row rejected; stored evidence reproduces evaluation + rescoring under its policy snapshot; fake↔PG parity vectors over EVERY branch.
- [ ] 3.8 `nvm use && docker compose up -d && IO_REQUIRE_PG=1 pnpm check` green (live PG 18.4 sequential proof; CI never silently skips).

## Phase 4: Cross-slice verification

- [ ] 4.1 Boundary: confirm `SkillState`,`MATERIAL_EVENT_TYPES`,T1,Skill registry,worker cycle unchanged (grep/tests green); no Stage-4 Skill creation/update introduced.
- [ ] 4.2 Full `nvm use && pnpm check` green end-to-end across business-domain + app + database.
