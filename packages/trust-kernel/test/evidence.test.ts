import { describe, expect, it } from 'vitest';

import type { AuditEntry, PrincipalId, RiskClass } from '../src/model.js';
import { NON_PERSISTENT_DISCLOSURE, captureEvidence, type EvidenceInput } from '../src/evidence.js';

/** In-memory evidence and audit (Req 7; Threat: persistent-record overclaim).
 * Every evaluation — ALLOW or DENY — appends EXACTLY one disclosed non-persistent
 * audit entry; the audit list is immutable and no state survives returned values. */

const principalId: PrincipalId = 'principal-1';
const actionId = 'action-1';

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    actionId,
    principalId,
    riskClass: 'medium' as RiskClass,
    decision: 'ALLOW',
    reason: 'explicit grant matched',
    now: 1000,
    ...overrides,
  };
}

/** A valid prior audit entry, independent of the production builder. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actionId: 'prior',
    principalId,
    riskClass: 'low' as RiskClass,
    decision: 'DENY',
    reason: 'prior evaluation',
    timestamp: 500,
    persistent: false,
    disclosure: NON_PERSISTENT_DISCLOSURE,
    ...overrides,
  };
}

describe('In-memory evidence and audit (Req 7)', () => {
  describe('captureEvidence — exactly one audit entry for ALLOW and DENY', () => {
    it('appends exactly one audit entry on ALLOW', () => {
      expect(captureEvidence(input({ decision: 'ALLOW' }), []).auditLog).toHaveLength(1);
    });

    it('appends exactly one audit entry on DENY', () => {
      expect(captureEvidence(input({ decision: 'DENY' }), []).auditLog).toHaveLength(1);
    });

    it('appends one entry to a non-empty prior log', () => {
      const prior = [entry()];
      const { auditLog } = captureEvidence(input(), prior);
      expect(auditLog).toHaveLength(2);
      expect(auditLog[1]?.actionId).toBe(actionId);
    });
  });

  describe('each entry declares it is non-persistent', () => {
    it('marks the ALLOW entry non-persistent with the shared disclosure', () => {
      const e = captureEvidence(input({ decision: 'ALLOW' }), []).auditLog[0];
      expect(e?.persistent).toBe(false);
      expect(e?.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
    });

    it('marks the DENY entry non-persistent with the shared disclosure', () => {
      const e = captureEvidence(input({ decision: 'DENY' }), []).auditLog[0];
      expect(e?.persistent).toBe(false);
      expect(e?.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
    });
  });

  describe('audit entry records principal/action/risk/decision/reason', () => {
    it('carries every required field from the input', () => {
      const e = captureEvidence(input({ reason: 'no current grant' }), []).auditLog[0];
      expect(e?.principalId).toBe(principalId);
      expect(e?.actionId).toBe(actionId);
      expect(e?.riskClass).toBe('medium');
      expect(e?.decision).toBe('ALLOW');
      expect(e?.reason).toBe('no current grant');
    });
  });

  describe('evidence record captures the evaluation and discloses non-persistence', () => {
    it('mirrors the input and is marked non-persistent', () => {
      const { evidence } = captureEvidence(input(), []);
      expect(evidence.actionId).toBe(actionId);
      expect(evidence.principalId).toBe(principalId);
      expect(evidence.riskClass).toBe('medium');
      expect(evidence.decision).toBe('ALLOW');
      expect(evidence.persistent).toBe(false);
      expect(evidence.disclosure).toBe(NON_PERSISTENT_DISCLOSURE);
    });
  });

  describe('audit list is immutable — no state survives returned values', () => {
    it('does not mutate the prior audit log', () => {
      const prior = [entry()];
      captureEvidence(input(), prior);
      expect(prior).toHaveLength(1);
    });

    it('returns a new list reference distinct from the prior list', () => {
      const prior: AuditEntry[] = [];
      const { auditLog } = captureEvidence(input(), prior);
      expect(auditLog).not.toBe(prior);
    });

    it('holds no module-level state: repeated calls from the same prior log stay length 1', () => {
      const prior: AuditEntry[] = [];
      const a = captureEvidence(input(), prior).auditLog;
      const b = captureEvidence(input(), prior).auditLog;
      expect(a).not.toBe(b);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    it('chains only through returned lists: two sequential appends grow 1 -> 2', () => {
      const first = captureEvidence(input({ reason: 'one' }), []);
      const second = captureEvidence(input({ reason: 'two' }), first.auditLog);
      expect(first.auditLog).toHaveLength(1);
      expect(second.auditLog).toHaveLength(2);
      expect(second.auditLog[0]?.reason).toBe('one');
      expect(second.auditLog[1]?.reason).toBe('two');
    });
  });
});
