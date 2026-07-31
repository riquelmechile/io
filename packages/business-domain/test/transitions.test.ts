import { describe, expect, it } from 'vitest';

import type { DelegationState, WorkState } from '../src/types.js';
import { canTransitionDelegation, canTransitionWork } from '../src/transitions.js';

describe('Delegation state machine', () => {
  describe('valid transitions', () => {
    const valid: ReadonlyArray<[DelegationState, DelegationState]> = [
      ['draft', 'active'],
      ['active', 'revoked'],
      ['active', 'expired'],
    ];

    for (const [from, to] of valid) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransitionDelegation(from, to)).toBe(true);
      });
    }
  });

  describe('invalid transitions', () => {
    const invalid: ReadonlyArray<[DelegationState, DelegationState]> = [
      ['draft', 'revoked'],
      ['draft', 'expired'],
      ['draft', 'draft'],
      ['active', 'draft'],
      ['active', 'active'],
    ];

    for (const [from, to] of invalid) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransitionDelegation(from, to)).toBe(false);
      });
    }
  });

  describe('terminal states reject all transitions', () => {
    const terminals: ReadonlyArray<DelegationState> = ['revoked', 'expired'];
    const allStates: ReadonlyArray<DelegationState> = ['draft', 'active', 'revoked', 'expired'];

    for (const terminal of terminals) {
      for (const target of allStates) {
        it(`revoked/expired terminal "${terminal}" rejects → ${target}`, () => {
          expect(canTransitionDelegation(terminal, target)).toBe(false);
        });
      }
    }
  });
});

describe('Work state machine', () => {
  describe('valid transitions', () => {
    const valid: ReadonlyArray<[WorkState, WorkState]> = [
      ['proposed', 'accepted'],
      ['proposed', 'rejected'],
      ['accepted', 'in_progress'],
      ['in_progress', 'completed'],
      ['completed', 'verified'],
      ['completed', 'rejected'],
    ];

    for (const [from, to] of valid) {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransitionWork(from, to)).toBe(true);
      });
    }
  });

  describe('invalid transitions', () => {
    const invalid: ReadonlyArray<[WorkState, WorkState]> = [
      ['proposed', 'in_progress'],
      ['proposed', 'completed'],
      ['proposed', 'verified'],
      ['accepted', 'verified'],
      ['accepted', 'rejected'],
      ['accepted', 'completed'],
      ['in_progress', 'verified'],
      ['in_progress', 'rejected'],
      ['completed', 'proposed'],
      ['completed', 'in_progress'],
    ];

    for (const [from, to] of invalid) {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransitionWork(from, to)).toBe(false);
      });
    }
  });

  describe('terminal states reject all transitions', () => {
    const terminals: ReadonlyArray<WorkState> = ['verified', 'rejected'];
    const allStates: ReadonlyArray<WorkState> = [
      'proposed',
      'accepted',
      'in_progress',
      'completed',
      'verified',
      'rejected',
    ];

    for (const terminal of terminals) {
      for (const target of allStates) {
        it(`verified/rejected terminal "${terminal}" rejects → ${target}`, () => {
          expect(canTransitionWork(terminal, target)).toBe(false);
        });
      }
    }
  });

  it('full happy path: proposed → accepted → in_progress → completed → verified', () => {
    let state: WorkState = 'proposed';
    expect(canTransitionWork(state, 'accepted')).toBe(true);
    state = 'accepted';
    expect(canTransitionWork(state, 'in_progress')).toBe(true);
    state = 'in_progress';
    expect(canTransitionWork(state, 'completed')).toBe(true);
    state = 'completed';
    expect(canTransitionWork(state, 'verified')).toBe(true);
  });
});
