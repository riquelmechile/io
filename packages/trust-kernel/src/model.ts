/**
 * Neutral identity, role, assignment, action, and risk types for the
 * transitional trust kernel. Neutral IDs reference no package-specific entity
 * (Req 2). Remaining types (grant, evidence, audit, receipt, step result, full
 * pipeline input) arrive in later slices, added when their tests require them.
 */

/** Neutral principal identifier — references no package-specific entity. */
export type PrincipalId = string;
/** Neutral position identifier — references no package-specific entity. */
export type PositionId = string;
/** A role label held by a principal (primary or temporary). */
export type Role = string;
/** A bounded scope string for a temporary assignment or grant. */
export type Scope = string;
/** A command/action identifier a grant is bound to. */
export type CommandId = string;
/** An explicit authority claim (deny-by-default; never ambient). */
export type Authority = string;

/** Authority-evaluation decision. Deny-by-default (Req 4). */
export type Decision = 'ALLOW' | 'DENY';

/**
 * A bounded validity window shared by temporary assignments and grants (Req 2,
 * Req 4). Both records carry scope + start + expiry + revocation; the shared
 * window validation lives once in {@link validateBoundedWindow}.
 */
export interface BoundedWindow {
  readonly scope?: Scope;
  readonly start?: number;
  readonly expiry?: number;
  readonly revoked?: boolean;
}

/** Shared structural-validation outcome shape. */
export interface ValidationOutcome {
  readonly valid: boolean;
  readonly reason: string;
}

/**
 * Validate the shared bounded window: a scope, a start, and a non-indefinite
 * expiry after start. Indefinite expiry is INVALID. Shared by identity
 * (temporary assignments) and grant (authority grants) so the expiry/scope rule
 * has a single source of truth.
 */
export function validateBoundedWindow(window: BoundedWindow): ValidationOutcome {
  if (!window.scope) {
    return { valid: false, reason: 'a bounded scope is required' };
  }
  if (window.start === undefined) {
    return { valid: false, reason: 'a start is required' };
  }
  if (window.expiry === undefined) {
    return { valid: false, reason: 'an expiry is required (indefinite is invalid)' };
  }
  if (window.expiry <= window.start) {
    return { valid: false, reason: 'expiry must be after start' };
  }
  return { valid: true, reason: 'ok' };
}

/**
 * A temporary role assignment. A VALID assignment MUST declare an assignment ID,
 * explicit bounded scope, start, and expiry (indefinite is INVALID). Fields are
 * optional so invalid fixtures can be constructed and rejected. Revocation is a
 * state flag, not a structural validity concern. [ADR-0001]
 */
export interface TemporaryAssignment {
  readonly principalId: PrincipalId;
  readonly positionId: PositionId;
  readonly role: Role;
  readonly assignmentId?: string;
  readonly scope?: Scope;
  readonly start?: number;
  readonly expiry?: number;
  readonly revoked?: boolean;
}

/** Risk classification tiers. */
export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

/** The five source-reserved categories that ALWAYS classify as critical (Req 3). */
export type ReservedCategory =
  | 'purpose'
  | 'capital'
  | 'critical-limits'
  | 'irreversible'
  | 'constitutional-modification';

/** An action to classify and (later) evaluate. */
export interface KernelAction {
  readonly actionId: string;
  readonly command: CommandId;
  readonly category?: ReservedCategory | string;
  readonly impactScore?: number;
}

/**
 * Fields shared by every in-memory kernel record (Req 7, Req 8). All such
 * records are non-persistent and disclose that fact; `persistent` is a literal
 * `false` so the honesty contract is carried by the type, not just runtime.
 */
export interface InMemoryRecord {
  readonly actionId: string;
  readonly principalId: PrincipalId;
  readonly riskClass: RiskClass;
  readonly decision: Decision;
  readonly reason: string;
  readonly timestamp: number;
  readonly persistent: false;
  readonly disclosure: string;
}

/**
 * A durable-capable record produced through a repository port (Req 3). Diverges
 * from {@link InMemoryRecord} ONLY on the `persistent` literal (`true` vs
 * `false`) so the type system records which records are durable-capable. The
 * durability truth lives in the adapter-supplied `disclosure`, NOT the literal:
 * the literal is a port-contract path marker (D6/D8). Field order mirrors
 * {@link InMemoryRecord} exactly.
 */
export interface PersistentRecord {
  readonly actionId: string;
  readonly principalId: PrincipalId;
  readonly riskClass: RiskClass;
  readonly decision: Decision;
  readonly reason: string;
  readonly timestamp: number;
  readonly persistent: true;
  readonly disclosure: string;
}

/**
 * In-memory evidence captured for one evaluation (Req 7). NOT persisted and does
 * NOT satisfy persistent R1–R17 obligations. At this minimum stage the evidence
 * record and the audit entry share the same shape; they diverge when
 * persistence arrives.
 */
export type Evidence = InMemoryRecord;

/** One in-memory audit entry recording principal/action/risk/decision/reason
 * (Req 7). NOT persisted; discloses its non-persistent nature. */
export type AuditEntry = InMemoryRecord;

/**
 * Durable-capable evidence routed through the evidence repository port (R7).
 * Aliases {@link PersistentRecord}; routed evidence and audit share the same
 * durable-capable shape during the transition.
 */
export type PersistentEvidence = PersistentRecord;

/**
 * Durable-capable audit entry routed through the audit repository port (R16).
 * Aliases {@link PersistentRecord}.
 */
export type PersistentAuditEntry = PersistentRecord;
