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

export interface WorkRepository {
  save(work: Work): Promise<Readonly<Work>>;
  get(companyId: string, workId: string): Promise<Work | undefined>;
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(companyId: string, receiptId: string): Promise<BusinessReceipt | undefined>;
}
