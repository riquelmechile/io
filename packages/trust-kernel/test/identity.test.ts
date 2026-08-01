import { describe, expect, it } from 'vitest';

import type { TemporaryAssignment } from '../src/model.js';
import type { PrincipalIdentity } from '../src/identity.js';
import { resolveActiveIdentity, validateTemporaryAssignment } from '../src/identity.js';

/**
 * Neutral identity & bounded roles (Req 2; Threat: ambient/expired authority).
 * IDs are neutral and reference no package-specific entity. A principal holds
 * exactly one immutable primary role plus zero or more compatible temporary
 * roles. Temporary roles MUST be bounded; expiry/revocation strip their
 * authority while the primary role is unchanged. No role grants ambient
 * authority.
 */

const principalId = 'principal-1';
const positionId = 'position-1';

function temp(overrides: Partial<TemporaryAssignment> = {}): TemporaryAssignment {
  return {
    principalId,
    positionId,
    role: 'auditor',
    assignmentId: 'a1',
    scope: 'region:us',
    start: 1000,
    expiry: 9000,
    ...overrides,
  };
}

function identityWith(assignments: readonly TemporaryAssignment[]): PrincipalIdentity {
  return { principalId, primaryRole: 'operator', temporaryAssignments: assignments };
}

describe('Neutral identity & bounded roles (Req 2)', () => {
  describe('validateTemporaryAssignment', () => {
    it.each([
      ['indefinite (no expiry)', temp({ expiry: undefined }), /expir/i],
      ['missing assignment id', temp({ assignmentId: undefined }), /assignment id/i],
      ['missing bounded scope', temp({ scope: undefined }), /scope/i],
      ['missing start', temp({ start: undefined }), /start/i],
      ['expiry not after start', temp({ start: 5000, expiry: 5000 }), /after start/i],
    ])('rejects %s so it grants no authority', (_label, assignment, reasonPattern) => {
      const result = validateTemporaryAssignment(assignment);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(reasonPattern);
    });

    it('accepts a well-formed bounded temporary assignment', () => {
      expect(validateTemporaryAssignment(temp()).valid).toBe(true);
    });
  });

  describe('expiry / revocation preserve the primary role', () => {
    it.each([
      ['expired', temp({ expiry: 2000 })],
      ['revoked', temp({ revoked: true })],
      ['indefinite (invalid)', temp({ expiry: undefined })],
    ])('strips a %s temporary role while the primary role is unchanged', (_label, assignment) => {
      const active = resolveActiveIdentity(identityWith([assignment]), 5000);
      expect(active.primaryRole).toBe('operator');
      expect(active.activeRoles).toEqual(['operator']);
      expect(active.activeAssignments).toEqual([]);
    });

    it('keeps a current, non-revoked temporary role alongside the primary role', () => {
      const active = resolveActiveIdentity(
        identityWith([temp({ role: 'auditor', start: 1000, expiry: 9000 })]),
        1500,
      );
      expect(active.primaryRole).toBe('operator');
      expect(active.activeRoles).toEqual(['operator', 'auditor']);
      expect(active.activeAssignments).toHaveLength(1);
    });

    it('strips a temporary role whose start is in the future (start > now)', () => {
      const active = resolveActiveIdentity(
        identityWith([temp({ role: 'auditor', start: 2000, expiry: 9000 })]),
        1500,
      );
      expect(active.primaryRole).toBe('operator');
      expect(active.activeRoles).toEqual(['operator']);
      expect(active.activeAssignments).toEqual([]);
    });

    it('keeps a temporary role on the boundary start == now', () => {
      const active = resolveActiveIdentity(
        identityWith([temp({ role: 'auditor', start: 1500, expiry: 9000 })]),
        1500,
      );
      expect(active.activeRoles).toEqual(['operator', 'auditor']);
    });

    it('strips a temporary role on the boundary now == expiry', () => {
      const active = resolveActiveIdentity(
        identityWith([temp({ role: 'auditor', start: 1000, expiry: 1500 })]),
        1500,
      );
      expect(active.activeRoles).toEqual(['operator']);
      expect(active.activeAssignments).toEqual([]);
    });
  });

  describe('temporary roles carry no ambient authority', () => {
    it('grants no authority from merely holding an active temporary role', () => {
      const active = resolveActiveIdentity(identityWith([temp({ role: 'auditor' })]), 1500);
      // The temporary role is held and active, yet identity grants nothing:
      // authority is deny-by-default and comes only from explicit grants later.
      expect(active.activeRoles).toContain('auditor');
      expect(active.authority).toEqual([]);
    });
  });
});
