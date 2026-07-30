import { describe, expect, it } from 'vitest';

import type { Evidence, PrincipalId } from '../src/model.js';
import { NON_PERSISTENT_DISCLOSURE, captureEvidence } from '../src/evidence.js';
import { issueReceipt, summarizeEvidence, type ReceiptInput } from '../src/receipt.js';

/** Honest in-memory receipt (Req 8; Threat: receipt overclaim). A receipt is
 * produced ONLY on ALLOW; it carries work/action ID, authority reference, risk
 * class, evidence summary, terminal state, and an explicit unsigned /
 * non-persistent disclosure. DENY yields no receipt. */

const principalId: PrincipalId = 'principal-1';
const actionId = 'action-1';
const authority = 'operator:execute';

/** A real non-persistent evidence record, built through the evidence module. */
function evidence(overrides: { actionId?: string; now?: number } = {}): Evidence {
  return captureEvidence(
    {
      actionId: overrides.actionId ?? actionId,
      principalId,
      riskClass: 'high',
      decision: 'ALLOW',
      reason: 'explicit grant matched',
      now: overrides.now ?? 1000,
    },
    [],
  ).evidence;
}

function receiptInput(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    actionId,
    authority,
    riskClass: 'high',
    terminalState: 'ALLOW',
    evidence: evidence(),
    now: 1000,
    ...overrides,
  };
}

describe('Honest in-memory receipt (Req 8)', () => {
  describe('issueReceipt — produced only on ALLOW', () => {
    it('produces a receipt on ALLOW', () => {
      expect(issueReceipt(receiptInput({ terminalState: 'ALLOW' }))).not.toBeNull();
    });

    it('yields no receipt on DENY (even with an authority present)', () => {
      expect(issueReceipt(receiptInput({ terminalState: 'DENY', authority }))).toBeNull();
    });

    it('produces a distinct receipt for a different action (not a constant)', () => {
      const a = issueReceipt(receiptInput({ actionId: 'a-1' }));
      const b = issueReceipt(receiptInput({ actionId: 'a-2' }));
      expect(a?.actionId).toBe('a-1');
      expect(b?.actionId).toBe('a-2');
      expect(a?.receiptId).not.toBe(b?.receiptId);
    });
  });

  describe('receipt honesty — carries every required field and disclosure', () => {
    const ev = evidence();
    const receipt = issueReceipt(receiptInput({ evidence: ev }));

    it('carries the work/action ID', () => {
      expect(receipt?.actionId).toBe(actionId);
    });

    it('carries the authority reference used', () => {
      expect(receipt?.authority).toBe(authority);
    });

    it('carries the risk class', () => {
      expect(receipt?.riskClass).toBe('high');
    });

    it('carries the evidence summary', () => {
      expect(receipt?.evidenceSummary).toBe(summarizeEvidence(ev));
    });

    it('carries the terminal state', () => {
      expect(receipt?.terminalState).toBe('ALLOW');
    });

    it('carries a receipt id', () => {
      expect(typeof receipt?.receiptId).toBe('string');
      expect(receipt?.receiptId.length).toBeGreaterThan(0);
    });

    it('declares it is unsigned', () => {
      expect(receipt?.signed).toBe(false);
    });

    it('declares it is non-persistent', () => {
      expect(receipt?.persistent).toBe(false);
    });

    it('carries an explicit unsigned / non-persistent disclosure', () => {
      expect(receipt?.disclosure).toContain(NON_PERSISTENT_DISCLOSURE);
      expect(receipt?.disclosure.toLowerCase()).toContain('unsigned');
    });
  });

  describe('summarizeEvidence — pure deterministic summary', () => {
    it('derives a stable summary from the same evidence record', () => {
      const ev = evidence();
      expect(summarizeEvidence(ev)).toBe(summarizeEvidence(ev));
    });

    it('produces a different summary for different evidence', () => {
      const a = evidence({ actionId: 'a-1' });
      const b = evidence({ actionId: 'a-2' });
      expect(summarizeEvidence(a)).not.toBe(summarizeEvidence(b));
    });
  });
});
