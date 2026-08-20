import type { BusinessEvent, BusinessReceipt, Company, Delegation, Skill, Work } from '../types.js';
import type {
  LearningCandidate,
  LearningSubject,
  TransitionEvidence,
} from '../learning-candidate.js';
import type { PolicyRef } from '../promotion-evaluation.js';
import type { AuthorityUnavailableReason } from '../validation/promotion-observation.js';

/**
 * Async, driver-free repository port interfaces for the four business-domain
 * aggregates. Each port has `save` (persist one record, return an immutable
 * view) and `get` (scoped retrieve by tenant `companyId` + record ID, or
 * `undefined`). Every business operation and lookup MUST be scoped by a
 * mandatory, non-empty `companyId` (ADR-0002): a scoped get returns ONLY
 * entities belonging to the requested company; a different company's entity
 * resolves to not-found, and an empty `companyId` MUST be rejected. All methods
 * return a `Promise` — a real adapter is I/O-bound. These ports carry ZERO
 * persistence knowledge; a downstream adapter (PG, file, etc.) supplies the
 * implementation.
 *
 * Cross-aggregate references use neutral string IDs (D3) — no port imports
 * another aggregate's type.
 */

export interface CompanyRepository {
  save(company: Company): Promise<Readonly<Company>>;
  get(companyId: string): Promise<Company | undefined>;
}

export interface DelegationRepository {
  save(delegation: Delegation): Promise<Readonly<Delegation>>;
  get(companyId: string, delegationId: string): Promise<Delegation | undefined>;
}

/**
 * Result of a compare-and-swap write (ADR-0002/D4): `{ ok: true; value }` when
 * the expected version matched and the write succeeded (version bumped +1), or
 * `{ ok: false; reason: 'version-conflict' | 'fencing-conflict'; current? }`
 * when it did NOT match — the stored work is left UNCHANGED and `current`
 * carries it when available. `version-conflict` = stale expected version (a
 * concurrent transition won); `fencing-conflict` = the version matched but a
 * claim-owned terminal close supplied a token that does not own the work
 * (zombie writer). Both route to the same T2 reconciliation; the distinct
 * reason diagnoses zombie vs race. No last-write-wins overwrite ever occurs.
 */
export type CasResult =
  | { ok: true; value: Work }
  | {
      ok: false;
      reason: 'version-conflict' | 'fencing-conflict';
      current?: Work;
    };

/**
 * Claim-scoped fencing directive for the Work CAS (fencing-tokens change,
 * design "Work CAS evolution"): `updateIfVersion` MAY receive one to mint or
 * check claim ownership atomically within the SAME compare-and-swap.
 *
 * - `{ kind: 'claim' }` — a fresh claim: the adapter/fake mints the NEXT
 *   server-side token (`fencing_token = fencing_token + 1`), atomically in the
 *   same statement, and returns it on the updated Work.
 * - `{ kind: 'terminal', expectedFencingToken }` — a claim-owned terminal
 *   close: the CAS MUST also match the stored fencing token. A token mismatch
 *   leaves Work unchanged and returns the typed `'fencing-conflict'`.
 *
 * Absent ⇒ version-only CAS (plain transitions / admin closes are unaffected —
 * the pre-fencing epoch token 0 is inert).
 */
export type FencingDirective =
  | { readonly kind: 'claim' }
  | { readonly kind: 'terminal'; readonly expectedFencingToken: number };

