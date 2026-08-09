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
  readonly companyId: string;
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
  readonly companyId: string;
  readonly delegationId: string;
  readonly proposer: string;
  readonly description: string;
  readonly state: WorkState;
  /** Numeric optimistic-concurrency counter; initialized to 1 on creation
   * (ADR-0002). CAS bumps it by one on each successful transition. */
  readonly version: number;
  /**
   * Claim-scoped fencing token (zombie-writer protection, fencing-tokens
   * change): monotonic counter minted server-side at the Work claim CAS and
   * required on every claim-owned terminal write. Initialized to 0 — the valid
   * pre-fencing epoch (legacy rows / unclaimed work). A fresh claim increments
   * it by one inside the same CAS; resume retains the stored token.
   */
  readonly fencingToken: number;
  readonly deliverable?: Deliverable;
  readonly evidenceRefs: readonly string[];
  readonly outcome?: WorkOutcome;
}

// ── BusinessReceipt (immutable, persisted; ≠ UnsignedInMemoryReceipt) ──

export interface BusinessReceipt {
  readonly receiptId: string;
  readonly companyId: string;
  readonly workId: string;
  readonly delegationId: string;
  readonly actor: string;
  readonly policyHash: string;
  readonly evidenceRefs: readonly string[];
  readonly terminalState: string;
  /** Terminal event (the attempt) that closed the work (D5). UNIQUE with
   * workId in the repository — a single terminal close per work. */
  readonly terminalEventId: string;
  readonly artifactHash: string;
  readonly issuedAt: number;
}

// ── BusinessEvent (append-only business-fact log, deterministic) ──

export interface BusinessEvent {
  /** Single-issuance identity: `evt:{attemptId}` (R7). */
  readonly eventId: string;
  /** Non-empty tenant scope (ADR-0002/R8). */
  readonly companyId: string;
  /** Aggregate the event belongs to — 'work' for this capability. */
  readonly aggregateKind: string;
  /** Aggregate instance id — the workId. */
  readonly aggregateId: string;
  /** Event name — 'work.completed' for terminal closes. */
  readonly eventType: string;
  /** Epoch ms timestamp (deps.now?.() ?? Date.now()). */
  readonly occurredAt: number;
  /** Terminal-close facts ONLY — never LLM output (R6). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Emitter — 'worker'. */
  readonly source: string;
}

// ── Skill (versioned, immutable; first-skill capability) ──

/**
 * Explicit lifecycle of a Skill version (R4): only `draft`, `active`, or
 * `retired`. A guard MUST reject every other state; only `active` Skills MAY be
 * selected for a cohort.
 */
export type SkillState = 'draft' | 'active' | 'retired';

/**
 * Cohort discriminators of a Skill (design: `{process, schemaVersion}`). A
 * Skill is eligible for the cohort whose `process` and `schemaVersion` BOTH
 * match — selection is a pure function of cohort values and Skill state/scope.
 */
export interface SkillScope {
  readonly process: string;
  /** ≥1 — the cohort schema version, never 0 (design). */
  readonly schemaVersion: number;
}

/**
 * Immutable versioned Skill (R1). Construction is DETERMINISTIC from
 * caller-supplied values: every field is supplied by the caller — the type
 * reads NO clocks and generates NO identifiers. A new version is a NEW record
 * (append-only, UNIQUE(companyId, skillId, version)); a duplicate identity is
 * rejected and the original preserved.
 */
export interface Skill {
  readonly skillId: string;
  /** Non-empty tenant scope (R7) — every read carries it. */
  readonly companyId: string;
  readonly name: string;
  /** ≥1, caller-supplied version of this Skill record. */
  readonly version: number;
  readonly body: string;
  readonly scope: SkillScope;
  readonly state: SkillState;
  /** Epoch ms timestamp, caller-supplied (deterministic construction). */
  readonly createdAt: number;
  readonly updatedAt: number;
}
