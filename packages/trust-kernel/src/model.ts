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
