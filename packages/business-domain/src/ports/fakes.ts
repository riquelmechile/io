import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';
import type {
  BusinessReceiptRepository,
  CompanyRepository,
  DelegationRepository,
  IdempotencyRegisterResult,
  IdempotencyStore,
  WorkRepository,
} from './repositories.js';
import { IdempotencyConflictError, NotFoundError, VersionConflictError } from './repositories.js';

/**
 * In-memory fake adapters for the four business-domain repository ports.
 * Map-backed, immutable returns, NO database/network/daemon/framework. Usable as
 * unit-test doubles. Scoped gets require matching companyId. The
 * {@link InMemoryBusinessReceiptRepository} enforces single-issuance by
 * receiptId and by (workId, terminalEventId).
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

  async get(delegationId: string, companyId: string): Promise<Delegation | undefined> {
    const row = this.entries.get(delegationId);
    if (row === undefined || row.companyId !== companyId) return undefined;
    return row;
  }
}

export class InMemoryWorkRepository implements WorkRepository {
  private readonly entries = new Map<string, Work>();

  async save(work: Work): Promise<Readonly<Work>> {
    this.entries.set(work.workId, work);
    return work;
  }

  async get(workId: string, companyId: string): Promise<Work | undefined> {
    const row = this.entries.get(workId);
    if (row === undefined || row.companyId !== companyId) return undefined;
    return row;
  }

  async updateWithVersion(work: Work, expectedVersion: number): Promise<Readonly<Work>> {
    const current = this.entries.get(work.workId);
    if (current === undefined || current.companyId !== work.companyId) {
      throw new NotFoundError(`work not found: ${work.workId}`);
    }
    if (current.version !== expectedVersion) {
      throw new VersionConflictError(
        `expected version ${expectedVersion}, found ${current.version}`,
      );
    }
    const updated: Work = { ...work, version: expectedVersion + 1 };
    this.entries.set(work.workId, updated);
    return updated;
  }
}

export class InMemoryBusinessReceiptRepository implements BusinessReceiptRepository {
  private readonly entries = new Map<string, BusinessReceipt>();
  private readonly byTerminal = new Map<string, string>();

  async save(receipt: BusinessReceipt): Promise<Readonly<BusinessReceipt>> {
    if (this.entries.has(receipt.receiptId)) {
      throw new Error(`BusinessReceipt already issued: ${receipt.receiptId}`);
    }
    const terminalKey = `${receipt.workId}:${receipt.terminalEventId}`;
    if (this.byTerminal.has(terminalKey)) {
      throw new Error(`BusinessReceipt already issued for terminal event: ${terminalKey}`);
    }
    this.entries.set(receipt.receiptId, receipt);
    this.byTerminal.set(terminalKey, receipt.receiptId);
    return receipt;
  }

  async get(receiptId: string, companyId: string): Promise<BusinessReceipt | undefined> {
    const row = this.entries.get(receiptId);
    if (row === undefined || row.companyId !== companyId) return undefined;
    return row;
  }
}

interface JournalEntry {
  readonly hash: string;
  status: 'in_progress' | 'completed';
  result?: unknown;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, JournalEntry>();

  private key(companyId: string, op: string, key: string): string {
    return `${companyId}:${op}:${key}`;
  }

  async register(
    companyId: string,
    op: string,
    key: string,
    hash: string,
  ): Promise<IdempotencyRegisterResult> {
    const k = this.key(companyId, op, key);
    const existing = this.entries.get(k);
    if (existing === undefined) {
      this.entries.set(k, { hash, status: 'in_progress' });
      return { status: 'proceed' };
    }
    if (existing.hash !== hash) {
      return { status: 'conflict' };
    }
    if (existing.status === 'completed') {
      return { status: 'replay', result: existing.result };
    }
    return { status: 'proceed' };
  }

  async complete(
    companyId: string,
    op: string,
    key: string,
    hash: string,
    result: unknown,
  ): Promise<void> {
    const k = this.key(companyId, op, key);
    const existing = this.entries.get(k);
    if (existing === undefined) {
      this.entries.set(k, { hash, status: 'completed', result });
      return;
    }
    if (existing.hash !== hash) {
      throw new IdempotencyConflictError(`hash mismatch for ${k}`);
    }
    existing.status = 'completed';
    existing.result = result;
  }
}
