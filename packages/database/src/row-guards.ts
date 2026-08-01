import type {
  BusinessEvent,
  BusinessReceipt,
  Deliverable,
  Skill,
  SkillState,
  Work,
  WorkOutcome,
  WorkState,
} from '@io/business-domain/src/index.js';
import { isSkillState } from '@io/business-domain/src/index.js';

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

/** A `business_event` payload read from PG: a plain (non-null, non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a `business_event` table row (as aliased by the adapter) before use.
 * The six identity/kind/source strings must be non-empty, `occurredAt` a number,
 * and `payload` a plain object (PG JSONB — never null/array). Rows read from PG
 * are UNTRUSTED bytes (D7): a corrupt row is an integrity violation — fail loudly.
 */
export function parseBusinessEventRow(input: unknown): RowGuardResult<BusinessEvent> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('business event row must be an object');
  }
  const row = input as Record<string, unknown>;

  for (const field of [
    'eventId',
    'companyId',
    'aggregateKind',
    'aggregateId',
    'eventType',
    'source',
  ] as const) {
    if (!isNonEmptyString(row[field])) {
      return fail(`business event row ${field} must be a non-empty string`);
    }
  }
  if (typeof row.occurredAt !== 'number') {
    return fail('business event row occurredAt must be a number');
  }
  if (!isPlainObject(row.payload)) {
    return fail('business event row payload must be a plain object');
  }

  return {
    ok: true,
    value: {
      eventId: row.eventId as string,
      companyId: row.companyId as string,
      aggregateKind: row.aggregateKind as string,
      aggregateId: row.aggregateId as string,
      eventType: row.eventType as string,
      occurredAt: row.occurredAt,
      payload: row.payload as Readonly<Record<string, unknown>>,
      source: row.source as string,
    },
  };
}

/**
 * Validate a `skill` table row (as aliased by the adapter) before use. The
 * identity/name/body strings must be non-empty, `version` a positive integer
 * (≥1), the two timestamps numbers, `state` one of the explicit Skill
 * lifecycle values (R4 — reuses the domain `isSkillState` guard, design
 * "PG reuses"), and `scope` a plain object carrying a non-empty `process`
 * and a `schemaVersion` ≥ 1 (design §007 cohort discriminators). Rows read
 * from PG are UNTRUSTED bytes (D7): a corrupt row is an integrity violation —
 * fail loudly.
 */
export function parseSkillRow(input: unknown): RowGuardResult<Skill> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('skill row must be an object');
  }
  const row = input as Record<string, unknown>;

  for (const field of ['skillId', 'companyId', 'name', 'body'] as const) {
    if (!isNonEmptyString(row[field])) {
      return fail(`skill row ${field} must be a non-empty string`);
    }
  }
  if (!isPositiveInteger(row.version)) {
    return fail('skill row version must be a positive integer');
  }
  if (typeof row.createdAt !== 'number') {
    return fail('skill row createdAt must be a number');
  }
  if (typeof row.updatedAt !== 'number') {
    return fail('skill row updatedAt must be a number');
  }
  if (typeof row.state !== 'string' || !isSkillState(row.state)) {
    return fail('skill row state must be one of: draft, active, retired');
  }
  if (!isPlainObject(row.scope)) {
    return fail('skill row scope must be a plain object');
  }
  const scope = row.scope as Record<string, unknown>;
  if (!isNonEmptyString(scope.process)) {
    return fail('skill row scope.process must be a non-empty string');
  }
  if (!isPositiveInteger(scope.schemaVersion)) {
    return fail('skill row scope.schemaVersion must be a positive integer');
  }

  return {
    ok: true,
    value: {
      skillId: row.skillId as string,
      companyId: row.companyId as string,
      name: row.name as string,
      version: row.version,
      body: row.body as string,
      scope: { process: scope.process as string, schemaVersion: scope.schemaVersion },
      state: row.state as SkillState,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}
