import type { Authority, Decision, Evidence, RiskClass } from './model.js';
import { NON_PERSISTENT_DISCLOSURE } from './evidence.js';

/**
 * Honest receipt disclosure (Req 8): non-persistent AND unsigned, with no
 * cryptographic or durable guarantee implied. Built on the shared
 * non-persistent disclosure so evidence and receipt declare consistently.
 */
export const RECEIPT_DISCLOSURE = `${NON_PERSISTENT_DISCLOSURE}; unsigned; not a cryptographic or durable guarantee`;

/**
 * An honest in-memory receipt (Req 8). Unsigned and non-persistent — `signed`
 * and `persistent` are literal `false` so the type carries the honesty contract.
 * Identifies the work/action ID, the authority reference used, the risk class,
 * the evidence summary, and the terminal state.
 */
export interface UnsignedInMemoryReceipt {
  readonly receiptId: string;
  readonly actionId: string;
  readonly authority: Authority | null;
  readonly riskClass: RiskClass;
  readonly evidenceSummary: string;
  readonly terminalState: Decision;
  readonly signed: false;
  readonly persistent: false;
  readonly disclosure: string;
}

/** Input to receipt issuance. */
export interface ReceiptInput {
  readonly actionId: string;
  readonly authority: Authority | null;
  readonly riskClass: RiskClass;
  readonly terminalState: Decision;
  readonly evidence: Evidence;
  readonly receiptId?: string;
  readonly now: number;
}

/**
 * Issue one honest unsigned, non-persistent receipt for an ALLOWED decision
 * (Req 8). Returns `null` for any non-ALLOW terminal state — a DENY yields no
 * receipt. The receipt honestly records the authority reference used (which may
 * be null) and derives its evidence summary from the captured evidence.
 */
export function issueReceipt(input: ReceiptInput): UnsignedInMemoryReceipt | null {
  if (input.terminalState !== 'ALLOW') return null;
  return {
    receiptId: input.receiptId ?? `receipt:${input.actionId}:${input.now}`,
    actionId: input.actionId,
    authority: input.authority,
    riskClass: input.riskClass,
    evidenceSummary: summarizeEvidence(input.evidence),
    terminalState: input.terminalState,
    signed: false,
    persistent: false,
    disclosure: RECEIPT_DISCLOSURE,
  };
}

/**
 * Derive a pure deterministic summary of an evidence record (Req 8). Same
 * evidence always yields the same summary; different evidence yields a different
 * summary.
 */
export function summarizeEvidence(evidence: Evidence): string {
  return `${evidence.decision}:${evidence.riskClass}:${evidence.actionId}:${evidence.timestamp}`;
}
