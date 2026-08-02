import type { BusinessEvent, BusinessReceipt, Company, Delegation, Skill, Work } from '../types.js';
import type { HeartbeatCursor } from '../heartbeat.js';
import { ACTIONABLE_WORK_STATES } from '../transitions.js';
import type { HeartbeatCursorStore } from './cursors.js';
import type {
  IdempotencyJournalPort,
  JournalClaimResult,
  JournalEntry,
  NewJournalEntry,
} from './idempotency.js';
import { isUnresolvedJournalResult } from './idempotency.js';
import type {
  BusinessEventRepository,
  BusinessReceiptRepository,
  CasResult,
  CompanyRepository,
  DelegationRepository,
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

  async updateIfVersion(work: Work, expectedVersion: number): Promise<CasResult> {
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
    // The stored version matched `expectedVersion`, so the new stored version
    // is exactly `expectedVersion + 1` — NOT `work.version + 1`, which could be
    // stale (the caller may hold an old snapshot).
    const updated: Work = { ...work, version: expectedVersion + 1 };
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
      // mirrors the PostgreSQL adapter's uq_business_event_event_id.
      throw new Error(`BusinessEvent already recorded: ${event.eventId}`);
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
    const updated: JournalEntry = { ...entry, status: 'completed', resultJson };
    this.byAttempt.set(attemptId, updated);
    this.byKey.set(
      InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey),
      updated,
    );
  }

  async markRetryable(attemptId: string): Promise<void> {
    const entry = this.byAttempt.get(attemptId);
    if (entry === undefined) {
      throw new Error(`no journal entry for attempt: ${attemptId}`);
    }
    if (entry.status !== 'in_flight') {
      // Only an in-flight attempt can be marked retryable: a completed attempt
      // must never regress to a marker, and a marker is never re-marked.
      throw new Error(`attempt is not in_flight: ${attemptId} (status: ${entry.status})`);
    }
    const updated: JournalEntry = { ...entry, status: 'aborted_retryable', resultJson: undefined };
    this.byAttempt.set(attemptId, updated);
    this.byKey.set(
      InMemoryIdempotencyJournalRepository.keyOf(entry.companyId, entry.idempotencyKey),
      updated,
    );
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

  async markRetryable(attemptId: string): Promise<void> {
    await this.delegate.markRetryable(attemptId);
    this.persist();
  }

  private persist(): void {
    this.persistence.save(this.delegate.snapshot());
  }
}
