import type { BusinessEvent, BusinessReceipt, Company, Delegation, Skill, Work } from '../types.js';
import type { HeartbeatCursor } from '../heartbeat.js';
import type { LearningCandidate } from '../learning-candidate.js';
import { ACTIONABLE_WORK_STATES } from '../transitions.js';
import type { AuthorityUnavailableReason } from '../validation/promotion-observation.js';
import type { HeartbeatCursorStore } from './cursors.js';
import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  MarkRetryableResult,
  NewJournalEntry,
} from './idempotency.js';
import { isUnresolvedJournalResult } from './idempotency.js';
import type {
  AuthorityTransitionProof,
  BusinessEventRepository,
  BusinessReceiptRepository,
  CasResult,
  CompanyRepository,
  DelegationRepository,
  FencingDirective,
  LearningCandidateRepository,
  LearningCandidateTransition,
  PromotionAuthorityRepository,
  PromotionAuthorityResolution,
  PromotionAuthorityResolutionInput,
  SkillRepository,
  WorkRepository,
} from './repositories.js';

/**
 * In-memory fake adapters for the four business-domain repository ports.
 * Map-backed, immutable returns, NO database/network/daemon/framework. Usable as
 * unit-test doubles. Each fake stores records keyed by their ID and resolves
 * instantly — no external I/O.
 *
 * Tenant scoping (ADR-0002): every operation requires a mandatory, non-empty
 * `companyId`. `save` rejects a record with an empty `companyId`; the scoped
 * `get(companyId, id)` returns ONLY records belonging to that company — a
 * different company's record resolves to not-found (`undefined`) and an empty
 * `companyId` rejects. The {@link InMemoryBusinessReceiptRepository} also
 * enforces single-issuance (D5): a second `save` with an existing `receiptId`
 * is rejected, and a second receipt for the same `(workId, terminalEventId)`
 * pair is rejected even with a different `receiptId` — preserving the original
 * record, mirroring the 004 UNIQUE indexes.
 */

/** Reject any operation that does not carry a mandatory, non-empty companyId. */
function requireCompanyId(companyId: string): void {
  if (!companyId) {
    throw new Error('a non-empty companyId is required');
  }
}

export class InMemoryCompanyRepository implements CompanyRepository {
  private readonly entries = new Map<string, Company>();

  async save(company: Company): Promise<Readonly<Company>> {
    requireCompanyId(company.companyId);
    this.entries.set(company.companyId, company);
    return company;
  }

  async get(companyId: string): Promise<Company | undefined> {
    requireCompanyId(companyId);
    return this.entries.get(companyId);
  }
}

export class InMemoryDelegationRepository implements DelegationRepository {
  private readonly entries = new Map<string, Delegation>();

  async save(delegation: Delegation): Promise<Readonly<Delegation>> {
    requireCompanyId(delegation.companyId);
    this.entries.set(delegation.delegationId, delegation);
    return delegation;
  }

  async get(companyId: string, delegationId: string): Promise<Delegation | undefined> {
    requireCompanyId(companyId);
    const entry = this.entries.get(delegationId);
    return entry !== undefined && entry.companyId === companyId ? entry : undefined;
  }
}

export class InMemoryWorkRepository implements WorkRepository {
  private readonly entries = new Map<string, Work>();
  /** Recovery designation markers (workId → requested). Side store mirroring
   * `work.recovery_requested` (migration 011): the domain `Work` type stays
   * pure, so the marker lives here, not on the entity. */
  private readonly recoveryRequested = new Map<string, boolean>();

  async save(work: Work): Promise<Readonly<Work>> {
    requireCompanyId(work.companyId);
    if (this.entries.has(work.workId)) {
      // Insert-only (D4): creating a new Work is save()'s ONLY job. A second
      // save of the same workId mirrors the PG UNIQUE(work_id) rejection.
      throw new Error(`Work already exists: ${work.workId}`);
    }
    this.entries.set(work.workId, work);
    return work;
  }

  async get(companyId: string, workId: string): Promise<Work | undefined> {
    requireCompanyId(companyId);
    const entry = this.entries.get(workId);
    return entry !== undefined && entry.companyId === companyId ? entry : undefined;
  }

