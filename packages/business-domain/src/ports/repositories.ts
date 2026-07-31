import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';

/**
 * Async, driver-free repository port interfaces for the four business-domain
 * aggregates. Each port has `save` (persist one record, return an immutable
 * view) and `get` (retrieve by ID + companyId or `undefined`). All methods
 * return a `Promise` — a real adapter is I/O-bound. These ports carry ZERO
 * persistence knowledge; a downstream adapter (PG, file, etc.) supplies the
 * implementation.
 *
 * Cross-aggregate references use neutral string IDs (D3) — no port imports
 * another aggregate's type. Business reads require companyId (tenant scope).
 */

export interface CompanyRepository {
  save(company: Company): Promise<Readonly<Company>>;
  get(companyId: string): Promise<Company | undefined>;
}

export interface DelegationRepository {
  save(delegation: Delegation): Promise<Readonly<Delegation>>;
  get(delegationId: string, companyId: string): Promise<Delegation | undefined>;
}

export interface WorkRepository {
  /** Initial insert only — transitions use {@link updateWithVersion}. */
  save(work: Work): Promise<Readonly<Work>>;
  get(workId: string, companyId: string): Promise<Work | undefined>;
  /**
   * Compare-and-set update: persists only when the row's version equals
   * `expectedVersion`, then increments version by one.
   */
  updateWithVersion(work: Work, expectedVersion: number): Promise<Readonly<Work>>;
}

export interface BusinessReceiptRepository {
  save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>>;
  get(receiptId: string, companyId: string): Promise<BusinessReceipt | undefined>;
}

/** Result of registering an idempotency attempt before a side effect. */
export type IdempotencyRegisterResult =
  | { readonly status: 'proceed' }
  | { readonly status: 'replay'; readonly result: unknown }
  | { readonly status: 'conflict' };

export interface IdempotencyStore {
  register(
    companyId: string,
    op: string,
    key: string,
    hash: string,
  ): Promise<IdempotencyRegisterResult>;
  complete(
    companyId: string,
    op: string,
    key: string,
    hash: string,
    result: unknown,
  ): Promise<void>;
}

/** Raised when CAS expectedVersion does not match the persisted row. */
export class VersionConflictError extends Error {
  constructor(message = 'version conflict') {
    super(message);
    this.name = 'VersionConflictError';
  }
}

/** Raised when a scoped row does not exist. */
export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Raised when the same idempotency key is reused with a different request hash. */
export class IdempotencyConflictError extends Error {
  constructor(message = 'idempotency key conflict') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}