export interface WorkRepository {
  /** Insert-only: creates a NEW work. Not the state-change path for an existing work. */
  save(work: Work): Promise<Readonly<Work>>;
  get(companyId: string, workId: string): Promise<Work | undefined>;
  /**
   * Compare-and-swap update (D4): writes ONLY when `expectedVersion` matches
   * the stored `version`, bumping it to `version + 1` on success. A mismatch
   * returns `{ ok: false, reason: 'version-conflict', current? }` and NEVER
   * overwrites the stored work. When a {@link FencingDirective} is supplied,
   * the CAS additionally mints (claim) or checks (terminal) the claim-scoped
   * fencing token in the SAME atomic statement (fencing-tokens change).
   */
  updateIfVersion(
    work: Work,
    expectedVersion: number,
    fencing?: FencingDirective,
  ): Promise<CasResult>;
  /**
   * Tenant-scoped actionable read (work-lifecycle delta): the company's Work in
   * the states declared by `ACTIONABLE_WORK_STATES` (currently only `accepted`),
   * in INSERTION order — the dispatch "oldest first" queue. An empty
   * `companyId` MUST be rejected BEFORE any storage read (ADR-0002/R8), and the
   * result MUST never include another company's Work.
   */
  listActionableByCompany(companyId: string): Promise<readonly Work[]>;
  /**
   * Plain CAS designation marker (supervisor-recovery design D2): sets/clears
   * the `recovery_requested` marker with expected-version CAS — `version` bumps
   * N → N + 1 while `state` and `fencing_token` stay UNCHANGED (no
   * {@link FencingDirective}, no token mint). The version bump is the fencing:
   * a zombie worker holding the stale version fails its terminal CAS once the
   * stored version advances. A stale `expectedVersion` returns
   * `{ ok: false, reason: 'version-conflict', current? }` and NEVER overwrites.
   * The marker is repository metadata: the returned `Work` never carries it
   * (the domain `Work` type stays pure).
   */
  setRecoveryRequest(
    companyId: string,
    workId: string,
    expectedVersion: number,
    requested: boolean,
  ): Promise<CasResult>;
  /**
   * Operator recovery designation discovery (supervisor-recovery design D2,
   * migration 011): tenant-scoped list of the company's DESIGNATED `in_progress`
   * Work — exactly the partial-index predicate
   * `idx_work_recovery_requested` (`WHERE recovery_requested AND
   * state='in_progress'`) covers. A designated Work that leaves `in_progress`
   * (terminal close) drops out of discovery by construction. An empty
   * `companyId` MUST be rejected BEFORE any storage read (ADR-0002/R8).
   */
  listRecoveryRequestedByCompany(companyId: string): Promise<readonly Work[]>;
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined>;
}

/**
 * Append-only repository for business facts (R2): events are WRITE-ONCE records
 * of what happened. The surface is deliberately limited to the two append
 * semantics and read-only listings — NO update, delete, overwrite, or get-by-id;
 * a fact is never mutated. Every scoped read MUST be guarded by a mandatory,
 * non-empty `companyId` (ADR-0002/R8) and MUST NOT return another company's
 * events. Methods return a `Promise` — a real adapter is I/O-bound. The port
 * carries ZERO persistence knowledge; a downstream adapter supplies the
 * implementation.
 */
export interface BusinessEventRepository {
  /**
   * Throwing insert (R7): persists ONE event and returns an immutable view. A
   * duplicate `eventId` (single issuance) is REJECTED — the ORIGINAL event is
   * preserved and the call throws (worker `evt:{attemptId}` emission).
   */
  append(event: BusinessEvent): Promise<Readonly<BusinessEvent>>;
  /**
   * At-most-once conditional append (supervisor `heartbeat.decision`): inserts
   * the event UNLESS an event with the same `eventId` already exists. A
   * duplicate NO-OPs and resolves the STORED ORIGINAL (never the input, never
   * an overwrite) — a retry with the same unadvanced cursor rebuilds the same
   * id and exactly one original row remains.
   */
  appendIfAbsent(event: BusinessEvent): Promise<Readonly<BusinessEvent>>;
  listByCompany(companyId: string): Promise<readonly BusinessEvent[]>;
  /** Read-only distinct company discovery (supervisor-timer): each company
   * appears exactly once, in insertion-first-seen order; never mutates events. */
  listCompanyIds(): Promise<readonly string[]>;
}