  async updateIfVersion(
    work: Work,
    expectedVersion: number,
    fencing?: FencingDirective,
  ): Promise<CasResult> {
    requireCompanyId(work.companyId);
    const current = this.entries.get(work.workId);
    if (current === undefined || current.companyId !== work.companyId) {
      // No stored work (or wrong tenant) to compare against: nothing to CAS.
      return { ok: false, reason: 'version-conflict' };
    }
    if (current.version !== expectedVersion) {
      // Stale writer: never overwrite; report the current work when available.
      return { ok: false, reason: 'version-conflict', current };
    }
    // Fencing (fencing-tokens change): a claim-owned TERMINAL close must also
    // match the stored claim token — a zombie writer (stale token) is a typed
    // fencing-conflict and the stored work is NEVER mutated.
    if (fencing?.kind === 'terminal' && current.fencingToken !== fencing.expectedFencingToken) {
      return { ok: false, reason: 'fencing-conflict', current };
    }
    // The stored version matched `expectedVersion`, so the new stored version
    // is exactly `expectedVersion + 1` — NOT `work.version + 1`, which could be
    // stale (the caller may hold an old snapshot). A claim directive mints the
    // NEXT server-side token atomically within the same CAS (epoch 0 → 1).
    const updated: Work =
      fencing?.kind === 'claim'
        ? { ...work, version: expectedVersion + 1, fencingToken: current.fencingToken + 1 }
        : { ...work, version: expectedVersion + 1 };
    this.entries.set(work.workId, updated);
    return { ok: true, value: updated };
  }

  async listActionableByCompany(companyId: string): Promise<readonly Work[]> {
    requireCompanyId(companyId);
    const actionable = ACTIONABLE_WORK_STATES as readonly string[];
    // Map iteration order == insertion order: the oldest accepted Work first
    // (the dispatch "oldest-first" queue). Tenant-scoped by companyId
    // (ADR-0002) — another company's Work is never returned.
    const result: Work[] = [];
    for (const work of this.entries.values()) {
      if (work.companyId === companyId && actionable.includes(work.state)) {
        result.push(work);
      }
    }
    return result;
  }

  /**
   * Recovery designation CAS (supervisor-recovery design D2): plain
   * expected-version CAS on the `recoveryRequested` MARKER (a side map — the
   * domain `Work` type stays pure). Bumps `version` N → N + 1 while `state`
   * and `fencingToken` stay UNCHANGED (no FencingDirective, no token mint) —
   * the version bump fences a stale-version zombie's terminal close. A stale
   * `expectedVersion` (or absent / wrong-tenant work) returns
   * `version-conflict` with the current work attached when available and NEVER
   * mutates the marker.
   */
  async setRecoveryRequest(
    companyId: string,
    workId: string,
    expectedVersion: number,
    requested: boolean,
  ): Promise<CasResult> {
    requireCompanyId(companyId);
    const current = this.entries.get(workId);
    if (current === undefined || current.companyId !== companyId) {
      // No stored work (or wrong tenant) to compare against: nothing to CAS.
      return { ok: false, reason: 'version-conflict' };
    }
    if (current.version !== expectedVersion) {
      // Stale writer: never overwrite; report the current work when available.
      return { ok: false, reason: 'version-conflict', current };
    }
    const updated: Work = { ...current, version: expectedVersion + 1 };
    this.entries.set(workId, updated);
    if (requested) {
      this.recoveryRequested.set(workId, true);
    } else {
      this.recoveryRequested.delete(workId);
    }
    return { ok: true, value: updated };
  }

  /**
   * Recovery designation discovery (supervisor-recovery design D2, migration
   * 011): partial-index semantics — ONLY `in_progress` Work whose marker is
   * set is returned, in insertion order (the oldest designated orphan first,
   * mirroring the PG `ORDER BY id ASC`). Tenant-scoped by companyId
   * (ADR-0002): another company's Work is never returned, and a designated
   * Work that left `in_progress` (terminal close) is invisible here.
   */
  async listRecoveryRequestedByCompany(companyId: string): Promise<readonly Work[]> {
    requireCompanyId(companyId);
    const result: Work[] = [];
    for (const work of this.entries.values()) {
      if (
        work.companyId === companyId &&
        work.state === 'in_progress' &&
        this.recoveryRequested.get(work.workId) === true
      ) {
        result.push(work);
      }
    }
    return result;
  }
}

export class InMemoryBusinessReceiptRepository implements BusinessReceiptRepository {
  private readonly entries = new Map<string, BusinessReceipt>();

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    requireCompanyId(receipt.companyId);
    if (this.entries.has(receipt.receiptId)) {
      throw new Error(`BusinessReceipt already issued: ${receipt.receiptId}`);
    }
    // Single terminal close per work (D5): a second receipt for the same
    // (workId, terminalEventId) pair MUST be rejected even with a different
    // receiptId — mirrors uq_receipt_work_terminal (004).
    for (const entry of this.entries.values()) {
      if (entry.workId === receipt.workId && entry.terminalEventId === receipt.terminalEventId) {
        throw new Error(
          `terminal event already closed work ${receipt.workId}: ${receipt.terminalEventId}`,
        );
      }
    }
    this.entries.set(receipt.receiptId, receipt);
    return receipt;
  }

  async get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined> {
    requireCompanyId(companyId);
    const entry = this.entries.get(receiptId);
    return entry !== undefined && entry.companyId === companyId ? entry : undefined;
  }
}

