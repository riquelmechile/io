# Design: Learning promotion (stages 2+3)

## Technical approach and flow

The learning subject is one activated Skill version, not an invented event field: `{companyId, skillId, skillVersion}`. The app resolves that exact version through tenant-scoped `SkillRepository.listByCompany`, obtains its existing `{process,schemaVersion}` scope, resolves one deployed policy, then filters existing composite events. No Skill, worker, T1, event, or `MATERIAL_EVENT_TYPES` change.

```text
subject → exact tenant Skill version → unique applicable policy at caller `at`
  → listByCompany events → validate payload → match activated Skill ref
  → filter [windowStart, at) → dedupe/sort → create/evaluate pure candidate
  → optional INSERT-only append command
```

## Domain contracts and semantics

```ts
type LearningSubject={skillId:string;skillVersion:number};
type LearningCandidateState='candidate'|'active'|'needs_review'|'superseded';
type LearningCandidate={companyId:string;candidateId:string;revision:number;subject:LearningSubject;scope:SkillScope;state:LearningCandidateState;outcomeEvidence:readonly SkillOutcomeEvidence[];linkedOutcomeIds:readonly string[];createdAt:number;supersedesRevision?:number;transition?:TransitionEvidence};
type CreateCandidateCommand={companyId:string;subject:LearningSubject;scope:SkillScope;outcomes:readonly SkillOutcomeEvidence[];createdAt:number};
type SkillOutcomeEvidence={evidenceId:string;eventId:string;companyId:string;subject:LearningSubject;occurredAt:number;workId:string};
type ExplicitObservation<T>={evidenceId:string;companyId:string;subject:LearningSubject;sourceRef:string;observedAt:number;value:T};
type ExplicitPromotionEvidence={confidence?:ExplicitObservation<number>;sourceAuthority?:ExplicitObservation<string>;rateObservations?:readonly ExplicitObservation<{positive:boolean;harmful:boolean}>[];conflicts:readonly ExplicitObservation<{unresolved:boolean;description:string}>[];catastrophicVetoes:readonly ExplicitObservation<{triggered:boolean;description:string}>[]};
type AuthorityEvidence={evidenceId:string;companyId:string;subject:LearningSubject;sourceRef:string;riskClass:RiskClass;grantId:string;delegatedScope:string;delegatedRiskClasses:readonly RiskClass[];reservedCategory?:'purpose'|'capital'|'critical-limits'|'irreversible'|'constitutional-modification';unresolvedRisk:boolean};
type PromotionPolicy={policyId:string;version:number;companyId:string;scope:SkillScope;subject?:LearningSubject;active:boolean;effectiveFrom:number;effectiveUntil:number;observationWindowMs?:number;minPositiveObservations:number;minLinkedOutcomes:number;requireUniqueOutcomes:boolean;conflictBehavior:'needs-review';delegatedRiskClasses:readonly RiskClass[];minConfidence?:number;allowedSourceAuthorities?:readonly string[];successRate?:ExplicitRateRule;harmfulCap?:ExplicitRateRule;catastrophicVetoEnabled?:boolean};
type PromotionResult={outcome:'promote'|'remain-candidate'|'needs-review';reasons:readonly PromotionReason[];policyRef?:PolicyRef;outcomeIds:readonly string[]};
function candidateIdFor(companyId:string,subject:LearningSubject):string;
function createLearningCandidate(command:CreateCandidateCommand):ParseResult<LearningCandidate>;
function resolvePromotionPolicy(policies:readonly unknown[],input:{companyId:string;subject:LearningSubject;scope:SkillScope;at:number}):PolicyResolution;
function aggregateSkillOutcomes(events:readonly BusinessEvent[],input:{companyId:string;subject:LearningSubject;windowStart:number;windowEnd:number}):ParseResult<PromotionEvidence>;
function parseExplicitPromotionEvidence(x:unknown,binding:{companyId:string;subject:LearningSubject}):ParseResult<ExplicitPromotionEvidence>;
function parseAuthorityEvidence(x:unknown,binding:{companyId:string;subject:LearningSubject}):ParseResult<AuthorityEvidence>;
function evaluatePromotion(candidate:LearningCandidate,outcomes:PromotionEvidence,explicit:ExplicitPromotionEvidence,policy:PromotionPolicy,authority:AuthorityEvidence):PromotionResult;
function evaluateLearningPromotionForCompany(deps:{events:BusinessEventRepository;skills:SkillRepository},input:{companyId:string;subject:LearningSubject;policies:readonly unknown[];explicitEvidence:unknown;authorityEvidence:unknown;at:number}):Promise<PromotionResult>;
```

`candidateIdFor` uses canonical length-prefixed UTF-8 components (`lc:<company length>:<company>:<skill length>:<skill>:v<version>`), avoiding delimiter collisions. Creation requires non-empty tenant/subject, exact resolved Skill scope, at least one validated matching outcome, canonical evidence sorted by `(occurredAt,eventId)`, derived unique `linkedOutcomeIds`, initial `state:'candidate'`, `revision:1`, no parent, and caller-supplied `createdAt`. Every evidence item binds stable evidence/event ID, tenant, subject, time, and work; provenance never claims candidate/cohort data came from payload.

