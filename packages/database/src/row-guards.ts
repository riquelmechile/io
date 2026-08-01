import type {
  BusinessReceipt,
  Deliverable,
  Work,
  WorkOutcome,
  WorkState,
} from '@io/business-domain/src/index.js';

/**
 * PostgreSQL row guards (design D7, runtime-validation spec). Rows read from
 * PostgreSQL are UNTRUSTED bytes: adapters MUST validate them at runtime before
 * use. Each guard accepts `unknown` and returns `{ok:true,value}` for a
 * well-formed row or `{ok:false,reason}` for a corrupt one — rejection is an
 * explicit result, never a thrown exception used for control flow, and never a
 * silent pass-through. `deliverable`/`outcome` normalize PG `NULL` → `undefined`
 * (nullable JSONB columns), mirroring the adapter get() contract.
 */

export type RowGuardResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const WORK_STATES: ReadonlySet<string> = new Set([
  'proposed',
  'accepted',
  'in_progress',
  'completed',
  'verified',
  'rejected',
]);

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Validate a `work` table row (as aliased by the adapter) before use. */
export function parseWorkRow(input: unknown): RowGuardResult<Work> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('work row must be an object');
  }
  const row = input as Record<string, unknown>;

  if (!isNonEmptyString(row.workId)) return fail('work row workId must be a non-empty string');
  if (!isNonEmptyString(row.companyId))
    return fail('work row companyId must be a non-empty string');
  if (!isNonEmptyString(row.delegationId)) {
    return fail('work row delegationId must be a non-empty string');
  }
  if (!isNonEmptyString(row.proposer)) return fail('work row proposer must be a non-empty string');
  if (!isNonEmptyString(row.description)) {
    return fail('work row description must be a non-empty string');
  }
  if (typeof row.state !== 'string' || !WORK_STATES.has(row.state)) {
    return fail(`work row state must be one of: ${[...WORK_STATES].join(', ')}`);
  }
  if (!isPositiveInteger(row.version)) {
    return fail('work row version must be a positive integer');
  }
  if (!isStringArray(row.evidenceRefs)) {
    return fail('work row evidenceRefs must be an array of strings');
  }

  const deliverable =
    row.deliverable === null || row.deliverable === undefined
      ? undefined
      : (row.deliverable as Deliverable);
  const outcome =
    row.outcome === null || row.outcome === undefined ? undefined : (row.outcome as WorkOutcome);

  return {
    ok: true,
    value: {
      workId: row.workId,
      companyId: row.companyId,
      delegationId: row.delegationId,
      proposer: row.proposer,
      description: row.description,
      state: row.state as WorkState,
      version: row.version,
      evidenceRefs: row.evidenceRefs,
      deliverable,
      outcome,
    },
  };
}

/** Validate a `business_receipt` table row (as aliased by the adapter) before use. */
export function parseBusinessReceiptRow(input: unknown): RowGuardResult<BusinessReceipt> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('business receipt row must be an object');
  }
  const row = input as Record<string, unknown>;

  for (const field of [
    'receiptId',
    'companyId',
    'workId',
    'delegationId',
    'actor',
    'policyHash',
    'terminalState',
    'terminalEventId',
    'artifactHash',
  ] as const) {
    if (!isNonEmptyString(row[field])) {
      return fail(`business receipt row ${field} must be a non-empty string`);
    }
  }
  if (!isStringArray(row.evidenceRefs)) {
    return fail('business receipt row evidenceRefs must be an array of strings');
  }
  if (typeof row.issuedAt !== 'number') {
    return fail('business receipt row issuedAt must be a number');
  }

  return {
    ok: true,
    value: {
      receiptId: row.receiptId as string,
      companyId: row.companyId as string,
      workId: row.workId as string,
      delegationId: row.delegationId as string,
      actor: row.actor as string,
      policyHash: row.policyHash as string,
      evidenceRefs: row.evidenceRefs,
      terminalState: row.terminalState as string,
      terminalEventId: row.terminalEventId as string,
      artifactHash: row.artifactHash as string,
      issuedAt: row.issuedAt,
    },
  };
}
