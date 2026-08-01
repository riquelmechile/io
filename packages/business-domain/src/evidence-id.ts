/**
 * Stable business evidence identity (design D8): `ev:${companyId}:${idempotencyKey}`.
 * The evidence produced by an idempotent business operation is identified by
 * its tenant scope + idempotency key, so RETRIES of the same operation produce
 * the SAME identity — never a per-attempt actionId, nonce, or now()-based id.
 * Used in the terminal-close/receipt path (D6): the receipt references this
 * stable identity in its evidenceRefs. Pure function, zero deps.
 */
export function evidenceId(companyId: string, idempotencyKey: string): string {
  return `ev:${companyId}:${idempotencyKey}`;
}