export class InMemoryBusinessEventRepository implements BusinessEventRepository {
  /**
   * Ordered array storage — insertion order IS read order, mirroring the
   * PostgreSQL adapter's `ORDER BY id ASC` (R3).
   */
  private readonly entries: BusinessEvent[] = [];

  async append(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    requireCompanyId(event.companyId);
    if (this.entries.some((entry) => entry.eventId === event.eventId)) {
      // Append-only, single-issuance (R7): an event is a write-once fact. A
      // duplicate eventId is rejected and the ORIGINAL event is preserved —
      // mirrors the PostgreSQL adapter's uq_business_event_event_id. This
      // covers the acceptor namespace too: `evt:acc:{workId}` is one-shot
      // (cold-start Atomic Acceptance Fact), so a duplicate append is an
      // integrity violation, not a retry.
      throw new Error(`BusinessEvent already recorded: ${event.eventId}`);
    }
    this.entries.push(event);
    return event;
  }

  async appendIfAbsent(event: BusinessEvent): Promise<Readonly<BusinessEvent>> {
    requireCompanyId(event.companyId);
    const existing = this.entries.find((entry) => entry.eventId === event.eventId);
    if (existing !== undefined) {
      if (event.source === 'acceptor') {
        // One-shot acceptor fact (cold-start Atomic Acceptance Fact): a
        // duplicate `evt:acc:{workId}` means a broken one-shot accept — it
        // THROWS instead of no-op'ing (the accept use case appends via the
        // throwing `append`, so a duplicate surfaces as a post-CAS failure
        // that rolls the shared transaction back). The at-most-once no-op is
        // preserved for every OTHER source (supervisor heartbeat etc.).
        throw new Error(`BusinessEvent already recorded: ${event.eventId}`);
      }
      // At-most-once (supervisor-timer): a duplicate conditional append no-ops
      // and returns the STORED ORIGINAL — never the input, never an overwrite.
      // Mirrors the PostgreSQL adapter's ON CONFLICT (event_id) DO NOTHING.
      return existing;
    }
    this.entries.push(event);
    return event;
  }

  async listByCompany(companyId: string): Promise<readonly BusinessEvent[]> {
    requireCompanyId(companyId);
    return this.entries.filter((entry) => entry.companyId === companyId);
  }

  async listCompanyIds(): Promise<readonly string[]> {
    // Read-only distinct discovery: insertion-first-seen order (the design's
    // fake parity for `SELECT DISTINCT company_id`), never mutating the log.
    const seen = new Set<string>();
    for (const entry of this.entries) {
      seen.add(entry.companyId);
    }
    return [...seen];
  }
}

/**
 * In-memory fake for the heartbeat cursor store port (supervisor-timer):
 * map-backed, immutable returns, atomic upsert, no I/O. Mirrors the 008
 * `heartbeat_cursor` table semantics: one checkpoint per company
 * (PRIMARY KEY company_id), upsert creates-or-replaces exactly that one row,
 * and a read for a company without a checkpoint resolves to `undefined`.
 * Not durable — restart/durability is demonstrated against live PG (Batch 2);
 * this fake covers the get/upsert decision logic.
 */
export class InMemoryHeartbeatCursorStore implements HeartbeatCursorStore {
  private readonly entries = new Map<string, HeartbeatCursor>();

  async get(companyId: string): Promise<HeartbeatCursor | undefined> {
    requireCompanyId(companyId);
    return this.entries.get(companyId);
  }

  async upsert(companyId: string, cursor: HeartbeatCursor): Promise<void> {
    requireCompanyId(companyId);
    // Atomic create-or-replace for THIS company only (008 ON CONFLICT parity).
    this.entries.set(companyId, cursor);
  }
}

export class InMemorySkillRepository implements SkillRepository {
  /**
   * Ordered array storage — insertion order IS versioned history (R3): a new
   * version is appended, never overwriting an existing entry. Mirrors the
   * PostgreSQL adapter's `ORDER BY id ASC` read order.
   */
  private readonly entries: Skill[] = [];

  async save(skill: Skill): Promise<Readonly<Skill>> {
    requireCompanyId(skill.companyId);
    if (
      this.entries.some(
        (entry) =>
          entry.companyId === skill.companyId &&
          entry.skillId === skill.skillId &&
          entry.version === skill.version,
      )
    ) {
      // Versioned append-only (R2/R7): a duplicate (companyId, skillId, version)
      // identity is rejected and the ORIGINAL entry is preserved — mirrors the
      // PostgreSQL adapter's uq_skill_company_skill_version UNIQUE constraint.
      throw new Error(
        `Skill already exists: ${skill.companyId}/${skill.skillId} v${skill.version}`,
      );
    }
    this.entries.push(skill);
    return skill;
  }

