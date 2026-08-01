import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';

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
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined>;
}
