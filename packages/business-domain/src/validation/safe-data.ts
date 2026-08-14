import type { ParseResult } from './command.js';

/**
 * Descriptor-safe unknown-data foundation (Slice 1E-a): `readClosedDataRecord`
 * and `readDenseDataArray` validate untrusted records/arrays by OWN property
 * descriptors — never by property reads — so getters never execute, prototypes
 * are never consulted, and adversarial values (symbols, hidden fields,
 * accessors, custom prototypes, revoked proxies) are failures, never throws.
 * Both reconstruct fresh containers and never mutate or freeze the input.
 * Internal module: NOT exported from the package index.
 */

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** Own DATA descriptor (accessors excluded); `length` may be non-enumerable. */
const isOwnData = (d: PropertyDescriptor | undefined): d is PropertyDescriptor =>
  d !== undefined && !('get' in d) && !('set' in d);

/** Own enumerable DATA descriptor (the only shape allowed for record fields). */
const isData = (d: PropertyDescriptor | undefined): d is PropertyDescriptor =>
  isOwnData(d) && d.enumerable === true;

/** Closed record: plain/null prototype; own enumerable string data fields only; no injected keys. */
export function readClosedDataRecord(
  raw: unknown,
  path: string,
  allowedKeys: ReadonlySet<string>,
): ParseResult<Record<string, unknown>> {
  try {
    if (typeof raw !== 'object' || raw === null) return fail(`${path} must be a plain object`);
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) return fail(`${path} must be a plain object`);
    const out: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(raw)) {
      if (typeof key !== 'string') return fail(`${path} must not carry symbol fields`);
      if (!allowedKeys.has(key)) return fail(`${path} must not carry injected field "${key}"`);
      const d = Object.getOwnPropertyDescriptor(raw, key);
      if (!isData(d)) return fail(`${path} must expose only own enumerable data fields`);
      out[key] = d.value;
    }
    return { ok: true, value: out };
  } catch {
    return fail(`${path} is not a safe plain data structure`);
  }
}

/** Dense canonical array: Array.prototype; own data length; exact index descriptors; no extras. */
export function readDenseDataArray(raw: unknown, path: string): ParseResult<unknown[]> {
  try {
    if (typeof raw !== 'object' || raw === null) return fail(`${path} must be a dense array`);
    if (Object.getPrototypeOf(raw) !== Array.prototype)
      return fail(`${path} must be a dense array`);
    const keys = Reflect.ownKeys(raw);
    const lenD = Object.getOwnPropertyDescriptor(raw, 'length');
    if (!isOwnData(lenD) || typeof lenD.value !== 'number' || !Number.isInteger(lenD.value)) {
      return fail(`${path} must be a dense array`);
    }
    const n = lenD.value;
    if (n < 0 || keys.length !== n + 1 || keys[n] !== 'length')
      return fail(`${path} must be a dense array`);
    const out: unknown[] = [];
    for (let i = 0; i < n; i += 1) {
      if (keys[i] !== String(i)) return fail(`${path} must be a dense array`);
      const d = Object.getOwnPropertyDescriptor(raw, i);
      if (!isData(d)) return fail(`${path} must be a dense array`);
      out.push(d.value);
    }
    return { ok: true, value: out };
  } catch {
    return fail(`${path} is not a safe plain data structure`);
  }
}