/**
 * Versioned, append-only repository for Skills (R2): `save` appends a NEW
 * version and rejects a duplicate `(companyId, skillId, version)` identity
 * WITHOUT altering the original (a new version is a new record — never an
 * overwrite). The surface is deliberately limited to append-`save`,
 * tenant-scoped latest-version `get`, and tenant-scoped `listByCompany` of ALL
 * persisted versions. There is NO update, delete, or overwrite operation. Every
 * read MUST be scoped by a mandatory, non-empty `companyId` (ADR-0002/R7) and
 * MUST NOT return another company's Skills. Methods return a `Promise` — a real
 * adapter is I/O-bound. The port carries ZERO persistence knowledge; a
 * downstream adapter (PG, file, etc.) supplies the implementation.
 */
export interface SkillRepository {
  /** Append a NEW version; a duplicate (companyId, skillId, version) fails. */
  save(skill: Skill): Promise<Readonly<Skill>>;
  /** Latest version for the tenant+skillId, or undefined when none exists. */
  get(companyId: string, skillId: string): Promise<Skill | undefined>;
  /** All persisted versions for the tenant, ordered by insertion. */
  listByCompany(companyId: string): Promise<readonly Skill[]>;
}

/**
 * Append-only LearningCandidate revision store (learning design "INSERT-only
 * persistence and concurrency"): deterministic append of the initial revision
 * and of superseding transitions; typed results
 * `appended|replayed|stale|conflict|idempotency-collision`; tenant-scoped
 * current-leaf read and full revision listing. NO update or delete exists.
 */
export type LearningCandidateAppendResult =
  | 'appended'
  | 'replayed'
  | 'stale'
  | 'conflict'
  | 'idempotency-collision';

export interface LearningCandidateTransition {
  readonly companyId: string;
  readonly candidateId: string;
  /** The exact parent revision this transition supersedes. */
  readonly expectedRevision: number;
  readonly transition: TransitionEvidence;
}

export interface LearningCandidateRepository {
  appendInitial(
    candidate: LearningCandidate,
    commandDigest: string,
  ): Promise<LearningCandidateAppendResult>;
  appendTransition(
    item: LearningCandidateTransition,
    commandDigest: string,
  ): Promise<LearningCandidateAppendResult>;
  getCurrent(companyId: string, candidateId: string): Promise<LearningCandidate | undefined>;
  listRevisions(companyId: string, candidateId: string): Promise<readonly LearningCandidate[]>;
}

/**
 * Current verification proof for the `learning.promote` command (learning
 * design "Authority contract and durable source"): one current leaf bound to
 * tenant, subject, principals, delegation, policy, scope, and validity window.
 * Repository-resolved — a caller never supplies it directly.
 */
export interface AuthorityTransitionProof {
  readonly proofId: string;
  readonly proofRevision: number;
  readonly transitionId: string;
  readonly transitionRevision: number;
  readonly supersedesProofRevision?: number;
  readonly current: true;
  readonly kind: 'verification';
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly actorId: string;
  readonly principalId: string;
  readonly delegationId: string;
  readonly grantId: string;
  readonly command: 'learning.promote';
  readonly capability: 'learning.promote';
  readonly scope: string;
  readonly policyRef: PolicyRef;
  readonly issuedAt: number;
  readonly effectiveFrom: number;
  readonly expiry: number;
  readonly revoked: boolean;
  readonly revocationVersion: number;
}

export type PromotionAuthorityAppendResult = 'appended' | 'replayed' | 'conflict';

export interface PromotionAuthorityResolutionInput {
  readonly sourceRef: string;
  readonly companyId: string;
  readonly subject: LearningSubject;
  readonly policyRef: PolicyRef;
  readonly at: number;
  readonly expectedPrincipalId: string;
  readonly expectedActorId: string;
  readonly command: 'learning.promote';
  readonly capability: 'learning.promote';
  readonly scope: string;
}

export type PromotionAuthorityResolution =
  | { readonly kind: 'resolved'; readonly value: AuthorityTransitionProof }
  | { readonly kind: 'unavailable'; readonly reason: AuthorityUnavailableReason };

export interface PromotionAuthorityRepository {
  appendProof(
    proof: Omit<AuthorityTransitionProof, 'current'>,
  ): Promise<PromotionAuthorityAppendResult>;
  resolve(input: PromotionAuthorityResolutionInput): Promise<PromotionAuthorityResolution>;
}
