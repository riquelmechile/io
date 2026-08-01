import { beforeAll, describe, expect, it } from 'vitest';

import type { AuditEntry, KernelAction, PrincipalId } from '../src/model.js';
import { NON_PERSISTENT_DISCLOSURE } from '../src/evidence.js';
import type { Grant } from '../src/grant.js';
import type { PrincipalIdentity } from '../src/identity.js';
import {
  DEFERRED_STEPS,
  evaluate,
  type EvaluationInput,
  type EvaluationResult,
} from '../src/pipeline.js';
import { RECEIPT_DISCLOSURE } from '../src/receipt.js';
import type { RiskThresholds } from '../src/risk.js';
import type { SodAssignment } from '../src/sod.js';

/**
 * Scoped in-memory evaluation pipeline (Req 3 ordering, Req 4, Req 5, Req 7,
 * Req 8, Req 9; Threat: order bypass + Persistence-Free Scoping). Fixed 16-step
 * order with classify BEFORE grant; every enforced gate denies on failure
 * (terminal DENY); the six deferred steps are documented no-op pass-throughs;
 * allow yields decision+evidence+audit+receipt, deny yields audit only.
 */

const principalId: PrincipalId = 'p1';
const command = 'execute';
const thresholds: RiskThresholds = { lowMax: 10, mediumMax: 50 };

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    grantId: 'g1',
    principalId,
    command: 'execute',
    authority: 'op:execute',
    scope: 'region:us',
    start: 1000,
    expiry: 9000,
    ...overrides,
  };
}

function principal(overrides: Partial<PrincipalIdentity> = {}): PrincipalIdentity {
  return { principalId, primaryRole: 'operator', temporaryAssignments: [], ...overrides };
}

function action(overrides: Partial<KernelAction> = {}): KernelAction {
  return { actionId: 'a1', command, impactScore: 25, ...overrides };
}

/** Medium risk (impact 25) needs 4-way distinct SOD. */
const fourWay: SodAssignment[] = [
  { role: 'proposer', principalId: 'p1' },
  { role: 'approver', principalId: 'p2' },
  { role: 'executor', principalId: 'p3' },
  { role: 'verifier', principalId: 'p4' },
];

/** High/critical risk needs 5-way distinct SOD (adds authorizer). */
const fiveWay: SodAssignment[] = [...fourWay, { role: 'authorizer', principalId: 'p5' }];

/** A valid prior audit entry, independent of the production builder. */
function priorEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actionId: 'prior',
    principalId,
    riskClass: 'low',
    decision: 'DENY',
    reason: 'prior evaluation',
    timestamp: 500,
    persistent: false,
    disclosure: NON_PERSISTENT_DISCLOSURE,
    ...overrides,
  };
}

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    principal: principal(),
    action: action(),
    grants: [grant()],
    sodAssignments: fourWay,
    thresholds,
    now: 1500,
    ...overrides,
  };
}