  async get(companyId: string, skillId: string): Promise<Skill | undefined> {
    requireCompanyId(companyId);
    // Tenant-scoped latest version (R2): newest version for the tenant+skillId,
    // or undefined when the tenant has no version of that skill.
    const tenantVersions = this.entries.filter(
      (entry) => entry.companyId === companyId && entry.skillId === skillId,
    );
    if (tenantVersions.length === 0) return undefined;
    return tenantVersions.reduce((latest, entry) =>
      entry.version > latest.version ? entry : latest,
    );
  }

  async listByCompany(companyId: string): Promise<readonly Skill[]> {
    requireCompanyId(companyId);
    return this.entries.filter((entry) => entry.companyId === companyId);
  }
}

type StoredLearningCandidate = Readonly<{ candidate: LearningCandidate; digest: string }>;

/**
 * In-memory fake for the LearningCandidate revision store (learning design
 * "INSERT-only persistence and concurrency"): mirrors the PostgreSQL
 * INSERT … SELECT semantics in one serialized critical section (the decision
 * block performs NO `await`, so racing callers never interleave inside it).
 *
 * - `appendInitial`: deterministic candidate identity + `ON CONFLICT DO
 *   NOTHING` — an equal digest replays; a divergent digest under a reused
 *   identity is an `idempotency-collision` that preserves the original.
 * - `appendTransition`: `INSERT … SELECT` from the expected revision with
 *   `NOT EXISTS` child — a parent that does not exist (or an over-advanced
 *   expected revision) is `stale`; an occupied parent claim with an equal
 *   digest replays; an occupied parent claim with a divergent digest is a
 *   `conflict` (the unique parent claim keeps ONE concurrent winner current).
 * - Reads return the current leaf (`getCurrent`) or every revision in
 *   ascending order (`listRevisions`); all operations are tenant-scoped and
 *   reject an empty `companyId` (ADR-0002/R8). INSERT-only: no update/delete.
 */
export class InMemoryLearningCandidateRepository implements LearningCandidateRepository {
  private readonly rows = new Map<string, StoredLearningCandidate[]>();

  private keyOf(companyId: string, candidateId: string): string {
    return `${companyId}\u0001${candidateId}`;
  }

  async appendInitial(
    candidate: LearningCandidate,
    commandDigest: string,
  ): Promise<'appended' | 'replayed' | 'idempotency-collision'> {
    requireCompanyId(candidate.companyId);
    if (candidate.revision !== 1) {
      throw new Error('appendInitial requires a revision-1 candidate');
    }
    if (!commandDigest) throw new Error('a non-empty command digest is required');
    const key = this.keyOf(candidate.companyId, candidate.candidateId);
    const revisions = this.rows.get(key);
    if (revisions === undefined) {
      this.rows.set(key, [{ candidate, digest: commandDigest }]);
      return 'appended';
    }
    const stored = revisions[0];
    return stored !== undefined && stored.digest === commandDigest
      ? 'replayed'
      : 'idempotency-collision';
  }

  async appendTransition(
    item: LearningCandidateTransition,
    commandDigest: string,
  ): Promise<'appended' | 'replayed' | 'stale' | 'conflict'> {
    requireCompanyId(item.companyId);
    if (!commandDigest) throw new Error('a non-empty command digest is required');
    const revisions = this.rows.get(this.keyOf(item.companyId, item.candidateId));
    if (revisions === undefined) return 'stale';
    if (item.expectedRevision < 1 || item.expectedRevision > revisions.length) return 'stale';
    const child = revisions[item.expectedRevision];
    if (item.expectedRevision < revisions.length) {
      // A child of the expected parent already exists: an equal digest replays
      // the converged transition; a divergent digest lost the parent claim.
      return child !== undefined && child.digest === commandDigest ? 'replayed' : 'conflict';
    }
    const parent = revisions[item.expectedRevision - 1]?.candidate;
    if (parent === undefined) return 'stale';
    const next: LearningCandidate = {
      ...parent,
      revision: parent.revision + 1,
      state: item.transition.toState,
      supersedesRevision: parent.revision,
      transition: { ...item.transition },
    };
    revisions.push({ candidate: next, digest: commandDigest });
    return 'appended';
  }

  async getCurrent(companyId: string, candidateId: string): Promise<LearningCandidate | undefined> {
    requireCompanyId(companyId);
    const revisions = this.rows.get(this.keyOf(companyId, candidateId));
    return revisions?.at(-1)?.candidate;
  }

  async listRevisions(
    companyId: string,
    candidateId: string,
  ): Promise<readonly LearningCandidate[]> {
    requireCompanyId(companyId);
    const revisions = this.rows.get(this.keyOf(companyId, candidateId));
    return (revisions ?? []).map((entry) => entry.candidate);
  }
}

