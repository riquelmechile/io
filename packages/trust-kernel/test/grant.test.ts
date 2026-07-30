import { describe, expect, it } from 'vitest';

import type { KernelAction, PrincipalId } from '../src/model.js';
import { checkGrant, validateGrant, type Grant, type GrantDecision } from '../src/grant.js';

/** Deny-by-default explicit grant (Req 4; Threat: ambient/expired authority).
 * Every action DENIED unless an explicit bounded grant exists; no ambient
 * authority; grant is command-bound and re-evaluated per action; any failure is
 * a terminal DENY. */

const principalId: PrincipalId = 'principal-1';
const command = 'execute';
const authority = 'operator:execute';

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: 'g1',
    principalId,
    command,
    authority,
    scope: 'region:us',
    start: 1000,
    expiry: 9000,
    ...overrides,
  };
}

function action(overrides: Partial<KernelAction> = {}): KernelAction {
  return { actionId: 'a1', command, impactScore: 25, ...overrides };
}

describe('Deny-by-default explicit grant (Req 4)', () => {
  describe('validateGrant — bounded grant shape', () => {
    it.each([
      ['missing grant id', grant({ grantId: undefined }), /grant id/i],
      ['missing command', grant({ command: undefined }), /command/i],
      ['missing authority', grant({ authority: undefined }), /authority/i],
      ['missing scope', grant({ scope: undefined }), /scope/i],
      ['missing start', grant({ start: undefined }), /start/i],
      ['indefinite (no expiry)', grant({ expiry: undefined }), /expir/i],
      ['expiry not after start', grant({ start: 5000, expiry: 5000 }), /after start/i],
    ])('rejects %s so it grants no authority', (_label, g, reasonPattern) => {
      const result = validateGrant(g);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(reasonPattern);
    });

    it('accepts a well-formed bounded grant', () => {
      expect(validateGrant(grant()).valid).toBe(true);
    });
  });

  describe('checkGrant — deny-by-default', () => {
    it('denies when no grant exists', () => {
      const decision = checkGrant(action(), principalId, [], 1500);
      expect(decision.decision).toBe('DENY');
      expect(decision.authority).toBeNull();
    });

    it.each([
      ['unbounded (no scope)', [grant({ scope: undefined })]],
      ['unbounded (no expiry)', [grant({ expiry: undefined })]],
      ['expired', [grant({ expiry: 1200 })]],
      ['revoked', [grant({ revoked: true })]],
      ['wrong command', [grant({ command: 'purge' })]],
      ['different principal', [grant({ principalId: 'principal-2' })]],
    ])('denies for a %s grant and yields no authority', (_label, grants) => {
      const decision = checkGrant(action(), principalId, grants, 1500);
      expect(decision.decision).toBe('DENY');
      expect(decision.authority).toBeNull();
      expect(decision.reason).toMatch(/grant|authority|denied/i);
    });

    it('allows only with a current, bounded, command-bound grant and returns its authority', () => {
      const decision = checkGrant(action(), principalId, [grant()], 1500);
      expect(decision.decision).toBe('ALLOW');
      expect(decision.authority).toBe(authority);
    });

    it('ignores an invalid grant even when a second valid one matches', () => {
      const grants = [grant({ grantId: 'bad', scope: undefined }), grant({ grantId: 'ok' })];
      const decision = checkGrant(action(), principalId, grants, 1500);
      expect(decision.decision).toBe('ALLOW');
      expect(decision.authority).toBe(authority);
    });

    it('is re-evaluated per input: the same grant denies once expired', () => {
      const sameGrant = grant();
      expect(checkGrant(action(), principalId, [sameGrant], 1500).decision).toBe('ALLOW');
      expect(checkGrant(action(), principalId, [sameGrant], 9500).decision).toBe('DENY');
    });

    it('is command-bound: a grant for one command does not authorize another', () => {
      const grants = [grant({ command: 'purge' })];
      expect(checkGrant(action({ command: 'execute' }), principalId, grants, 1500).decision).toBe(
        'DENY',
      );
    });

    it('treats any failure as a terminal DENY (no authority leaks)', () => {
      const failed: GrantDecision = checkGrant(action(), principalId, [], 1500);
      expect(failed.decision).toBe('DENY');
      expect(failed.authority).toBeNull();
    });
  });
});
