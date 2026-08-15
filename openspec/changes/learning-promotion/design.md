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
type AuthorityEvidence={companyId:string;subject:LearningSubject;sourceRef:string};
type PromotionPolicy={policyId:string;version:number;companyId:string;scope:SkillScope;subject?:LearningSubject;active:boolean;effectiveFrom:number;effectiveUntil:number;observationWindowMs?:number;minPositiveObservations:number;minLinkedOutcomes:number;requireUniqueOutcomes:boolean;conflictBehavior:'needs-review';delegatedRiskClasses:readonly RiskClass[];minConfidence?:number;allowedSourceAuthorities?:readonly string[];successRate?:ExplicitRateRule;harmfulCap?:ExplicitRateRule;catastrophicVetoEnabled?:boolean};
type PromotionResult={outcome:'promote'|'remain-candidate'|'needs-review';reasons:readonly PromotionReason[];policyRef?:PolicyRef;outcomeIds:readonly string[]};
function candidateIdFor(companyId:string,subject:LearningSubject):string;
function createLearningCandidate(command:CreateCandidateCommand):ParseResult<LearningCandidate>;
function resolvePromotionPolicy(policies:readonly unknown[],input:{companyId:string;subject:LearningSubject;scope:SkillScope;at:number}):PolicyResolution;
function aggregateSkillOutcomes(events:readonly BusinessEvent[],input:{companyId:string;subject:LearningSubject;windowStart:number;windowEnd:number}):ParseResult<PromotionEvidence>;
function parseExplicitPromotionEvidence(x:unknown,binding:{companyId:string;subject:LearningSubject}):ParseResult<ExplicitPromotionEvidence>;
function parseAuthorityEvidence(x:unknown,binding:{companyId:string;subject:LearningSubject}):AuthorityEvidenceParse;
function evaluatePromotion(candidate:LearningCandidate,outcomes:PromotionEvidence,explicit:ExplicitPromotionEvidence,policy:PromotionPolicy,authority:AuthorityEvidence):PromotionResult;
function evaluateLearningPromotionForCompany(deps:{events:BusinessEventRepository;skills:SkillRepository},input:{companyId:string;subject:LearningSubject;policies:readonly unknown[];explicitEvidence:unknown;authorityEvidence:unknown;at:number}):Promise<PromotionResult>;
```

`candidateIdFor` uses canonical length-prefixed UTF-8 components (`lc:<company length>:<company>:<skill length>:<skill>:v<version>`), avoiding delimiter collisions. Creation requires non-empty tenant/subject, exact resolved Skill scope, at least one validated matching outcome, canonical evidence sorted by `(occurredAt,eventId)`, derived unique `linkedOutcomeIds`, initial `state:'candidate'`, `revision:1`, no parent, and caller-supplied `createdAt`. Every evidence item binds stable evidence/event ID, tenant, subject, time, and work; provenance never claims candidate/cohort data came from payload.

Policy has no defaults; `conflictBehavior` is required and only `'needs-review'` is valid. Exactly one valid active exact company+scope and optional exact-subject policy must satisfy `effectiveFrom <= at < effectiveUntil`; zero/invalid/ambiguous returns `policy-not-found|policy-invalid|policy-ambiguous`, without event read or mutation. Window is `[max(effectiveFrom, at-observationWindowMs), at)` when configured, otherwise `[effectiveFrom, at)`; `at` is caller supplied. Aggregation accepts only same-tenant `work.skill-outcome`, `aggregateKind:'work'`, `source:'worker'`, payload `{version:1,activatedSkills:[{skillId,version}]}`, and a matching subject ref; it preserves `occurredAt`, rejects malformed payloads, deduplicates event IDs, and sorts by `(occurredAt,eventId)`.

Current events are success-only: missing is unknown, and no harmful/success denominator is inferred. The app runtime-validates caller-supplied explicit and authority evidence after policy resolution and before evaluation; every observation must have unique stable ID/provenance and exact tenant/subject binding. Rate rules consume only `rateObservations`; missing required observations yield `harmful-evidence-unavailable|success-rate-unavailable`. Missing confidence/source authority similarly yields typed unavailable. Any unresolved conflict (regardless of policy), unresolved/undelegated risk, reserved category, or enabled triggered veto yields `needs-review` before thresholds; only insufficient non-conflicting evidence may remain candidate. No external-evidence store is added.

## Authority contract and durable source

Authority is repository-resolved, never caller-supplied: the caller provides only a closed descriptor-safe `{companyId,subject,sourceRef}` envelope, and the trusted authenticated context supplies the expected principal, actor, and binding. The exact command and capability are `learning.promote`; the canonical scope is `learning.promote:<companyUtf8Bytes>:<companyId>:<skillUtf8Bytes>:<skillId>:v<positiveVersion>`. `promotionScopeFor` emits it; `parsePromotionScope` consumes byte counts, rejects malformed Unicode/trailing bytes/non-positive version, and requires byte-for-byte canonical re-encoding.

```ts
type AuthorityTransitionProof={proofId:string;proofRevision:number;transitionId:string;transitionRevision:number;supersedesProofRevision?:number;current:true;kind:'verification';companyId:string;subject:LearningSubject;actorId:string;principalId:string;delegationId:string;grantId:string;command:'learning.promote';capability:'learning.promote';scope:string;policyRef:PolicyRef;issuedAt:number;effectiveFrom:number;expiry:number;revoked:boolean;revocationVersion:number}; type AuthorityUnavailableReason='authority-missing'|'authority-malformed'|'authority-foreign'|'authority-stale'|'authority-revoked'|'authority-ambiguous'|'authority-source-unresolvable'|'authority-command-mismatch'|'authority-principal-mismatch'|'authority-policy-mismatch'|'authority-proof-unavailable';
interface PromotionAuthorityRepository { appendProof(p:Omit<AuthorityTransitionProof,'current'>):Promise<'appended'|'replayed'|'conflict'>; resolve(i:{sourceRef:string;companyId:string;subject:LearningSubject;policyRef:PolicyRef;at:number;expectedPrincipalId:string;expectedActorId:string;command:'learning.promote';capability:'learning.promote';scope:string}):Promise<{kind:'resolved';value:AuthorityTransitionProof}|{kind:'unavailable';reason:AuthorityUnavailableReason}>; }
```

`parseAuthorityEvidence` validates only the closed envelope and exact binding; missing/malformed/foreign input maps to its typed reason. `PgPromotionAuthorityRepository` then tenant-looks up opaque `sourceRef` as `proof_id`, selects current proof leaves, and re-reads `DelegationRepository.get(companyId,delegationId)`. Zero rows is missing/unresolvable; one is validated; multiple leaves/conflicting identities are ambiguous. Success requires expected actor/principal, policy ID/version, command/capability, canonical scope, `grantId===delegationId`, `delegate===principalId`, `delegator`-approved active Delegation, matching action/scope, current proof and transition identity/revision, `max(effectiveFrom,delegation.validFrom) <= at < min(expiry,delegation.validUntil)`, `issuedAt <= at`, and non-revoked latest `revocationVersion`. Foreign, malformed, future/expired/superseded/policy-old, revoked, mismatched, or absent proof maps to the typed reason and `needs-review`, never promotion. Sufficient evidence plus resolved authority can therefore promote in production.

Migration `013_promotion_authority_proofs.sql` creates append-only `promotion_authority_proof`: PK `(company_id,proof_id,proof_revision)`, unique `(company_id,transition_id,transition_revision)`, self-FK `(company_id,proof_id,supersedes_proof_revision)`, unique partial parent claim, bounded-time CHECK, positive revisions, closed subject/policy JSON guards, and indexed tenant proof lookup. Current is derived by `NOT EXISTS` child; no UPDATE/DELETE/current boolean is stored. The verification application transaction owns writes: after `verifyWork` wins `completed→verified`, authenticated verifier/expected promoter plus the freshly read active Delegation and resolved policy produce the proof INSERT atomically. Revocation appends a superseding `revoked` revision (returned only as `authority-revoked`); no event is invented. Existing `Work`, receipt, sandbox result, or caller claim alone is not proof because they lack verifier, policy, and immutable transition identity.

## INSERT-only persistence and concurrency

`LearningCandidateRepository` exposes `appendInitial`, `appendTransition`, `getCurrent`, and `listRevisions`; typed results are `appended|replayed|stale|conflict|idempotency-collision`.

`012_learning_candidates.sql` creates `learning_candidate_revision` with PK `(company_id,candidate_id,revision)`, composite self-FK `(company_id,candidate_id,parent_revision)` to the PK, root/successor CHECK, unique partial parent claim, and unique command digest. Immutable guarded JSONB stores subject/scope, canonical full `outcomeEvidence` (with derived IDs), policy snapshot, explicit/authority evidence snapshots, result/reasons, lineage, and digest for replay and rescoring.

Initial append uses deterministic ID plus `INSERT ... ON CONFLICT DO NOTHING`; fetch compares canonical creation bytes/digest, returning replay only when identical, otherwise collision. Transition uses one transaction and `INSERT ... SELECT` from the expected tenant/candidate/revision where parent state is eligible and `NOT EXISTS` any child; SQL copies subject/scope, sets `revision=parent+1`, and the unique parent claim chooses one concurrent winner. Canonical length-prefixed serialization of command, full policy snapshot, and sorted evidence produces `command_digest`; same bytes replay the stored row, reused digest with unequal bytes is collision. Current view is rows with `NOT EXISTS` a child; therefore exactly one leaf exists and no UPDATE/DELETE is needed. The fake executes the identical checks in one serialized critical section; shared parity vectors cover all branches.

## Security, testing, rollout, and impact

Every read rejects empty tenant before access and predicates `company_id`; foreign data is not-found. Logs expose typed reason, IDs, policy ref, digest, and replay/conflict only—not content. Tests cover policy/conflict value and window boundaries, every explicit/authority guard and missing input, every authority unavailable reason, canonical scope and forged refs, zero/one/multiple/current/superseded/revoked proofs and window boundaries, actor/principal/command/capability/policy mismatches, atomic verification-proof write, app ordering/no-write failures, gold/decoy/equivalent-order/missing/veto, immutable provenance/rescoring, creation replay/collision, concurrency, malformed rows, isolation, and fake/PG parity. Company Bench supplies discipline only. Threat matrix: N/A—no routing/shell/process boundary.

| Files | Action |
|---|---|
| `packages/business-domain/src/{learning-candidate,promotion-evaluation}.ts`, `validation/promotion-observation.ts`, `promotion-scope.ts` + authority/scope tests | Create |
| `packages/business-domain/src/{index,ports/repositories,ports/fakes}.ts` | Modify |
| `packages/app/src/learning/evaluate.ts`, `app/src/worker/verify.ts` authority write owner, app tests | Create |
| `packages/database/src/learning-candidate-adapter.ts`, `promotion-authority-adapter.ts`, `sql/012_learning_candidates.sql`, `013_promotion_authority_proofs.sql`, PG tests | Create |
| `packages/database/src/{index,row-guards}.ts`, `packages/database/test/connection-fake.ts`, E2E migration list | Modify |

Migration is additive; policy retirement fails closed without rewriting history. Rollback removes unused modules/tables. Likely ≤400-line slices: domain; app/fake parity; PG/concurrency. Stage 4 remains out.

## Self-audit

Full proposal/spec audit: all seven requirements remain covered—immutable candidate plus complete provenance; deterministic tenant success-only aggregation; explicit unique policy with mandatory review conflicts; bounded typed evaluation with validated explicit/authority evidence; INSERT-only replay/concurrency; PG/fake validation parity and reproducible snapshots; quality controls and Stage-4 boundary. No numeric defaults, Memory OS, or Skill/worker/T1/event/materiality changes were introduced.
