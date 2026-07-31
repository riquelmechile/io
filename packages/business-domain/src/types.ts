/**
 * Pure domain types for the business vertical: Company, Delegation, Work, and
 * BusinessReceipt (ADR-0001/0002/0003). Every field is a plain primitive or
 * value object — NO framework, persistence, or cross-aggregate import. All
 * cross-aggregate references use neutral string IDs (D3: receiving a task never
 * grants ambient authority; aggregates don't import each other).
 */

// ── Company (minimal: identity + scope, architecture doc §4) ──

export interface Company {
  readonly companyId: string;
  readonly purpose: string;
}

// ── Delegation (ADR-0002: authority commitment) ──

export type DelegationState = 'draft' | 'active' | 'revoked' | 'expired';

export interface AuthorityScope {
  readonly scope: string;
  readonly actions: readonly string[];
}

export interface Budget {
  readonly currency: string;
  readonly limit: number;
}

export interface Delegation {
  readonly delegationId: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly authorityScope: AuthorityScope;
  readonly budget: Budget;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly expectedOutcome: string;
  readonly state: DelegationState;
}

// ── Work (ADR-0002: execution, separate from authority) ──

export type WorkState =
  | 'proposed'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'rejected';

export interface Deliverable {
  readonly description: string;
  readonly format?: string;
}

export interface WorkOutcome {
  readonly result: string;
  readonly success: boolean;
}

export interface Work {
  readonly workId: string;
  readonly delegationId: string;
  readonly proposer: string;
  readonly description: string;
  readonly state: WorkState;
  readonly deliverable?: Deliverable;
  readonly evidenceRefs: readonly string[];
  readonly outcome?: WorkOutcome;
}

// ── BusinessReceipt (immutable, persisted; ≠ UnsignedInMemoryReceipt) ──

export interface BusinessReceipt {
  readonly receiptId: string;
  readonly workId: string;
  readonly delegationId: string;
  readonly actor: string;
  readonly policyHash: string;
  readonly evidenceRefs: readonly string[];
  readonly terminalState: string;
  readonly artifactHash: string;
  readonly issuedAt: number;
}
