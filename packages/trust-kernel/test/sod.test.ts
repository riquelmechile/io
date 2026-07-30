import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '../src/model.js';
import {
  checkSod,
  type SodAssignment,
  type SodInput,
  type SodPolicy,
  type SodRole,
} from '../src/sod.js';

/** In-memory separation of duties (Req 6; Threat: SOD overlap). No self-approve
 * / self-verify at any tier; medium four-way, high/critical five-way distinct;
 * low combines only when policy permits. Every prohibited overlap MUST DENY. */

const p1: PrincipalId = 'p1';
const p2: PrincipalId = 'p2';
const p3: PrincipalId = 'p3';
const p4: PrincipalId = 'p4';
const p5: PrincipalId = 'p5';
const ALL_TIERS = ['low', 'medium', 'high', 'critical'] as const;

/** Build role→principal assignments from explicit pairs. */
function assign(...pairs: ReadonlyArray<readonly [SodRole, PrincipalId]>): SodAssignment[] {
  return pairs.map(([role, principalId]) => ({ role, principalId }));
}

/** Four mutually distinct core roles (proposer/approver/executor/verifier). */
const FOUR_WAY = assign(['proposer', p1], ['approver', p2], ['executor', p3], ['verifier', p4]);

/** Five mutually distinct roles (adds an authorizer for high/critical). */
const FIVE_WAY = assign(
  ['proposer', p1],
  ['approver', p2],
  ['executor', p3],
  ['verifier', p4],
  ['authorizer', p5],
);

describe('In-memory separation of duties (Req 6)', () => {
  describe('no self-approval / self-verification at ANY tier', () => {
    it.each(ALL_TIERS)('denies self-approval (approver == executor) at %s risk', (risk) => {
      const assignments = assign(
        ['proposer', p2],
        ['approver', p1],
        ['executor', p1],
        ['verifier', p3],
        ['authorizer', p4],
      );
      const policy: SodPolicy | undefined =
        risk === 'low' ? { allowsLowCombination: true } : undefined;
      const decision = checkSod({ risk, assignments, policy });
      expect(decision.decision).toBe('DENY');
      expect(decision.reason).toMatch(/self|approv|verif|distinct|overlap|separation/i);
    });

    it.each(ALL_TIERS)('denies self-verification (verifier == executor) at %s risk', (risk) => {
      const assignments = assign(
        ['proposer', p1],
        ['approver', p2],
        ['executor', p3],
        ['verifier', p3],
        ['authorizer', p4],
      );
      const policy: SodPolicy | undefined =
        risk === 'low' ? { allowsLowCombination: true } : undefined;
      const decision = checkSod({ risk, assignments, policy });
      expect(decision.decision).toBe('DENY');
    });
  });

  describe('medium risk — four-way distinctness', () => {
    it('allows when proposer/approver/executor/verifier are mutually distinct', () => {
      const decision = checkSod({ risk: 'medium', assignments: FOUR_WAY });
      expect(decision.decision).toBe('ALLOW');
    });

    it.each([
      [
        'proposer == approver',
        assign(['proposer', p1], ['approver', p1], ['executor', p3], ['verifier', p4]),
      ],
      [
        'approver == executor',
        assign(['proposer', p1], ['approver', p2], ['executor', p2], ['verifier', p4]),
      ],
      [
        'executor == verifier',
        assign(['proposer', p1], ['approver', p2], ['executor', p3], ['verifier', p3]),
      ],
      [
        'proposer == verifier',
        assign(['proposer', p1], ['approver', p2], ['executor', p3], ['verifier', p1]),
      ],
    ])('denies when %s', (_label, assignments) => {
      expect(checkSod({ risk: 'medium', assignments }).decision).toBe('DENY');
    });

    it('denies when a required core role is missing', () => {
      const assignments = assign(['proposer', p1], ['approver', p2], ['executor', p3]);
      expect(checkSod({ risk: 'medium', assignments }).decision).toBe('DENY');
    });

    it('does not let policy relax medium-risk distinctness', () => {
      const assignments = assign(
        ['proposer', p1],
        ['approver', p1],
        ['executor', p3],
        ['verifier', p4],
      );
      const decision = checkSod({
        risk: 'medium',
        assignments,
        policy: { allowsLowCombination: true },
      });
      expect(decision.decision).toBe('DENY');
    });
  });

  describe('high and critical risk — five-way distinctness', () => {
    it.each(['high', 'critical'] as const)(
      'allows %s risk with five mutually distinct principals',
      (risk) => {
        expect(checkSod({ risk, assignments: FIVE_WAY }).decision).toBe('ALLOW');
      },
    );

    it.each(['high', 'critical'] as const)(
      'denies %s risk when the authorizer is missing',
      (risk) => {
        expect(checkSod({ risk, assignments: FOUR_WAY }).decision).toBe('DENY');
      },
    );

    it.each(['high', 'critical'] as const)(
      'denies %s risk when any two of the five roles overlap',
      (risk) => {
        const assignments = assign(
          ['proposer', p1],
          ['approver', p2],
          ['executor', p3],
          ['verifier', p4],
          ['authorizer', p1],
        );
        expect(checkSod({ risk, assignments }).decision).toBe('DENY');
      },
    );
  });

  describe('low risk — combines only when policy permits', () => {
    it('allows a combinable overlap (proposer == executor) when policy permits', () => {
      const assignments = assign(
        ['proposer', p1],
        ['approver', p2],
        ['executor', p1],
        ['verifier', p3],
      );
      const input: SodInput = { risk: 'low', assignments, policy: { allowsLowCombination: true } };
      expect(checkSod(input).decision).toBe('ALLOW');
    });

    it('denies the same overlap when policy does NOT permit combination', () => {
      const assignments = assign(
        ['proposer', p1],
        ['approver', p2],
        ['executor', p1],
        ['verifier', p3],
      );
      expect(checkSod({ risk: 'low', assignments }).decision).toBe('DENY');
    });
  });
});
