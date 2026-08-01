import type { BusinessReceipt, Company, Delegation, Work } from '../types.js';
import type {
  BusinessReceiptRepository,
  CasResult,
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
