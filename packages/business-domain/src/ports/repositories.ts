import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';

/**
 * Async, driver-free repository port interfaces for the four business-domain
 * aggregates. Each port has `save` (persist one record, return an immutable
 * view) and `get` (retrieve by ID or `undefined`). All methods return a
 * `Promise` — a real adapter is I/O-bound. These ports carry ZERO persistence
 * knowledge; a downstream adapter (PG, file, etc.) supplies the implementation.
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
  get(delegationId: string): Promise<Delegation | undefined>;
}

export interface WorkRepository {
  save(work: Work): Promise<Readonly<Work>>;
  get(workId: string): Promise<Work | undefined>;
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(receiptId: string): Promise<BusinessReceipt | undefined>;
}
