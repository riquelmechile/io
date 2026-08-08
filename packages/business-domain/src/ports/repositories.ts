import type { BusinessEvent, BusinessReceipt, Company, Delegation, Skill, Work } from '../types.js';

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
 * `{ ok: false; reason: 'version-conflict'; current? }` when it did NOT match —
 * the stored work is left UNCHANGED and `current` carries it when available.
 * No last-write-wins overwrite ever occurs.
 */
export type CasResult =
  | { ok: true; value: Work }
  | { ok: false; reason: 'version-conflict'; current?: Work };

export interface WorkRepository {
  /** Insert-only: creates a NEW work. Not the state-change path for an existing work. */
  save(work: Work): Promise<Readonly<Work>>;
  get(companyId: string, workId: string): Promise<Work | undefined>;
  /**
   * Compare-and-swap update (D4): writes ONLY when `expectedVersion` matches
   * the stored `version`, bumping it to `version + 1` on success. A mismatch
   * returns `{ ok: false, reason: 'version-conflict', current? }` and NEVER
   * overwrites the stored work.
   */
  updateIfVersion(work: Work, expectedVersion: number): Promise<CasResult>;
  /**
   * Tenant-scoped actionable read (work-lifecycle delta): the company's Work in
   * the states declared by `ACTIONABLE_WORK_STATES` (currently only `accepted`),
   * in INSERTION order — the dispatch "oldest first" queue. An empty
   * `companyId` MUST be rejected BEFORE any storage read (ADR-0002/R8), and the
   * result MUST never include another company's Work.
   */
  listActionableByCompany(companyId: string): Promise<readonly Work[]>;
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
