# Tasks: Learning promotion (stages 2+3)

> `nvm use`; 400 lines/unit; TDD; no numeric defaults; no Skill/worker-T1/event/`MATERIAL_EVENT_TYPES`/Stage-4 change; threats N/A; authority = repository-resolved proof.

Estimate ~1700–2000; ≤400/unit. Delivery strategy: auto-chain.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Work Units (stacked-to-main, autonomous, no size:exception)

| # | Tasks | Focused test command | Runtime harness | Rollback |
|---|---|---|---|---|
| 1 | 1.11–1.12 | `pnpm exec vitest run packages/business-domain/test/authority-evidence.test.ts packages/business-domain/test/promotion-scope.test.ts` | N/A | authority code+tests |
| 2 | 1.5r, 1.7–1.9 | `pnpm exec vitest run packages/business-domain/test/promotion-evaluation.test.ts` | N/A | evaluator/port exports |
| 3 | 2.1–2.6 | `pnpm exec vitest run packages/app/test/learning/evaluate.test.ts packages/business-domain/test/learning-candidate-fake.test.ts` | N/A | learning/, verify hook, fakes |
| 4 | 3.1–3.5 | `docker compose up -d && pnpm exec vitest run packages/database/test/sql-migrations.test.ts` | `docker compose up -d` (PG 18.4) | 012 table+adapter |
| 5 | 3.9–3.11 | `docker compose up -d && pnpm exec vitest run packages/database/test/promotion-authority.test.ts` | `docker compose up -d` | 013 table+adapter |
| 6 | 3.6–3.8, 4.x | `IO_REQUIRE_PG=1 pnpm exec vitest run packages/database/test/learning-candidate-roundtrip.integration.test.ts` | `IO_REQUIRE_PG=1 pnpm check` | E2E `MIGRATIONS` |

## Phase 1: Domain

- [x] 1.1 `candidateIdFor` (1A).
- [x] 1.2 `learning-candidate.ts` types (1A).
- [x] 1.3 `createLearningCandidate` (1B).
- [x] 1.4 RED `resolvePromotionPolicy` (1C).
- [x] 1.5 COMPLETE: 1C policy-resolution + 1D aggregation + 1E safe-data + 1F explicit parser + 1G authority/scope all delivered on main (evaluator below).
- [x] 1.6 PARTIAL→DONE: 1E-b1-v2 observation foundation (sha256:8a6aacdb…) + 1F public `parseExplicitPromotionEvidence` envelope (sha256:47d06b31…, 12/12) + 1.11 `parseAuthorityEvidence` delivered; 1.6 complete.
- [x] 1.11 RED+GREEN `parseAuthorityEvidence`: closed `{companyId,subject,sourceRef}` envelope; missing/malformed/foreign → typed unavailable; export; completes 1.6.
- [x] 1.12 RED+GREEN `promotionScopeFor`/`parsePromotionScope`: canonical `learning.promote:<companyUtf8Bytes>:<companyId>:<skillUtf8Bytes>:<skillId>:v<positiveVersion>`; reject malformed/trailing/non-positive; byte-exact re-encode.
- [x] 1.7 GREEN `evaluatePromotion` (2B): outcomes+reasons; conflict/reserved/unresolved-risk/veto → needs-review BEFORE thresholds; veto never averaged; authority unavailable → needs-review, never promote.
- [x] 1.8 RED corpus: gold→promote; decoy/reorder-identical/missing-not-harmful/veto-any-count/absent-or-revoked-authority/retired-policy-fail-closed; `SkillState`/`MATERIAL_EVENT_TYPES` unchanged. (2C: `promotion-quality-corpus.test.ts`, honest n/a-RED vs merged evaluator.)
- [x] 1.9 GREEN `ports/repositories.ts`: candidate port (4 ops, typed results) + `PromotionAuthorityRepository` (`appendProof`/`resolve`) + authority types; export (2A).
- [x] 1.10 `pnpm check` green. (2C: exit 0 — 1532 passed / 6 skipped.)

## Phase 2: App + fakes

- [x] 2.1 GREEN `app/src/learning/evaluate.ts`: Skill → unique policy → one read → aggregate → parse explicit+authority → scope → resolve authority (trusted actor/principal) → evaluate; tenant guard.
- [x] 2.2 RED tests: one read/zero writes/tenant scoping/fail-closed policy/typed authority failures. (W3C1 3/3 core + W3C2 3/3 gates + W3C3 9/9 typed matrix.)
- [x] 2.3 GREEN `ports/fakes.ts`: in-memory candidate + authority repos (append-only, current-leaf, revocation); INSERT-only; export. (W3A candidate fake + W3B1 authority fake; W3B2 coverage tests.)
- [x] 2.4 RED fake tests: candidate replay/collision/stale/concurrency; authority current/superseded/revoked. (W3A 11/11 candidate; W3B1 8/8 core + W3B2 10/10 coverage.)
- [ ] 2.6 RED+GREEN atomic verifyWork+proof owner (`app/src/worker/verify.ts`): one transaction = `completed→verified` win + proof append (verifier, fresh Delegation, policy); revocation supersede; no partial write.
- [x] 2.5 `pnpm check` green. (1582 passed / 6 skipped on the full work-unit-3 stack; 9 pre-existing warnings.)

## Phase 3: PostgreSQL

- [ ] 3.1 GREEN `sql/012_learning_candidates.sql`: PK/self-FK/CHECK/parent-claim/digest/guarded JSONB/`IF NOT EXISTS`.
- [ ] 3.2 RED+GREEN migration tests assert 012.
- [ ] 3.9 GREEN `sql/013_promotion_authority_proofs.sql`: append-only `promotion_authority_proof` PK `(company_id,proof_id,proof_revision)`; UNIQUE transition identity; self-FK supersede + parent claim; time CHECK; JSON guards; tenant index; current = `NOT EXISTS` child; no UPDATE/DELETE.
- [ ] 3.10 RED+GREEN migration tests assert 013 + idempotency.
- [ ] 3.3 GREEN `row-guards.ts` `parseLearningCandidateRow` (columns+JSONB).
- [ ] 3.4 GREEN candidate adapter: `ON CONFLICT DO NOTHING` replay/collision; transactional `INSERT…SELECT`, parent-claim winner; no UPDATE/DELETE.
- [ ] 3.11 GREEN `promotion-authority-adapter.ts` `PgPromotionAuthorityRepository`: `resolve` = `sourceRef`→proof leaves + Delegation re-read; 0 rows→missing, >1→ambiguous; validates actor/principal/policy/command/capability/scope/grant/window/revocation; INSERT-only; row guard+fake.
- [ ] 3.5 Extend `connection-fake.ts` (candidate SQL).
- [ ] 3.6 E2E wiring: `012`+`013` in `packages/app/test/e2e/harness.ts` `MIGRATIONS`; export adapters+guards.
- [ ] 3.7 RED integration/parity (live PG, `skipIf(!reachable)`, TRUNCATE, sequential): authority leaf-counts/superseded/revoked/expired/mismatch/forged/atomic-write; candidate replay/concurrency/isolation/malformed; fake↔PG parity+rescoring.
- [ ] 3.8 `IO_REQUIRE_PG=1 pnpm check` green (live PG).

## Phase 4: Verification

- [ ] 4.1 Boundary unchanged: `SkillState`,`MATERIAL_EVENT_TYPES`,T1,registry,worker.
- [ ] 4.2 Full `pnpm check` green.
- [ ] 4.3 Rollback: 012/013 removable; retired policy fails closed.