/**
 * In-memory fake for the idempotency journal port (D6): map-backed, immutable
 * returns, no I/O. Mirrors the 004 table constraints: a second attempt for the
 * same (companyId, idempotencyKey) is rejected and a duplicate attemptId is
 * rejected (UNIQUE(company_id, idempotency_key) + UNIQUE(attempt_id)). Not
 * transactional — the atomic terminal close is demonstrated against live PG;
 * this fake covers the replay / DENY / in-flight decision logic.
 */
export class InMemoryIdempotencyJournalRepository implements IdempotencyJournalPort {
  private readonly byKey = new Map<string, JournalEntry>();
  private readonly byAttempt = new Map<string, JournalEntry>();

  private static keyOf(companyId: string, idempotencyKey: string): string {
    return `${companyId}\u0000${idempotencyKey}`;
  }

  async lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined> {
    requireCompanyId(companyId);
    if (!idempotencyKey) {
      throw new Error('a non-empty idempotencyKey is required');
    }
    const entry = this.byKey.get(
      InMemoryIdempotencyJournalRepository.keyOf(companyId, idempotencyKey),
    );
    if (entry === undefined) return undefined;
    // PG-parity (D7, F1/F4): the journal legitimately stores the NON-Work
    // UNRESOLVED_REQUIRES_HUMAN sentinel (finalize T2(ii)); pass it through
    // unguarded, exactly as the PG adapter does — via the SAME shared
    // isUnresolvedJournalResult recognizer, so the fake and PG cannot diverge on
    // the sentinel shape. The Work-parse guard itself stays in the PG adapter
    // (business-domain cannot import parseWorkRow without a forbidden coupling);
    // the PG integration suite is the authoritative corrupt-Work parity guarantee.
    if (entry.resultJson !== undefined && isUnresolvedJournalResult(entry.resultJson)) {
      return { ...entry, resultJson: entry.resultJson };
    }
    return entry;
  }

  async insertInFlight(entry: NewJournalEntry): Promise<JournalClaimResult> {
    requireCompanyId(entry.companyId);
    if (!entry.idempotencyKey) {
      throw new Error('a non-empty idempotencyKey is required');
    }
    if (!entry.requestHash) {
      throw new Error('a non-empty requestHash is required');
    }
    if (!entry.attemptId) {
      throw new Error('a non-empty attemptId is required');
    }
    const key = InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      // Mirrors UNIQUE(company_id, idempotency_key): one attempt per key.
      // EXCEPTION (design §Journal Port Change): a row marked aborted_retryable
      // with the SAME request hash reopens the attempt (controlled retry) —
      // status → in_flight, the ORIGINAL attemptId is kept (a receipt was never
      // issued on the prior CAS loss, and the att: scheme is stable), resultJson
      // is cleared. A different hash under the marker is a DENY conflict; any
      // other existing status (in_flight | completed) is a LOST CLAIM — a typed
      // attempt-in-flight result (a same-key race loser), never a thrown error.
      if (existing.status !== 'aborted_retryable') {
        return { ok: false, reason: 'attempt-in-flight' };
      }
      if (existing.requestHash !== entry.requestHash) {
        throw new Error(
          `idempotency conflict: request hash differs for retryable attempt: ${entry.idempotencyKey}`,
        );
      }
      const reopened: JournalEntry = { ...existing, status: 'in_flight', resultJson: undefined };
      this.byKey.set(key, reopened);
      this.byAttempt.set(existing.attemptId, reopened);
      return { ok: true };
    }
    if (this.byAttempt.has(entry.attemptId)) {
      // Mirrors UNIQUE(attempt_id): one row per attempt — a duplicate attempt id
      // is a lost claim (typed result), never a thrown error.
      return { ok: false, reason: 'attempt-in-flight' };
    }
    // The claim token rides on the row via the spread (NewJournalEntry now
    // REQUIRES fencingToken — the fake stores it pre-effect, mirroring the PG
    // column). Token 0 (the epoch) is valid for unclaimed/legacy rows.
    const row: JournalEntry = { ...entry, status: 'in_flight' };
    this.byKey.set(key, row);
    this.byAttempt.set(entry.attemptId, row);
    return { ok: true };
  }

  async complete(attemptId: string, resultJson: unknown): Promise<void> {
    const entry = this.byAttempt.get(attemptId);
    if (entry === undefined) {
      throw new Error(`no journal entry for attempt: ${attemptId}`);
    }
    if (entry.status !== 'in_flight') {
      // Status guard (fencing-tokens spec): complete transitions ONLY an
      // in_flight row — a completed row must never re-complete, and a marker
      // must never regress to a completion. Rejected without mutation. Token-
      // FREE by contract: the honest T2(ii) UNRESOLVED close needs no token.
      throw new Error(`attempt is not in_flight: ${attemptId} (status: ${entry.status})`);
    }
    const updated: JournalEntry = { ...entry, status: 'completed', resultJson };
    this.byAttempt.set(attemptId, updated);
    this.byKey.set(
      InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey),
      updated,
    );
  }

  async markRetryable(attemptId: string, fencingToken: number): Promise<MarkRetryableResult> {
    const entry = this.byAttempt.get(attemptId);
    if (entry === undefined) {
      // Missing attempt: a TYPED refusal (spec "Stale token cannot mark
      // retryable" — a typed failure value, never a thrown rejection), with no
      // row to report. Mirrors the PG adapter's 0-row result.
      return { ok: false, reason: 'stale-token' };
    }
    if (entry.status !== 'in_flight') {
      // Only an in-flight attempt can be marked retryable: a completed attempt
      // must never regress to a marker, and a marker is never re-marked. Typed
      // refusal with the stored row attached (PG-parity: 0-row → stale-token).
      return { ok: false, reason: 'stale-token', current: entry };
    }
    if (entry.fencingToken !== fencingToken) {
      // Claim-ownership gate (fencing-tokens spec, "Stale token cannot mark
      // retryable"): the marker write is OWNED by the claim. A stale holder
      // (zombie) supplies a token that no longer owns the row — refused as a
      // TYPED failure WITHOUT mutation, exactly like the PG adapter's AND
      // fencing_token=$5 zero-row result.
      return { ok: false, reason: 'stale-token', current: entry };
    }
    const updated: JournalEntry = { ...entry, status: 'aborted_retryable', resultJson: undefined };
    this.byAttempt.set(attemptId, updated);
    this.byKey.set(
      InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey),
      updated,
    );
    return { ok: true };
  }

  /**
   * Snapshot every stored row (durable-fake persistence hook — pure map logic,
   * zero I/O). Restore with {@link restoreSnapshot}.
   */
  snapshot(): readonly JournalEntry[] {
    return [...this.byAttempt.values()];
  }

  /** Replace the stored state from a snapshot (durable-fake restart). */
  restoreSnapshot(entries: readonly JournalEntry[]): void {
    this.byKey.clear();
    this.byAttempt.clear();
    for (const entry of entries) {
      this.byAttempt.set(entry.attemptId, entry);
      this.byKey.set(
        InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey),
        entry,
      );
    }
  }
}