describe('Scoped in-memory evaluation pipeline (Req 5)', () => {
  describe('fixed 16-step order; classify BEFORE grant (Req 3, Req 5)', () => {
    let result: EvaluationResult;
    beforeAll(async () => {
      result = await evaluate(input());
    });

    it('runs exactly 16 steps for an allowed evaluation in canonical order', () => {
      expect(result.steps).toHaveLength(16);
      expect(result.steps.map((step) => step.id)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);
    });

    it('classifies risk at step 1, strictly before authority at step 3', () => {
      const classification = result.steps.find((step) => step.name === 'classification');
      const authority = result.steps.find((step) => step.name === 'authority');
      expect(classification?.id).toBe(1);
      expect(authority?.id).toBe(3);
      expect((classification?.id ?? 0) < (authority?.id ?? 0)).toBe(true);
    });

    it('produces the risk class that drives downstream SOD (medium for impact 25)', () => {
      expect(result.risk).toBe('medium');
      expect(result.steps[0]?.reason).toContain('medium');
    });
  });

  describe('classification drives SOD: reserved -> critical -> five-way (Req 3, Req 6)', () => {
    it('classifies a reserved category as critical and allows with five-way SOD', async () => {
      const result = await evaluate(
        input({ action: action({ category: 'capital' }), sodAssignments: fiveWay }),
      );
      expect(result.risk).toBe('critical');
      expect(result.decision).toBe('ALLOW');
    });

    it('denies critical risk when only four-way SOD is present (missing authorizer)', async () => {
      const result = await evaluate(input({ action: action({ category: 'capital' }) }));
      expect(result.risk).toBe('critical');
      expect(result.decision).toBe('DENY');
      expect(result.reason).toMatch(/duties|distinct|sod|missing/i);
    });
  });

  describe('six deferred steps are documented no-op pass-throughs (Req 5, io-ports)', () => {
    let result: EvaluationResult;
    beforeAll(async () => {
      result = await evaluate(input());
    });

    it('has exactly six deferred steps with the canonical names in order', () => {
      const deferred = result.steps.filter((step) => step.deferred);
      expect(deferred.map((step) => step.name)).toEqual([...DEFERRED_STEPS]);
      expect(deferred).toHaveLength(6);
    });

    it.each([...DEFERRED_STEPS])(
      '%s is a DEFERRED no-op pass-through documenting harden-downstream (never silent ALLOW)',
      (name) => {
        const step = result.steps.find((entry) => entry.name === name);
        expect(step?.deferred).toBe(true);
        expect(step?.passThrough).toBe(true);
        expect(step?.decision).toBe('DEFERRED');
        expect(step?.reason).toMatch(/deferred|harden|pass-through|downstream/i);
      },
    );

    it('never implements real deferred behavior: pass-throughs never gate the decision', () => {
      for (const name of DEFERRED_STEPS) {
        const step = result.steps.find((entry) => entry.name === name);
        expect(step?.decision).toBe('DEFERRED');
      }
      expect(result.decision).toBe('ALLOW');
    });

    it('records a non-ALLOW marker on every deferred step (no silent ALLOW)', () => {
      for (const step of result.steps.filter((entry) => entry.deferred)) {
        expect(step.decision).not.toBe('ALLOW');
        expect(step.decision).toBe('DEFERRED');
      }
    });
  });

  describe('every enforced gate denies on failure (terminal DENY) (Req 4, Req 5)', () => {
    it.each([
      ['classification', input({ action: action({ actionId: '' }) }), /identif|action/i, 1],
      [
        'authority',
        input({ grants: [grant({ principalId: 'other' })] }),
        /grant|principal|absent/i,
        3,
      ],
      ['identity', input({ principal: principal({ primaryRole: '' }) }), /role|identity/i, 5],
      [
        'assignment',
        input({ grants: [grant({ grantId: '' })] }),
        /assignment|well-formed|grant/i,
        6,
      ],
      ['bounded-scope', input({ grants: [grant({ scope: undefined })] }), /scope|bound/i, 7],
      [
        'sod',
        input({
          sodAssignments: [
            { role: 'approver', principalId: 'p1' },
            { role: 'executor', principalId: 'p1' },
            { role: 'proposer', principalId: 'p2' },
            { role: 'verifier', principalId: 'p3' },
          ],
        }),
        /duties|distinct|sod|self/i,
        10,
      ],
      ['expiry', input({ grants: [grant({ expiry: 1200 })] }), /expir|revoke|active/i, 12],
      ['action-scope', input({ grants: [grant({ command: 'purge' })] }), /command|scope/i, 14],
    ])(
      'denies at %s and terminates there',
      async (_gate, evaluationInput, reasonPattern, stepId) => {
        const result = await evaluate(evaluationInput);
        expect(result.decision).toBe('DENY');
        expect(result.reason).toMatch(reasonPattern);
        const failed = result.steps[result.steps.length - 1];
        expect(failed?.id).toBe(stepId);
        expect(failed?.decision).toBe('DENY');
      },
    );

    it('treats a revoked grant as a terminal DENY at expiry', async () => {
      const result = await evaluate(input({ grants: [grant({ revoked: true })] }));
      expect(result.decision).toBe('DENY');
      expect(result.steps[result.steps.length - 1]?.id).toBe(12);
    });

    it('denies a grant whose window has not started (future start) at the expiry gate', async () => {
      const result = await evaluate(input({ grants: [grant({ start: 2000 })] }));
      expect(result.decision).toBe('DENY');
      expect(result.steps[result.steps.length - 1]?.id).toBe(12);
      expect(result.steps[result.steps.length - 1]?.decision).toBe('DENY');
    });

    it('allows a grant on the boundary start == now', async () => {
      const result = await evaluate(input({ grants: [grant({ start: 1500 })], now: 1500 }));
      expect(result.decision).toBe('ALLOW');
    });
  });

  describe('allow produces decision, evidence, audit, and receipt (Req 7, Req 8)', () => {
    const prior = [priorEntry()];
    let result: EvaluationResult;
    beforeAll(async () => {
      result = await evaluate(input({ priorAuditLog: prior }));
    });

    it('decides ALLOW', () => {
      expect(result.decision).toBe('ALLOW');
    });

    it('captures a non-persistent evidence record reflecting the decision and risk', () => {
      expect(result.evidence.persistent).toBe(false);
      expect(result.evidence.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
      expect(result.evidence.decision).toBe('ALLOW');
      expect(result.evidence.riskClass).toBe('medium');
    });

    it('appends exactly one audit entry to the prior log', () => {
      expect(result.auditLog).toHaveLength(prior.length + 1);
      expect(result.auditLog[prior.length]?.decision).toBe('ALLOW');
      expect(result.auditLog[prior.length]?.persistent).toBe(false);
    });

    it('issues an unsigned non-persistent receipt carrying authority and terminal state', () => {
      expect(result.receipt).toBeDefined();
      expect(result.receipt?.signed).toBe(false);
      expect(result.receipt?.persistent).toBe(false);
      expect(result.receipt?.disclosure).toBe(RECEIPT_DISCLOSURE);
      expect(result.receipt?.terminalState).toBe('ALLOW');
      expect(result.receipt?.authority).toBe('op:execute');
      expect(result.receipt?.riskClass).toBe('medium');
    });

    it('selects the matching command grant when an earlier grant for the principal differs', async () => {
      const result = await evaluate(
        input({
          grants: [
            grant({ grantId: 'wrong-command', command: 'purge', authority: 'op:purge' }),
            grant({ grantId: 'matching-command', command: 'execute', authority: 'op:execute' }),
          ],
        }),
      );
      expect(result.decision).toBe('ALLOW');
      expect(result.receipt?.authority).toBe('op:execute');
    });
  });

  describe('deny appends one audit entry and issues no receipt (Req 7, Req 8)', () => {
    let result: EvaluationResult;
    beforeAll(async () => {
      result = await evaluate(input({ grants: [] }));
    });

    it('decides DENY', () => {
      expect(result.decision).toBe('DENY');
    });

    it('appends exactly one audit entry disclosing non-persistence', () => {
      expect(result.auditLog).toHaveLength(1);
      expect(result.auditLog[0]?.decision).toBe('DENY');
      expect(result.auditLog[0]?.persistent).toBe(false);
    });

    it('issues no receipt', () => {
      expect(result.receipt).toBeUndefined();
    });

    it('captures a DENY evidence record', () => {
      expect(result.evidence.decision).toBe('DENY');
      expect(result.evidence.persistent).toBe(false);
    });
  });

  describe('callers must await evaluate (Req 5)', () => {
    it('returns a Promise whose resolution carries the decision', async () => {
      const promise = evaluate(input());
      expect(promise).toBeInstanceOf(Promise);
      await expect(promise).resolves.toMatchObject({ decision: 'ALLOW' });
    });

    it('a denied evaluation is obtained only after awaiting the Promise', async () => {
      await expect(evaluate(input({ grants: [] }))).resolves.toMatchObject({ decision: 'DENY' });
    });
  });

  describe('pipeline holds no surviving state (Req 1)', () => {
    it('does not mutate the prior audit log', async () => {
      const prior = [priorEntry()];
      await evaluate(input({ priorAuditLog: prior }));
      expect(prior).toHaveLength(1);
    });

    it('repeated evaluations from the same prior log stay independent', async () => {
      const prior: AuditEntry[] = [];
      const a = await evaluate(input({ priorAuditLog: prior }));
      const b = await evaluate(input({ priorAuditLog: prior }));
      expect(a.auditLog).not.toBe(b.auditLog);
      expect(a.auditLog).toHaveLength(1);
      expect(b.auditLog).toHaveLength(1);
    });
  });
});
