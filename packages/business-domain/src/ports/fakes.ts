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
 * instantly — no external I/O. The {@link InMemoryBusinessReceiptRepository}
 * enforces single-issuance: a second `save` with an existing `receiptId` is
 * rejected, preserving the original record.
 */

export class InMemoryCompanyRepository implements CompanyRepository {
  private readonly entries = new Map<string, Company>();

  async save(company: Company): Promise<Readonly<Company>> {
    this.entries.set(company.companyId, company);
    return company;
  }

  async get(companyId: string): Promise<Company | undefined> {
    return this.entries.get(companyId);
  }
}

export class InMemoryDelegationRepository implements DelegationRepository {
  private readonly entries = new Map<string, Delegation>();

  async save(delegation: Delegation): Promise<Readonly<Delegation>> {
    this.entries.set(delegation.delegationId, delegation);
    return delegation;
  }

  async get(delegationId: string): Promise<Delegation | undefined> {
    return this.entries.get(delegationId);
  }
}

export class InMemoryWorkRepository implements WorkRepository {
  private readonly entries = new Map<string, Work>();

  async save(work: Work): Promise<Readonly<Work>> {
    this.entries.set(work.workId, work);
    return work;
  }

  async get(workId: string): Promise<Work | undefined> {
    return this.entries.get(workId);
  }
}

export class InMemoryBusinessReceiptRepository implements BusinessReceiptRepository {
  private readonly entries = new Map<string, BusinessReceipt>();

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    if (this.entries.has(receipt.receiptId)) {
      throw new Error(`BusinessReceipt already issued: ${receipt.receiptId}`);
    }
    this.entries.set(receipt.receiptId, receipt);
    return receipt;
  }

  async get(receiptId: string): Promise<BusinessReceipt | undefined> {
    return this.entries.get(receiptId);
  }
}