/**
 * Persistence seam for {@link DurableJournalFake} — injected so the fake stays
 * pure (zero infra imports, all map logic). A JSON-file-backed implementation
 * is supplied by the app/test layer (à la `DurableSandboxFake`'s
 * durabilityPath); live-PostgreSQL durability is proven in Slice C.
 */
export interface JournalFakePersistence {
  /** Every persisted journal row, or [] when nothing has been persisted. */
  load(): readonly JournalEntry[];
  /** Persist ALL rows (full-state snapshot). */
  save(entries: readonly JournalEntry[]): void;
}

/**
 * JSON-durable journal fake for restart tests (acceptance note 3): wraps
 * {@link InMemoryIdempotencyJournalRepository} (same status domain, markRetryable
 * and reopen logic) and persists a full-state snapshot through the injected
 * {@link JournalFakePersistence} after every mutation. A fresh instance over the
 * same persistence simulates a process restart — the rows survive.
 */
export class DurableJournalFake implements IdempotencyJournalPort {
  private readonly delegate: InMemoryIdempotencyJournalRepository;

  constructor(private readonly persistence: JournalFakePersistence) {
    this.delegate = new InMemoryIdempotencyJournalRepository();
    this.delegate.restoreSnapshot(persistence.load());
  }

  async lookup(companyId: string, idempotencyKey: string): Promise<JournalEntry | undefined> {
    return this.delegate.lookup(companyId, idempotencyKey);
  }

  async insertInFlight(entry: NewJournalEntry): Promise<JournalClaimResult> {
    const claim = await this.delegate.insertInFlight(entry);
    this.persist();
    return claim;
  }

  async complete(attemptId: string, resultJson: unknown): Promise<void> {
    await this.delegate.complete(attemptId, resultJson);
    this.persist();
  }

  async markRetryable(attemptId: string, fencingToken: number): Promise<MarkRetryableResult> {
    const result = await this.delegate.markRetryable(attemptId, fencingToken);
    // Persist ONLY on success — a typed stale-token refusal mutates nothing.
    if (result.ok) this.persist();
    return result;
  }

  private persist(): void {
    this.persistence.save(this.delegate.snapshot());
  }
}
type StoredAuthorityProof = Omit<AuthorityTransitionProof, 'current'>;

/** Serializable snapshot of one authority-fake instance (DurableJournalFake
 * precedent): used to simulate restarts and transactional rollback recovery. */
export interface PromotionAuthorityFakeSnapshot {
  readonly rows: readonly {
    readonly companyId: string;
    readonly proofId: string;
    readonly proofRevision: number;
    readonly proof: StoredAuthorityProof;
  }[];
}

