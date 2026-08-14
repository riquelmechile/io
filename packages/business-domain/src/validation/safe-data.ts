import type { ParseResult } from './command.js';

/**
 * Descriptor-safe unknown-data foundation (Slice 1E-a): `readClosedDataRecord`
 * and `readDenseDataArray` validate untrusted records/arrays by OWN property
 * descriptors — never by property reads — so getters never execute, prototypes
 * are never consulted, and adversarial values (symbols, hidden fields,
 * accessors, custom prototypes, revoked proxies) are failures, never throws.
 * Both reconstruct fresh containers and never mutate or freeze the input;
 * record outputs are null-prototype so own `__proto__`/`constructor` data
 * fields stay own data with zero inherited leakage.
 * Slice 1E-b: `cloneAndFreezeSafeData` recursively clones safe JSON-like values
 * into a fresh, deeply frozen copy; caller value stays mutable/isolated.
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
    // Null-prototype output: own `__proto__`/`constructor` data fields stay own
    // data and no inherited Object.prototype value can ever leak through.
    const out: Record<string, unknown> = Object.create(null);
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

/** Safe JSON-like data union (mutable form; runtime values carry no getters/custom prototypes). */
export type SafeData = string | number | boolean | null | SafeData[] | { [key: string]: SafeData };

/** Recursively readonly variant of `SafeData` — exactly the shape of fresh frozen clones. */
export type ReadonlySafeData =
  | string
  | number
  | boolean
  | null
  | readonly ReadonlySafeData[]
  | { readonly [key: string]: ReadonlySafeData };

/**
 * Descriptor-safe recursive clone + deep freeze of a JSON-like value: finite
 * numbers, strings, booleans, null, plain/null-proto records, dense arrays.
 * Undefined/non-finite/symbol/function/bigint, accessors, hidden fields,
 * custom prototypes, holes, revoked proxies, cycles → failure, never throw,
 * getters never execute. Output fresh + deeply frozen (null-proto records, no
 * inherited leakage); input never mutated. Returns the concrete
 * `ReadonlySafeData` union — no caller-selected generic T: callers narrow with
 * explicit checks (category checks + casts) before treating values as domain
 * types.
 */
export function cloneAndFreezeSafeData(raw: unknown, path: string): ParseResult<ReadonlySafeData> {
  const cloned = clone(raw, path, new Set<object>());
  if (!cloned.ok) return cloned;
  return { ok: true, value: cloned.value as ReadonlySafeData };
}

/** Supported scalar: finite number, string, boolean, or null (canonical JSON-like values). */
const isSupportedScalar = (v: unknown): v is number | string | boolean | null =>
  v === null ||
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v));

function clone(raw: unknown, path: string, seen: Set<object>): ParseResult<unknown> {
  if (isSupportedScalar(raw)) return { ok: true, value: raw };
  if (typeof raw !== 'object' || raw === null)
    return fail(`${path} must be a supported JSON-like value`);
  if (seen.has(raw)) return fail(`${path} must not contain a cycle`);
  seen.add(raw);
  try {
    const proto = Object.getPrototypeOf(raw);
    if (proto === Array.prototype) {
      const dense = readDenseDataArray(raw, path);
      if (!dense.ok) return dense;
      const out: unknown[] = [];
      for (const item of dense.value) {
        const child = clone(item, `${path}[${out.length}]`, seen);
        if (!child.ok) return child;
        out.push(child.value);
      }
      return { ok: true, value: Object.freeze(out) };
    }
    if (proto !== Object.prototype && proto !== null)
      return fail(`${path} must be a plain object or dense array`);
    // Null-prototype output: own `__proto__`/`constructor`/`prototype` data
    // fields stay own data; the output prototype can never be attacker-driven.
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(raw)) {
      if (typeof key !== 'string') return fail(`${path} must not carry symbol fields`);
      const d = Object.getOwnPropertyDescriptor(raw, key);
      if (!isData(d)) return fail(`${path} must expose only own enumerable data fields`);
      const child = clone(d.value, `${path}.${key}`, seen);
      if (!child.ok) return child;
      out[key] = child.value;
    }
    return { ok: true, value: Object.freeze(out) };
  } catch {
    return fail(`${path} is not a safe plain data structure`);
  } finally {
    seen.delete(raw);
  }
}
