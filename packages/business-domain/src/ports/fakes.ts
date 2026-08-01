import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';
import type {
  BusinessReceiptRepository,
  CompanyRepository,
  DelegationRepository,
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
 * enforces single-issuance: a second `save` with an existing `receiptId` is
 * rejected, preserving the original record.
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
    this.entries.set(work.workId, work);
    return work;
  }

  async get(companyId: string, workId: string): Promise<Work | undefined> {
    requireCompanyId(companyId);
    const entry = this.entries.get(workId);
    return entry !== undefined && entry.companyId === companyId ? entry : undefined;
  }
}

export class InMemoryBusinessReceiptRepository implements BusinessReceiptRepository {
  private readonly entries = new Map<string, BusinessReceipt>();

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    requireCompanyId(receipt.companyId);
    if (this.entries.has(receipt.receiptId)) {
      throw new Error(`BusinessReceipt already issued: ${receipt.receiptId}`);
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