const PROOF_STRING_FIELDS = [
  'proofId',
  'transitionId',
  'actorId',
  'principalId',
  'delegationId',
  'grantId',
  'scope',
] as const;

function sameProof(a: StoredAuthorityProof, b: StoredAuthorityProof): boolean {
  const scalars = [
    a.proofRevision === b.proofRevision,
    a.transitionRevision === b.transitionRevision,
    a.companyId === b.companyId,
    a.issuedAt === b.issuedAt,
    a.effectiveFrom === b.effectiveFrom,
    a.expiry === b.expiry,
    a.revoked === b.revoked,
    a.revocationVersion === b.revocationVersion,
    a.command === b.command,
    a.capability === b.capability,
    a.kind === b.kind,
    a.subject.skillId === b.subject.skillId,
    a.subject.skillVersion === b.subject.skillVersion,
    a.policyRef.policyId === b.policyRef.policyId,
    a.policyRef.version === b.policyRef.version,
    (a.supersedesProofRevision ?? 0) === (b.supersedesProofRevision ?? 0),
  ];
  return scalars.every(Boolean) && PROOF_STRING_FIELDS.every((field) => a[field] === b[field]);
}

function proofFieldGuards(p: StoredAuthorityProof): string | undefined {
  if (PROOF_STRING_FIELDS.some((field) => typeof p[field] !== 'string' || p[field] === ''))
    return 'identity fields must be non-empty strings';
  if (typeof p.subject?.skillId !== 'string' || p.subject.skillId === '')
    return 'subject.skillId must be a non-empty string';
  if (!Number.isInteger(p.subject?.skillVersion) || p.subject.skillVersion < 1)
    return 'subject.skillVersion must be a positive integer';
  return undefined;
}

/**
 * In-memory fake for the PromotionAuthority repository (learning design
 * "Authority contract and durable source"): append-only proof store — PK
 * `(companyId, proofId, proofRevision)` plus a per-tenant UNIQUE transition
 * identity (a superseding revision of the SAME proof chain is exempt — self-FK
 * supersede); revocation is a superseding revision with `revoked: true`.
 * `resolve` derives current leaves, then validates in order: binding
 * (_foreign), revocation (_revoked), command/capability (_command-mismatch),
 * actor/principal (_principal-mismatch), policy (_policy-mismatch), canonical
 * scope (_foreign), issuedAt (_stale), and the fresh active Delegation
 * (grant/delegate/action/scope/window clamp; _proof-unavailable for an
 * unresolvable backing). Zero rows → _missing; several leaves → _ambiguous.
 * Fail closed without a delegation backing. INSERT-only.
 */
export class InMemoryPromotionAuthorityRepository implements PromotionAuthorityRepository {
  private readonly rows = new Map<string, Map<number, StoredAuthorityProof>>();

  constructor(private readonly options: { readonly delegation?: DelegationRepository } = {}) {}

  private keyOf(companyId: string, proofId: string): string {
    return `${companyId}\u0001${proofId}`;
  }

  async appendProof(proof: StoredAuthorityProof): Promise<'appended' | 'replayed' | 'conflict'> {
    requireCompanyId(proof.companyId);
    const guard = proofFieldGuards(proof);
    if (guard !== undefined) throw new Error(`appendProof: ${guard}`);
    if (!Number.isInteger(proof.proofRevision) || proof.proofRevision < 1)
      throw new Error('appendProof: proofRevision must be a positive integer');
    if (!Number.isInteger(proof.transitionRevision) || proof.transitionRevision < 1)
      throw new Error('appendProof: transitionRevision must be a positive integer');
    if (
      !Number.isFinite(proof.issuedAt) ||
      !Number.isFinite(proof.effectiveFrom) ||
      !Number.isFinite(proof.expiry)
    )
      throw new Error('appendProof: times must be finite');
    if (proof.effectiveFrom >= proof.expiry)
      throw new Error('appendProof: effectiveFrom must precede expiry');
    if (typeof proof.revoked !== 'boolean')
      throw new Error('appendProof: revoked must be a boolean');
    if (!Number.isInteger(proof.revocationVersion) || proof.revocationVersion < 0)
      throw new Error('appendProof: revocationVersion must be a non-negative integer');
    if (!Number.isInteger(proof.policyRef?.version) || proof.policyRef.version < 1)
      throw new Error('appendProof: policyRef.version must be a positive integer');
    const supersedes = proof.supersedesProofRevision;
    if (supersedes !== undefined) {
      if (!Number.isInteger(supersedes) || supersedes < 1 || supersedes >= proof.proofRevision)
        throw new Error('appendProof: supersedesProofRevision must be a positive earlier revision');
      const chain = this.rows.get(this.keyOf(proof.companyId, proof.proofId));
      if (chain === undefined || !chain.has(supersedes))
        throw new Error('appendProof: supersedes target revision does not exist');
    }
    const key = this.keyOf(proof.companyId, proof.proofId);
    const chain = this.rows.get(key) ?? new Map<number, StoredAuthorityProof>();
    const existing = chain.get(proof.proofRevision);
    if (existing !== undefined) return sameProof(existing, proof) ? 'replayed' : 'conflict';
    for (const [otherKey, otherChain] of this.rows) {
      if (otherKey.split('\u0001')[0] !== proof.companyId) continue;
      // Superseding revisions of the SAME proof chain share the transition
      // identity (self-FK supersede); only a DIFFERENT proof claim conflicts.
      if (otherKey.split('\u0001')[1] === proof.proofId) continue;
      for (const other of otherChain.values()) {
        if (
          other.transitionId === proof.transitionId &&
          other.transitionRevision === proof.transitionRevision
        )
          return 'conflict';
      }
    }
    chain.set(proof.proofRevision, proof);
    this.rows.set(key, chain);
    return 'appended';
  }