Policy has no defaults; `conflictBehavior` is required and only `'needs-review'` is valid. Exactly one valid active exact company+scope and optional exact-subject policy must satisfy `effectiveFrom <= at < effectiveUntil`; zero/invalid/ambiguous returns `policy-not-found|policy-invalid|policy-ambiguous`, without event read or mutation. Window is `[max(effectiveFrom, at-observationWindowMs), at)` when configured, otherwise `[effectiveFrom, at)`; `at` is caller supplied. Aggregation accepts only same-tenant `work.skill-outcome`, `aggregateKind:'work'`, `source:'worker'`, payload `{version:1,activatedSkills:[{skillId,version}]}`, and a matching subject ref; it preserves `occurredAt`, rejects malformed payloads, deduplicates event IDs, and sorts by `(occurredAt,eventId)`.

Current events are success-only: missing is unknown, and no harmful/success denominator is inferred. The app runtime-validates caller-supplied explicit and authority evidence after policy resolution and before evaluation; every observation must have unique stable ID/provenance and exact tenant/subject binding. Rate rules consume only `rateObservations`; missing required observations yield `harmful-evidence-unavailable|success-rate-unavailable`. Missing confidence/source authority similarly yields typed unavailable. Any unresolved conflict (regardless of policy), unresolved/undelegated risk, reserved category, or enabled triggered veto yields `needs-review` before thresholds; only insufficient non-conflicting evidence may remain candidate. No external-evidence store is added.

## INSERT-only persistence and concurrency

`LearningCandidateRepository` exposes `appendInitial`, `appendTransition`, `getCurrent`, and `listRevisions`; typed results are `appended|replayed|stale|conflict|idempotency-collision`.

`012_learning_candidates.sql` creates `learning_candidate_revision` with PK `(company_id,candidate_id,revision)`, composite self-FK `(company_id,candidate_id,parent_revision)` to the PK, root/successor CHECK, unique partial parent claim, and unique command digest. Immutable guarded JSONB stores subject/scope, canonical full `outcomeEvidence` (with derived IDs), policy snapshot, explicit/authority evidence snapshots, result/reasons, lineage, and digest for replay and rescoring.

Initial append uses deterministic ID plus `INSERT ... ON CONFLICT DO NOTHING`; fetch compares canonical creation bytes/digest, returning replay only when identical, otherwise collision. Transition uses one transaction and `INSERT ... SELECT` from the expected tenant/candidate/revision where parent state is eligible and `NOT EXISTS` any child; SQL copies subject/scope, sets `revision=parent+1`, and the unique parent claim chooses one concurrent winner. Canonical length-prefixed serialization of command, full policy snapshot, and sorted evidence produces `command_digest`; same bytes replay the stored row, reused digest with unequal bytes is collision. Current view is rows with `NOT EXISTS` a child; therefore exactly one leaf exists and no UPDATE/DELETE is needed. The fake executes the identical checks in one serialized critical section; shared parity vectors cover all branches.

## Security, testing, rollout, and impact

Every read rejects empty tenant before access and predicates `company_id`; foreign data is not-found. Logs expose typed reason, IDs, policy ref, digest, and replay/conflict only—not content. Tests cover policy/conflict value and window boundaries, every explicit/authority guard and missing input, gold/decoy/equivalent-order/missing/veto, immutable provenance/rescoring, creation replay/collision, concurrency, malformed rows, isolation, and fake/PG parity. Company Bench supplies discipline only. Threat matrix: N/A—no routing/shell/process boundary.

| Files | Action |
|---|---|
| `packages/business-domain/src/{learning-candidate,promotion-evaluation}.ts`, tests | Create |
| `packages/business-domain/src/{index,ports/repositories,ports/fakes}.ts` | Modify |
| `packages/app/src/learning/evaluate.ts`, app tests | Create |
| `packages/database/src/learning-candidate-adapter.ts`, `sql/012_learning_candidates.sql`, PG tests | Create |
| `packages/database/src/{index,row-guards}.ts`, `packages/database/test/connection-fake.ts`, E2E migration list | Modify |

Migration is additive; policy retirement fails closed without rewriting history. Rollback removes unused modules/table. Likely ≤400-line slices: domain; app/fake parity; PG/concurrency. Stage 4 remains out.

## Self-audit

Full proposal/spec audit: all seven requirements remain covered—immutable candidate plus complete provenance; deterministic tenant success-only aggregation; explicit unique policy with mandatory review conflicts; bounded typed evaluation with validated explicit/authority evidence; INSERT-only replay/concurrency; PG/fake validation parity and reproducible snapshots; quality controls and Stage-4 boundary. No numeric defaults, Memory OS, or Skill/worker/T1/event/materiality changes were introduced.
