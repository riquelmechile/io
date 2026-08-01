/**
 * Command guard (design D7, runtime-validation spec): `parseCommand(unknown)`
 * validates business command inputs at RUNTIME and returns
 * `{ ok: true; value } | { ok: false; reason }`. It performs REAL structural
 * checks — a value that satisfies the static type but is corrupt at runtime
 * (e.g. `companyId: 42`) MUST be rejected; TypeScript types are never treated
 * as validation. Rejection is an explicit RESULT, never a thrown exception used
 * for control flow. This module lives in business-domain and imports ZERO
 * @io/* packages (business-domain purity).
 */

/** Shared typed guard result: `{ok:true,value}` or `{ok:false,reason}`. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The validated business command envelope (mirrors the use-case cmd, D3). */
export interface BusinessCommand {
  readonly companyId: string;
  readonly actor: string;
  readonly workId?: string;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly requestHash?: string;
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export function parseCommand(input: unknown): ParseResult<BusinessCommand> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('command must be an object');
  }
  const record = input as Record<string, unknown>;

  const companyId = record.companyId;
  if (typeof companyId !== 'string' || companyId === '') {
    return fail('command.companyId must be a non-empty string');
  }
  const actor = record.actor;
  if (typeof actor !== 'string' || actor === '') {
    return fail('command.actor must be a non-empty string');
  }

  const workId = record.workId;
  if (workId !== undefined && (typeof workId !== 'string' || workId === '')) {
    return fail('command.workId must be a non-empty string');
  }
  const expectedVersion = record.expectedVersion;
  if (
    expectedVersion !== undefined &&
    (typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1)
  ) {
    return fail('command.expectedVersion must be a positive integer');
  }
  const idempotencyKey = record.idempotencyKey;
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== 'string' || idempotencyKey === '')
  ) {
    return fail('command.idempotencyKey must be a non-empty string');
  }
  const requestHash = record.requestHash;
  if (requestHash !== undefined && (typeof requestHash !== 'string' || requestHash === '')) {
    return fail('command.requestHash must be a non-empty string');
  }

  return {
    ok: true,
    value: {
      companyId,
      actor,
      ...(workId !== undefined ? { workId } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(requestHash !== undefined ? { requestHash } : {}),
    },
  };
}