  async resolve(input: PromotionAuthorityResolutionInput): Promise<PromotionAuthorityResolution> {
    requireCompanyId(input.companyId);
    const chain = this.rows.get(this.keyOf(input.companyId, input.sourceRef));
    if (chain === undefined) return { kind: 'unavailable', reason: 'authority-missing' };
    const leaves = [...chain.values()].filter(
      (row) =>
        ![...chain.values()].some((other) => other.supersedesProofRevision === row.proofRevision),
    );
    if (leaves.length !== 1) return { kind: 'unavailable', reason: 'authority-ambiguous' };
    const leaf = leaves[0];
    if (leaf === undefined) return { kind: 'unavailable', reason: 'authority-missing' };
    const fail = (reason: AuthorityUnavailableReason): PromotionAuthorityResolution => ({
      kind: 'unavailable',
      reason,
    });
    if (
      leaf.companyId !== input.companyId ||
      leaf.subject.skillId !== input.subject.skillId ||
      leaf.subject.skillVersion !== input.subject.skillVersion
    )
      return fail('authority-foreign');
    if (leaf.revoked) return fail('authority-revoked');
    if (leaf.command !== input.command || leaf.capability !== input.capability)
      return fail('authority-command-mismatch');
    if (leaf.actorId !== input.expectedActorId || leaf.principalId !== input.expectedPrincipalId)
      return fail('authority-principal-mismatch');
    if (
      leaf.policyRef.policyId !== input.policyRef.policyId ||
      leaf.policyRef.version !== input.policyRef.version
    )
      return fail('authority-policy-mismatch');
    if (leaf.scope !== input.scope) return fail('authority-foreign');
    if (leaf.issuedAt > input.at) return fail('authority-stale');
    if (input.at < leaf.effectiveFrom || input.at >= leaf.expiry) return fail('authority-stale');
    const delegationRepository = this.options.delegation;
    if (delegationRepository === undefined) return fail('authority-proof-unavailable');
    const delegation = await delegationRepository.get(input.companyId, leaf.delegationId);
    if (delegation === undefined) return fail('authority-proof-unavailable');
    if (leaf.grantId !== delegation.delegationId) return fail('authority-proof-unavailable');
    if (delegation.state !== 'active') return fail('authority-proof-unavailable');
    if (leaf.principalId !== delegation.delegate) return fail('authority-principal-mismatch');
    if (!delegation.authorityScope.actions.includes('learning.promote'))
      return fail('authority-command-mismatch');
    if (delegation.authorityScope.scope !== leaf.scope) return fail('authority-foreign');
    const effectiveFrom = Math.max(leaf.effectiveFrom, delegation.validFrom);
    const expiry = Math.min(leaf.expiry, delegation.validUntil);
    if (input.at < effectiveFrom || input.at >= expiry) return fail('authority-stale');
    return { kind: 'resolved', value: { ...leaf, current: true } };
  }

  takeSnapshot(): PromotionAuthorityFakeSnapshot {
    const rows: PromotionAuthorityFakeSnapshot['rows'][number][] = [];
    for (const [key, chain] of this.rows) {
      const [companyId, proofId] = key.split('\u0001');
      for (const [proofRevision, proof] of chain) {
        rows.push({ companyId: companyId ?? '', proofId: proofId ?? '', proofRevision, proof });
      }
    }
    return { rows };
  }

  restoreSnapshot(snapshot: PromotionAuthorityFakeSnapshot): void {
    this.rows.clear();
    for (const row of snapshot.rows) {
      const key = this.keyOf(row.companyId, row.proofId);
      const chain = this.rows.get(key) ?? new Map<number, StoredAuthorityProof>();
      chain.set(row.proofRevision, row.proof);
      this.rows.set(key, chain);
    }
  }
}
